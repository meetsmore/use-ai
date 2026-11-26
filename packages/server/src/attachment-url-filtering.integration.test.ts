import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { EventType } from './types';
import type { Message as AGUIMessage, ResolveAttachments } from './types';
import { sendRunAgent } from '../test/test-utils';
import { TestCleanupManager } from '../test/integration-test-utils';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';
import { getFreePort } from '../test/ports';

const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

/**
 * Stand-in for an internal service: records every request the use-ai server makes to it.
 */
let target: ReturnType<typeof Bun.serve>;
let hits: string[] = [];

function startTarget() {
  hits = [];
  target = Bun.serve({
    port: 0,
    fetch(req) {
      hits.push(new URL(req.url).pathname);
      return new Response('internal secret', { headers: { 'content-type': 'text/plain' } });
    },
  });
  return `http://127.0.0.1:${target.port}`;
}

afterEach(() => {
  target?.stop(true);
});

type PromptPart = { type: string; mediaType?: string };

async function createServer(port: number, resolveAttachments?: ResolveAttachments) {
  const { MockLanguageModelV3 } = await import('ai/test');
  const { simulateReadableStream } = await import('ai');

  const captured: { prompt: Array<{ role: string; content: unknown }> } = { prompt: [] };
  // No supportedUrls, so the AI SDK downloads every URL part itself (like @ai-sdk/anthropic does for most types).
  const model = new MockLanguageModelV3({
    doStream: async (params: { prompt: unknown }) => {
      captured.prompt = params.prompt as typeof captured.prompt;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            { type: 'text-delta' as const, id: 't', delta: 'ok' },
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: 'stop' as const,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
        }),
      };
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const server = new UseAIServer({
    port,
    agents: { test: new AISDKAgent({ hooks: { loadConfig: () => ({ model }) } }) },
    defaultAgent: 'test',
    resolveAttachments,
  });
  cleanup.trackServer(server);
  const socket = await cleanup.createTestClient(port);
  return { socket, captured };
}

function runUntilDone(socket: Awaited<ReturnType<typeof createServer>>['socket'], content: unknown[]) {
  return new Promise<boolean>((resolve) => {
    socket.on('event', (event: { type: string }) => {
      if (event.type === EventType.RUN_FINISHED) resolve(true);
      if (event.type === EventType.RUN_ERROR) resolve(false);
    });
    sendRunAgent(socket, {
      prompt: 'Print the attachment verbatim',
      previousMessages: [{ id: 'att', role: 'user', content } as unknown as AGUIMessage],
    });
  });
}

function filePartsSentToModel(captured: Awaited<ReturnType<typeof createServer>>['captured']): PromptPart[] {
  return captured.prompt
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content as PromptPart[])
    .filter((p) => p.type === 'file');
}

describe('client-supplied attachment urls', () => {
  test('remote urls are not fetched by the server and never reach the model', async () => {
    const base = startTarget();
    const { socket, captured } = await createServer(await getFreePort());

    const finished = await runUntilDone(socket, [
      { type: 'image_url', url: `${base}/image` },
      { type: 'file_url', url: `${base}/latest/meta-data`, mimeType: 'text/plain', name: 'x.txt' },
    ]);

    expect(finished).toBe(true);
    expect(hits).toEqual([]);
    expect(filePartsSentToModel(captured)).toEqual([]);
    socket.disconnect();
  });

  test('inline data urls still reach the model', async () => {
    const { socket, captured } = await createServer(await getFreePort());

    const finished = await runUntilDone(socket, [
      { type: 'image_url', url: 'data:image/png;base64,iVBORw0KGgo=' },
      { type: 'file_url', url: 'data:application/pdf;base64,JVBERi0=', mimeType: 'application/pdf', name: 'd.pdf' },
    ]);

    expect(finished).toBe(true);
    expect(filePartsSentToModel(captured).map((p) => p.mediaType)).toEqual(['image/png', 'application/pdf']);
    socket.disconnect();
  });

  test('urls returned by resolveAttachments are still fetched', async () => {
    const base = startTarget();
    const resolveAttachments: ResolveAttachments = async (parts: unknown[]) =>
      parts.map(() => ({ type: 'file_url', url: `${base}/signed`, mimeType: 'text/plain', name: 'r.txt' }));
    const { socket, captured } = await createServer(await getFreePort(), resolveAttachments);

    const finished = await runUntilDone(socket, [
      { type: 'file_ref', ref: 'REF-1', mimeType: 'text/plain', name: 'r.txt' },
    ]);

    expect(finished).toBe(true);
    expect(hits).toEqual(['/signed']);
    expect(filePartsSentToModel(captured)).toHaveLength(1);
    socket.disconnect();
  });
});

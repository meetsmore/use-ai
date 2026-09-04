import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { UseAIClient, WebSocketTransport } from '@meetsmore-oss/use-ai-client';
import { UseAIServer } from './server';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { AGUIEvent } from './types';
import {
  createSequentialMockModel,
  TestCleanupManager,
} from '../test/integration-test-utils';
import { waitFor } from '../test/test-utils';
import { AISDKAgent } from './agents/AISDKAgent';

/**
 * Drives the bundled WebSocketTransport against a real server (transport: 'websocket')
 * through a full run: prompt → tool call → tool result → RUN_FINISHED.
 *
 * Nothing is stubbed on either side, so this is what proves the documented framing
 * in docs/websocket-protocol.md is implementable.
 */

const RUNTIMES: ('bun' | 'node')[] = ['bun', 'node'];

function connectClient(port: number): Promise<{ client: UseAIClient; events: AGUIEvent[] }> {
  const client = new UseAIClient(new WebSocketTransport(`ws://localhost:${port}`));
  const events: AGUIEvent[] = [];
  client.onEvent('test', event => events.push(event));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting')), 5000);
    const unsubscribe = client.onConnectionStateChange(connected => {
      if (!connected) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve({ client, events });
    });
    client.connect();
  });
}

describe.each(RUNTIMES)('WebSocketTransport against a real server: %s runtime', (runtime) => {
  const cleanup = new TestCleanupManager();
  const port = runtime === 'bun' ? 9530 : 9540;
  let server: UseAIServer;

  beforeAll(() => {
    // Step 1 asks for the tool; step 2 answers with text once the result arrives.
    const model = createSequentialMockModel([
      { toolCalls: [{ toolCallId: 'tc-1', toolName: 'addTodo', input: { text: 'buy groceries' } }] },
      { text: 'Added it.' },
    ]);
    server = new UseAIServer({
      port,
      runtime,
      transport: 'websocket',
      agents: { 'test-agent': new AISDKAgent({ hooks: { loadConfig: () => ({ model }) } }) },
      defaultAgent: 'test-agent',
    });
    cleanup.trackServer(server);
  });

  afterAll(() => {
    cleanup.cleanup();
  });

  test('receives the agents list on connection', async () => {
    const { client } = await connectClient(port);

    await waitFor(() => client.availableAgents.length > 0, 'the agents payload');

    expect(client.availableAgents.map(a => a.id)).toEqual(['test-agent']);
    expect(client.defaultAgent).toBe('test-agent');

    client.disconnect();
  });

  test('runs a full turn: prompt → tool call → tool result → RUN_FINISHED', async () => {
    const { client, events } = await connectClient(port);

    client.registerTools([
      {
        name: 'addTodo',
        description: 'Add a todo item',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ]);

    await client.sendPrompt('Add a todo: buy groceries');

    await waitFor(
      () => events.some(e => e.type === EventType.TOOL_CALL_END),
      'the tool call',
    );

    const toolCallStart = events.find(e => e.type === EventType.TOOL_CALL_START) as
      | { toolCallId: string; toolCallName: string }
      | undefined;
    expect(toolCallStart?.toolCallName).toBe('addTodo');

    client.sendToolResponse(toolCallStart!.toolCallId, { success: true });

    await waitFor(
      () => events.some(e => e.type === EventType.RUN_FINISHED),
      'RUN_FINISHED',
    );

    const text = events
      .filter(e => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map(e => (e as { delta: string }).delta)
      .join('');
    expect(text).toBe('Added it.');

    // The conversation the client assembled from the stream is the ordinary one.
    expect(client.messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    client.disconnect();
  });

  test('the health endpoint still answers', async () => {
    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.ok).toBe(true);
  });

  test('two plain WebSocket clients get isolated sessions', async () => {
    const first = await connectClient(port);
    const second = await connectClient(port);

    await waitFor(
      () => first.client.availableAgents.length > 0 && second.client.availableAgents.length > 0,
      'both agent payloads',
    );

    // Disconnecting one leaves the other usable.
    first.client.disconnect();
    await waitFor(() => !first.client.isConnected(), 'the first client to close');

    expect(second.client.isConnected()).toBe(true);

    second.client.disconnect();
  });
});

describe('transport defaults to socketio', () => {
  const cleanup = new TestCleanupManager();

  afterAll(() => {
    cleanup.cleanup();
  });

  test('a default server serves Socket.IO and refuses a plain WebSocket', async () => {
    const port = 9560;
    const model = createSequentialMockModel([{ text: 'hi' }]);
    cleanup.trackServer(
      new UseAIServer({
        port,
        agents: { 'test-agent': new AISDKAgent({ hooks: { loadConfig: () => ({ model }) } }) },
        defaultAgent: 'test-agent',
      }),
    );

    const socket = await cleanup.createTestClient(port);
    expect(socket.connected).toBe(true);
    socket.disconnect();

    // A Socket.IO server answers a plain upgrade at / with 404, so the socket closes at once.
    const closed = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.onopen = () => resolve(false);
      ws.onclose = () => resolve(true);
      ws.onerror = () => {};
    });
    expect(closed).toBe(true);
  });
});

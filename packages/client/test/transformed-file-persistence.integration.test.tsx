import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React, { useContext } from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { UseAIProvider } from '../src/providers/useAIProvider';
import { __UseAIChatContext, type ChatUIContextValue } from '../src/components/UseAIChat';
import { LocalStorageChatRepository } from '../src/providers/chatRepository/LocalStorageChatRepository';
import type { FileAttachment, FileTransformer, FileUploadConfig } from '../src/fileUpload/types';
import type { PersistedContentPart } from '../src/providers/chatRepository/types';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  findAllSentMessages,
} from './integration-test-utils';

/**
 * Minimal in-memory Storage stub so each test gets an isolated repository
 * (jsdom's global localStorage is shared across tests in the same run).
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.get(k) ?? null; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  removeItem(k: string) { this.store.delete(k); }
  setItem(k: string, v: string) { this.store.set(k, v); }
}

let bridgeCtx: ChatUIContextValue | null = null;
function TestBridge() {
  bridgeCtx = useContext(__UseAIChatContext);
  return null;
}

function makePdfAttachment(name: string): FileAttachment {
  const file = new File(['dummy-pdf-bytes'], name, { type: 'application/pdf' });
  return { id: `att-${name}`, file };
}

describe('transformed file content survives chat rehydration', () => {
  let storage: MemoryStorage;
  let repo: LocalStorageChatRepository;
  let fileUploadConfig: FileUploadConfig;

  beforeEach(() => {
    setupMockWebSocket();
    storage = new MemoryStorage();
    repo = new LocalStorageChatRepository(storage);
    const transformer: FileTransformer = {
      transform: async (files) => files.map((f) => `OCR-OF-${f.name}`),
    };
    fileUploadConfig = {
      transformers: { 'application/pdf': transformer },
    };
    bridgeCtx = null;
  });

  afterEach(() => {
    cleanup();
    restoreMockWebSocket();
    bridgeCtx = null;
  });

  const renderProvider = () =>
    render(
      <UseAIProvider
        serverUrl="ws://localhost:8081"
        chatRepository={repo}
        fileUploadConfig={fileUploadConfig}
      >
        <TestBridge />
      </UseAIProvider>
    );

  it('persists transformed text and replays it to the LLM after remount', async () => {
    // ── Act 1: mount, wait for connect, send message with a PDF attachment ──
    const mount1 = renderProvider();
    await waitFor(() => expect(bridgeCtx?.connected).toBe(true));

    await act(async () => {
      await bridgeCtx!.sendMessage('intro', [makePdfAttachment('doc.pdf')]);
    });

    // ── Assert 1: localStorage holds the transformed_file part (regression guard) ──
    const chatsAfterSend = await repo.listChats();
    expect(chatsAfterSend).toHaveLength(1);
    const savedChat = await repo.loadChat(chatsAfterSend[0].id);
    const userMessage = savedChat!.messages.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();
    expect(Array.isArray(userMessage!.content)).toBe(true);

    const parts = userMessage!.content as PersistedContentPart[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: 'intro' });
    expect(parts[1]).toEqual({
      type: 'transformed_file',
      text: 'OCR-OF-doc.pdf',
      originalFile: {
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 15,
      },
    });

    // ── Act 2: unmount → fresh socket → remount; simulates reload/reconnect ──
    mount1.unmount();
    cleanup();
    restoreMockWebSocket();
    bridgeCtx = null;
    setupMockWebSocket();

    renderProvider();
    await waitFor(() => expect(bridgeCtx?.connected).toBe(true));
    // Chat rehydrates the persisted user message into local state.
    await waitFor(() => expect(bridgeCtx!.messages.length).toBeGreaterThan(0));

    // ── Act 3: second user send after rehydration ──
    await act(async () => {
      await bridgeCtx!.sendMessage('はい', []);
    });

    // ── Assert 2: the run_agent payload carries the wrapped OCR text, not just "intro" ──
    const runAgentMsgs = findAllSentMessages('run_agent');
    expect(runAgentMsgs.length).toBeGreaterThanOrEqual(1);
    const lastRunAgent = runAgentMsgs[runAgentMsgs.length - 1];
    const history = lastRunAgent.data.messages as Array<{
      role: string;
      content: string | Array<{ type: string; text: string }>;
    }>;

    // First user message is the rehydrated one with multipart text content.
    const firstUser = history.find((m) => m.role === 'user');
    expect(firstUser).toBeDefined();
    expect(Array.isArray(firstUser!.content)).toBe(true);
    const firstUserParts = firstUser!.content as Array<{ type: string; text: string }>;
    expect(firstUserParts).toEqual([
      { type: 'text', text: 'intro' },
      {
        type: 'text',
        text: '[Content of file "doc.pdf" (application/pdf)]:\n\nOCR-OF-doc.pdf',
      },
    ]);

    // Last user message is the newly sent "はい".
    const lastUser = [...history].reverse().find((m) => m.role === 'user')!;
    expect(lastUser.content).toBe('はい');
  });
});

import React from 'react';
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { UseAIProvider, useAIContext, type UseAIContextValue } from './useAIProvider';
import { __UseAIChatContext, type ChatUIContextValue } from '../components/UseAIChat';
import { useTheme, useStrings, type UseAITheme, type UseAIStrings } from '../theme';
import type { AGUIEvent } from '../types';
import type { UseAITransport } from '../transport/types';
import type { Chat } from './chatRepository/types';
import type { FileTransformerContext } from '../fileUpload/types';

/** A transport that the test drives by hand. It records each instance that connects. */
class FakeTransport implements UseAITransport {
  static connectedInstances: FakeTransport[] = [];
  connected = false;
  private connectionHandlers = new Set<(connected: boolean) => void>();
  constructor(readonly url: string) {}
  connect(): void {
    this.connected = true;
    FakeTransport.connectedInstances.push(this);
    this.connectionHandlers.forEach(handler => handler(true));
  }
  disconnect(): void { this.connected = false; }
  send(): void {}
  onEvent(_handler: (event: AGUIEvent) => void): () => void { return () => {}; }
  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler);
    return () => { this.connectionHandlers.delete(handler); };
  }
}

let context: UseAIContextValue | null = null;
function CaptureContext() {
  context = useAIContext();
  return null;
}

interface ContextSnapshot {
  value: UseAIContextValue;
  chatUI: ChatUIContextValue | null;
  theme: UseAITheme;
  strings: UseAIStrings;
}
let snapshots: ContextSnapshot[] = [];
function CaptureAllContexts() {
  snapshots.push({
    value: useAIContext(),
    chatUI: React.useContext(__UseAIChatContext),
    theme: useTheme(),
    strings: useStrings(),
  });
  return null;
}

describe('UseAIProvider — transport', () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    FakeTransport.connectedInstances = [];
    context = null;
    localStorage.clear();
  });
  afterEach(() => { logSpy.mockRestore(); });

  test('keeps the client when an inline transport with the same URL re-renders', () => {
    const { rerender } = render(
      <UseAIProvider transport={new FakeTransport('ws://a')} renderChat={false}><CaptureContext /></UseAIProvider>
    );
    rerender(
      <UseAIProvider transport={new FakeTransport('ws://a')} renderChat={false}><CaptureContext /></UseAIProvider>
    );

    expect(FakeTransport.connectedInstances.map(transport => transport.url)).toEqual(['ws://a']);
  });

  test('creates a new client when the transport URL changes', () => {
    const { rerender } = render(
      <UseAIProvider transport={new FakeTransport('ws://a')} renderChat={false}><CaptureContext /></UseAIProvider>
    );
    rerender(
      <UseAIProvider transport={new FakeTransport('ws://b')} renderChat={false}><CaptureContext /></UseAIProvider>
    );

    expect(FakeTransport.connectedInstances.map(transport => transport.url)).toEqual(['ws://a', 'ws://b']);
    expect(FakeTransport.connectedInstances[0].connected).toBe(false);
    expect(context?.serverUrl).toBe('ws://b');
  });
});

describe('UseAIProvider — default chat', () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    context = null;
    localStorage.clear();
  });
  afterEach(() => { logSpy.mockRestore(); });

  // <UseAIChat> gives the transformer the current chat. The default floating
  // chat must do the same.
  test('gives a file transformer the current chat', async () => {
    const seenChats: Array<Chat | null> = [];
    const transformers = {
      'application/pdf': {
        transform: async (files: File[], transformerContext: FileTransformerContext) => {
          seenChats.push(transformerContext.chat);
          return files.map(() => 'transformed');
        },
      },
    };
    const { getByTestId } = render(
      <UseAIProvider transport={new FakeTransport('ws://a')} fileUploadConfig={{ transformers }}>
        <CaptureContext />
      </UseAIProvider>
    );

    await act(async () => {
      await context!.chat.create();
    });
    fireEvent.click(getByTestId('ai-button'));
    const file = new File(['%PDF'], `notes-${Date.now()}.pdf`, { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(getByTestId('file-input'), { target: { files: [file] } });
    });

    await waitFor(() => expect(seenChats).toHaveLength(1));
    const currentChat = await context!.chat.get();
    expect(currentChat).not.toBeNull();
    expect(seenChats[0]?.id).toBe(currentChat!.id);
  });
});

describe('UseAIProvider — context values', () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    snapshots = [];
    localStorage.clear();
  });
  afterEach(() => { logSpy.mockRestore(); });

  // A new context object on each render re-renders every consumer.
  test('keeps the identity of each context value when the provider re-renders with the same props', async () => {
    const transport = new FakeTransport('ws://a');
    const theme = { primaryColor: '#123456' };
    const strings = { header: { aiAssistant: 'Helper' } } as Partial<UseAIStrings>;
    const tree = (
      <UseAIProvider transport={transport} renderChat={false} theme={theme} strings={strings}>
        <CaptureAllContexts />
      </UseAIProvider>
    );
    const { rerender } = render(tree);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const before = snapshots[snapshots.length - 1];

    rerender(
      <UseAIProvider transport={transport} renderChat={false} theme={theme} strings={strings}>
        <CaptureAllContexts />
      </UseAIProvider>
    );
    const after = snapshots[snapshots.length - 1];

    expect(after).not.toBe(before);
    expect(after.value).toBe(before.value);
    expect(after.chatUI).toBe(before.chatUI);
    expect(after.theme).toBe(before.theme);
    expect(after.strings).toBe(before.strings);
    expect(after.theme.primaryColor).toBe('#123456');
  });
});

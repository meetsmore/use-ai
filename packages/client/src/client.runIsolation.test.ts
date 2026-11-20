import { describe, test, expect, beforeEach } from 'bun:test';
import { UseAIClient } from './client';
import type { UseAITransport } from './transport/types';
import type { AGUIEvent, UseAIClientMessage } from './types';
import { EventType } from './types';
import { withEventRunId } from '@meetsmore-oss/use-ai-core';

/**
 * Security finding M4: one connection can carry a chat run and a workflow run
 * at the same time. The chat must only take the events of the chat runs that it
 * started. Events of other runs go only to the handler registered for that run.
 */

class FakeTransport implements UseAITransport {
  readonly url = 'ws://fake';
  connected = true;
  sent: UseAIClientMessage[] = [];
  private eventHandler: ((event: AGUIEvent) => void) | null = null;

  connect(): void {}
  disconnect(): void {}
  send(message: UseAIClientMessage): void {
    this.sent.push(message);
  }
  onEvent(handler: (event: AGUIEvent) => void): () => void {
    this.eventHandler = handler;
    return () => {
      this.eventHandler = null;
    };
  }
  onConnectionChange(): () => void {
    return () => {};
  }
  deliver(event: AGUIEvent): void {
    this.eventHandler?.(event);
  }
}

/** The events of one run that writes `text` and calls the tool `toolName`. */
function runEvents(runId: string, text: string, toolName: string): AGUIEvent[] {
  const events: AGUIEvent[] = [
    { type: EventType.RUN_STARTED, threadId: 't', runId },
    { type: EventType.TEXT_MESSAGE_START, messageId: `${runId}-m`, role: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: `${runId}-m`, delta: text },
    { type: EventType.TEXT_MESSAGE_END, messageId: `${runId}-m` },
    { type: EventType.TOOL_CALL_START, toolCallId: `${runId}-tc`, toolCallName: toolName },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: `${runId}-tc`, delta: '{}' },
    { type: EventType.TOOL_CALL_END, toolCallId: `${runId}-tc` },
    { type: EventType.STEP_FINISHED, stepName: 'step' },
    { type: EventType.RUN_FINISHED, threadId: 't', runId },
  ];
  return events.map(event => withEventRunId(event, runId));
}

describe('UseAIClient run isolation', () => {
  let transport: FakeTransport;
  let client: UseAIClient;

  beforeEach(() => {
    transport = new FakeTransport();
    client = new UseAIClient(transport);
    client.connect();
  });

  function startChatRun(): string {
    client.sendPrompt('hello');
    const message = transport.sent.find(m => m.type === 'run_agent');
    if (!message || message.type !== 'run_agent') throw new Error('no run_agent sent');
    return message.data.runId;
  }

  test('events of a chat run that the client started reach onEvent handlers', () => {
    const chatRunId = startChatRun();
    const received: AGUIEvent[] = [];
    client.onEvent('chat', event => received.push(event));

    for (const event of runEvents(chatRunId, 'chat text', 'chatTool')) transport.deliver(event);

    expect(received.map(e => e.type)).toContain(EventType.TOOL_CALL_END);
    expect(client.getToolCallData(`${chatRunId}-tc`)?.name).toBe('chatTool');
    expect(client.runMessages.some(m => m.role === 'assistant')).toBe(true);
  });

  test('events of a run that the client did not start as a chat run do not reach onEvent handlers', () => {
    const received: AGUIEvent[] = [];
    client.onEvent('chat', event => received.push(event));

    for (const event of runEvents('workflow-run', 'PDF contents', 'deleteAll')) transport.deliver(event);

    expect(received).toEqual([]);
  });

  test('events of another run do not go into the chat history', () => {
    const chatRunId = startChatRun();
    const before = client.runMessages.length;

    for (const event of runEvents('workflow-run', 'PDF contents', 'deleteAll')) transport.deliver(event);

    expect(client.runMessages.length).toBe(before);
    expect(JSON.stringify(client.runMessages)).not.toContain('PDF contents');
    expect(client.currentMessageContent).not.toContain('PDF contents');
    expect(client.getToolCallData('workflow-run-tc')).toBeUndefined();
    // The chat run is still in flight.
    expect(client.currentRunId).toBe(chatRunId);
  });

  test('events of a workflow run that mix with a chat run stay apart', () => {
    const chatRunId = startChatRun();
    const chatEvents = runEvents(chatRunId, 'chat text', 'chatTool');
    const workflowEvents = runEvents('workflow-run', 'PDF contents', 'deleteAll');
    const chatReceived: AGUIEvent[] = [];
    const workflowReceived: AGUIEvent[] = [];
    client.onEvent('chat', event => chatReceived.push(event));
    client.onRunEvent('workflow-run', event => workflowReceived.push(event));

    for (let i = 0; i < chatEvents.length; i++) {
      transport.deliver(workflowEvents[i]);
      transport.deliver(chatEvents[i]);
    }

    expect(chatReceived).toEqual(chatEvents);
    expect(workflowReceived).toEqual(workflowEvents);
    expect(JSON.stringify(client.runMessages)).toContain('chat text');
    expect(JSON.stringify(client.runMessages)).not.toContain('PDF contents');
  });

  test('onRunEvent receives only the events of its own run', () => {
    const chatRunId = startChatRun();
    const received: AGUIEvent[] = [];
    client.onRunEvent('workflow-run', event => received.push(event));

    for (const event of runEvents(chatRunId, 'chat text', 'chatTool')) transport.deliver(event);
    for (const event of runEvents('other-workflow', 'other', 'otherTool')) transport.deliver(event);

    expect(received).toEqual([]);
  });

  test('onRunEvent stops when its cleanup function is called', () => {
    const received: AGUIEvent[] = [];
    const unsubscribe = client.onRunEvent('workflow-run', event => received.push(event));
    unsubscribe();

    for (const event of runEvents('workflow-run', 'PDF contents', 'deleteAll')) transport.deliver(event);

    expect(received).toEqual([]);
  });

  test('events of a chat run that has finished are ignored', () => {
    const chatRunId = startChatRun();
    for (const event of runEvents(chatRunId, 'chat text', 'chatTool')) transport.deliver(event);
    const received: AGUIEvent[] = [];
    client.onEvent('chat', event => received.push(event));

    transport.deliver(withEventRunId({ type: EventType.TOOL_CALL_START, toolCallId: 'late', toolCallName: 'deleteAll' }, chatRunId));

    expect(received).toEqual([]);
  });

  test('events without a run id still reach onEvent handlers (older servers)', () => {
    const received: AGUIEvent[] = [];
    client.onEvent('chat', event => received.push(event));

    transport.deliver({ type: EventType.TEXT_MESSAGE_START, messageId: 'm', role: 'assistant' });

    expect(received.length).toBe(1);
  });
});

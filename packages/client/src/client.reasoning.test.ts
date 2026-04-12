import { describe, it, expect, beforeEach } from 'bun:test';
import { UseAIClient } from './client';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { AGUIEvent, Message } from './types';

/**
 * Tests for extended thinking (reasoning) support in UseAIClient.
 *
 * Validates that:
 * 1. Reasoning blocks are accumulated during a run
 * 2. Reasoning parts are attached to assistant messages correctly
 * 3. Multi-step runs with interleaved thinking preserve reasoning per step
 * 4. Reasoning with signatures is preserved for multi-turn context
 */
describe('Extended thinking (reasoning) support', () => {
  let client: UseAIClient;

  beforeEach(() => {
    client = new UseAIClient('http://localhost:8081');
  });

  function emit(client: UseAIClient, events: (AGUIEvent | Record<string, unknown>)[]) {
    const handle = (client as unknown as { handleEvent(e: AGUIEvent): void }).handleEvent.bind(client);
    for (const event of events) handle(event as AGUIEvent);
  }

  it('attaches reasoning parts to final assistant message (no tool calls)', () => {
    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },

      // Reasoning block (AG-UI protocol)
      { type: EventType.REASONING_START, messageId: 'r-0', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_START, messageId: 'rm-0', role: 'reasoning', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm-0', delta: 'Let me think about this...', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm-0', delta: ' Step by step.', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_END, messageId: 'rm-0', timestamp: Date.now() },
      { type: EventType.REASONING_ENCRYPTED_VALUE, subtype: 'message', entityId: 'rm-0', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig123' } }), timestamp: Date.now() },
      { type: EventType.REASONING_END, messageId: 'r-0', timestamp: Date.now() },

      // Text response
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-0', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-0', delta: 'The answer is 42.', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-0', timestamp: Date.now() },

      { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1', result: '', timestamp: Date.now() },
    ]);

    const messages = client.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('The answer is 42.');

    // Reasoning should be attached
    const msg = messages[0] as Message & { reasoningParts?: unknown[] };
    expect(msg.reasoningParts).toHaveLength(1);
    expect((msg.reasoningParts![0] as { text: string }).text).toBe('Let me think about this... Step by step.');
    expect((msg.reasoningParts![0] as { encryptedValue?: string }).encryptedValue)
      .toBe(JSON.stringify({ anthropic: { signature: 'sig123' } }));
  });

  it('attaches reasoning parts to intermediate assistant messages with tool calls', () => {
    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },

      // Step 0: reasoning + text + tool call
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.REASONING_START, messageId: 'r-0', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_START, messageId: 'rm-0', role: 'reasoning', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm-0', delta: 'I need to search.', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_END, messageId: 'rm-0', timestamp: Date.now() },
      { type: EventType.REASONING_ENCRYPTED_VALUE, subtype: 'message', entityId: 'rm-0', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig-step0' } }), timestamp: Date.now() },
      { type: EventType.REASONING_END, messageId: 'r-0', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-0', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-0', delta: 'Searching...', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'search', parentMessageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{"q":"test"}', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{"found":true}', role: 'tool', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

      // Step 1: reasoning + final text
      { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
      { type: EventType.REASONING_START, messageId: 'r-1', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_START, messageId: 'rm-1', role: 'reasoning', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm-1', delta: 'Got the result, forming answer.', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_END, messageId: 'rm-1', timestamp: Date.now() },
      { type: EventType.REASONING_ENCRYPTED_VALUE, subtype: 'message', entityId: 'rm-1', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig-step1' } }), timestamp: Date.now() },
      { type: EventType.REASONING_END, messageId: 'r-1', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-1', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-1', delta: 'Found the result!', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-1', timestamp: Date.now() },

      { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1', result: '', timestamp: Date.now() },
    ]);

    const messages = client.messages;
    // Should have: assistant(text+toolCalls+reasoning), tool(result), assistant(text+reasoning)
    expect(messages).toHaveLength(3);

    // First message: assistant with tool call and reasoning
    const msg0 = messages[0] as Message & { reasoningParts?: { text: string; encryptedValue?: string }[] };
    expect(msg0.role).toBe('assistant');
    expect(msg0.reasoningParts).toHaveLength(1);
    expect(msg0.reasoningParts![0].text).toBe('I need to search.');
    expect(msg0.reasoningParts![0].encryptedValue).toBe(JSON.stringify({ anthropic: { signature: 'sig-step0' } }));

    // Second message: tool result
    expect(messages[1].role).toBe('tool');

    // Third message: final assistant with reasoning
    const msg2 = messages[2] as Message & { reasoningParts?: { text: string; encryptedValue?: string }[] };
    expect(msg2.role).toBe('assistant');
    expect(msg2.content).toBe('Found the result!');
    expect(msg2.reasoningParts).toHaveLength(1);
    expect(msg2.reasoningParts![0].text).toBe('Got the result, forming answer.');
    expect(msg2.reasoningParts![0].encryptedValue).toBe(JSON.stringify({ anthropic: { signature: 'sig-step1' } }));
  });

  it('currentReasoningBlocks tracks reasoning during streaming', () => {
    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.REASONING_START, messageId: 'r-0', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_START, messageId: 'rm-0', role: 'reasoning', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm-0', delta: 'Thinking...', timestamp: Date.now() },
    ]);

    // During streaming, currentReasoningBlocks should be empty (block not yet ended)
    expect(client.currentReasoningBlocks).toHaveLength(0);

    emit(client, [
      { type: EventType.REASONING_MESSAGE_END, messageId: 'rm-0', timestamp: Date.now() },
      { type: EventType.REASONING_ENCRYPTED_VALUE, subtype: 'message', entityId: 'rm-0', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig' } }), timestamp: Date.now() },
      { type: EventType.REASONING_END, messageId: 'r-0', timestamp: Date.now() },
    ]);

    // After reasoning end, block should be in currentReasoningBlocks
    expect(client.currentReasoningBlocks).toHaveLength(1);
    expect(client.currentReasoningBlocks[0].text).toBe('Thinking...');
  });

  it('currentReasoningBlocks is available to external handlers at RUN_FINISHED', () => {
    let blocksAtRunFinished: unknown[] | undefined;

    client.onEvent('test-handler', (event) => {
      if ((event as { type: string }).type === EventType.RUN_FINISHED) {
        blocksAtRunFinished = [...client.currentReasoningBlocks];
      }
    });

    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.REASONING_START, messageId: 'r-0', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_START, messageId: 'rm-0', role: 'reasoning', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'rm-0', delta: 'Deep thought...', timestamp: Date.now() },
      { type: EventType.REASONING_MESSAGE_END, messageId: 'rm-0', timestamp: Date.now() },
      { type: EventType.REASONING_ENCRYPTED_VALUE, subtype: 'message', entityId: 'rm-0', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig-abc' } }), timestamp: Date.now() },
      { type: EventType.REASONING_END, messageId: 'r-0', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-0', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-0', delta: 'Answer', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1', result: '', timestamp: Date.now() },
    ]);

    // External handler should have seen the reasoning blocks BEFORE they were cleared
    expect(blocksAtRunFinished).toHaveLength(1);
    expect((blocksAtRunFinished![0] as { text: string }).text).toBe('Deep thought...');
  });

  it('handles run without reasoning (no reasoning events)', () => {
    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-0', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-0', delta: 'Hello!', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1', result: '', timestamp: Date.now() },
    ]);

    const messages = client.messages;
    expect(messages).toHaveLength(1);

    // Should NOT have reasoningParts property when no reasoning occurred
    const msg = messages[0] as Message & { reasoningParts?: unknown };
    expect(msg.reasoningParts).toBeUndefined();
  });
});

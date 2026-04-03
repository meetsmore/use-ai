import { describe, it, expect, beforeEach } from 'bun:test';
import { UseAIClient } from './client';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { AGUIEvent, Message } from './types';
import { extractTurnMessages } from './hooks/useServerEvents';

/**
 * Integration test: multi-step agent run context preservation.
 *
 * Bug: When a run produces multiple assistant steps (text+tool per step),
 * the conversation context sent to LLM on the 2nd run was corrupted:
 *
 *   Correct:  [assistant(text1, tc1), tool(r1), assistant(text2, tc2), tool(r2), assistant(final)]
 *   Bug:      [assistant(tc1+tc2), tool(r1), tool(r2), assistant(text1+text2+final)]
 *
 * These tests validate that UseAIClient assembles per-step messages correctly
 * and that the 2nd run_agent call sends the correct context.
 */
describe('Multi-step context preservation (integration)', () => {
  let client: UseAIClient;

  beforeEach(() => {
    client = new UseAIClient('http://localhost:8081');
  });

  function emit(client: UseAIClient, events: AGUIEvent[]) {
    const handle = (client as unknown as { handleEvent(e: AGUIEvent): void }).handleEvent.bind(client);
    for (const event of events) handle(event);
  }

  /** Simulates a 3-step run: text+tool → text+tool → text (final) */
  function emitThreeStepRun(client: UseAIClient) {
    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },

      // Step 0: text + tool
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-0', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-0', delta: 'Planning search.', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'search', parentMessageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{"q":"yamamoto"}', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{"found":false}', role: 'tool', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

      // Step 1: text + tool
      { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-1', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-1', delta: 'Retrying with archived.', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-1', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc-2', toolCallName: 'search', parentMessageId: 'tm-1', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-2', delta: '{"q":"Yamamoto","archived":true}', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_END, toolCallId: 'tc-2', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-2', toolCallId: 'tc-2', content: '{"found":false}', role: 'tool', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

      // Step 2: final text
      { type: EventType.STEP_STARTED, stepName: 'step-2', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-2', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-2', delta: 'User not found.', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-2', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-2', timestamp: Date.now() },

      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
    ]);
  }

  // ─── Test 1: Per-step message structure ─────────────────────────────

  it('assembles per-step messages: 3-step run produces 5 messages with correct text+toolCall pairs', () => {
    emitThreeStepRun(client);

    const msgs = client.messages;
    expect(msgs).toHaveLength(5);

    // Step 0: assistant(text + toolCalls)
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toBe('Planning search.');
    expect(msgs[0].toolCalls).toHaveLength(1);
    expect((msgs[0].toolCalls as { id: string }[])[0].id).toBe('tc-1');

    // Step 0: tool result
    expect(msgs[1].role).toBe('tool');
    expect((msgs[1] as { toolCallId: string }).toolCallId).toBe('tc-1');

    // Step 1: assistant(text + toolCalls)
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[2].content).toBe('Retrying with archived.');
    expect(msgs[2].toolCalls).toHaveLength(1);
    expect((msgs[2].toolCalls as { id: string }[])[0].id).toBe('tc-2');

    // Step 1: tool result
    expect(msgs[3].role).toBe('tool');
    expect((msgs[3] as { toolCallId: string }).toolCallId).toBe('tc-2');

    // Step 2: final assistant (text only)
    expect(msgs[4].role).toBe('assistant');
    expect(msgs[4].content).toBe('User not found.');
    expect(msgs[4].toolCalls).toBeUndefined();
  });

  // ─── Test 2: 2nd run context correctness (core bug regression) ──────

  it('2nd run_agent sends correct per-step context (no merged toolCalls, no concatenated text)', () => {
    // Simulate 1st run
    emitThreeStepRun(client);

    // Capture what sendPrompt would send via socket.emit('run_agent', ...)
    // We spy on the private `send` method that writes to socket
    let capturedPayload: { messages: Message[] } | null = null;
    const clientAny = client as unknown as { send(msg: { type: string; data: unknown }): void };
    clientAny.send = (msg: { type: string; data: unknown }) => {
      if (msg.type === 'run_agent') {
        capturedPayload = msg.data as { messages: Message[] };
      }
    };

    // 2nd run: sendPrompt adds user message + calls send('run_agent', { messages })
    client.sendPrompt('What did you find?');

    expect(capturedPayload).not.toBeNull();
    const messages = capturedPayload!.messages;

    // Should be: [assistant(text+tc), tool, assistant(text+tc), tool, assistant(text), user]
    // = 5 from 1st run + 1 user = 6
    expect(messages).toHaveLength(6);

    // ── Verify the bug pattern does NOT appear ──

    // Bug pattern 1: a single assistant with all toolCalls merged
    const assistantsWithTools = messages.filter(
      m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
    );
    for (const msg of assistantsWithTools) {
      // Each assistant should have exactly 1 toolCall, not 2
      expect(msg.toolCalls).toHaveLength(1);
    }
    expect(assistantsWithTools).toHaveLength(2); // one per tool-step

    // Bug pattern 2: a single assistant with all text concatenated
    const textOnlyAssistants = messages.filter(
      m => m.role === 'assistant' && (!m.toolCalls || m.toolCalls.length === 0)
    );
    expect(textOnlyAssistants).toHaveLength(1);
    // Final text should be ONLY the last step's text
    expect(textOnlyAssistants[0].content).toBe('User not found.');
    expect((textOnlyAssistants[0].content as string).includes('Planning')).toBe(false);
    expect((textOnlyAssistants[0].content as string).includes('Retrying')).toBe(false);

    // ── Verify correct order ──
    expect(messages[0].role).toBe('assistant'); // step 0 assistant
    expect(messages[0].content).toBe('Planning search.');
    expect(messages[1].role).toBe('tool');      // step 0 tool result
    expect(messages[2].role).toBe('assistant'); // step 1 assistant
    expect(messages[2].content).toBe('Retrying with archived.');
    expect(messages[3].role).toBe('tool');      // step 1 tool result
    expect(messages[4].role).toBe('assistant'); // final text
    expect(messages[5].role).toBe('user');      // 2nd prompt
  });

  // ─── Test 3: extractTurnMessages produces no text duplication ───────

  it('extractTurnMessages + final content have no text duplication', () => {
    emitThreeStepRun(client);

    const turnMessages = extractTurnMessages(client.messages as Message[], 0);
    const finalContent = client.currentMessageContent;

    // Collect all text from turnMessages
    const turnTexts = turnMessages
      .filter(m => m.role === 'assistant' && typeof m.content === 'string' && m.content)
      .map(m => m.content as string);

    // turnMessages should have per-step intermediate text (not empty string)
    // This validates the extractTurnMessages fix: content is preserved on
    // assistant messages with toolCalls (was previously set to '')
    expect(turnTexts).toContain('Planning search.');
    expect(turnTexts).toContain('Retrying with archived.');

    // Each intermediate assistant should also have toolCalls
    const intermediateAssistants = turnMessages.filter(m => m.role === 'assistant');
    for (const msg of intermediateAssistants) {
      expect(msg.content).not.toBe('');
      expect(msg.toolCalls).toBeDefined();
      expect(msg.toolCalls!.length).toBeGreaterThan(0);
    }

    // Final content should be ONLY the last step's text
    expect(finalContent).toBe('User not found.');
    expect(finalContent.includes('Planning')).toBe(false);
    expect(finalContent.includes('Retrying')).toBe(false);
  });

  // ─── Test 4: 2-step run (simpler case) ──────────────────────────────

  it('2-step run (text+tool → text) preserves association', () => {
    emit(client, [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
      { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-0', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-0', delta: 'Calling tool.', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'doThing', parentMessageId: 'tm-0', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{}', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{"ok":true}', role: 'tool', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

      { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'tm-1', role: 'assistant', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'tm-1', delta: 'Done.', timestamp: Date.now() },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'tm-1', timestamp: Date.now() },
      { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1', timestamp: Date.now() },
    ]);

    const msgs = client.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toBe('Calling tool.');
    expect(msgs[0].toolCalls).toHaveLength(1);
    expect(msgs[1].role).toBe('tool');
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[2].content).toBe('Done.');
  });
});

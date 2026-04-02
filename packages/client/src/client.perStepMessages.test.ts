import { describe, it, expect, beforeEach } from 'bun:test';
import { UseAIClient } from './client';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { AGUIEvent } from './types';

/**
 * Tests for per-step message assembly in the UseAIClient.
 *
 * Bug: The client accumulates all tool calls from all steps into a single
 * `_currentAssistantToolCalls` array and all text into a single
 * `_currentAssistantMessage.content`. At RUN_FINISHED, this creates a flat
 * message structure that loses per-step boundaries:
 *   assistant(toolCalls=[all], content='') → tool results → assistant(content='all text')
 *
 * Expected: At each step boundary (STEP_STARTED for step > 0), the client
 * should flush the previous step's messages, creating per-step messages:
 *   assistant(text='step0', toolCalls=[tc1]) → tool(result1) →
 *   assistant(text='step1', toolCalls=[tc2]) → tool(result2) →
 *   assistant(text='final')
 */
describe('Client per-step message assembly', () => {
  let client: UseAIClient;

  beforeEach(() => {
    client = new UseAIClient('http://localhost:8081');
  });

  /**
   * Helper to simulate a sequence of AG-UI events through the client's event handler.
   * Accesses the private handleEvent via the onEvent mechanism.
   */
  function simulateEvents(client: UseAIClient, events: AGUIEvent[]) {
    // The handleEvent is private, but we can trigger it via
    // directly dispatching events through the internal handler.
    // Use the public onEvent to observe, but we need to trigger handleEvent.
    // Access private method through casting.
    const clientAny = client as unknown as { handleEvent(event: AGUIEvent): void };
    for (const event of events) {
      clientAny.handleEvent(event);
    }
  }

  describe('single-step run (no tool calls)', () => {
    it('creates a single assistant message with text', () => {
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'msg-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'msg-1', delta: 'Hello world', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'msg-1', timestamp: Date.now() },
        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      const messages = client.messages;
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('Hello world');
      expect('toolCalls' in messages[0]).toBe(false);
    });
  });

  describe('two-step run: text+tool → text', () => {
    it('creates per-step messages with text+toolCalls association preserved', () => {
      simulateEvents(client, [
        // RUN_STARTED
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        // Step 0: text + tool call
        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: 'Planning...', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'search', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{"q":"test"}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        // Tool result (simulating server-side tool via TOOL_CALL_RESULT)
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tool-result-1', toolCallId: 'tc-1', content: '{"found":false}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        // Step 1: text only (final)
        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: 'Not found.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

        // RUN_FINISHED
        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      const messages = client.messages;

      // Should have 3 messages: assistant(text+tool) → tool → assistant(text)
      expect(messages.length).toBe(3);

      // Step 0: assistant with text AND tool calls
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('Planning...');
      expect('toolCalls' in messages[0]).toBe(true);
      const toolCalls = (messages[0] as { toolCalls: Array<{ id: string; function: { name: string } }> }).toolCalls;
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].function.name).toBe('search');

      // Tool result
      expect(messages[1].role).toBe('tool');
      expect('toolCallId' in messages[1]).toBe(true);
      expect((messages[1] as { toolCallId: string }).toolCallId).toBe('tc-1');

      // Step 1: final text only
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('Not found.');
      expect('toolCalls' in messages[2]).toBe(false);
    });
  });

  describe('three-step run: text+tool → text+tool → text', () => {
    it('creates 5 messages: 2x(assistant+tool) + 1 final assistant', () => {
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        // Step 0: text + tool call
        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: 'Step 0.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'search', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{"q":"a"}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{"r":1}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        // Step 1: text + tool call
        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: 'Step 1.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-2', toolCallName: 'search', parentMessageId: 'text-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-2', delta: '{"q":"b"}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-2', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-2', toolCallId: 'tc-2', content: '{"r":2}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

        // Step 2: text only (final)
        { type: EventType.STEP_STARTED, stepName: 'step-2', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-2', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-2', delta: 'Final.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-2', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-2', timestamp: Date.now() },

        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      const messages = client.messages;
      expect(messages.length).toBe(5);

      // Step 0
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('Step 0.');
      expect('toolCalls' in messages[0]).toBe(true);

      // Tool result 0
      expect(messages[1].role).toBe('tool');

      // Step 1
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('Step 1.');
      expect('toolCalls' in messages[2]).toBe(true);

      // Tool result 1
      expect(messages[3].role).toBe('tool');

      // Final
      expect(messages[4].role).toBe('assistant');
      expect(messages[4].content).toBe('Final.');
      expect('toolCalls' in messages[4]).toBe(false);
    });
  });

  describe('currentMessageContent at RUN_FINISHED', () => {
    it('contains only the final step text (not concatenated)', () => {
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        // Step 0
        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: 'First step text.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'tool1', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        // Step 1 (final)
        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: 'Final answer.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },
      ]);

      // Before RUN_FINISHED, currentMessageContent should be the LAST step's text
      expect(client.currentMessageContent).toBe('Final answer.');

      simulateEvents(client, [
        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      // After RUN_FINISHED, messages should be correct
      const messages = client.messages;
      const finalMsg = messages[messages.length - 1];
      expect(finalMsg.content).toBe('Final answer.');
    });
  });

  describe('no text duplication across steps', () => {
    /**
     * Bug: When saveAIResponse receives accumulated text from all steps
     * (via runTextRef), the final saved assistant message contains text
     * from ALL steps. But intermediate assistant messages (from
     * extractTurnMessages) also have their per-step text. This causes
     * the LLM to see step 0 text twice on subsequent turns.
     *
     * Example from the bug:
     *   Intermediate assistant: "I'll create a shopping list..." + tool_calls
     *   Final assistant: "I'll create a shopping list...\n\nPerfect! I've created..."
     *   → step 0 text appears in BOTH messages
     *
     * Expected: The final assistant message should contain ONLY the
     * last step's text. Intermediate text lives in turnMessages only.
     */
    function extractTurnMessages(messages: Array<Record<string, unknown>>, startIndex: number) {
      const turnSlice = messages.slice(startIndex);
      const result: Array<Record<string, unknown>> = [];
      for (const msg of turnSlice) {
        if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
          result.push({
            id: msg.id,
            role: 'assistant',
            content: typeof msg.content === 'string' ? msg.content : '',
            toolCalls: msg.toolCalls,
          });
        } else if (msg.role === 'tool') {
          result.push({
            id: msg.id,
            role: 'tool',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            toolCallId: msg.toolCallId,
          });
        }
      }
      return result;
    }

    it('final message content does not include text from intermediate steps', () => {
      // Simulate: step 0 (text + tool) → step 1 (text only)
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        // Step 0: "I'll create a shopping list..." + tool call
        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: "I'll create a shopping list.", timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'addTodo', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{"text":"Chicken"}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{"success":true}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        // Step 1: "Perfect! I've created the list." (final)
        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: "Perfect! I've created the list.", timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      const messages = client.messages;

      // Final assistant message should have ONLY step 1's text
      const finalMessage = messages[messages.length - 1];
      expect(finalMessage.role).toBe('assistant');
      expect(finalMessage.content).toBe("Perfect! I've created the list.");

      // It must NOT contain step 0's text
      expect((finalMessage.content as string).includes("I'll create a shopping list")).toBe(false);

      // Intermediate message should have step 0's text
      expect(messages[0].content).toBe("I'll create a shopping list.");
    });

    it('saveAIResponse content (client.currentMessageContent) is only the last step text', () => {
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        // Step 0
        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: 'Step zero text.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'doThing', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        // Step 1
        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: 'Step one text.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-2', toolCallName: 'doThing', parentMessageId: 'text-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-2', delta: '{}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-2', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-2', toolCallId: 'tc-2', content: '{}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

        // Step 2 (final)
        { type: EventType.STEP_STARTED, stepName: 'step-2', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-2', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-2', delta: 'Final step text.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-2', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-2', timestamp: Date.now() },
      ]);

      // This is what saveAIResponse should receive as content
      const contentForSave = client.currentMessageContent;
      expect(contentForSave).toBe('Final step text.');

      // Must NOT contain previous steps' text
      expect(contentForSave.includes('Step zero')).toBe(false);
      expect(contentForSave.includes('Step one')).toBe(false);
    });

    it('combined turnMessages + final message have no text duplication', () => {
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: 'Alpha.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'search', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: 'Bravo.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      // Get turnMessages (intermediate assistant+tool messages)
      const turnMessages = extractTurnMessages(
        client.messages as unknown as Array<Record<string, unknown>>,
        0 // startIndex
      );

      // Get final content (what saveAIResponse should receive)
      const finalContent = client.currentMessageContent;

      // Collect ALL text content across turnMessages and final message
      const allTexts: string[] = [];
      for (const msg of turnMessages) {
        if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
          allTexts.push(msg.content);
        }
      }
      allTexts.push(finalContent);

      // No text should appear more than once
      expect(allTexts).toEqual(['Alpha.', 'Bravo.']);

      // Specifically: final content must NOT contain intermediate text
      expect(finalContent).toBe('Bravo.');
      expect(finalContent.includes('Alpha')).toBe(false);
    });
  });

  describe('extractTurnMessages compatibility', () => {
    /**
     * Replicate extractTurnMessages logic to validate that per-step messages
     * are correctly extracted for persistence.
     */
    function extractTurnMessages(messages: Array<Record<string, unknown>>, startIndex: number) {
      const turnSlice = messages.slice(startIndex);
      const result: Array<Record<string, unknown>> = [];

      for (const msg of turnSlice) {
        if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
          result.push({
            id: msg.id,
            role: 'assistant',
            content: typeof msg.content === 'string' ? msg.content : '',
            toolCalls: msg.toolCalls,
          });
        } else if (msg.role === 'tool') {
          result.push({
            id: msg.id,
            role: 'tool',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            toolCallId: msg.toolCallId,
          });
        }
      }

      return result;
    }

    it('extractTurnMessages preserves per-step text content', () => {
      simulateEvents(client, [
        { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },

        { type: EventType.STEP_STARTED, stepName: 'step-0', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-0', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-0', delta: 'Step text here.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_START, toolCallId: 'tc-1', toolCallName: 'search', parentMessageId: 'text-0', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc-1', delta: '{"q":"x"}', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_END, toolCallId: 'tc-1', timestamp: Date.now() },
        { type: EventType.TOOL_CALL_RESULT, messageId: 'tr-1', toolCallId: 'tc-1', content: '{"ok":true}', role: 'tool', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-0', timestamp: Date.now() },

        { type: EventType.STEP_STARTED, stepName: 'step-1', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_START, messageId: 'text-1', role: 'assistant', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'text-1', delta: 'Done.', timestamp: Date.now() },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'text-1', timestamp: Date.now() },
        { type: EventType.STEP_FINISHED, stepName: 'step-1', timestamp: Date.now() },

        { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1', timestamp: Date.now() },
      ]);

      // extractTurnMessages should find the step 0 messages (excluding the final text-only assistant)
      const turnMessages = extractTurnMessages(client.messages as unknown as Array<Record<string, unknown>>, 0);

      // Should have 2 intermediate messages: assistant(text+toolCalls) + tool
      expect(turnMessages.length).toBe(2);

      // The assistant message should have BOTH content and toolCalls
      expect(turnMessages[0].role).toBe('assistant');
      expect(turnMessages[0].content).toBe('Step text here.');
      expect(turnMessages[0].toolCalls).toBeDefined();

      // The tool message
      expect(turnMessages[1].role).toBe('tool');
      expect(turnMessages[1].toolCallId).toBe('tc-1');
    });
  });
});

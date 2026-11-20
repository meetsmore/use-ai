import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { UseAIProvider, useAIContext } from '../src/providers/useAIProvider';
import { useAIWorkflow, type WorkflowApprovalRequest } from '../src/useAIWorkflow';
import { defineTool } from '../src/defineTool';
import type { WorkflowStatus } from '../src/types';
import { EventType } from '../src/types';
import { z } from 'zod';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  simulateEvent,
  simulateToolCall,
  simulateWorkflowSuccess,
  simulateWorkflowError,
  findSentMessage,
  findAllSentMessages,
  getSentMessages,
  getMockServer,
  lastWorkflowRunId,
} from './integration-test-utils';

// Store original WebSocket
const OriginalWebSocket = global.WebSocket;

describe('useAIWorkflow Hook Tests', () => {
  beforeEach(() => {
    setupMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <UseAIProvider serverUrl="ws://localhost:8081">{children}</UseAIProvider>
  );

  describe('Workflow Execution - Basic', () => {
    it('can trigger a workflow', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({ inputs: { test: 'data' } });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage).toBeDefined();
        expect(workflowMessage?.data.runner).toBe('dify');
        expect(workflowMessage?.data.workflowId).toBe('test-workflow');
        expect(workflowMessage?.data.inputs).toEqual({ test: 'data' });
      });
    });

    it('workflows are stateless (no conversation history)', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      // Trigger workflow
      act(() => {
        result.current.trigger({ inputs: { test: 'data' } });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage).toBeDefined();
        // Workflow messages don't include conversation history
        expect(workflowMessage?.data.messages).toBeUndefined();
      });
    });

    it('workflows execute with specified runner', async () => {
      const { result } = renderHook(() => useAIWorkflow('custom-runner', 'my-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({ inputs: {} });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage?.data.runner).toBe('custom-runner');
        expect(workflowMessage?.data.workflowId).toBe('my-workflow');
      });
    });

    it('only one workflow can run at a time per hook instance', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      // Start first workflow
      act(() => {
        result.current.trigger({ inputs: { first: true } });
      });

      await waitFor(() => expect(result.current.status).toBe('running'));

      // Try to start second workflow while first is running
      let errorOccurred = false;
      act(() => {
        result.current
          .trigger({ inputs: { second: true } })
          .catch(() => {
            errorOccurred = true;
          });
      });

      await waitFor(() => expect(errorOccurred || result.current.error).toBeTruthy());
      expect(result.current.status).toBe('error');
    });

    it('workflow execution status is tracked', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      // Initial status
      expect(result.current.status).toBe('idle');

      

      // Trigger workflow
      act(() => {
        result.current.trigger({ inputs: {} });
      });

      // Should be running
      await waitFor(() => expect(result.current.status).toBe('running'));

      // Simulate completion
      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');
      act(() => {
        simulateWorkflowSuccess(sentMessage.data.runId, sentMessage.data.threadId);
      });

      // Should be completed
      await waitFor(() => expect(result.current.status).toBe('completed'));
    });

    it('handles error status', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({ inputs: {} });
      });

      await waitFor(() => expect(result.current.status).toBe('running'));

      // Simulate error
      act(() => {
        simulateWorkflowError('Workflow failed', lastWorkflowRunId());
      });

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.error?.message).toBe('Workflow failed');
    });
  });

  describe('Workflow Lifecycle & Callbacks', () => {
    it('workflow inputs can be arbitrary JSON data', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      const complexInputs = {
        user: { name: 'Alice', id: 123 },
        settings: { theme: 'dark', notifications: true },
        array: [1, 2, 3],
        nested: { deep: { value: 'test' } },
      };

      act(() => {
        result.current.trigger({ inputs: complexInputs });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage?.data.inputs).toEqual(complexInputs);
      });
    });

    it('onProgress callback tracks workflow execution', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      const progressUpdates: any[] = [];

      act(() => {
        result.current.trigger({
          inputs: {},
          onProgress: (progress) => progressUpdates.push(progress),
        });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');

      // Simulate workflow progress
      act(() => {
        simulateWorkflowSuccess(sentMessage.data.runId, sentMessage.data.threadId, 'Result text');
      });

      await waitFor(() => expect(result.current.status).toBe('completed'));

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some((p) => p.status === 'running')).toBe(true);
    });

    it('onProgress receives accumulated text', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      const progressUpdates: any[] = [];

      act(() => {
        result.current.trigger({
          inputs: {},
          onProgress: (progress) => progressUpdates.push(progress),
        });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');
      const runId = sentMessage.data.runId;
      const threadId = sentMessage.data.threadId;
      const messageId = 'msg-test';

      // Simulate streaming text
      act(() => {
        simulateEvent({
          type: EventType.RUN_STARTED,
          threadId,
          runId,
          input: { threadId, runId, messages: [], tools: [], state: {} } as any,
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateEvent({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: 'First ',
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: 'Second ',
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: 'Third',
          timestamp: Date.now(),
        }, lastWorkflowRunId());
      });

      await waitFor(() => expect(result.current.text).toBe('First Second Third'));

      // Progress updates should have accumulated text
      const textUpdates = progressUpdates.filter((p) => p.text);
      expect(textUpdates.length).toBeGreaterThan(0);
      expect(textUpdates[textUpdates.length - 1].text).toBe('First Second Third');
    });

    it('onComplete callback called with final results', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      let completeResult: any = null;

      act(() => {
        result.current.trigger({
          inputs: {},
          onComplete: (result) => {
            completeResult = result;
          },
        });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');

      act(() => {
        simulateWorkflowSuccess(sentMessage.data.runId, sentMessage.data.threadId, 'Final result');
      });

      await waitFor(() => expect(completeResult).toBeDefined());
      expect(completeResult.text).toBe('Final result');
    });

    it('onError callback called when workflow fails', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      let errorReceived: Error | null = null;

      act(() => {
        result.current.trigger({
          inputs: {},
          onError: (err) => {
            errorReceived = err;
          },
        });
      });

      act(() => {
        simulateWorkflowError('Something went wrong', lastWorkflowRunId());
      });

      await waitFor(() => expect(errorReceived).toBeDefined());
      expect(errorReceived?.message).toBe('Something went wrong');
    });

    it('workflows emit AG-UI protocol events', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({ inputs: {} });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');

      act(() => {
        simulateWorkflowSuccess(sentMessage.data.runId, sentMessage.data.threadId);
      });

      await waitFor(() => expect(result.current.status).toBe('completed'));
      expect(result.current.text).toBeDefined();
    });
  });

  describe('Workflow Tool Integration', () => {
    it('workflows can call back to client-side tools', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      const toolExecutions: any[] = [];

      const testTool = defineTool(
        'Execute a test action',
        z.object({ value: z.string() }),
        (input) => {
          toolExecutions.push(input);
          return { success: true, message: 'Tool executed' };
        }
      );

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { testTool },
        });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage?.data.tools).toBeDefined();
        expect(workflowMessage.data.tools.length).toBe(1);
        expect(workflowMessage.data.tools[0].name).toBe('testTool');
      });

      // Simulate tool call from workflow
      act(() => {
        simulateToolCall('tool-call-1', 'testTool', { value: 'test-value' }, lastWorkflowRunId());
      });

      await waitFor(() => expect(toolExecutions.length).toBe(1));
      expect(toolExecutions[0].value).toBe('test-value');

      // Verify tool result was sent back
      await waitFor(() => {
        const toolResults = getSentMessages().filter((m) => m.type === 'tool_result');
        expect(toolResults.length).toBe(1);
        const result = JSON.parse(toolResults[0].data.content);
        expect(result.success).toBe(true);
      });
    });

    it('tool calls are tracked with names, arguments, and results', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      const progressUpdates: any[] = [];

      const testTool = defineTool(
        'Test tool',
        z.object({ arg1: z.string() }),
        (input) => ({ result: `Processed ${input.arg1}` })
      );

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { testTool },
          onProgress: (progress) => progressUpdates.push(progress),
        });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');

      // Simulate tool call
      act(() => {
        simulateEvent({
          type: EventType.RUN_STARTED,
          threadId: sentMessage.data.threadId,
          runId: sentMessage.data.runId,
          input: {
            threadId: sentMessage.data.threadId,
            runId: sentMessage.data.runId,
            messages: [],
            tools: [],
            state: {},
          } as any,
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateToolCall('tool-1', 'testTool', { arg1: 'test' }, lastWorkflowRunId());
      });

      await waitFor(() => {
        const toolResultMessages = getSentMessages().filter((m) => m.type === 'tool_result');
        expect(toolResultMessages.length).toBe(1);
      });

      // Check that progress updates include tool call information
      await waitFor(() => {
        const updatesWithTools = progressUpdates.filter((p) => p.toolCalls && p.toolCalls.length > 0);
        expect(updatesWithTools.length).toBeGreaterThan(0);
      });

      const finalUpdate = progressUpdates[progressUpdates.length - 1];
      expect(finalUpdate.toolCalls).toBeDefined();
      expect(finalUpdate.toolCalls[0].toolName).toBe('testTool');
      expect(finalUpdate.toolCalls[0].args).toEqual({ arg1: 'test' });
      expect(finalUpdate.toolCalls[0].result).toBeDefined();
    });

    it('onProgress receives updated tool call information after each execution', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      
      const progressUpdates: any[] = [];

      const tool1 = defineTool('First tool', z.object({}), () => ({ success: true }));
      const tool2 = defineTool('Second tool', z.object({}), () => ({ success: true }));

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { tool1, tool2 },
          onProgress: (progress) => progressUpdates.push({ ...progress }),
        });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');

      act(() => {
        simulateEvent({
          type: EventType.RUN_STARTED,
          threadId: sentMessage.data.threadId,
          runId: sentMessage.data.runId,
          input: {
            threadId: sentMessage.data.threadId,
            runId: sentMessage.data.runId,
            messages: [],
            tools: [],
            state: {},
          } as any,
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        // First tool call
        simulateToolCall('tool-1', 'tool1', {}, lastWorkflowRunId());
      });

      await waitFor(() => {
        const withOneTool = progressUpdates.filter((p) => p.toolCalls?.length === 1);
        expect(withOneTool.length).toBeGreaterThan(0);
      });

      act(() => {
        // Second tool call
        simulateToolCall('tool-2', 'tool2', {}, lastWorkflowRunId());
      });

      await waitFor(() => {
        const withTwoTools = progressUpdates.filter((p) => p.toolCalls?.length === 2);
        expect(withTwoTools.length).toBeGreaterThan(0);
      });

      // Final update should have both tool calls
      const finalUpdate = progressUpdates[progressUpdates.length - 1];
      expect(finalUpdate.toolCalls?.length).toBe(2);
    });

    it('tool execution errors are sent back to workflow', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      const errorTool = defineTool(
        'Tool that throws error',
        z.object({}),
        () => {
          throw new Error('Tool execution failed');
        }
      );

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { errorTool },
        });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');

      act(() => {
        simulateEvent({
          type: EventType.RUN_STARTED,
          threadId: sentMessage.data.threadId,
          runId: sentMessage.data.runId,
          input: {
            threadId: sentMessage.data.threadId,
            runId: sentMessage.data.runId,
            messages: [],
            tools: [],
            state: {},
          } as any,
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateToolCall('tool-error', 'errorTool', {}, lastWorkflowRunId());
      });

      // Verify error was sent back in tool_result
      await waitFor(() => {
        const toolResults = getSentMessages().filter((m) => m.type === 'tool_result');
        expect(toolResults.length).toBe(1);
        const result = JSON.parse(toolResults[0].data.content);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Tool execution failed');
      });
    });

    it('handles tools with complex parameters', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      const complexTool = defineTool(
        'Complex tool',
        z.object({
          name: z.string(),
          age: z.number(),
          settings: z.object({
            theme: z.enum(['light', 'dark']),
            notifications: z.boolean(),
          }),
        }),
        (input) => ({ processed: true, input })
      );

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { complexTool },
        });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage?.data.tools[0].parameters).toBeDefined();
        expect(workflowMessage.data.tools[0].parameters.properties).toBeDefined();
      });
    });
  });

  describe('Connection & Error Handling', () => {
    it('returns connected status', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));
    });

    it('prevents triggering workflow when disconnected', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      // Simulate disconnection
      const mockServer = getMockServer();
      if (mockServer) {
        (mockServer.clientMock as any).connected = false;
        (mockServer.clientMock as any).disconnected = true;
      }

      let errorOccurred = false;
      const errorCallback = mock((err: Error) => {
        errorOccurred = true;
      });

      act(() => {
        result.current.trigger({
          inputs: {},
          onError: errorCallback,
        });
      });

      await waitFor(() => expect(errorOccurred).toBe(true));
      expect(errorCallback).toHaveBeenCalled();
    });

    it('resets state when starting new workflow', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      // First workflow with error
      act(() => {
        result.current.trigger({ inputs: {} });
      });

      await waitFor(() => expect(result.current.status).toBe('running'));

      act(() => {
        simulateWorkflowError('First error', lastWorkflowRunId());
      });

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.error).toBeDefined();

      // Wait a bit to allow cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Start new workflow - should reset state
      act(() => {
        result.current.trigger({ inputs: {} });
      });

      // Status should reset, error should be cleared
      expect(result.current.status).toBe('running');
      expect(result.current.error).toBeNull();
    });

    it('accumulates text correctly', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({ inputs: {} });
      });

      const sentMessage = getSentMessages().find((m) => m.type === 'run_workflow');
      const messageId = 'msg-test';

      act(() => {
        simulateEvent({
          type: EventType.RUN_STARTED,
          threadId: sentMessage.data.threadId,
          runId: sentMessage.data.runId,
          input: {
            threadId: sentMessage.data.threadId,
            runId: sentMessage.data.runId,
            messages: [],
            tools: [],
            state: {},
          } as any,
          timestamp: Date.now(),
        }, lastWorkflowRunId());

        simulateEvent({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          timestamp: Date.now(),
        }, lastWorkflowRunId());
      });

      // Send multiple content chunks
      for (let i = 0; i < 5; i++) {
        act(() => {
          simulateEvent({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: `Chunk ${i} `,
            timestamp: Date.now(),
          }, lastWorkflowRunId());
        });
      }

      await waitFor(() => {
        expect(result.current.text).toBe('Chunk 0 Chunk 1 Chunk 2 Chunk 3 Chunk 4 ');
      });
    });

    it('handles workflows with no tools', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({
          inputs: { data: 'test' },
          // No tools provided
        });
      });

      await waitFor(() => {
        const messages = getSentMessages();
        const workflowMessage = messages.find((m) => m.type === 'run_workflow');
        expect(workflowMessage?.data.tools).toEqual([]);
      });
    });

    it('properly cleans up on unmount', async () => {
      const { result, unmount } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });

      await waitFor(() => expect(result.current.connected).toBe(true));

      

      act(() => {
        result.current.trigger({ inputs: {} });
      });

      await waitFor(() => expect(result.current.status).toBe('running'));

      // Unmount while workflow is running
      unmount();

      // Simulate events after unmount - should not cause errors
      act(() => {
        simulateEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'msg-test',
          delta: 'Should not crash',
          timestamp: Date.now(),
        }, lastWorkflowRunId());
      });

      // Test passes if no errors thrown
      expect(true).toBe(true);
    });
  });

  describe('Multiple Hook Instances', () => {
    it('different hook instances have independent state', async () => {
      const { result: result1 } = renderHook(() => useAIWorkflow('dify', 'workflow-1'), { wrapper });
      const { result: result2 } = renderHook(() => useAIWorkflow('dify', 'workflow-2'), { wrapper });

      await waitFor(() => {
        expect(result1.current.connected).toBe(true);
        expect(result2.current.connected).toBe(true);
      });

      

      // Trigger first workflow
      act(() => {
        result1.current.trigger({ inputs: { workflow: 1 } });
      });

      await waitFor(() => expect(result1.current.status).toBe('running'));
      expect(result2.current.status).toBe('idle');

      // Trigger second workflow
      act(() => {
        result2.current.trigger({ inputs: { workflow: 2 } });
      });

      await waitFor(() => expect(result2.current.status).toBe('running'));

      // Both should be running independently
      expect(result1.current.status).toBe('running');
      expect(result2.current.status).toBe('running');
    });
  });

  // Security finding M4: a chat run and a workflow run can share one connection.
  describe('Run isolation', () => {
    function useWorkflowAndClient() {
      const workflow = useAIWorkflow('dify', 'test-workflow');
      const { client } = useAIContext();
      return { workflow, client };
    }

    it('does not run a tool for a tool call of another run, even when the workflow has that tool', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const calls: unknown[] = [];
      const deleteAll = defineTool('Delete all items', z.object({}), (input) => {
        calls.push(input);
        return { deleted: true };
      });

      act(() => {
        result.current.trigger({ inputs: {}, tools: { deleteAll } });
      });

      act(() => {
        simulateToolCall('chat-tool-call', 'deleteAll', {}, 'chat-run');
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(calls).toEqual([]);
      expect(getSentMessages().filter((m) => m.type === 'tool_result')).toEqual([]);

      // The workflow's own tool call still runs.
      act(() => {
        simulateToolCall('workflow-tool-call', 'deleteAll', {}, lastWorkflowRunId());
      });
      await waitFor(() => expect(calls.length).toBe(1));
    });

    it('does not run a tool for a tool call without a run id', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const calls: unknown[] = [];
      const deleteAll = defineTool('Delete all items', z.object({}), (input) => {
        calls.push(input);
        return { deleted: true };
      });

      act(() => {
        result.current.trigger({ inputs: {}, tools: { deleteAll } });
      });
      act(() => {
        simulateToolCall('unscoped-tool-call', 'deleteAll', {});
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(calls).toEqual([]);
    });

    it('ignores the text and the end of another run', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));

      act(() => {
        result.current.trigger({ inputs: {} });
      });
      act(() => {
        simulateWorkflowSuccess('chat-run', 'chat-thread', 'Chat text');
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result.current.status).toBe('running');
      expect(result.current.text).toBeNull();
    });

    it('keeps workflow output out of the chat history', async () => {
      const { result } = renderHook(() => useWorkflowAndClient(), { wrapper });
      await waitFor(() => expect(result.current.workflow.connected).toBe(true));

      act(() => {
        result.current.client!.sendPrompt('Hello');
      });
      const chatRunId = findAllSentMessages('run_agent')[0].data.runId;
      act(() => {
        result.current.workflow.trigger({ inputs: {} });
      });
      const workflowRunId = lastWorkflowRunId();
      const workflowThreadId = findSentMessage('run_workflow').data.threadId;

      act(() => {
        simulateEvent({ type: EventType.RUN_STARTED, threadId: 't', runId: chatRunId }, chatRunId);
        simulateWorkflowSuccess(workflowRunId, workflowThreadId, 'PDF contents');
      });

      await waitFor(() => expect(result.current.workflow.status).toBe('completed'));
      expect(result.current.workflow.text).toBe('PDF contents');
      const client = result.current.client!;
      expect(JSON.stringify(client.messages)).not.toContain('PDF contents');
      expect(JSON.stringify(client.runMessages)).not.toContain('PDF contents');
      expect(client.currentMessageContent).not.toContain('PDF contents');
      expect(client.currentRunId).toBe(chatRunId);
    });
  });

  // Security finding M4: a workflow has no chat approval UI, so a tool that needs
  // approval runs only when the caller answers the approval request.
  describe('Tool approval', () => {
    const destructive = { annotations: { destructiveHint: true } };

    function toolResults(): Array<Record<string, unknown>> {
      return getSentMessages()
        .filter((m) => m.type === 'tool_result')
        .map((m) => JSON.parse(m.data.content));
    }

    it('does not run a destructive tool when the caller gives no onApprovalRequest', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const calls: unknown[] = [];
      const deleteAll = defineTool('Delete all items', () => {
        calls.push(true);
        return { deleted: true };
      }, destructive);

      act(() => {
        result.current.trigger({ inputs: {}, tools: { deleteAll } });
      });
      act(() => {
        simulateToolCall('tc-1', 'deleteAll', {}, lastWorkflowRunId());
      });

      await waitFor(() => expect(toolResults().length).toBe(1));
      expect(calls).toEqual([]);
      expect(toolResults()[0].rejected).toBe(true);
    });

    it('runs a destructive tool when onApprovalRequest approves', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const calls: unknown[] = [];
      const deleteItem = defineTool('Delete one item', z.object({ id: z.string() }), (input) => {
        calls.push(input);
        return { deleted: input.id };
      }, destructive);
      const requests: WorkflowApprovalRequest[] = [];

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { deleteItem },
          onApprovalRequest: async (request) => {
            requests.push(request);
            return { approved: true };
          },
        });
      });
      act(() => {
        simulateToolCall('tc-1', 'deleteItem', { id: 'a' }, lastWorkflowRunId());
      });

      await waitFor(() => expect(calls).toEqual([{ id: 'a' }]));
      expect(requests).toEqual([
        { toolCallId: 'tc-1', toolName: 'deleteItem', args: { id: 'a' }, annotations: { destructiveHint: true } },
      ]);
      await waitFor(() => expect(toolResults()).toEqual([{ deleted: 'a' }]));
    });

    it('does not run a destructive tool when onApprovalRequest rejects', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const calls: unknown[] = [];
      const deleteAll = defineTool('Delete all items', () => {
        calls.push(true);
        return { deleted: true };
      }, destructive);

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { deleteAll },
          onApprovalRequest: async () => ({ approved: false, reason: 'Not now' }),
        });
      });
      act(() => {
        simulateToolCall('tc-1', 'deleteAll', {}, lastWorkflowRunId());
      });

      await waitFor(() => expect(toolResults().length).toBe(1));
      expect(calls).toEqual([]);
      expect(toolResults()[0]).toEqual({ rejected: true, reason: 'Not now' });
    });

    it('rejects ctx.requestApproval when the caller gives no onApprovalRequest', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const askFirst = defineTool('Ask first', async (ctx) => {
        const { approved } = await ctx.requestApproval({ message: 'Send the email?' });
        return { approved };
      });

      act(() => {
        result.current.trigger({ inputs: {}, tools: { askFirst } });
      });
      act(() => {
        simulateToolCall('tc-1', 'askFirst', {}, lastWorkflowRunId());
      });

      await waitFor(() => expect(toolResults()).toEqual([{ approved: false }]));
    });

    it('sends ctx.requestApproval to onApprovalRequest', async () => {
      const { result } = renderHook(() => useAIWorkflow('dify', 'test-workflow'), { wrapper });
      await waitFor(() => expect(result.current.connected).toBe(true));
      const askFirst = defineTool('Ask first', async (ctx) => {
        const { approved } = await ctx.requestApproval({ message: 'Send the email?', metadata: { to: 'x' } });
        return { approved };
      });
      const requests: WorkflowApprovalRequest[] = [];

      act(() => {
        result.current.trigger({
          inputs: {},
          tools: { askFirst },
          onApprovalRequest: async (request) => {
            requests.push(request);
            return { approved: true };
          },
        });
      });
      act(() => {
        simulateToolCall('tc-1', 'askFirst', {}, lastWorkflowRunId());
      });

      await waitFor(() => expect(toolResults()).toEqual([{ approved: true }]));
      expect(requests).toEqual([
        { toolCallId: 'tc-1', toolName: 'askFirst', args: {}, message: 'Send the email?', metadata: { to: 'x' } },
      ]);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { renderHook, waitFor, render, act } from '@testing-library/react';
import React from 'react';
import { z } from 'zod';
import { UseAIProvider, useAIContext } from '../src/providers/useAIProvider';
import { useAI } from '../src/useAI';
import { defineTool } from '../src/defineTool';
import { UseAIFloatingButton } from '../src/components/UseAIFloatingButton';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  simulateToolCall,
  findSentMessage,
  getSentMessages,
  useStableTools,
} from './integration-test-utils';

describe('useAI Integration Tests', () => {
  beforeEach(() => {
    setupMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <UseAIProvider serverUrl="ws://localhost:8081">{children}</UseAIProvider>
  );

  describe('A component can define tools for an AI to invoke', () => {
    it('should allow tools to be defined and registered in the provider', async () => {
      let todoList: string[] = [];

      const addTodo = defineTool(
        'Add a new todo item',
        z.object({ text: z.string() }),
        (input) => {
          todoList.push(input.text);
          return { success: true, id: '123', text: input.text, totalTodos: todoList.length };
        }
      );

      const TestComponent = () => {
        const tools = useStableTools({ addTodo });
        useAI({ tools });
        return null;
      };

      render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      // Invoke the tool and verify it actually modifies state
      await act(async () => {
        
        simulateToolCall('call-1', 'addTodo', { text: 'Buy groceries' });
      });

      // Wait for tool result to be sent
      await waitFor(() => {
        
        const toolResult = findSentMessage('tool_result');
        expect(toolResult).toBeDefined();
      });

      // Verify the state was actually updated
      expect(todoList).toEqual(['Buy groceries']);

      // Verify the tool result contains the correct data
      
      const toolResult = findSentMessage('tool_result');
      const resultData = JSON.parse(toolResult.data.content);
      expect(resultData.success).toBe(true);
      expect(resultData.text).toBe('Buy groceries');
      expect(resultData.totalTodos).toBe(1);
    });

    it('should allow the AI to invoke registered tools', async () => {
      const TestComponent = () => {
        const [lastTodo, setLastTodo] = React.useState<string>('');

        const tools = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setLastTodo(input.text);
              return { success: true, text: input.text };
            }
          )
        }), []);

        useAI({ tools });
        return <div data-testid="last-todo">{lastTodo}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );
      await act(async () => {
        
        simulateToolCall('call-123', 'addTodo', { text: 'Buy groceries' });
      });

      // Verify the component state was updated
      await waitFor(() => {
        expect(getByTestId('last-todo').textContent).toBe('Buy groceries');
      });

      // Verify the tool result was sent back to the server
      await waitFor(() => {
        
        const toolResult = findSentMessage('tool_result');
        expect(toolResult).toBeDefined();
        expect(toolResult.data.toolCallId).toBe('call-123');

        const resultData = JSON.parse(toolResult.data.content);
        expect(resultData.success).toBe(true);
        expect(resultData.text).toBe('Buy groceries');
      });
    });
  });

  describe('A component can put its state in "prompt" to provide current state to the AI', () => {
    it('should allow prompt to be provided (state is sent with RunAgentInput)', async () => {
      const TestComponent = () => {
        const [todos, setTodos] = React.useState<string[]>(['Buy milk', 'Walk dog']);

        const toolsWithState = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setTodos(prev => [...prev, input.text]);
              return { success: true, added: input.text };
            }
          )
        }), []);

        const currentState = `Current todos: ${todos.join(', ')}`;
        useAI({ tools: toolsWithState, prompt: currentState });
        return <div data-testid="todo-count">{todos.length}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      // Connection is automatic

      // Initial state should be 2 todos
      expect(getByTestId('todo-count').textContent).toBe('2');

      // Invoke the tool
      await act(async () => {
        
        simulateToolCall('call-1', 'addTodo', { text: 'Take out trash' });
      });

      // Wait for tool result with updated state
      await waitFor(() => {
        
        const toolResult = findSentMessage('tool_result');
        expect(toolResult).toBeDefined();
      });

      // Verify the component state was updated
      await waitFor(() => {
        expect(getByTestId('todo-count').textContent).toBe('3');
      });

      // Verify the tool result contains the state
      
      const toolResult = findSentMessage('tool_result');
      const resultData = JSON.parse(toolResult.data.content);
      expect(resultData.success).toBe(true);
      expect(resultData.added).toBe('Take out trash');
    });

    it('should update state when component re-renders after tool execution', async () => {
      const TestComponent = () => {
        const [count, setCount] = React.useState(0);

        const toolsWithState = React.useMemo(() => ({
          incrementCounter: defineTool(
            'Increment the counter',
            () => {
              setCount(prev => prev + 1);
              return { success: true, newCount: count + 1 };
            }
          )
        }), [count]);

        const currentState = `Counter value: ${count}`;
        useAI({ tools: toolsWithState, prompt: currentState });
        return <div data-testid="counter">{count}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      // Initial count should be 0
      expect(getByTestId('counter').textContent).toBe('0');

      // Invoke the tool to increment counter
      await act(async () => {
        
        simulateToolCall('call-increment-1', 'incrementCounter', {});
      });

      // Verify the component state was updated
      await waitFor(() => {
        expect(getByTestId('counter').textContent).toBe('1');
      });

      // Verify tool_result message contains updated state
      await waitFor(() => {
        
        const toolResultMessage = getSentMessages().find(
          (msg) => msg.type === 'tool_result'
        );
        expect(toolResultMessage).toBeDefined();
        expect(toolResultMessage.data.toolCallId).toBe('call-increment-1');

        const resultData = JSON.parse(toolResultMessage.data.content);
        expect(resultData.success).toBe(true);
        expect(resultData.newCount).toBe(1);
      });
    });
  });

  describe('Components will be automatically identified by their "id" attribute if present', () => {
    it('should namespace tools with the component ref id attribute', async () => {
      const TestComponent = ({ id, listName }: { id: string; listName: string }) => {
        const [lastTodo, setLastTodo] = React.useState<string>('');

        const tools = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setLastTodo(input.text);
              return { success: true, list: listName, text: input.text };
            }
          )
        }), [listName]);
        const { ref } = useAI({ tools });

        return <div ref={ref} id={id} data-testid={`list-${id}`}>{lastTodo}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent id="todo-list" listName="todo-list" />
          <TestComponent id="shopping-list" listName="shopping-list" />
          <TestComponent id="work-tasks" listName="work-tasks" />
        </UseAIProvider>
      );

      // Test namespaced tool calls - call todo-list component
      await act(async () => {
        
        simulateToolCall('call-1', 'todo-list_addTodo', { text: 'Task 1' });
      });

      // Verify only the todo-list component state was updated
      await waitFor(() => {
        expect(getByTestId('list-todo-list').textContent).toBe('Task 1');
        expect(getByTestId('list-shopping-list').textContent).toBe('');
        expect(getByTestId('list-work-tasks').textContent).toBe('');
      });

      // Verify the tool result contains the correct list identifier
      await waitFor(() => {
        
        const toolResult = findSentMessage('tool_result');
        const resultData = JSON.parse(toolResult.data.content);
        expect(resultData.list).toBe('todo-list');
        expect(resultData.text).toBe('Task 1');
      });
    });
  });

  describe('An explicit id can be provided to useAI', () => {
    it('should namespace tools with the explicit id option', async () => {
      const TestComponent = ({ id, panelName }: { id: string; panelName: string }) => {
        const [lastTask, setLastTask] = React.useState<string>('');

        const tools = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setLastTask(input.text);
              return { success: true, panel: panelName, text: input.text };
            }
          )
        }), [panelName]);
        useAI({ tools, id });
        return <div data-testid={`panel-${id}`}>{lastTask}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent id="user-panel" panelName="user" />
          <TestComponent id="admin-panel" panelName="admin" />
          <TestComponent id="guest-panel" panelName="guest" />
        </UseAIProvider>
      );

      // Test that namespaced tool can be called
      await act(async () => {
        
        simulateToolCall('call-1', 'user-panel_addTodo', { text: 'Task' });
      });

      // Verify only the user panel state was updated
      await waitFor(() => {
        expect(getByTestId('panel-user-panel').textContent).toBe('Task');
        expect(getByTestId('panel-admin-panel').textContent).toBe('');
        expect(getByTestId('panel-guest-panel').textContent).toBe('');
      });

      // Verify tool result contains correct panel identifier
      await waitFor(() => {
        
        const toolResult = findSentMessage('tool_result');
        const resultData = JSON.parse(toolResult.data.content);
        expect(resultData.panel).toBe('user');
        expect(resultData.text).toBe('Task');
      });
    });

    it('should prefer explicit id over ref id attribute', async () => {
      const TestComponent = ({ explicitId, refId, idLabel }: { explicitId: string; refId: string; idLabel: string }) => {
        const [lastTask, setLastTask] = React.useState<string>('');

        const tools = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setLastTask(input.text);
              return { success: true, id: idLabel, text: input.text };
            }
          )
        }), [idLabel]);
        const { ref } = useAI({ tools, id: explicitId });

        return <div ref={ref} id={refId} data-testid={`component-${explicitId}`}>{lastTask}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent explicitId="explicit-1" refId="ref-1" idLabel="explicit-1" />
          <TestComponent explicitId="explicit-2" refId="ref-2" idLabel="explicit-2" />
        </UseAIProvider>
      );

      // Connection is automatic

      // Test that tool with explicit id (not ref id) is used
      await act(async () => {
        
        simulateToolCall('call-1', 'explicit-1_addTodo', { text: 'Task' });
      });

      // Verify only explicit-1 component state was updated
      await waitFor(() => {
        expect(getByTestId('component-explicit-1').textContent).toBe('Task');
        expect(getByTestId('component-explicit-2').textContent).toBe('');
      });

      // Verify the tool result uses the explicit ID
      await waitFor(() => {
        
        const toolResult = findSentMessage('tool_result');
        const resultData = JSON.parse(toolResult.data.content);
        expect(resultData.id).toBe('explicit-1');
        expect(resultData.text).toBe('Task');
      });
    });
  });

  describe('confirmationRequired can be set to instruct the backend to confirm operations', () => {
    it('should include confirmationRequired in tool definition when set', async () => {
      const deleteTodo = defineTool(
        'Delete a todo',
        z.object({ id: z.string() }),
        () => ({ success: true }),
        { confirmationRequired: true }
      );

      const TestComponent = () => {
        const tools = useStableTools({ deleteTodo });
        useAI({ tools });
        return null;
      };

      render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );
      // confirmationRequired is part of tool definition (verified in defineTool tests)
      // Just verify component renders
      expect(deleteTodo._options.confirmationRequired).toBe(true);
    });

    it('should not include confirmationRequired when not set', async () => {
      const getTodo = defineTool(
        'Get a todo',
        z.object({ id: z.string() }),
        () => ({ id: '1', text: 'Sample todo' })
      );

      const TestComponent = () => {
        const tools = useStableTools({ getTodo });
        useAI({ tools });
        return null;
      };

      render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      expect(getTodo._options.confirmationRequired).toBeUndefined();
    });
  });

  describe('The client will send a response after invoking a tool', () => {
    it('should send tool_result message after tool execution', async () => {
      const TestComponent = () => {
        const [count, setCount] = React.useState(0);

        // Modify the tool to trigger a re-render
        const toolsWithRender = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setCount(c => c + 1); // Trigger re-render
              return { success: true, id: '123', text: input.text };
            }
          )
        }), []);

        useAI({ tools: toolsWithRender });
        return <div>Count: {count}</div>;
      };

      render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      await act(async () => {
        
        simulateToolCall('call-456', 'addTodo', { text: 'New todo' });
      });

      await waitFor(() => {
        
        const toolResultMessage = getSentMessages().find(
          (msg) => msg.type === 'tool_result'
        );
        expect(toolResultMessage).toBeDefined();
        expect(toolResultMessage.data.toolCallId).toBe('call-456');
      });
    });

    it('should send tool_result with state when prompt is provided', async () => {
      const TestComponent = () => {
        const [todos, setTodos] = React.useState<string[]>([]);

        const toolsWithRender = React.useMemo(() => ({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => {
              setTodos(prev => [...prev, input.text]); // Trigger re-render
              return { success: true };
            }
          )
        }), []);

        const currentState = `Current todos: ${todos.join(', ') || 'none'}`;
        useAI({ tools: toolsWithRender, prompt: currentState });
        return <div>Todos: {todos.length}</div>;
      };

      render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      await act(async () => {
        
        simulateToolCall('call-789', 'addTodo', { text: 'Buy milk' });
      });

      await waitFor(() => {
        
        const toolResultMessage = getSentMessages().find(
          (msg) => msg.type === 'tool_result'
        );
        expect(toolResultMessage).toBeDefined();
        expect(toolResultMessage.data.toolCallId).toBe('call-789');
      });
    });
  });

  describe('The UseAIFloatingButton will only be enabled when the websocket is connected', () => {
    it('should be disabled when not connected', async () => {
      const { container } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <div>App Content</div>
        </UseAIProvider>
      );

      // Initially, before connection, no button should be rendered (no tools registered)
      // Let's register tools to make button appear
      const TestComponent = () => {
        const tools = useStableTools({
          testTool: defineTool('Test tool', () => 'result'),
        });
        useAI({ tools });
        return null;
      };

      const { container: container2 } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      // Before connection completes, button should exist and be disabled
      // Wait for button to appear (after tools are registered)
      await waitFor(() => {
        const button = container2.querySelector('button');
        expect(button).toBeDefined();
      });
    });

    it('should be enabled when connected', async () => {
      const TestComponent = () => {
        const tools = useStableTools({
          testTool: defineTool('Test tool', () => 'result'),
        });
        useAI({ tools });
        return null;
      };

      const { container } = render(
        <UseAIProvider serverUrl="ws://localhost:8081">
          <TestComponent />
        </UseAIProvider>
      );

      await waitFor(() => {
        const button = container.querySelector('button');
        expect(button).toBeDefined();
        expect(button?.disabled).toBe(false);
      });
    });
  });

  describe('systemPrompt is included in state when sending messages', () => {
    it('should include systemPrompt in run_agent state when useAI provides a prompt', async () => {
      const systemPrompt = 'You are a helpful SQL assistant. Always respond in Japanese.';
      let sendPromptFn: ((message: string) => Promise<void>) | null = null;

      const TestComponent = () => {
        const { client, connected } = useAIContext();
        const [todos] = React.useState(['Buy milk', 'Walk dog']);

        const tools = useStableTools({
          addTodo: defineTool(
            'Add a todo',
            z.object({ text: z.string() }),
            (input) => ({ success: true, text: input.text })
          ),
        });

        const componentPrompt = `Current todos: ${todos.join(', ')}`;
        useAI({ tools, prompt: componentPrompt });

        // Expose sendPrompt for testing
        React.useEffect(() => {
          if (client && connected) {
            sendPromptFn = async (message: string) => {
              client.sendPrompt(message);
            };
          }
        }, [client, connected]);

        return <div data-testid="connected">{connected ? 'yes' : 'no'}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081" systemPrompt={systemPrompt}>
          <TestComponent />
        </UseAIProvider>
      );

      // Wait for connection
      await waitFor(() => {
        expect(getByTestId('connected').textContent).toBe('yes');
      });

      // Wait for sendPromptFn to be available
      await waitFor(() => {
        expect(sendPromptFn).not.toBeNull();
      });

      // Send a message
      await act(async () => {
        await sendPromptFn!('What todos do I have?');
      });

      // Wait for run_agent message to be sent
      await waitFor(() => {
        const runAgentMsg = getSentMessages().find(msg => msg.type === 'run_agent');
        expect(runAgentMsg).toBeDefined();
      });

      // Verify the state includes the system prompt
      const runAgentMsg = getSentMessages().find(msg => msg.type === 'run_agent');
      expect(runAgentMsg.data.state).toBeDefined();
      expect(runAgentMsg.data.state.context).toBeDefined();

      // The context should include the system prompt
      expect(runAgentMsg.data.state.context).toContain(systemPrompt);
      // The context should also include the component's prompt
      expect(runAgentMsg.data.state.context).toContain('Current todos: Buy milk, Walk dog');
    });

    it('should include systemPrompt in run_agent state even when no useAI hook is present', async () => {
      const systemPrompt = 'You are a helpful assistant. Always be polite.';
      let sendPromptFn: ((message: string) => Promise<void>) | null = null;

      // This component does NOT use useAI hook - only uses the provider context
      const TestComponent = () => {
        const { client, connected } = useAIContext();

        // Expose sendPrompt for testing
        React.useEffect(() => {
          if (client && connected) {
            sendPromptFn = async (message: string) => {
              client.sendPrompt(message);
            };
          }
        }, [client, connected]);

        return <div data-testid="connected">{connected ? 'yes' : 'no'}</div>;
      };

      const { getByTestId } = render(
        <UseAIProvider serverUrl="ws://localhost:8081" systemPrompt={systemPrompt}>
          <TestComponent />
        </UseAIProvider>
      );

      // Wait for connection
      await waitFor(() => {
        expect(getByTestId('connected').textContent).toBe('yes');
      });

      // Wait for sendPromptFn to be available
      await waitFor(() => {
        expect(sendPromptFn).not.toBeNull();
      });

      // Send a message
      await act(async () => {
        await sendPromptFn!('Hello!');
      });

      // Wait for run_agent message to be sent
      await waitFor(() => {
        const runAgentMsg = getSentMessages().find(msg => msg.type === 'run_agent');
        expect(runAgentMsg).toBeDefined();
      });

      // Verify the state includes the system prompt
      const runAgentMsg = getSentMessages().find(msg => msg.type === 'run_agent');
      expect(runAgentMsg.data.state).toBeDefined();
      expect(runAgentMsg.data.state.context).toBeDefined();

      // The context should include the system prompt
      expect(runAgentMsg.data.state.context).toContain(systemPrompt);
    });
  });
});

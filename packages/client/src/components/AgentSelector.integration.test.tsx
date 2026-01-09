import { describe, test, expect, mock } from 'bun:test';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { UseAIChatPanel } from './UseAIChatPanel';
import { ThemeContext, StringsContext, defaultTheme, defaultStrings } from '../theme';
import type { AgentInfo } from '../types';

/**
 * Test wrapper that provides theme and strings context
 */
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={defaultTheme}>
      <StringsContext.Provider value={defaultStrings}>
        {children}
      </StringsContext.Provider>
    </ThemeContext.Provider>
  );
}

/**
 * Helper to render UseAIChatPanel with required props
 */
function renderChatPanel(props: Partial<React.ComponentProps<typeof UseAIChatPanel>> = {}) {
  const defaultProps = {
    onSendMessage: mock(() => {}),
    messages: [],
    loading: false,
    connected: true,
    ...props,
  };

  return render(
    <TestWrapper>
      <UseAIChatPanel {...defaultProps} />
    </TestWrapper>
  );
}

describe('Agent Selector Integration', () => {
  describe('visibility', () => {
    test('agent selector is not shown when there is only one agent', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
      ];

      const { queryByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: mock(() => {}),
      });

      expect(queryByTestId('agent-selector')).not.toBeInTheDocument();
    });

    test('agent selector is not shown when no agents are provided', () => {
      const { queryByTestId } = renderChatPanel({
        availableAgents: undefined,
        onAgentChange: mock(() => {}),
      });

      expect(queryByTestId('agent-selector')).not.toBeInTheDocument();
    });

    test('agent selector is not shown when onAgentChange is not provided', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { queryByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: undefined,
      });

      expect(queryByTestId('agent-selector')).not.toBeInTheDocument();
    });

    test('agent selector is shown when there are multiple agents', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: mock(() => {}),
      });

      expect(getByTestId('agent-selector')).toBeInTheDocument();
    });
  });

  describe('displaying agent names', () => {
    test('shows the default agent name in the button', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Claude Sonnet' },
        { id: 'agent2', name: 'Claude Opus' },
      ];

      const { getByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        selectedAgent: null,
        onAgentChange: mock(() => {}),
      });

      expect(getByTestId('agent-selector')).toHaveTextContent('Claude Sonnet');
    });

    test('shows the selected agent name in the button', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Claude Sonnet' },
        { id: 'agent2', name: 'Claude Opus' },
      ];

      const { getByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        selectedAgent: 'agent2',
        onAgentChange: mock(() => {}),
      });

      expect(getByTestId('agent-selector')).toHaveTextContent('Claude Opus');
    });
  });

  describe('dropdown interaction', () => {
    test('clicking the selector opens the dropdown', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId, queryAllByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: mock(() => {}),
      });

      // Dropdown should not be visible initially
      expect(queryAllByTestId('agent-option')).toHaveLength(0);

      // Click the selector
      fireEvent.click(getByTestId('agent-selector'));

      // Dropdown should now be visible with agent options
      expect(getAllByTestId('agent-option')).toHaveLength(2);
    });

    test('dropdown shows all available agents with names', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Claude Sonnet' },
        { id: 'agent2', name: 'Claude Opus' },
        { id: 'agent3', name: 'Claude Haiku' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: mock(() => {}),
      });

      fireEvent.click(getByTestId('agent-selector'));

      const options = getAllByTestId('agent-option');
      expect(options).toHaveLength(3);
      expect(options[0]).toHaveTextContent('Claude Sonnet');
      expect(options[1]).toHaveTextContent('Claude Opus');
      expect(options[2]).toHaveTextContent('Claude Haiku');
    });

    test('dropdown shows annotation when provided', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Quick Mode', annotation: 'Fast responses for simple tasks' },
        { id: 'agent2', name: 'Deep Thinking', annotation: 'Complex reasoning and analysis' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: mock(() => {}),
      });

      fireEvent.click(getByTestId('agent-selector'));

      const options = getAllByTestId('agent-option');
      expect(options[0]).toHaveTextContent('Quick Mode');
      expect(options[0]).toHaveTextContent('Fast responses for simple tasks');
      expect(options[1]).toHaveTextContent('Deep Thinking');
      expect(options[1]).toHaveTextContent('Complex reasoning and analysis');
    });

    test('dropdown does not show annotation when not provided', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Quick Mode' },
        { id: 'agent2', name: 'Deep Thinking', annotation: 'Has annotation' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange: mock(() => {}),
      });

      fireEvent.click(getByTestId('agent-selector'));

      const options = getAllByTestId('agent-option');
      // First agent has no annotation
      expect(options[0]).toHaveTextContent('Quick Mode');
      expect(options[0]).not.toHaveTextContent('Has annotation');
      // Second agent has annotation
      expect(options[1]).toHaveTextContent('Deep Thinking');
      expect(options[1]).toHaveTextContent('Has annotation');
    });
  });

  describe('selection behavior', () => {
    test('clicking an agent option calls onAgentChange with the agent id', () => {
      const onAgentChange = mock(() => {});
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange,
      });

      fireEvent.click(getByTestId('agent-selector'));
      fireEvent.click(getAllByTestId('agent-option')[1]);

      expect(onAgentChange).toHaveBeenCalledWith('agent2');
    });

    test('clicking the default agent calls onAgentChange with null', () => {
      const onAgentChange = mock(() => {});
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        selectedAgent: 'agent2',
        onAgentChange,
      });

      fireEvent.click(getByTestId('agent-selector'));
      // Click the first option (which is the default agent)
      fireEvent.click(getAllByTestId('agent-option')[0]);

      // Should pass null to reset to server default
      expect(onAgentChange).toHaveBeenCalledWith(null);
    });

    test('dropdown closes after selecting an agent', () => {
      const onAgentChange = mock(() => {});
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId, getAllByTestId, queryAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        onAgentChange,
      });

      fireEvent.click(getByTestId('agent-selector'));
      expect(getAllByTestId('agent-option')).toHaveLength(2);

      fireEvent.click(getAllByTestId('agent-option')[1]);

      // Dropdown should be closed
      expect(queryAllByTestId('agent-option')).toHaveLength(0);
    });

    test('selected agent has visual indicator (checkmark)', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        selectedAgent: 'agent2',
        onAgentChange: mock(() => {}),
      });

      fireEvent.click(getByTestId('agent-selector'));

      const options = getAllByTestId('agent-option');
      // First option (agent1) should not have SVG checkmark
      expect(options[0].querySelector('svg')).toBeNull();
      // Second option (agent2) should have SVG checkmark
      expect(options[1].querySelector('svg')).toBeInTheDocument();
    });

    test('default agent is selected when selectedAgent is null', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ];

      const { getByTestId, getAllByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'agent1',
        selectedAgent: null,
        onAgentChange: mock(() => {}),
      });

      fireEvent.click(getByTestId('agent-selector'));

      const options = getAllByTestId('agent-option');
      // First option (agent1) should have SVG checkmark as it's the default
      expect(options[0].querySelector('svg')).toBeInTheDocument();
      // Second option should not
      expect(options[1].querySelector('svg')).toBeNull();
    });
  });

  describe('button display with visibleAgentIds', () => {
    test('button shows selected agent name after selection', () => {
      const agents: AgentInfo[] = [
        { id: 'agent1', name: 'Quick Mode' },
        { id: 'agent2', name: 'Deep Thinking' },
      ];

      const { rerender, getByTestId } = render(
        <TestWrapper>
          <UseAIChatPanel
            onSendMessage={mock(() => {})}
            messages={[]}
            loading={false}
            connected={true}
            availableAgents={agents}
            defaultAgent="agent1"
            selectedAgent={null}
            onAgentChange={mock(() => {})}
          />
        </TestWrapper>
      );

      // Initially shows the default agent's name
      expect(getByTestId('agent-selector')).toHaveTextContent('Quick Mode');

      // Simulate selection by re-rendering with selectedAgent
      rerender(
        <TestWrapper>
          <UseAIChatPanel
            onSendMessage={mock(() => {})}
            messages={[]}
            loading={false}
            connected={true}
            availableAgents={agents}
            defaultAgent="agent1"
            selectedAgent="agent2"
            onAgentChange={mock(() => {})}
          />
        </TestWrapper>
      );

      // Now shows the selected agent's name
      expect(getByTestId('agent-selector')).toHaveTextContent('Deep Thinking');
    });
  });

  describe('edge cases', () => {
    test('shows only default agent when single agent in list', () => {
      const agents: AgentInfo[] = [
        { id: 'default-agent', name: 'Default Agent' },
      ];

      const { queryByTestId } = renderChatPanel({
        availableAgents: agents,
        defaultAgent: 'default-agent',
        onAgentChange: mock(() => {}),
      });

      // Should not show selector when only one agent
      expect(queryByTestId('agent-selector')).not.toBeInTheDocument();
    });
  });
});

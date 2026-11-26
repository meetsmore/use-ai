import { v4 as uuidv4 } from 'uuid';
import type { AgentInput } from '../src/agents/types';

/**
 * Creates an AgentInput with one user message "Hello", no tools and no state.
 * Fields in `overrides` replace the top-level fields of the input.
 */
export function createTestInput(overrides: Partial<AgentInput> = {}): AgentInput {
  const threadId = uuidv4();
  const runId = uuidv4();
  return {
    session: {
      socket: {} as never,
      clientId: 'client-1',
      threadId: 'thread-1',
      tools: [],
      state: null,
      pendingToolCalls: new Map(),
      pendingToolApprovals: new Map(),
      ipAddress: '127.0.0.1',
    },
    runId,
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    state: null,
    originalInput: {
      threadId,
      runId,
      messages: [{ id: uuidv4(), role: 'user', content: 'Hello' }],
      tools: [],
      state: null,
      context: [],
      forwardedProps: {},
    },
    ...overrides,
  };
}

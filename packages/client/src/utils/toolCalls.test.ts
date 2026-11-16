import { describe, it, expect } from 'bun:test';
import { getToolCallStatus, getTurnParts } from './toolCalls';
import type { PersistedMessage } from '../providers/chatRepository/types';

describe('getToolCallStatus', () => {
  it.each([
    ['{"aborted":true,"reason":"Cancelled by user before tool finished"}', 'aborted'],
    ['{"rejected":true,"reason":"No"}', 'rejected'],
    ['{"error":"Not found"}', 'error'],
    ['{"error":true,"message":"MCP confirmation execution failed"}', 'error'],
    ['{"success":false}', 'error'],
    ['{"success":true}', 'done'],
    ['"hi"', 'done'],
    ['[1,2]', 'done'],
    ['not json', 'done'],
  ])('reads %s as %s', (result, status) => {
    expect(getToolCallStatus(result)).toBe(status as ReturnType<typeof getToolCallStatus>);
  });
});

describe('getTurnParts', () => {
  const at = new Date(0);
  const call = (id: string, name: string, args: string) => ({ id, type: 'function' as const, function: { name, arguments: args } });

  it('rebuilds a turn in the order the run streamed it, with each call\'s status and result', () => {
    const turn: PersistedMessage[] = [
      {
        id: 'a1', role: 'assistant', content: 'Checking.', createdAt: at,
        reasoningParts: [{ text: 'Need the time.' }],
        toolCalls: [call('tc1', 'getTime', '{}'), call('tc2', 'deleteAll', '{}')],
      },
      { id: 't1', role: 'tool', content: '{"time":"noon"}', toolCallId: 'tc1', createdAt: at },
      { id: 't2', role: 'tool', content: '{"rejected":true}', toolCallId: 'tc2', createdAt: at },
      { id: 'a2', role: 'assistant', content: 'It is noon.', createdAt: at },
    ];

    expect(getTurnParts(turn)).toEqual([
      { kind: 'reasoning', text: 'Need the time.' },
      { kind: 'text', text: 'Checking.', messageId: 'a1' },
      { kind: 'tool_call', toolCallId: 'tc1', name: 'getTime', args: '{}', status: 'done', result: '{"time":"noon"}' },
      { kind: 'tool_call', toolCallId: 'tc2', name: 'deleteAll', args: '{}', status: 'rejected', result: '{"rejected":true}' },
      { kind: 'text', text: 'It is noon.', messageId: 'a2' },
    ]);
  });

  it('reads a call with no result as aborted', () => {
    const turn: PersistedMessage[] = [
      { id: 'a1', role: 'assistant', content: '', createdAt: at, toolCalls: [call('tc1', 'ask', '{}')] },
    ];
    expect(getTurnParts(turn)).toEqual([
      { kind: 'tool_call', toolCallId: 'tc1', name: 'ask', args: '{}', status: 'aborted' },
    ]);
  });
});

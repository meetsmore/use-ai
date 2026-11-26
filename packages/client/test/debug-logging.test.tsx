import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { z } from 'zod';
import { UseAIProvider } from '../src/providers/useAIProvider';
import { useAI } from '../src/useAI';
import { defineTool } from '../src/defineTool';
import { DEBUG_STORAGE_KEY, setDebugLogging } from '../src/utils/logger';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  simulateToolCall,
  findSentMessage,
  useStableTools,
} from './integration-test-utils';

const SECRET = 'secret-user-input-4242';

type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';
const METHODS: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];

interface CapturedCall {
  method: ConsoleMethod;
  text: string;
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

let calls: CapturedCall[] = [];
const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

function captureConsole(): void {
  calls = [];
  for (const method of METHODS) {
    originals.set(method, console[method]);
    console[method] = (...args: unknown[]) => {
      calls.push({ method, text: args.map(stringifyArg).join(' ') });
    };
  }
}

function restoreConsole(): void {
  for (const method of METHODS) {
    const original = originals.get(method);
    if (original) console[method] = original;
  }
}

function callsContaining(value: string): CapturedCall[] {
  return calls.filter(call => call.text.includes(value));
}

function ToolComponent() {
  const tools = useStableTools({
    saveNote: defineTool(
      'Save a note',
      z.object({ text: z.string() }),
      (input) => ({ success: true, saved: input.text }),
    ),
  });
  useAI({ tools });
  return null;
}

async function runToolCall(debug?: boolean): Promise<void> {
  render(
    <UseAIProvider serverUrl="ws://localhost:8081" debug={debug}>
      <ToolComponent />
    </UseAIProvider>,
  );

  await act(async () => {
    simulateToolCall('call-1', 'saveNote', { text: SECRET });
  });

  await waitFor(() => expect(findSentMessage('tool_result')).toBeDefined());
}

describe('client debug logging', () => {
  beforeEach(() => {
    setupMockWebSocket();
    localStorage.removeItem(DEBUG_STORAGE_KEY);
    setDebugLogging(false);
    captureConsole();
  });

  afterEach(() => {
    restoreConsole();
    localStorage.removeItem(DEBUG_STORAGE_KEY);
    setDebugLogging(false);
    restoreMockWebSocket();
  });

  it('does not log tool arguments or results by default', async () => {
    await runToolCall();

    expect(callsContaining(SECRET)).toEqual([]);
    expect(calls.filter(call => call.method === 'log')).toEqual([]);
  });

  it('logs debug output when the provider has the debug prop', async () => {
    await runToolCall(true);

    expect(calls.filter(call => call.method === 'log').length).toBeGreaterThan(0);
  });

  it('logs debug output when the localStorage flag is set', async () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, 'true');

    await runToolCall();

    expect(calls.filter(call => call.method === 'log').length).toBeGreaterThan(0);
  });
});

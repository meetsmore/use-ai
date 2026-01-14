import { mock } from 'bun:test';
import { mkdirSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// AI SDK Mock
// ============================================================================
// This mock must be set up BEFORE any code imports the ai module.
// The tests can still define their own createMockModel functions for custom behavior,
// but for tests that need simpler mocking, they can use setMockResponses.

/**
 * Type for mock response configuration
 */
interface MockResponse {
  text?: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }>;
}

/**
 * Type for tool executor function (matches AI SDK tool format)
 */
type ToolExecutor = (
  args: Record<string, unknown>,
  options: { toolCallId: string }
) => Promise<unknown>;

/**
 * Type for tools configuration passed to streamText
 */
type ToolsConfig = Record<string, { execute?: ToolExecutor }>;

// Track mock behavior - can be configured per-test via exported functions
const mockBehavior: {
  responses: MockResponse[];
  callCount: number;
  error?: string;
  useBuiltinMock: boolean;
} = {
  responses: [{ text: 'Default response' }],
  callCount: 0,
  useBuiltinMock: false,
};

// Store the original streamText for tests that define their own mocks
let originalStreamText: unknown = null;

// Mock the AI SDK module
mock.module('ai', () => {
  // Import actual implementations for non-mocked exports
  const actualAi = require('ai');
  originalStreamText = actualAi.streamText;

  return {
    ...actualAi,
    streamText: (options: { tools?: ToolsConfig; [key: string]: unknown }) => {
      // If tests have disabled the builtin mock, use their custom model behavior
      if (!mockBehavior.useBuiltinMock) {
        return actualAi.streamText(options);
      }

      // Throw error if set
      if (mockBehavior.error) {
        throw new Error(mockBehavior.error);
      }

      const tools = options.tools;
      const responses = [...mockBehavior.responses];

      // Get current response index and advance for next call
      const responseIndex = mockBehavior.callCount;
      mockBehavior.callCount++;

      // Get current response (or last one if we've exceeded the array)
      const currentResponse = responses[responseIndex] || responses[responses.length - 1];

      // Create async generator that yields AI SDK stream chunks
      async function* generateStream() {
        let idx = responseIndex;

        // If we've exceeded the responses array, use the last response
        if (idx >= responses.length) {
          idx = responses.length - 1;
        }

        while (idx < responses.length) {
          const response = responses[idx];
          idx++;

          // Emit text if present
          if (response.text) {
            yield { type: 'text-delta', text: response.text };
          }

          // Process tool calls if present
          if (response.toolCalls && response.toolCalls.length > 0) {
            for (const tc of response.toolCalls) {
              // Tool input start (AI SDK uses 'id' for toolCallId)
              yield {
                type: 'tool-input-start',
                id: tc.toolCallId,
                toolName: tc.toolName,
              };

              // Tool call complete (AI SDK uses 'input' for args)
              yield {
                type: 'tool-call',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
              };

              // Execute tool if available
              const toolExecutor = tools?.[tc.toolName]?.execute;
              if (toolExecutor) {
                try {
                  const result = await toolExecutor(tc.input, {
                    toolCallId: tc.toolCallId,
                  });
                  yield {
                    type: 'tool-result',
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    output: result,
                  };
                } catch (error) {
                  yield {
                    type: 'error',
                    error,
                  };
                }
              }
            }
          }

          // If this response has text and no tool calls, we're done
          if (response.text && (!response.toolCalls || response.toolCalls.length === 0)) {
            break;
          }
        }

        // Emit finish chunk
        yield {
          type: 'finish',
          finishReason: 'stop',
          usage: {
            promptTokens: 10,
            completionTokens: 5,
          },
        };
      }

      // Get text from the current response for the text property
      const responseText = currentResponse?.text || '';

      return {
        fullStream: generateStream(),
        text: Promise.resolve(responseText),
        response: Promise.resolve({ messages: [] }),
      };
    },
  };
});

// Export functions to control mock behavior
export function setMockResponses(responses: MockResponse[]) {
  mockBehavior.responses = responses;
  mockBehavior.callCount = 0;
  mockBehavior.error = undefined;
  mockBehavior.useBuiltinMock = true;
}

export function setMockError(errorMessage: string) {
  mockBehavior.error = errorMessage;
  mockBehavior.useBuiltinMock = true;
}

export function disableBuiltinMock() {
  mockBehavior.useBuiltinMock = false;
}

export function resetMock() {
  mockBehavior.responses = [{ text: 'Default response' }];
  mockBehavior.callCount = 0;
  mockBehavior.error = undefined;
  mockBehavior.useBuiltinMock = false;
}

// ============================================================================
// Logging Setup
// ============================================================================

const logDir = join(import.meta.dir, '..', '.test-logs');
const logFile = join(logDir, 'latest.log');

// Ensure log directory exists and clear previous log
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}
writeFileSync(logFile, `Test run started at ${new Date().toISOString()}\n\n`);

// Print log file location at start (so user knows where to look)
process.stderr.write(`📋 Logs: ${logFile}\n`);

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// Intercept console methods to write to file
const captureToFile =
  (level: string) =>
  (...args: unknown[]) => {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' ');
    appendFileSync(logFile, `[${level}] ${message}\n`);
    // Don't call original - keep console quiet
  };

console.log = captureToFile('LOG');
console.info = captureToFile('INFO');
console.warn = captureToFile('WARN');
console.error = captureToFile('ERROR');

// Export for tests to access
export { logFile, originalConsole };

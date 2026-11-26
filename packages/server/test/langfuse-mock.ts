import { mock, type Mock } from 'bun:test';
import type { LangfuseClient } from '@langfuse/client';

export interface MockLangfuseFns {
  score?: Mock<(...args: unknown[]) => void>;
  flush?: Mock<() => Promise<void>>;
}

/**
 * Creates a Langfuse client stub that has only `score.create` and `flush`.
 * Pass shared mocks to check calls across more than one client.
 */
export function createMockLangfuseClient({
  score = mock(() => {}),
  flush = mock(() => Promise.resolve()),
}: MockLangfuseFns = {}): LangfuseClient {
  return {
    score: { create: score },
    flush,
  } as unknown as LangfuseClient;
}

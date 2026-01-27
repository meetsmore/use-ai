/**
 * Langfuse Integration Tests
 *
 * Tests for Langfuse observability configuration and initialization.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { initializeLangfuse } from './instrumentation';

describe('Langfuse Integration', () => {
  // Store original env vars
  let originalPublicKey: string | undefined;
  let originalSecretKey: string | undefined;
  let originalBaseUrl: string | undefined;

  beforeEach(() => {
    // Save original env vars
    originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
    originalSecretKey = process.env.LANGFUSE_SECRET_KEY;
    originalBaseUrl = process.env.LANGFUSE_BASE_URL;

    // Clear env vars for clean test state
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  afterEach(() => {
    // Restore original environment variables
    if (originalPublicKey !== undefined) {
      process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
    } else {
      delete process.env.LANGFUSE_PUBLIC_KEY;
    }
    if (originalSecretKey !== undefined) {
      process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
    } else {
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.LANGFUSE_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.LANGFUSE_BASE_URL;
    }
  });

  test('should not enable Langfuse when env vars are not set', () => {
    const config = initializeLangfuse();

    expect(config.enabled).toBe(false);
    expect(config.client).toBeUndefined();
    expect(config.flush).toBeUndefined();
  });

  test('should not enable Langfuse when only public key is set', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';

    const config = initializeLangfuse();

    expect(config.enabled).toBe(false);
  });

  test('should not enable Langfuse when only secret key is set', () => {
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';

    const config = initializeLangfuse();

    expect(config.enabled).toBe(false);
  });

  test('should enable Langfuse when both keys are set', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';

    const config = initializeLangfuse();

    expect(config.enabled).toBe(true);
    expect(config.client).toBeDefined();
    expect(config.flush).toBeInstanceOf(Function);
  });

  test('should use custom base URL when LANGFUSE_BASE_URL is set', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
    process.env.LANGFUSE_BASE_URL = 'https://custom.langfuse.com';

    const config = initializeLangfuse();

    expect(config.enabled).toBe(true);
    expect(config.client).toBeDefined();
  });
});

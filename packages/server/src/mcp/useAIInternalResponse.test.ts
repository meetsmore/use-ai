import { describe, expect, test } from 'bun:test';
import { isUseAIInternalResponse } from './useAIInternalResponse';

describe('isUseAIInternalResponse', () => {
  test('returns true for valid internal response', () => {
    expect(isUseAIInternalResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 'hello' },
    })).toBe(true);
  });

  test('returns true for unknown _use_ai_type (base does not restrict type)', () => {
    expect(isUseAIInternalResponse({
      _use_ai_internal: true,
      _use_ai_type: 'future_feature',
      _use_ai_metadata: { foo: 'bar' },
    })).toBe(true);
  });

  test('returns false for null / undefined / primitives', () => {
    expect(isUseAIInternalResponse(null)).toBe(false);
    expect(isUseAIInternalResponse(undefined)).toBe(false);
    expect(isUseAIInternalResponse('string')).toBe(false);
    expect(isUseAIInternalResponse(42)).toBe(false);
  });

  test('returns false when _use_ai_internal is not true', () => {
    expect(isUseAIInternalResponse({
      _use_ai_internal: false,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 'msg' },
    })).toBe(false);
  });

  test('returns false when _use_ai_type is missing or non-string', () => {
    expect(isUseAIInternalResponse({
      _use_ai_internal: true,
      _use_ai_metadata: { message: 'msg' },
    })).toBe(false);
    expect(isUseAIInternalResponse({
      _use_ai_internal: true,
      _use_ai_type: 123,
      _use_ai_metadata: { message: 'msg' },
    })).toBe(false);
  });

  test('returns false when _use_ai_metadata is missing or non-object', () => {
    expect(isUseAIInternalResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
    })).toBe(false);
    expect(isUseAIInternalResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: 'not-an-object',
    })).toBe(false);
  });

  test('returns false for normal tool results', () => {
    expect(isUseAIInternalResponse({ success: true, data: 'ok' })).toBe(false);
  });

  test('rejects old schema (confirmation_required + execute_on_approval)', () => {
    expect(isUseAIInternalResponse({
      confirmation_required: true,
      message: 'Are you sure?',
      execute_on_approval: { tool: 'confirm', args: {} },
    })).toBe(false);
  });
});

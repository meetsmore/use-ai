import { describe, it, expect } from 'bun:test';
import { jsonValuesEqual } from './jsonValuesEqual';

describe('jsonValuesEqual', () => {
  it('treats objects with the same keys in a different order as equal', () => {
    expect(jsonValuesEqual({ a: 1, b: { c: [1, 'x'] } }, { b: { c: [1, 'x'] }, a: 1 })).toBe(true);
  });

  it('detects a changed nested value', () => {
    expect(jsonValuesEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('detects an extra or a missing key', () => {
    expect(jsonValuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonValuesEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
  });

  it('compares arrays by order and length', () => {
    expect(jsonValuesEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonValuesEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('does not treat an array and an object with index keys as equal', () => {
    expect(jsonValuesEqual(['a'], { 0: 'a' })).toBe(false);
  });

  it('distinguishes null, a number and a string', () => {
    expect(jsonValuesEqual(null, {})).toBe(false);
    expect(jsonValuesEqual(1, '1')).toBe(false);
    expect(jsonValuesEqual(null, null)).toBe(true);
  });
});

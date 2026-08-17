import { describe, test, expect, beforeEach } from 'bun:test';
import { snapshotSelection, restoreSelection } from './textSelection';

function build(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function select(container: HTMLElement, start: number, end: number): void {
  const range = document.createRange();
  const walker = document.createTreeWalker(container, window.NodeFilter.SHOW_TEXT);
  let consumed = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (start >= consumed && start <= consumed + node.data.length) {
      range.setStart(node, start - consumed);
    }
    if (end >= consumed && end <= consumed + node.data.length) {
      range.setEnd(node, end - consumed);
    }
    consumed += node.data.length;
  }
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('textSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  test('snapshots a selection as offsets into the container text', () => {
    const container = build('<p>Hello world</p>');
    select(container, 6, 11);

    expect(snapshotSelection(container)).toEqual({ start: 6, end: 11, text: 'world' });
  });

  test('snapshots a selection spanning multiple blocks and inline elements', () => {
    const container = build('<p>first <strong>bold</strong> tail</p><p>second</p>');
    // "st bold tail" -> offsets over the concatenated text "first bold tailsecond"
    select(container, 3, 15);

    expect(snapshotSelection(container)).toEqual({ start: 3, end: 15, text: 'st bold tail' });
  });

  test('returns null when nothing is selected', () => {
    const container = build('<p>Hello world</p>');

    expect(snapshotSelection(container)).toBeNull();
  });

  test('returns null when the selection reaches outside the container', () => {
    const container = build('<p>inside</p>');
    const outside = build('<p>outside</p>');

    const range = document.createRange();
    range.setStart(container.querySelector('p')!.firstChild!, 0);
    range.setEnd(outside.querySelector('p')!.firstChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(snapshotSelection(container)).toBeNull();
  });

  test('restores the same range onto an equivalent container', () => {
    const streaming = build('<p>first <strong>bold</strong> tail</p><p>second</p>');
    select(streaming, 3, 15);
    const snapshot = snapshotSelection(streaming)!;

    streaming.remove();
    window.getSelection()!.removeAllRanges();

    const persisted = build('<p>first <strong>bold</strong> tail</p><p>second</p>');
    expect(restoreSelection(persisted, snapshot)).toBe(true);
    expect(window.getSelection()!.toString()).toBe('st bold tail');
  });

  test('restores across a different but text-equivalent DOM shape', () => {
    const persisted = build('<p>first bold tail</p><p>second</p>');

    expect(restoreSelection(persisted, { start: 3, end: 15, text: 'st bold tail' })).toBe(true);
    expect(window.getSelection()!.toString()).toBe('st bold tail');
  });

  test('leaves the selection alone when the text no longer matches', () => {
    const elsewhere = build('<p>somewhere else entirely</p>');
    select(elsewhere, 0, 9);
    const persisted = build('<p>completely different content</p>');

    expect(restoreSelection(persisted, { start: 3, end: 15, text: 'st bold tail' })).toBe(false);
    expect(window.getSelection()!.toString()).toBe('somewhere');
    expect(elsewhere.contains(window.getSelection()!.anchorNode)).toBe(true);
  });

  test('leaves the selection alone when the container is too short', () => {
    const elsewhere = build('<p>somewhere else entirely</p>');
    select(elsewhere, 0, 9);
    const persisted = build('<p>short</p>');

    expect(restoreSelection(persisted, { start: 3, end: 15, text: 'st bold tail' })).toBe(false);
    expect(window.getSelection()!.toString()).toBe('somewhere');
    expect(elsewhere.contains(window.getSelection()!.anchorNode)).toBe(true);
  });
});

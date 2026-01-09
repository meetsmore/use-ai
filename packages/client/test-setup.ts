import { expect, afterEach } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { mkdirSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// === Log capture setup ===
const logDir = join(import.meta.dir, '.test-logs');
const logFile = join(logDir, 'latest.log');

if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}
writeFileSync(logFile, `Test run started at ${new Date().toISOString()}\n\n`);
process.stderr.write(`📋 Logs: ${logFile}\n`);

const captureToFile =
  (level: string) =>
  (...args: unknown[]) => {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' ');
    appendFileSync(logFile, `[${level}] ${message}\n`);
  };

console.log = captureToFile('LOG');
console.info = captureToFile('INFO');
console.warn = captureToFile('WARN');
console.error = captureToFile('ERROR');
// === End log capture setup ===

// Set up jsdom global environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});

(global as any).window = dom.window as unknown as Window & typeof globalThis;
(global as any).document = dom.window.document;
(global as any).navigator = dom.window.navigator;
(global as any).HTMLElement = dom.window.HTMLElement;
(global as any).customElements = dom.window.customElements;
(global as any).Node = dom.window.Node;
(global as any).Element = dom.window.Element;
(global as any).localStorage = dom.window.localStorage;

// Mock scrollIntoView which is not implemented in jsdom
(dom.window.Element.prototype as any).scrollIntoView = () => {};

// Extend Bun's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Set up React act environment
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

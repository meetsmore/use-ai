import { mkdirSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const logDir = join(import.meta.dir, '..', '.test-logs');
const logFile = join(logDir, 'latest.log');

// Ensure log directory exists and clear previous log
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}
writeFileSync(logFile, `Test run started at ${new Date().toISOString()}\n\n`);

// Print log file location at start (so user knows where to look)
process.stderr.write(`📋 Logs: ${logFile}\n`);

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

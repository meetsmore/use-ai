import React, { ReactNode, useState, useEffect } from 'react';
import { useAI, defineTool } from '@meetsmore/use-ai-client';
import { z } from 'zod';

// Simple in-memory log store
let logs: string[] = [];
const logListeners = new Set<(logs: string[]) => void>();

function notifyLogListeners() {
  logListeners.forEach(listener => listener([...logs]));
}

export function subscribeToLogs(callback: (logs: string[]) => void) {
  logListeners.add(callback);
  callback([...logs]);
  return () => {
    logListeners.delete(callback);
  };
}

export function clearLogs() {
  logs = [];
  notifyLogListeners();
}

const invisibleTools = {
  logMessage: defineTool(
    'Log a message to the system log',
    z.object({
      message: z.string().describe('The message to log'),
    }),
    (input) => {
      logs.push(input.message);
      notifyLogListeners();
      return { success: true, message: `Logged: "${input.message}"` };
    }
  ),

  getLogCount: defineTool(
    'Get the current number of logged messages',
    z.object({}),
    () => {
      return { success: true, count: logs.length };
    }
  ),
};

/**
 * Example of an invisible provider component.
 * This component has no visual state - it just provides tools to the AI.
 * Tools execute immediately without waiting for React re-renders.
 */
export function InvisibleAIProvider({ children }: { children: ReactNode }) {
  // Use invisible: true since this component has no visual state
  useAI({
    tools: invisibleTools,
    invisible: true,
  });

  return <>{children}</>;
}

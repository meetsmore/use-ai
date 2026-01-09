import { useState } from 'react';
import { defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';

export interface Calculation {
  expression: string;
  result: number;
  timestamp: number;
}

function evaluateExpression(expression: string): number {
  const cleaned = expression.replace(/\s+/g, '');

  const validChars = /^[0-9+\-*/().]+$/;
  if (!validChars.test(cleaned)) {
    throw new Error('Invalid characters in expression');
  }

  const parenBalance = (cleaned.match(/\(/g) || []).length - (cleaned.match(/\)/g) || []).length;
  if (parenBalance !== 0) {
    throw new Error('Unbalanced parentheses');
  }

  const result = Function('"use strict"; return (' + cleaned + ')')();

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Invalid calculation result');
  }

  return result;
}

export function useCalculatorLogic() {
  const [result, setResult] = useState<number | null>(null);
  const [history, setHistory] = useState<Calculation[]>([]);

  const calculateFn = (expression: string) => {
    try {
      const calculatedResult = evaluateExpression(expression);

      setResult(calculatedResult);
      setHistory(prev => {
        const newHistory = [...prev, {
          expression,
          result: calculatedResult,
          timestamp: Date.now(),
        }];

        return newHistory.length > 10 ? newHistory.slice(-10) : newHistory;
      });

      return {
        success: true,
        expression,
        result: calculatedResult,
        message: `${expression} = ${calculatedResult}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: `Failed to calculate: ${expression}`,
      };
    }
  };

  const clearCalculatorFn = () => {
    setResult(null);
    setHistory([]);

    return {
      success: true,
      message: 'Calculator cleared',
    };
  };

  const tools = {
    calculate: defineTool(
      'Perform a mathematical calculation and display the result in the calculator',
      z.object({
        expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2", "10 * 5 - 3", "(8 + 2) / 2")'),
      }),
      (input) => calculateFn(input.expression)
    ),

    clearCalculator: defineTool(
      'Clear the calculator display and history',
      z.object({}),
      () => clearCalculatorFn()
    ),
  };

  return {
    result,
    history,
    tools,
    calculate: calculateFn,
    clearCalculator: clearCalculatorFn,
  };
}

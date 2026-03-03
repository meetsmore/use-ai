import React from 'react';
import Calculator from '../Calculator';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function CalculatorPage() {
  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Calculator</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Demonstrates how tool return values are sent back to the AI. The calculator tools
          return computation results, which Claude uses to formulate a natural-language response.
        </p>
        <p style={docStyles.text}>
          The AI sees the current calculator state (result and history) through the{' '}
          <code style={docStyles.code}>prompt</code> prop and can perform calculations using
          the <code style={docStyles.code}>calculate</code> and <code style={docStyles.code}>clear</code> tools.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`const calculate = defineTool(
  'Evaluate a mathematical expression',
  z.object({
    expression: z.string().describe('e.g. "2 + 3 * 4"'),
  }),
  (input) => {
    const result = evaluateExpression(input.expression);
    // This return value is sent back to Claude as the tool result
    return { success: true, expression: input.expression, result };
  }
);

useAI({
  tools: { calculate, clear },
  prompt: \`Calculator — Current result: \${result}
History: \${history.map(h => \`\${h.expression} = \${h.result}\`).join(', ')}\`,
  suggestions: ["What's 17 x 410?"],
});`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Open the chat and try: "What is 17 times 410?"
        </p>
        <Calculator />
      </div>
    </div>
  );
}

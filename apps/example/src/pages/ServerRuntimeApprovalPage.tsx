import React from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function ServerRuntimeApprovalPage() {
  useAI({
    tools: {},
    prompt: `Server Runtime Approval Demo Page.

This page demonstrates server-side tools that use ctx.requestApproval() for runtime interactive approval.
The following server tool is available:
- serverTransfer: Transfer money. Transfers over $1,000 require user approval via ctx.requestApproval().

Help the user test the server-side runtime approval flow. The tool runs server-side — there is no client-side state to track.`,
    suggestions: [
      'Transfer $500 to Alice (server)',
      'Transfer $2000 to Bob (server)',
    ],
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Server Runtime Approval</h1>

      <div style={docStyles.prerequisiteCard}>
        <h2 style={docStyles.subtitle}>Prerequisites</h2>
        <p style={docStyles.text}>
          Server tools require <code style={docStyles.code}>ENABLE_EXAMPLE_SERVER_TOOLS=true</code> in
          your <code style={docStyles.code}>.env</code> file. Restart the server after changing it.
        </p>
      </div>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          This page tests <code style={docStyles.code}>ctx.requestApproval()</code> on{' '}
          <strong>server-side tools</strong>. Unlike client tools (which resolve approval
          via React state), server tools send a{' '}
          <code style={docStyles.code}>TOOL_APPROVAL_REQUEST</code> event over Socket.IO
          and wait for the client's response via{' '}
          <code style={docStyles.code}>waitForApproval()</code>.
        </p>
        <p style={docStyles.text}>
          The approval dialog looks the same to the user, but the underlying mechanism is different.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Server-Side Code</h2>
        <CollapsibleCode>
{`// In server config (apps/use-ai-server-app/src/index.ts)
serverTransfer: defineServerTool(
  'Transfer money between accounts',
  z.object({
    to: z.string(),
    amount: z.number(),
  }),
  async ({ to, amount }, ctx) => {
    if (amount > 1000) {
      const { approved, reason } = await ctx.requestApproval({
        message: \`Transfer $\${amount} to "\${to}"?\`,
        metadata: { amount, to, source: 'server' },
      });
      if (!approved) {
        return { error: 'User rejected', reason };
      }
    }
    return { success: true, message: \`Transferred $\${amount} to \${to}\` };
  }
)`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.comparisonCard}>
        <h2 style={docStyles.subtitle}>Client vs Server Approval Flow</h2>
        <table style={docStyles.table}>
          <thead>
            <tr>
              <th style={docStyles.th}></th>
              <th style={docStyles.th}>Client Tool</th>
              <th style={docStyles.th}>Server Tool</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}><strong>Execution</strong></td>
              <td style={docStyles.td}>Browser (React)</td>
              <td style={docStyles.td}>Server (Node/Bun)</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><strong>Approval trigger</strong></td>
              <td style={docStyles.tdAlt}>setPendingApprovals (React state)</td>
              <td style={docStyles.tdAlt}>events.emit(TOOL_APPROVAL_REQUEST)</td>
            </tr>
            <tr>
              <td style={docStyles.td}><strong>Wait mechanism</strong></td>
              <td style={docStyles.td}>Promise + runtimeApprovalResolversRef</td>
              <td style={docStyles.td}>waitForApproval(session, approvalId)</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><strong>UI</strong></td>
              <td style={docStyles.tdAlt}>Same ToolApprovalDialog</td>
              <td style={docStyles.tdAlt}>Same ToolApprovalDialog</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Transfer $500 to Alice" (no approval) vs "Transfer $2000 to Bob" (approval required).
          The tool executes on the server — there is no client-side balance to display.
        </p>
      </div>
    </div>
  );
}

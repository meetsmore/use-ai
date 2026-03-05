import React from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

const PYTHON_EXAMPLE = [
  '# Phase 1: check tool — returns confirmation response',
  '@server.tool("transfer")',
  'async def transfer(to: str, amount: float):',
  '    if amount > 1000:',
  '        return {',
  '            "confirmation_required": True,',
  '            "message": f"Transfer ${amount} to {to}. Are you sure?",',
  '            "metadata": {"amount": amount, "to": to},',
  '            "execute_on_approval": {',
  '                "tool": "confirm_transfer",',
  '                "args": {"to": to, "amount": amount, "confirmed": True}',
  '            }',
  '        }',
  '    # Small amounts proceed directly',
  '    return do_transfer(to, amount)',
  '',
  '# Phase 2: execution tool — called by server after approval',
  '@server.tool("confirm_transfer")',
  'async def confirm_transfer(to: str, amount: float, confirmed: bool):',
  '    return do_transfer(to, amount)',
].join('\n');

export default function McpRuntimeApprovalPage() {
  useAI({
    tools: {},
    prompt: `MCP Runtime Approval Demo Page.

This page demonstrates MCP tools that use the two-phase confirmation pattern.
The following remote MCP tools (prefixed with "mcp_") are available:
- mcp_transfer: [MCP] Transfer money via the remote MCP endpoint. Transfers over $1,000 return a confirmation_required response which triggers the approval dialog.
- mcp_confirm_transfer: [MCP] Phase-2 execution tool, called automatically by the server after user approval. Do NOT call this tool directly.

IMPORTANT: Always use the mcp_transfer tool (the MCP tool), NOT the serverTransfer tool (which is a different server-side tool).

Help the user test the MCP confirmation flow:
- Small transfers (e.g. $500) should proceed directly without approval.
- Large transfers (e.g. $2000) should show an approval dialog first.`,
    suggestions: [
      'Transfer $500 to Alice',
      'Transfer $5000 to Bob',
    ],
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>MCP Runtime Approval</h1>

      <div style={docStyles.prerequisiteCard}>
        <h2 style={docStyles.subtitle}>Prerequisites</h2>
        <p style={docStyles.text}>
          The MCP server must be running on <code style={docStyles.code}>localhost:3002</code> with
          the <code style={docStyles.code}>transfer</code> and <code style={docStyles.code}>confirm_transfer</code> tools
          registered.
        </p>
      </div>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          MCP tools run on remote servers and cannot call{' '}
          <code style={docStyles.code}>ctx.requestApproval()</code> directly.
          Instead, they use a <strong>two-phase confirmation pattern</strong>:
          the tool returns a special JSON response with{' '}
          <code style={docStyles.code}>confirmation_required: true</code>,
          the server intercepts it, shows the approval dialog, and if approved,
          calls the execution tool on the same MCP endpoint.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Confirmation Response Schema</h2>
        <CollapsibleCode defaultOpen>
{`{
  "confirmation_required": true,
  "message": "Transfer $5000 to Bob. Are you sure?",
  "metadata": { "amount": 5000, "to": "Bob" },
  "execute_on_approval": {
    "tool": "confirm_transfer",
    "args": { "to": "Bob", "amount": 5000, "confirmed": true }
  }
}`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>MCP Endpoint Code</h2>
        <CollapsibleCode>{PYTHON_EXAMPLE}</CollapsibleCode>
      </div>

      <div style={docStyles.comparisonCard}>
        <h2 style={docStyles.subtitle}>Approval Flow Comparison</h2>
        <table style={docStyles.table}>
          <thead>
            <tr>
              <th style={docStyles.th}></th>
              <th style={docStyles.th}>Client Tool</th>
              <th style={docStyles.th}>Server Tool</th>
              <th style={docStyles.th}>MCP Tool</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}><strong>Execution</strong></td>
              <td style={docStyles.td}>Browser</td>
              <td style={docStyles.td}>Server</td>
              <td style={docStyles.td}>Remote MCP endpoint</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><strong>Approval trigger</strong></td>
              <td style={docStyles.tdAlt}>setPendingApprovals</td>
              <td style={docStyles.tdAlt}>ctx.requestApproval()</td>
              <td style={docStyles.tdAlt}>confirmation_required response</td>
            </tr>
            <tr>
              <td style={docStyles.td}><strong>Wait mechanism</strong></td>
              <td style={docStyles.td}>React state + ref</td>
              <td style={docStyles.td}>waitForApproval()</td>
              <td style={docStyles.td}>waitForApproval()</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><strong>UI</strong></td>
              <td style={docStyles.tdAlt}>Same dialog</td>
              <td style={docStyles.tdAlt}>Same dialog</td>
              <td style={docStyles.tdAlt}>Same dialog</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Transfer $500 to Alice" (no approval) vs "Transfer $5000 to Bob" (approval required).
        </p>
      </div>
    </div>
  );
}

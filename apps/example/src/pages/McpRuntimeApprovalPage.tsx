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

const SEQUENCE_DIAGRAM = [
  'Client          Server              MCP Endpoint',
  '  |                 |                      |',
  '  | run_agent       |                      |',
  '  |---------------->|  tools/call (ph.1)   |',
  '  |                 |--------------------->|',
  '  |                 |  { confirmation_     |',
  '  |                 |    required: true }  |',
  '  |                 |<---------------------|',
  '  | TOOL_APPROVAL   |                      |',
  '  |   _REQUEST      |                      |',
  '  |<----------------|                      |',
  '  | (user approves) |                      |',
  '  |---------------->|  tools/call (ph.2)   |',
  '  |                 |--------------------->|',
  '  |                 |  { success: true }   |',
  '  |                 |<---------------------|',
  '  |  final result   |                      |',
  '  |<----------------|                      |',
].join('\n');

export default function McpRuntimeApprovalPage() {
  useAI({
    tools: {},
    prompt: `MCP Runtime Approval Demo Page.

This page explains how MCP tools can request runtime user confirmation using the two-phase confirmation pattern.
There is no live MCP endpoint connected — this is a documentation page.

Help the user understand the MCP confirmation flow.`,
    suggestions: [
      'How does MCP runtime approval work?',
      'What is the two-phase confirmation pattern?',
    ],
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>MCP Runtime Approval</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          MCP tools run on remote servers and cannot call{' '}
          <code style={docStyles.code}>ctx.requestApproval()</code> directly.
          Instead, they use a <strong>two-phase confirmation pattern</strong>:
          the tool returns a special JSON response, the server intercepts it,
          shows the approval dialog, and if approved, calls the execution tool
          on the same MCP endpoint.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Phase 1: Confirmation Response</h2>
        <p style={docStyles.text}>
          The MCP tool returns this JSON structure instead of a normal result:
        </p>
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
        <h2 style={docStyles.subtitle}>Phase 2: Execution</h2>
        <p style={docStyles.text}>
          The server detects <code style={docStyles.code}>confirmation_required: true</code>,
          emits a <code style={docStyles.code}>TOOL_APPROVAL_REQUEST</code> event to the client,
          and waits for user approval. If approved, it calls{' '}
          <code style={docStyles.code}>execute_on_approval.tool</code> with the specified args
          on the same MCP endpoint.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>MCP Endpoint Example (Python)</h2>
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
        <h2 style={docStyles.subtitle}>Sequence</h2>
        <pre style={{ ...docStyles.text, fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre', overflowX: 'auto' }}>
          {SEQUENCE_DIAGRAM}
        </pre>
      </div>
    </div>
  );
}

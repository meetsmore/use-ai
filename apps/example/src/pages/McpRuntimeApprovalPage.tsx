import React from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

const TOKEN_EXAMPLE = [
  '# Single tool with token-based approval',
  '@server.tool("transfer")',
  'async def transfer(to: str, amount: float, token: str | None):',
  '    # Phase 2: token provided — validate and execute',
  '    if token is not None:',
  '        stored = pending_tokens.pop(token, None)',
  '        if not stored or stored["to"] != to or stored["amount"] != amount:',
  '            return {"error": True, "message": "Invalid token"}',
  '        return {"success": True, "message": f"Transferred ${amount} to {to}"}',
  '',
  '    # Phase 1: no token — check if approval is needed',
  '    if amount > 1000:',
  '        approval_token = generate_token()',
  '        pending_tokens[approval_token] = {"to": to, "amount": amount}',
  '        return {',
  '            "_use_ai_internal": True,',
  '            "_use_ai_type": "confirmation_required",',
  '            "_use_ai_metadata": {',
  '                "message": f"Transfer ${amount} to {to}. Are you sure?",',
  '                "metadata": {"amount": amount, "to": to},',
  '                "additional_columns": {"token": approval_token}',
  '            }',
  '        }',
  '',
  '    # Small amounts proceed directly',
  '    return {"success": True, "message": f"Transferred ${amount} to {to}"}',
].join('\n');

export default function McpRuntimeApprovalPage() {
  useAI({
    tools: {},
    prompt: `MCP Runtime Approval Demo Page.

This page demonstrates MCP tools that use the two-phase confirmation pattern with token-based security.
The following remote MCP tool (prefixed with "mcp_") is available:
- mcp_transfer: Transfer money via the remote MCP endpoint. Pass token as null on the first call. Transfers over $1,000 require user approval — the server issues a one-time token and re-calls the same tool after approval.

IMPORTANT: Always use the mcp_transfer tool (the MCP tool), NOT the serverTransfer tool.
IMPORTANT: Always pass token as null. Never fabricate or guess a token value.

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
          the <code style={docStyles.code}>transfer</code> tool registered.
        </p>
      </div>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          MCP tools run on remote servers and cannot call{' '}
          <code style={docStyles.code}>ctx.requestApproval()</code> directly.
          Instead, they use a <strong>two-phase confirmation pattern</strong> with
          a single tool and a <code style={docStyles.code}>token</code> parameter:
        </p>
        <ol style={{ ...docStyles.text, paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>First call: <code style={docStyles.code}>token: null</code> — if amount &gt; $1,000, returns <code style={docStyles.code}>_use_ai_type: "confirmation_required"</code> with a server-issued one-time token in <code style={docStyles.code}>additional_columns</code></li>
          <li>Server shows approval dialog to the user</li>
          <li>If approved: server re-calls the same tool with original args merged with <code style={docStyles.code}>additional_columns</code></li>
          <li>Tool validates token (one-time, parameter-bound, expiring) and executes</li>
        </ol>
        <p style={docStyles.text}>
          The AI cannot bypass approval because it never sees a valid token — tokens are
          generated server-side and consumed on use.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Confirmation Response Schema</h2>
        <CollapsibleCode defaultOpen>
{`{
  "_use_ai_internal": true,
  "_use_ai_type": "confirmation_required",
  "_use_ai_metadata": {
    "message": "Transfer $5000 to Bob. Are you sure?",
    "metadata": { "amount": 5000, "to": "Bob" },
    "additional_columns": { "token": "<server-issued UUID>" }
  }
}`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>MCP Endpoint Code</h2>
        <CollapsibleCode>{TOKEN_EXAMPLE}</CollapsibleCode>
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
              <td style={docStyles.tdAlt}>_use_ai_type: "confirmation_required"</td>
            </tr>
            <tr>
              <td style={docStyles.td}><strong>Bypass prevention</strong></td>
              <td style={docStyles.td}>Client-side only</td>
              <td style={docStyles.td}>Server-side ctx</td>
              <td style={docStyles.td}>One-time token in additional_columns</td>
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

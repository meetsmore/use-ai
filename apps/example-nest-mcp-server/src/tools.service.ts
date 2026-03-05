import { Injectable, Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { Request } from 'express';

/**
 * In-memory store for one-time approval tokens.
 * Each token is tied to specific transfer parameters and expires after 5 minutes.
 * Module-scoped so it persists across request-scoped service instances.
 */
const pendingTokens = new Map<string, { to: string; amount: number; expiresAt: number }>();

@Injectable({ scope: Scope.REQUEST })
export class ToolsService {
  constructor(@Inject(REQUEST) private readonly request: Request) {}
  @Tool({
    name: 'add',
    description: 'Add two numbers together',
    parameters: z.object({
      a: z.number().describe('The first number'),
      b: z.number().describe('The second number'),
    }),
    annotations: {
      title: 'Adding Numbers',
      readOnlyHint: true,
    },
  })
  async add({ a, b }: { a: number; b: number }) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result: a + b }),
        },
      ],
    };
  }

  @Tool({
    name: 'multiply',
    description: 'Multiply two numbers together',
    parameters: z.object({
      a: z.number().describe('The first number'),
      b: z.number().describe('The second number'),
    }),
    annotations: {
      title: 'Multiplying Numbers',
      readOnlyHint: true,
    },
  })
  async multiply({ a, b }: { a: number; b: number }) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result: a * b }),
        },
      ],
    };
  }

  @Tool({
    name: 'greet',
    description: 'Greet a person by name',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
    }),
    annotations: {
      title: 'Greeting User',
      readOnlyHint: true,
    },
  })
  async greet({ name }: { name: string }) {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${name}! Welcome to the MCP server.`,
        },
      ],
    };
  }

  @Tool({
    name: 'get_weather',
    description: 'Get the current weather for a location (mock data)',
    parameters: z.object({
      location: z.string().describe('The location to get weather for'),
    }),
    annotations: {
      title: 'Fetching Weather',
      readOnlyHint: true,
      openWorldHint: true,
    },
  })
  async getWeather({ location }: { location: string }) {
    const weatherData = {
      location,
      temperature: 72,
      condition: 'Sunny',
      humidity: 45,
    };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(weatherData),
        },
      ],
    };
  }

  @Tool({
    name: 'transfer',
    description: '[MCP] Transfer money to a recipient via the remote MCP endpoint. Transfers over $1000 require user confirmation. On the first call, pass token as null. If confirmation is needed, the server issues a one-time token and asks for approval. The server will re-call this tool with the issued token after the user approves.',
    parameters: z.object({
      to: z.string().describe('Recipient name'),
      amount: z.number().describe('Amount to transfer'),
      token: z.string().nullable().describe('One-time approval token. Pass null on the first call. The server issues and provides this token automatically after user approval — never fabricate a token.'),
    }),
    annotations: {
      title: 'Transferring Money',
    },
  })
  async transfer({ to, amount, token }: { to: string; amount: number; token: string | null }) {
    // Phase 2: token provided — validate and execute
    if (token != null) {
      const stored = pendingTokens.get(token);
      if (!stored) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'Invalid or expired token' }) }],
          isError: true,
        };
      }
      // Consume the token (one-time use)
      pendingTokens.delete(token);

      if (stored.expiresAt < Date.now()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'Token expired' }) }],
          isError: true,
        };
      }
      if (stored.to !== to || stored.amount !== amount) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'Token does not match transfer parameters' }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Transferred $${amount} to ${to} (confirmed)` }) }],
      };
    }

    // Phase 1: no token — check if approval is needed
    if (amount > 1000) {
      const approvalToken = randomUUID();
      pendingTokens.set(approvalToken, { to, amount, expiresAt: Date.now() + 5 * 60 * 1000 });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              confirmation_required: true,
              message: `Transfer $${amount} to "${to}". Are you sure?`,
              metadata: { amount, to },
              execute_on_approval: {
                tool: 'transfer',
                args: { to, amount, token: approvalToken },
              },
            }),
          },
        ],
      };
    }

    // Small amounts proceed directly
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Transferred $${amount} to ${to}` }) }],
    };
  }

  @Tool({
    name: 'get_secure_data',
    description: 'Get secure data (requires authentication via X-API-Key header)',
    parameters: z.object({
      dataId: z.string().describe('The ID of the data to retrieve'),
    }),
    annotations: {
      title: 'Accessing Secure Data',
      readOnlyHint: true,
    },
  })
  async getSecureData({ dataId }: { dataId: string }) {
    const apiKey = this.request.headers['x-api-key'];
    const expectedKey = 'secret-api-key-123';

    if (!apiKey || apiKey !== expectedKey) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Unauthorized',
              message: 'Valid X-API-Key header is required',
            }),
          },
        ],
        isError: true,
      };
    }

    const secureData = {
      dataId,
      content: `This is secure data for ${dataId}`,
      timestamp: new Date().toISOString(),
      classified: true,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(secureData),
        },
      ],
    };
  }
}

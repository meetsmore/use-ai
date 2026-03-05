import { Injectable, Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import type { Request } from 'express';

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
    description: '[MCP] Transfer money to a recipient via the remote MCP endpoint. Transfers over $1000 require user confirmation via the two-phase approval flow. This is an MCP tool (not a server tool).',
    parameters: z.object({
      to: z.string().describe('Recipient name'),
      amount: z.number().describe('Amount to transfer'),
    }),
    annotations: {
      title: 'Transferring Money',
    },
  })
  async transfer({ to, amount }: { to: string; amount: number }) {
    if (amount > 1000) {
      // Phase 1: Return confirmation_required response
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              confirmation_required: true,
              message: `Transfer $${amount} to "${to}". Are you sure?`,
              metadata: { amount, to },
              execute_on_approval: {
                tool: 'confirm_transfer',
                args: { to, amount, confirmed: true },
              },
            }),
          },
        ],
      };
    }
    // Small amounts proceed directly
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Transferred $${amount} to ${to}`,
          }),
        },
      ],
    };
  }

  @Tool({
    name: 'confirm_transfer',
    description: '[MCP] Execute a confirmed money transfer via the remote MCP endpoint (phase 2 of the two-phase approval flow). This tool is called automatically by the server after user approval — do not call it directly.',
    parameters: z.object({
      to: z.string().describe('Recipient name'),
      amount: z.number().describe('Amount to transfer'),
      confirmed: z.boolean().describe('Must be true'),
    }),
    annotations: {
      title: 'Executing Transfer',
    },
  })
  async confirmTransfer({ to, amount, confirmed }: { to: string; amount: number; confirmed: boolean }) {
    if (!confirmed) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: true, message: 'Transfer not confirmed' }),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Transferred $${amount} to ${to} (confirmed)`,
          }),
        },
      ],
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

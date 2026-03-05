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
    description: '[MCP] Transfer money to a recipient via the remote MCP endpoint.',
    parameters: z.object({
      to: z.string().describe('Recipient name'),
      amount: z.number().describe('Amount to transfer'),
      token: z.string().nullable().describe('This is used for internal authentication. This will be filled automatically, so always set null.'),
    }),
    annotations: {
      title: 'Transferring Money',
    },
  })
  async transfer({ to, amount, token }: { to: string; amount: number; token: string | null }) {
    // This token will not be in the context of AI Agent. So it is OK to set some random fixed token.
    const internal_token_password = "random_fixed_token" 

    if (!token && amount > 1000){
      // needs user confirmation
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              _use_ai_internal: true,
              _use_ai_type: 'confirmation_required',
              _use_ai_metadata: {
                message: `Transfer $${amount} to "${to}". Are you sure?`,
                metadata: { amount, to },
                additional_columns: { token: internal_token_password },
              },
            }),
          },
        ],
      };
    }

    // token is set but invalid
    if (token && token !=internal_token_password) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'Invalid token' }) }],
        isError: true,
      };
    }

    // handle the request here
    // await executeTransfer(...)
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Transferred $${amount} to ${to} (confirmed)` }) }],
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

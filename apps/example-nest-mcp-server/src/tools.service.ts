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
    name: 'get_secure_data',
    description: 'Get secure data (requires authentication via X-API-Key header)',
    parameters: z.object({
      dataId: z.string().describe('The ID of the data to retrieve'),
    }),
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

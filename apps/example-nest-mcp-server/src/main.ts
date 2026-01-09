#!/usr/bin/env bun
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Enable CORS for development
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  const port = Number(process.env.MCP_PORT) || 3002;
  await app.listen(port);

  console.log(`MCP server is running on http://localhost:${port}`);
  console.log(`MCP JSON-RPC endpoint: http://localhost:${port}/mcp`);
  console.log(`SSE endpoint: http://localhost:${port}/sse`);
}

bootstrap();

import { describe, expect, test, afterAll } from 'bun:test';
import type { UseAIServerPlugin, BeforeRunAgentResult } from './plugins/types';
import type { ClientSession, AgentInput } from './agents/types';
import { EventType } from './types';
import { UseAIServer } from './server';
import {
  createTestAgent,
  TestCleanupManager,
} from '../test/integration-test-utils';
import {
  sendRunAgent,
  waitForEventType,
  collectEventsUntil,
  extractTextFromEvents,
} from '../test/test-utils';

// Track all servers and sockets for cleanup
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Plugin Architecture', () => {
  let server: UseAIServer;
  const testPort = 9009;

  test('Server supports plugins that extend functionality', () => {
    class TestPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'test-plugin';
      }

      registerHandlers(server: any): void {
        // Plugin can register handlers
      }
    }

    const plugin = new TestPlugin();
    server = new UseAIServer({
      port: testPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [plugin],
    });
    cleanup.trackServer(server);

    expect(server).toBeDefined();
  });

  test('Plugins can register custom message handlers', async () => {
    const customPort = 9010;
    let customMessageReceived = false;

    class CustomMessagePlugin implements UseAIServerPlugin {
      getName(): string {
        return 'custom-message';
      }

      registerHandlers(server: any): void {
        server.registerMessageHandler('custom_message', async (session: ClientSession, message: any) => {
          customMessageReceived = true;
        });
      }
    }

    const plugin = new CustomMessagePlugin();
    const pluginServer = new UseAIServer({
      port: customPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [plugin],
    });
    cleanup.trackServer(pluginServer);

    const socket = await cleanup.createTestClient(customPort);

    // Send custom message
    socket.emit('message', { type: 'custom_message', data: {} });

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(customMessageReceived).toBe(true);

    socket.disconnect();
    pluginServer.close();
  });

  test('Plugins receive lifecycle hooks on connect/disconnect', async () => {
    const lifecyclePort = 9011;
    let connectCalled = false;
    let disconnectCalled = false;

    class LifecyclePlugin implements UseAIServerPlugin {
      getName(): string {
        return 'lifecycle';
      }

      registerHandlers(server: any): void {}

      onClientConnect(session: ClientSession): void {
        connectCalled = true;
      }

      onClientDisconnect(session: ClientSession): void {
        disconnectCalled = true;
      }
    }

    const plugin = new LifecyclePlugin();
    const lifecycleServer = new UseAIServer({
      port: lifecyclePort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [plugin],
    });
    cleanup.trackServer(lifecycleServer);

    const socket = await cleanup.createTestClient(lifecyclePort);

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(connectCalled).toBe(true);

    socket.disconnect();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(disconnectCalled).toBe(true);

    lifecycleServer.close();
  });

  test('Plugins have access to client session', async () => {
    const sessionPort = 9012;
    let receivedSession: ClientSession | null = null;

    class SessionPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'session';
      }

      registerHandlers(server: any): void {
        server.registerMessageHandler('get_session', async (session: ClientSession, message: any) => {
          receivedSession = session;
        });
      }
    }

    const plugin = new SessionPlugin();
    const sessionServer = new UseAIServer({
      port: sessionPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [plugin],
    });
    cleanup.trackServer(sessionServer);

    const socket = await cleanup.createTestClient(sessionPort);

    socket.emit('message', { type: 'get_session', data: {} });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(receivedSession).not.toBeNull();
    expect(receivedSession!.clientId).toBeDefined();
    expect(receivedSession!.threadId).toBeDefined();

    socket.disconnect();
    sessionServer.close();
  });

  test('clientId is unique across server instances (pods and restarts)', async () => {
    // Two server instances stand for two pods, or one pod before and after a restart.
    // A per-process counter gives "client-1" on both, which merges tenants in Langfuse and Dify.
    const ports = [9018, 9019];
    const clientIds: string[] = [];

    class CapturePlugin implements UseAIServerPlugin {
      getName(): string {
        return 'capture-client-id';
      }

      registerHandlers(): void {}

      onClientConnect(session: ClientSession): void {
        clientIds.push(session.clientId);
      }
    }

    for (const port of ports) {
      const instance = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [new CapturePlugin()],
      });
      cleanup.trackServer(instance);

      const socket = await cleanup.createTestClient(port);
      await new Promise(resolve => setTimeout(resolve, 100));
      socket.disconnect();
      instance.close();
    }

    expect(clientIds).toHaveLength(2);
    expect(clientIds[0]).not.toBe(clientIds[1]);
    for (const clientId of clientIds) {
      expect(clientId).toMatch(/^client-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  test('beforeRunAgent hook is called before agent execution', async () => {
    const hookPort = 9013;
    let hookCalledWith: AgentInput | null = null;

    class BeforeRunPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'before-run-test';
      }
      registerHandlers(): void {}
      async beforeRunAgent(input: AgentInput): Promise<void> {
        hookCalledWith = input;
      }
    }

    const plugin = new BeforeRunPlugin();
    const hookServer = new UseAIServer({
      port: hookPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [plugin],
    });
    cleanup.trackServer(hookServer);

    const socket = await cleanup.createTestClient(hookPort);

    const mcpHeaders = { 'http://mcp.test/*': { headers: { Authorization: 'Bearer user-token' } } };
    const eventsPromise = collectEventsUntil(socket, EventType.RUN_FINISHED);
    sendRunAgent(socket, { prompt: 'Hello', forwardedProps: { mcpHeaders } });
    await eventsPromise;

    expect(hookCalledWith).not.toBeNull();
    expect(hookCalledWith!.session).toBeDefined();
    expect(hookCalledWith!.runId).toBeDefined();
    expect(hookCalledWith!.messages).toBeDefined();
    // MCP headers belong to the run, not the shared session
    expect(hookCalledWith!.mcpHeaders).toEqual(mcpHeaders);

    socket.disconnect();
    hookServer.close();
  });

  test('beforeRunAgent hook can abort a run', async () => {
    const blockPort = 9014;

    class BlockingPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'blocking-plugin';
      }
      registerHandlers(): void {}
      async beforeRunAgent(_input: AgentInput): Promise<BeforeRunAgentResult | void> {
        return { abort: true, message: 'Quota exceeded' };
      }
    }

    const plugin = new BlockingPlugin();
    const blockServer = new UseAIServer({
      port: blockPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [plugin],
    });
    cleanup.trackServer(blockServer);

    const socket = await cleanup.createTestClient(blockPort);

    const errorPromise = waitForEventType(socket, EventType.RUN_ERROR);
    sendRunAgent(socket, { prompt: 'Hello' });
    const errorEvent = await errorPromise;

    expect((errorEvent as { message?: string }).message).toBe('Quota exceeded');

    socket.disconnect();
    blockServer.close();
  });

  test('beforeRunAgent hook stops at first abort', async () => {
    const orderPort = 9015;
    const callOrder: string[] = [];

    class FirstPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'first-plugin';
      }
      registerHandlers(): void {}
      async beforeRunAgent(_input: AgentInput): Promise<BeforeRunAgentResult | void> {
        callOrder.push('first');
        return { abort: true, message: 'First plugin aborts' };
      }
    }

    class SecondPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'second-plugin';
      }
      registerHandlers(): void {}
      async beforeRunAgent(_input: AgentInput): Promise<void> {
        callOrder.push('second');
      }
    }

    const orderServer = new UseAIServer({
      port: orderPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [new FirstPlugin(), new SecondPlugin()],
    });
    cleanup.trackServer(orderServer);

    const socket = await cleanup.createTestClient(orderPort);

    const errorPromise = waitForEventType(socket, EventType.RUN_ERROR);
    sendRunAgent(socket, { prompt: 'Hello' });
    await errorPromise;

    expect(callOrder).toEqual(['first']);

    socket.disconnect();
    orderServer.close();
  });

  test('agent runs normally when beforeRunAgent hook passes', async () => {
    const passPort = 9016;
    let hookCalled = false;

    class PassingPlugin implements UseAIServerPlugin {
      getName(): string {
        return 'passing-plugin';
      }
      registerHandlers(): void {}
      async beforeRunAgent(_input: AgentInput): Promise<void> {
        hookCalled = true;
        // Returns void — run proceeds
      }
    }

    const passServer = new UseAIServer({
      port: passPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      plugins: [new PassingPlugin()],
    });
    cleanup.trackServer(passServer);

    const socket = await cleanup.createTestClient(passPort);

    const eventsPromise = collectEventsUntil(socket, EventType.RUN_FINISHED);
    sendRunAgent(socket, { prompt: 'Hello' });
    const events = await eventsPromise;

    expect(hookCalled).toBe(true);
    const text = extractTextFromEvents(events);
    expect(text).toBe('Default response');

    socket.disconnect();
    passServer.close();
  });
});

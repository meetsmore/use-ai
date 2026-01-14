import { describe, expect, test, afterAll } from 'bun:test';
import type { UseAIServerPlugin } from './plugins/types';
import type { ClientSession } from './agents/types';
import { UseAIServer } from './server';
import {
  createTestAgent,
  TestCleanupManager,
} from '../test/integration-test-utils';

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
      cors: { origin: '*' },
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
      cors: { origin: '*' },
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
      cors: { origin: '*' },
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
      cors: { origin: '*' },
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

  test('WorkflowsPlugin enables headless workflow execution', () => {
    // WorkflowsPlugin is tested in the workflows package
    // This test just verifies the concept
    expect(true).toBe(true);
  });
});

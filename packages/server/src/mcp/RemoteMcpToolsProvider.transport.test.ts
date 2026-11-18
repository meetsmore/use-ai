import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { Server } from 'bun';
import { RemoteMcpToolsProvider } from './RemoteMcpToolsProvider';

interface RecordedRequest {
  headers: Headers;
  signal: AbortSignal;
  body: {
    jsonrpc: string;
    id: number;
    method: string;
    params?: Record<string, unknown> & { _meta?: Record<string, unknown> };
  };
}

type Reply = (request: RecordedRequest['body']) => Response;

const sse = (events: string[]) =>
  new Response(events.join(''), { headers: { 'Content-Type': 'text/event-stream' } });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const toolsResult = {
  tools: [
    {
      name: 'echo',
      description: 'Echo the input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    },
  ],
};

describe('RemoteMcpToolsProvider over Streamable HTTP', () => {
  let server: Server<undefined>;
  let url: string;
  let reply: Reply;
  let requests: RecordedRequest[];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as RecordedRequest['body'];
        requests.push({ headers: req.headers, signal: req.signal, body });
        return reply(body);
      },
    });
    url = `http://localhost:${server.port}/mcp`;
  });

  afterAll(() => {
    server.stop(true);
  });

  beforeEach(() => {
    requests = [];
  });

  describe('text/event-stream responses', () => {
    test('tools/list reads the response from an SSE stream', async () => {
      reply = ({ id }) =>
        sse([
          ': keep-alive\n\n',
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'listing' } })}\n\n`,
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: toolsResult })}\n\n`,
        ]);

      const tools = await new RemoteMcpToolsProvider({ url }).fetchToolsWithHeaders();

      expect(tools.map((t) => t.name)).toEqual(['echo']);
    });

    test('tools/list reads a response split over several data lines with CRLF line endings', async () => {
      reply = ({ id }) => {
        const payload = JSON.stringify({ jsonrpc: '2.0', id, result: toolsResult }, null, 2);
        return sse([`${payload.split('\n').map((line) => `data: ${line}`).join('\r\n')}\r\n\r\n`]);
      };

      const tools = await new RemoteMcpToolsProvider({ url }).fetchToolsWithHeaders();

      expect(tools.map((t) => t.name)).toEqual(['echo']);
    });

    test('tools/call skips progress notifications and returns the final result', async () => {
      reply = ({ id }) =>
        sse([
          `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, progress: 50 } })}\n\n`,
          `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '{"echoed":"hi"}' }] } })}\n\n`,
        ]);

      const result = await new RemoteMcpToolsProvider({ url }).executeTool('echo', { text: 'hi' });

      expect(result).toEqual({ echoed: 'hi' });
    });

    test('tools/call surfaces a JSON-RPC error sent on an SSE stream', async () => {
      reply = ({ id }) =>
        sse([`data: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'boom' } })}\n\n`]);

      await expect(new RemoteMcpToolsProvider({ url }).executeTool('echo', {})).rejects.toThrow(
        'MCP error: boom'
      );
    });

    test('an SSE stream that ends without the response is an error', async () => {
      reply = () =>
        sse([`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, progress: 1 } })}\n\n`]);

      await expect(new RemoteMcpToolsProvider({ url }).executeTool('echo', {})).rejects.toThrow(
        'SSE stream ended without a JSON-RPC response'
      );
    });

    test('tools/call reads a response split across chunks, inside a CRLF, on a stream the server keeps open', async () => {
      reply = ({ id }) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const chunk of [
              'data: {"jsonrpc":',
              '"2.0",\r',
              `\ndata: "id":${id},"result":{"content":[{"type":"text","text":"done"}]}}\r\n\r\n`,
            ]) {
              controller.enqueue(encoder.encode(chunk));
              await Bun.sleep(20);
            }
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      };

      const result = await new RemoteMcpToolsProvider({ url, timeout: 1000 }).executeTool('echo', {});

      expect(result).toEqual({ result: 'done' });
    });

    test('tools/call skips a priming event with empty data before the response', async () => {
      reply = ({ id }) =>
        sse([
          'id: prime-1\ndata: \n\n',
          'id: prime-2\ndata\n\n',
          `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } })}\n\n`,
        ]);

      const result = await new RemoteMcpToolsProvider({ url }).executeTool('echo', {});

      expect(result).toEqual({ result: 'ok' });
    });

    test('tools/call closes the connection once the response arrives on a stream the server keeps open', async () => {
      reply = ({ id }) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [] } })}\n\n`)
            );
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      };

      await new RemoteMcpToolsProvider({ url, timeout: 5000 }).executeTool('echo', {});

      const { signal } = requests[0];
      const closed = await new Promise<boolean>((resolve) => {
        if (signal.aborted) return resolve(true);
        signal.addEventListener('abort', () => resolve(true));
        setTimeout(() => resolve(false), 500);
      });
      expect(closed).toBe(true);
    });

    test('application/json responses still work', async () => {
      reply = ({ id }) => json({ jsonrpc: '2.0', id, result: toolsResult });

      const tools = await new RemoteMcpToolsProvider({ url }).fetchToolsWithHeaders();

      expect(tools.map((t) => t.name)).toEqual(['echo']);
    });
  });

  describe('protocolVersion 2026-07-28 request metadata', () => {
    beforeEach(() => {
      reply = ({ id, method }) =>
        json({ jsonrpc: '2.0', id, result: method === 'tools/list' ? toolsResult : { content: [] } });
    });

    test('tools/list carries MCP-Protocol-Version, Mcp-Method and the required _meta fields', async () => {
      await new RemoteMcpToolsProvider({ url, protocolVersion: '2026-07-28' }).fetchToolsWithHeaders();

      const [{ headers, body }] = requests;
      expect(headers.get('MCP-Protocol-Version')).toBe('2026-07-28');
      expect(headers.get('Mcp-Method')).toBe('tools/list');
      expect(headers.get('Mcp-Name')).toBeNull();
      expect(body.params).toEqual({
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      });
    });

    test('tools/call carries Mcp-Name and keeps name and arguments in params', async () => {
      await new RemoteMcpToolsProvider({ url, protocolVersion: '2026-07-28' }).executeTool('echo', { text: 'hi' });

      const [{ headers, body }] = requests;
      expect(headers.get('MCP-Protocol-Version')).toBe('2026-07-28');
      expect(headers.get('Mcp-Method')).toBe('tools/call');
      expect(headers.get('Mcp-Name')).toBe('echo');
      expect(body.params).toEqual({
        name: 'echo',
        arguments: { text: 'hi' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      });
    });

    test.each([
      ['plain ASCII', 'us-west1', 'us-west1'],
      ['non-ASCII', 'Hello, 世界', '=?base64?SGVsbG8sIOS4lueVjA==?='],
      ['leading and trailing spaces', ' padded ', '=?base64?IHBhZGRlZCA=?='],
      ['a newline', 'line1\nline2', '=?base64?bGluZTEKbGluZTI=?='],
      ['the sentinel pattern', '=?base64?literal?=', '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?='],
    ])('Mcp-Name encodes a name with %s per the spec value encoding', async (_case, name, header) => {
      await new RemoteMcpToolsProvider({ url, protocolVersion: '2026-07-28' }).executeTool(name, {});

      expect(requests[0].headers.get('Mcp-Name')).toBe(header);
    });

    test('without protocolVersion the request is unchanged', async () => {
      await new RemoteMcpToolsProvider({ url }).executeTool('echo', { text: 'hi' });

      const [{ headers, body }] = requests;
      expect(headers.get('MCP-Protocol-Version')).toBeNull();
      expect(headers.get('Mcp-Method')).toBeNull();
      expect(headers.get('Mcp-Name')).toBeNull();
      expect(body.params).toEqual({ name: 'echo', arguments: { text: 'hi' } });
    });
  });
});

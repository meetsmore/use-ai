import { randomUUID } from 'node:crypto';
import type { McpEndpointConfig } from '../types';

interface RequestOptions {
  headers: Record<string, string>;
  extraHeaders?: Record<string, string>;
}

export class McpRequestTimeoutError extends Error {
  constructor(readonly timeout: number) {
    super(`Request timeout after ${timeout}ms`);
  }
}

/** Sends individual MCP JSON-RPC requests over Streamable HTTP. */
export class McpHttpClient {
  constructor(
    private readonly url: string,
    private readonly timeout: number,
    private readonly protocolVersion?: McpEndpointConfig['protocolVersion'],
  ) {}

  async request(
    method: 'tools/list' | 'tools/call',
    params: Record<string, unknown> | undefined,
    { headers, extraHeaders }: RequestOptions,
  ): Promise<Record<string, unknown>> {
    const id = randomUUID();
    let requestHeaders = headers;
    let requestParams = params;
    if (this.protocolVersion) {
      // The protocol headers must agree with the body, even when an endpoint
      // configures extra headers using different casing.
      const modernHeaders = new Headers(headers);
      for (const name of [...modernHeaders.keys()]) {
        if (name === 'mcp-name' || name.startsWith('mcp-param-')) modernHeaders.delete(name);
      }
      modernHeaders.set('MCP-Protocol-Version', this.protocolVersion);
      modernHeaders.set('Mcp-Method', method);
      if (method === 'tools/call' && typeof params?.name === 'string') {
        modernHeaders.set('Mcp-Name', encodeMcpHeaderValue(params.name));
      }
      for (const [name, value] of Object.entries(extraHeaders ?? {})) {
        modernHeaders.set(name, value);
      }
      requestHeaders = Object.fromEntries(modernHeaders);
      requestParams = {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': this.protocolVersion,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new McpRequestTimeoutError(this.timeout)), this.timeout);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          ...(requestParams ? { params: requestParams } : {}),
          id,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (mediaType === 'text/event-stream') {
        return await readSseResponse(response.body, id);
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      // Close SSE responses that remain open after delivering the result.
      controller.abort();
    }
  }
}

/**
 * Encodes a value for the `Mcp-Name` or `Mcp-Param-*` header: plain when it is printable ASCII without
 * leading or trailing whitespace and does not look like the sentinel, otherwise
 * `=?base64?{UTF-8 bytes in Base64}?=`.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#value-encoding
 */
export function encodeMcpHeaderValue(value: string): string {
  const plain =
    /^[\x20-\x7E\t]*$/.test(value) &&
    value === value.trim() &&
    !(value.startsWith('=?base64?') && value.endsWith('?='));
  return plain ? value : `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Reads a `text/event-stream` body until the JSON-RPC response with the given id arrives.
 * Events with empty data (such as priming events), comment lines and notifications are skipped.
 * Unlike the event-stream spec, an unterminated last event at the end of the stream is still read.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */
async function readSseResponse(
  body: ReadableStream<Uint8Array> | null,
  id: string
): Promise<Record<string, unknown>> {
  let data: string[] = [];

  const readLine = (line: string): Record<string, unknown> | undefined => {
    if (line === '') {
      const text = data.join('\n');
      data = [];
      if (text === '') return undefined;
      const message = JSON.parse(text) as Record<string, unknown> | null;
      if (message && typeof message === 'object' && message.id === id) {
        return 'result' in message || 'error' in message ? message : undefined;
      }
      return undefined;
    }
    if (line === 'data' || line.startsWith('data:')) {
      const value = line.slice(5);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    return undefined;
  };

  if (body) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      let buffer = '';
      let afterCr = false;
      for (;;) {
        const { value, done } = await reader.read();
        let chunk = done ? '\n\n' : value;
        // An LF right after a CR that ended the previous chunk is the second half of a CRLF.
        if (afterCr && chunk.startsWith('\n')) chunk = chunk.slice(1);
        afterCr = chunk.endsWith('\r');
        if (chunk === '') continue;
        buffer += chunk;
        if (!/[\r\n]/.test(chunk)) continue;
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop()!;
        for (const line of lines) {
          const message = readLine(line);
          if (message) return message;
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }

  throw new Error('SSE stream ended without a JSON-RPC response');
}

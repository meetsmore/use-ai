import type { Server as BunEngine } from '@socket.io/bun-engine';
import type { CorsOptions } from './types';

interface BunServerConfig {
  port: number;
  idleTimeout: number;
  cors?: CorsOptions;
}

/**
 * Get Access-Control-Allow-Origin header value based on cors config and request origin.
 */
function getAllowedOrigin(
  requestOrigin: string | undefined,
  corsOrigin: CorsOptions['origin']
): string | null {
  // true or '*' = allow all (reflect request origin or '*')
  if (corsOrigin === true || corsOrigin === '*') {
    return requestOrigin || '*';
  }
  // string = exact match
  if (typeof corsOrigin === 'string') {
    return corsOrigin;
  }
  // RegExp = test against request origin
  if (corsOrigin instanceof RegExp) {
    return requestOrigin && corsOrigin.test(requestOrigin) ? requestOrigin : null;
  }
  // Array = check if any matches
  if (Array.isArray(corsOrigin)) {
    for (const allowed of corsOrigin) {
      const result = getAllowedOrigin(requestOrigin, allowed);
      if (result) return result;
    }
    return null;
  }
  return null;
}

/**
 * Creates Bun server configuration for use with Bun.serve().
 */
export function createBunConfig(
  engine: BunEngine,
  config: BunServerConfig
): Parameters<typeof Bun.serve>[0] {
  const handler = engine.handler();

  const addCorsHeaders = (req: Request, headers: Record<string, string>) => {
    if (!config.cors) return headers;

    const requestOrigin = req.headers.get('Origin') || undefined;
    const allowedOrigin = getAllowedOrigin(requestOrigin, config.cors.origin);

    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
    }
    if (config.cors.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    return headers;
  };

  return {
    port: config.port,
    idleTimeout: config.idleTimeout,
    fetch: async (req: Request, server: Parameters<typeof engine.handleRequest>[1]) => {
      const url = new URL(req.url);

      // Handle CORS preflight
      if (req.method === 'OPTIONS' && config.cors) {
        const methods = config.cors.methods ?? ['GET', 'POST'];
        const requestedHeaders = req.headers.get('Access-Control-Request-Headers');

        return new Response(null, {
          status: 204,
          headers: addCorsHeaders(req, {
            'Access-Control-Allow-Methods': Array.isArray(methods) ? methods.join(',') : methods,
            ...(requestedHeaders && { 'Access-Control-Allow-Headers': requestedHeaders }),
            'Content-Length': '0',
          }),
        });
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: addCorsHeaders(req, { 'Content-Type': 'application/json' }),
        });
      }

      // Socket.IO path
      if (url.pathname.startsWith('/socket.io/')) {
        const response = await engine.handleRequest(req, server);

        // Add CORS headers to Socket.IO responses
        if (response && config.cors) {
          const corsHeaders = addCorsHeaders(req, {});
          if (Object.keys(corsHeaders).length > 0) {
            const newHeaders = new Headers(response.headers);
            for (const [key, value] of Object.entries(corsHeaders)) {
              newHeaders.set(key, value);
            }
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          }
        }
        return response;
      }

      return new Response('Not Found', { status: 404, headers: addCorsHeaders(req, {}) });
    },
    websocket: handler.websocket,
  } as Parameters<typeof Bun.serve>[0];
}

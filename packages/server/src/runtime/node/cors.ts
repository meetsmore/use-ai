import type { IncomingMessage, ServerResponse } from 'http';
import type { CorsOptions } from '../../types';

/**
 * Get Access-Control-Allow-Origin header value based on cors config and request origin.
 */
export function getAllowedOrigin(
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
 * Sets CORS headers on a Node.js HTTP response.
 */
export function setCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  cors?: CorsOptions
): void {
  if (!cors) return;

  const requestOrigin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(requestOrigin, cors.origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  if (cors.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

/**
 * Handles CORS preflight OPTIONS request.
 * Returns true if the request was handled, false otherwise.
 */
export function handleCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  cors?: CorsOptions
): boolean {
  if (req.method !== 'OPTIONS' || !cors) {
    return false;
  }

  const methods = cors.methods ?? ['GET', 'POST'];
  const requestedHeaders = req.headers['access-control-request-headers'];

  setCorsHeaders(req, res, cors);
  res.setHeader('Access-Control-Allow-Methods', Array.isArray(methods) ? methods.join(',') : methods);
  if (requestedHeaders) {
    res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
  }
  res.setHeader('Content-Length', '0');
  res.statusCode = 204;
  res.end();
  return true;
}

import type { IncomingMessage, ServerResponse } from 'http';
import type { CorsOptions } from '../../types';
import { resolveCorsHeaders, resolvePreflightHeaders } from '../cors';

// Re-export for convenience
export { getAllowedOrigin, resolveCorsHeaders, resolvePreflightHeaders } from '../cors';

/**
 * Sets CORS headers on a Node.js HTTP response.
 */
export function setCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  cors?: CorsOptions
): void {
  const requestOrigin = req.headers.origin;
  const headers = resolveCorsHeaders(requestOrigin, cors);

  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      res.setHeader(key, value);
    }
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

  const requestOrigin = req.headers.origin;
  const requestedHeaders = req.headers['access-control-request-headers'];
  const headers = resolvePreflightHeaders(
    requestOrigin,
    typeof requestedHeaders === 'string' ? requestedHeaders : undefined,
    cors
  );

  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      res.setHeader(key, value);
    }
  }

  res.setHeader('Content-Length', '0');
  res.statusCode = 204;
  res.end();
  return true;
}

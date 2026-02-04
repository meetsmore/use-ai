import type { CorsOptions } from '../types';

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
 * Resolves CORS headers based on request origin and CORS configuration.
 * Returns an object with header key-value pairs to be set.
 */
export function resolveCorsHeaders(
  requestOrigin: string | undefined,
  cors?: CorsOptions
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!cors) return headers;

  const allowedOrigin = getAllowedOrigin(requestOrigin, cors.origin);

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  if (cors.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/**
 * Resolves CORS preflight headers for OPTIONS requests.
 */
export function resolvePreflightHeaders(
  requestOrigin: string | undefined,
  requestedHeaders: string | undefined,
  cors?: CorsOptions
): Record<string, string> {
  const headers = resolveCorsHeaders(requestOrigin, cors);

  if (!cors) return headers;

  const methods = cors.methods ?? ['GET', 'POST'];
  headers['Access-Control-Allow-Methods'] = Array.isArray(methods) ? methods.join(',') : methods;

  if (requestedHeaders) {
    headers['Access-Control-Allow-Headers'] = requestedHeaders;
  }

  return headers;
}

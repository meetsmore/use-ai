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
 * Adds CORS headers to a headers object based on the request and CORS configuration.
 */
export function addCorsHeaders(
  req: Request,
  headers: Record<string, string>,
  cors?: CorsOptions
): Record<string, string> {
  if (!cors) return headers;

  const requestOrigin = req.headers.get('Origin') || undefined;
  const allowedOrigin = getAllowedOrigin(requestOrigin, cors.origin);

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  if (cors.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

import type { CorsOptions } from '../../types';
import { resolveCorsHeaders } from '../cors';

// Re-export for convenience
export { getAllowedOrigin, resolveCorsHeaders, resolvePreflightHeaders } from '../cors';

/**
 * Adds CORS headers to a headers object based on the Bun Request and CORS configuration.
 */
export function addCorsHeaders(
  req: Request,
  headers: Record<string, string>,
  cors?: CorsOptions
): Record<string, string> {
  const requestOrigin = req.headers.get('Origin') || undefined;
  const corsHeaders = resolveCorsHeaders(requestOrigin, cors);

  return { ...headers, ...corsHeaders };
}

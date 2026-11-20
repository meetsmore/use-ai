/**
 * Decides whether a connection may open, from its Origin header.
 *
 * Without an allowlist, every origin is accepted. With an allowlist, the Origin header
 * must match one entry exactly. A request without an Origin header is refused.
 *
 * Browsers always send Origin on a WebSocket upgrade and on a cross-origin request,
 * so this check stops other sites from opening connections from their users' browsers.
 * A non-browser client can send any Origin header, so this check does not replace
 * authentication.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[] | undefined): boolean {
  if (!allowedOrigins) return true;
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

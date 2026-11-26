/**
 * The request headers that the origin check reads.
 */
export interface OriginCheckHeaders {
  /** The `Origin` request header. */
  origin: string | undefined;
  /** The `Sec-Fetch-Site` request header. */
  secFetchSite: string | undefined;
}

/**
 * Decides whether a connection may open, from its Origin and Sec-Fetch-Site headers.
 *
 * Without an allowlist, every origin is accepted. With an allowlist, the Origin header
 * must match one entry exactly.
 *
 * A request without an Origin header is accepted only when `Sec-Fetch-Site` is
 * `same-origin`. Browsers do not send Origin on a same-origin GET, for example the first
 * Socket.IO polling handshake when the app and the server share an origin behind a
 * reverse proxy. Pages cannot set `Sec-Fetch-Site`, so another site cannot make the
 * browser send `same-origin`. A cross-site GET without Origin (for example from an
 * `<img>` tag) carries `cross-site` and is refused. The browser compares the page with
 * the server's own origin, not with the allowlist, so any page on the server's own
 * origin can connect, even if the allowlist does not name that origin.
 *
 * Browsers always send Origin on a WebSocket upgrade and on a cross-origin request,
 * so this check stops other sites from opening connections from their users' browsers.
 * A non-browser client can send any Origin or Sec-Fetch-Site header, so this check does
 * not replace authentication.
 */
export function isOriginAllowed(
  { origin, secFetchSite }: OriginCheckHeaders,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  if (!allowedOrigins) return true;
  if (!origin) return secFetchSite === 'same-origin';
  return allowedOrigins.includes(origin);
}

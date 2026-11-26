/**
 * Matches client-supplied `mcpHeaders` patterns to configured MCP endpoint URLs.
 *
 * The client chooses which MCP endpoint receives which headers (often a user token).
 * The server operator chooses which endpoints exist. If a client pattern has no domain
 * (for example a wildcard host), an endpoint that an operator adds later receives the
 * user's token without anyone noticing. So every pattern must name a domain.
 *
 * Pattern format: `scheme://host[:port][/path]`
 * - `scheme` and `path` may contain picomatch globs. A missing path means `/`.
 * - `host` is a literal host (`api.example.com`, `localhost`, `127.0.0.1`, `[::1]`),
 *   or `*.` followed by a literal domain that is not a public suffix (`*.example.com`).
 *   The subdomains of that domain must not be public suffixes either (not `*.kawasaki.jp`).
 *   `*.example.com` matches subdomains at any depth, but not `example.com` itself.
 * - `port` is a literal number. A missing port means the default port of the scheme.
 *
 * A pattern that breaks these rules is ignored and a warning is logged.
 */

import picomatch from 'picomatch';
import { parse as parseDomain } from 'tldts';
import type { McpHeadersConfig, McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import { logger } from '../logger';

interface ParsedPattern {
  matchScheme: (scheme: string) => boolean;
  /** Lowercase literal host, or the domain after `*.` if `wildcardSubdomain` is true. */
  host: string;
  wildcardSubdomain: boolean;
  /** Literal port, or undefined for the default port of the scheme. */
  port: string | undefined;
  matchPath: (path: string) => boolean;
}

type ParseResult = { ok: true; pattern: ParsedPattern } | { ok: false; reason: string };

const PATTERN_RE = /^([^:/]+):\/\/([^/]*)(\/.*)?$/;
const HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const IPV6_RE = /^\[[0-9a-f:.]+\]$/;
const PORT_RE = /^[0-9]{1,5}$/;

const DEFAULT_PORTS: Record<string, string> = {
  http: '80',
  https: '443',
  ws: '80',
  wss: '443',
};

/** Normalizes a literal host the same way the WHATWG URL parser does, or returns undefined. */
function normalizeLiteralHost(host: string): string | undefined {
  if (!HOSTNAME_RE.test(host) && !IPV6_RE.test(host)) {
    return undefined;
  }
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

function parsePattern(pattern: string): ParseResult {
  const parts = PATTERN_RE.exec(pattern);
  if (!parts) {
    return { ok: false, reason: 'pattern must have the form scheme://host[:port][/path]' };
  }
  const [, scheme, authority, path = '/'] = parts;

  if (authority.includes('@')) {
    return { ok: false, reason: 'pattern must not contain user info' };
  }

  // Split the authority into host and port. An IPv6 host is in brackets.
  const portMatch = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(authority.toLowerCase());
  if (!portMatch) {
    return { ok: false, reason: 'host must not contain a colon' };
  }
  let host = portMatch[1];
  const port: string | undefined = portMatch[2];

  if (port !== undefined && (!PORT_RE.test(port) || Number(port) > 65535)) {
    return { ok: false, reason: 'port must be a literal number from 0 to 65535' };
  }

  let wildcardSubdomain = false;
  if (host.startsWith('*.')) {
    wildcardSubdomain = true;
    host = host.slice(2);
  }

  const normalized = normalizeLiteralHost(host);
  if (normalized === undefined) {
    return {
      ok: false,
      reason: 'host must be a literal host, or *. followed by a literal domain',
    };
  }
  host = normalized;

  if (wildcardSubdomain) {
    const info = parseDomain(host, { allowPrivateDomains: true });
    if (info.isIp || IPV6_RE.test(host)) {
      return { ok: false, reason: '*. must be followed by a domain, not an IP address' };
    }
    if (host.split('.').length < 2) {
      return { ok: false, reason: '*. must be followed by a domain with at least 2 labels' };
    }
    if (info.publicSuffix === host) {
      return { ok: false, reason: '*. must not be followed by a public suffix' };
    }
    // A PSL wildcard rule such as `*.kawasaki.jp` makes each child of `kawasaki.jp` a
    // public suffix, but not `kawasaki.jp` itself. Then `*.kawasaki.jp` matches hosts of
    // different registrants. Any label works as the probe, because the rule matches any label.
    const probe = `x.${host}`;
    if (parseDomain(probe, { allowPrivateDomains: true }).publicSuffix === probe) {
      return {
        ok: false,
        reason: '*. must not be followed by a domain whose subdomains are public suffixes',
      };
    }
  }

  return {
    ok: true,
    pattern: {
      matchScheme: picomatch(scheme.toLowerCase()),
      host,
      wildcardSubdomain,
      port,
      matchPath: picomatch(path),
    },
  };
}

function matchesUrl(pattern: ParsedPattern, url: URL): boolean {
  const scheme = url.protocol.slice(0, -1);
  if (!pattern.matchScheme(scheme)) {
    return false;
  }

  const hostname = url.hostname;
  const hostMatches = pattern.wildcardSubdomain
    ? hostname.endsWith(`.${pattern.host}`)
    : hostname === pattern.host;
  if (!hostMatches) {
    return false;
  }

  if (pattern.port === undefined) {
    // No port in the pattern: the URL must use the default port of its scheme.
    if (url.port !== '') {
      return false;
    }
  } else {
    const urlPort = url.port !== '' ? url.port : DEFAULT_PORTS[scheme];
    if (urlPort !== pattern.port) {
      return false;
    }
  }

  return pattern.matchPath(url.pathname + url.search);
}

function warnInvalidPattern(pattern: string, reason: string): void {
  // Log the pattern and the reason only. Never log header values.
  logger.warn('[MCP] Ignored an mcpHeaders pattern without a domain. Its headers are not sent.', {
    pattern: pattern.slice(0, 200),
    reason,
  });
}

/**
 * Finds the client headers for an MCP endpoint URL.
 * A key equal to the URL wins. Otherwise the first valid pattern that matches wins.
 * Invalid patterns are ignored and logged.
 *
 * @param endpointUrl - The configured MCP endpoint URL
 * @param mcpHeaders - The client-supplied headers map
 * @returns The headers config for the endpoint, or undefined if no valid pattern matches
 */
export function findMcpHeadersForUrl(
  endpointUrl: string,
  mcpHeaders: McpHeadersMap | undefined
): McpHeadersConfig | undefined {
  if (!mcpHeaders) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    return undefined;
  }

  const valid: Array<[ParsedPattern, McpHeadersConfig]> = [];
  for (const [key, config] of Object.entries(mcpHeaders)) {
    const result = parsePattern(key);
    if (!result.ok) {
      warnInvalidPattern(key, result.reason);
      continue;
    }
    if (key === endpointUrl) {
      return config;
    }
    valid.push([result.pattern, config]);
  }

  for (const [pattern, config] of valid) {
    if (matchesUrl(pattern, url)) {
      return config;
    }
  }
  return undefined;
}

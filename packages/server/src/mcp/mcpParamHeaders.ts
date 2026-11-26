import { encodeMcpHeaderValue } from './McpHttpClient';

export interface McpParamHeader {
  /** Name portion of the `Mcp-Param-{name}` header */
  header: string;
  /** Chain of `properties` keys from the schema root to the annotated property */
  path: string[];
  type: 'string' | 'integer' | 'boolean';
}

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Collects the `x-mcp-header` annotations of a tool input schema.
 * Returns the reason when an annotation breaks a constraint of the spec: not an HTTP token,
 * not case-insensitively unique, not on a string, integer or boolean property, or not
 * statically reachable from the root through `properties` keys only.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header
 */
export function readMcpParamHeaders(schema: unknown): McpParamHeader[] | string {
  const found: McpParamHeader[] = [];
  const seen = new Set<string>();
  let reachable = 0;

  const visitProperties = (node: unknown, path: string[]): string | undefined => {
    const properties = (node as { properties?: unknown } | null)?.properties;
    if (properties === null || typeof properties !== 'object') return undefined;
    for (const [key, property] of Object.entries(properties)) {
      if (property === null || typeof property !== 'object') continue;
      if ('x-mcp-header' in property) {
        reachable++;
        const header = (property as Record<string, unknown>)['x-mcp-header'];
        const type = (property as Record<string, unknown>).type;
        if (typeof header !== 'string' || !HTTP_TOKEN.test(header)) {
          return `x-mcp-header ${JSON.stringify(header)} is not an HTTP header token`;
        }
        if (seen.has(header.toLowerCase())) return `x-mcp-header "${header}" is not unique`;
        if (type !== 'string' && type !== 'integer' && type !== 'boolean') {
          return `x-mcp-header "${header}" is on a property of type ${JSON.stringify(type)}`;
        }
        seen.add(header.toLowerCase());
        found.push({ header, path: [...path, key], type });
      }
      const error = visitProperties(property, [...path, key]);
      if (error) return error;
    }
    return undefined;
  };

  const countAll = (node: unknown, isPropertiesMap = false): number => {
    if (node === null || typeof node !== 'object') return 0;
    let count = 0;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'x-mcp-header' && !isPropertiesMap && !Array.isArray(node)) count++;
      count += countAll(value, key === 'properties' && !isPropertiesMap && !Array.isArray(node));
    }
    return count;
  };

  const error = visitProperties(schema, []);
  if (error) return error;
  if (countAll(schema) > reachable) return 'x-mcp-header is on a property that is not statically reachable';
  return found;
}

export function buildMcpParamHeaders(
  args: unknown,
  annotations: readonly McpParamHeader[],
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const { header, path, type } of annotations) {
    let value = args;
    for (const key of path) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (value === null || value === undefined) continue;

    const valid = type === 'integer'
      ? typeof value === 'number' && Number.isSafeInteger(value)
      : typeof value === type;
    if (!valid) {
      throw new Error(`Invalid value for MCP header parameter "${path.join('.')}": expected ${type === 'integer' ? 'a safe integer' : type}`);
    }
    headers[`Mcp-Param-${header}`] = encodeMcpHeaderValue(String(value));
  }
  return headers;
}

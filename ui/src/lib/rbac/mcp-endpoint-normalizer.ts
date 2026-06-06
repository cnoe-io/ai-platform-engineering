/**
 * Normalise MCP server endpoints that route through AgentGateway.
 *
 * Invariant: when an MCP server is dispatched via AgentGateway, the
 * gateway routes requests by path prefix — `/mcp/<target>` — so the
 * endpoint persisted against the server document MUST be
 * target-qualified. A bare `http://agentgateway:4000/mcp` falls through
 * to AgentGateway's `/mcp` route, which is not registered, and returns
 * `HTTP 404 Not Found` on every probe and tool call.
 *
 * This module centralises the rewrite logic so:
 *   - `POST /api/mcp-servers` and `PUT /api/mcp-servers` can normalise
 *     on save (preventing future drift),
 *   - the dynamic-agents probe path can normalise on read (defence in
 *     depth against historical bad data we haven't yet repaired),
 *   - a one-shot repair script can audit Mongo without re-inventing
 *     the rule.
 *
 * It is intentionally a pure module: no I/O, no env reads. Callers pass
 * in the AgentGateway base URL so dev/staging/prod and per-tenant
 * overrides flow through one decision point.
 */

export interface NormalizeMcpEndpointInput {
  /** Current endpoint value (may be undefined for stdio servers). */
  endpoint: string | undefined;
  /** The MCP server's id — used as the path suffix when we rewrite. */
  serverId: string;
  /**
   * AgentGateway base URL (e.g. `http://agentgateway:4000`). Used to
   * detect whether the endpoint points at AgentGateway vs. a direct
   * upstream. Trailing slashes are tolerated.
   */
  agentGatewayBaseUrl: string;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function collapseSlashes(url: string): string {
  // Preserve the protocol's `//` while collapsing any subsequent
  // `//` runs in the path.
  return url.replace(/([^:])\/{2,}/g, "$1/");
}

function withoutMcpSuffix(url: string): string {
  return url.endsWith("/mcp") ? url.slice(0, -"/mcp".length) : url;
}

function originOf(url: string): string {
  // Conservative origin extractor — we only care about
  // `protocol://host[:port]` so use a regex rather than the URL API
  // (which would throw on a few legacy inputs we want to be tolerant of).
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i.exec(url);
  return match ? match[1] : "";
}

/**
 * `true` iff the endpoint points at the configured AgentGateway base
 * WITHOUT a target suffix. These are the rows we have to repair —
 * everything else is either healthy (target-qualified) or a direct
 * upstream and must NOT be rewritten.
 */
export function isAgentGatewayBaseEndpoint(
  endpoint: string,
  agentGatewayBaseUrl: string,
): boolean {
  if (!endpoint || !agentGatewayBaseUrl) return false;
  const trimmedEndpoint = stripTrailingSlashes(collapseSlashes(endpoint));
  const trimmedBase = stripTrailingSlashes(collapseSlashes(agentGatewayBaseUrl));

  if (originOf(trimmedEndpoint) !== originOf(trimmedBase) || !originOf(trimmedBase)) {
    return false;
  }

  // Strip an optional trailing `/mcp` and see if what remains is
  // exactly the configured base. That's the signature of a bare
  // gateway endpoint.
  const withoutMcp = withoutMcpSuffix(trimmedEndpoint);
  const baseWithoutMcp = withoutMcpSuffix(trimmedBase);
  return withoutMcp === baseWithoutMcp || withoutMcp === trimmedBase;
}

/**
 * Return the endpoint in target-qualified form when:
 *   - it points at AgentGateway, AND
 *   - we have a non-empty `serverId` to suffix.
 *
 * Otherwise the endpoint is returned unchanged. The normalisation also
 * repairs endpoints that name the wrong target (e.g. after a rename) by
 * replacing the existing suffix with the current `serverId`.
 */
export function normalizeMcpEndpointForServer(
  input: NormalizeMcpEndpointInput,
): string | undefined {
  const { endpoint, serverId, agentGatewayBaseUrl } = input;
  if (endpoint === undefined) return undefined;
  if (endpoint === "") return "";
  if (!serverId.trim()) return endpoint;

  const trimmedEndpoint = stripTrailingSlashes(collapseSlashes(endpoint));
  const trimmedBase = stripTrailingSlashes(collapseSlashes(agentGatewayBaseUrl));
  if (!trimmedBase) return endpoint;

  // Only touch endpoints that point at AgentGateway. Direct upstream
  // URLs (e.g. http://mcp-confluence:8000/mcp) are valid and must be
  // left untouched — AgentGateway routing is opt-in per server.
  if (originOf(trimmedEndpoint) !== originOf(trimmedBase)) {
    return endpoint;
  }

  // Compute the canonical base, with a single `/mcp` segment.
  const baseWithMcp = trimmedBase.endsWith("/mcp")
    ? trimmedBase
    : `${trimmedBase}/mcp`;

  // If the endpoint already names this exact server id, we're done.
  const expected = `${baseWithMcp}/${serverId.trim()}`;
  if (trimmedEndpoint === expected) {
    return expected;
  }

  // Otherwise rewrite to the expected form. This handles three cases at once:
  //   - bare base (e.g. `.../mcp`) → suffix
  //   - wrong suffix (e.g. `.../mcp/old-id`) → repair to current serverId
  //   - missing /mcp segment (e.g. `http://agentgateway:4000`) → add it
  return expected;
}

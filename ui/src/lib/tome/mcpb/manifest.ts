/**
 * Manifest for the Tome MCP Bundle (.mcpb) — see
 * https://github.com/anthropics/mcpb/blob/main/MANIFEST.md.
 *
 * Built as a plain object rather than a static template, since the OAuth
 * args array needs a conditional `--allow-http` entry depending on whether
 * this deployment's public origin is `http://` (local/dev) or `https://`
 * (a real deployment).
 */

// Matches the Keycloak `caipe-cli` public PKCE client's already-registered
// redirect URIs (`http://localhost:8085/*`) — see
// charts/ai-platform-engineering/charts/keycloak/realm-config.json and
// `_reconcile_cli_client` in .../scripts/init-idp.sh. Reusing this client id
// and port means the bundle's OAuth callback needs zero Keycloak changes.
const KEYCLOAK_CLI_CLIENT_ID = "caipe-cli";
const OAUTH_CALLBACK_PORT = "8085";

export interface TomeMcpbManifestOptions {
  /** Public origin of this deployment, e.g. "https://caipe.example.com". */
  origin: string;
  /** Whether `origin` is a plain http:// (local dev) — needs --allow-http. */
  allowHttp: boolean;
}

export interface McpRemoteOAuthArgsOptions {
  /** Full Tome MCP endpoint URL, e.g. "https://caipe.example.com/api/tome/mcp". */
  endpoint: string;
  /** Whether `endpoint` is a plain http:// (local dev) — needs --allow-http. */
  allowHttp: boolean;
}

/**
 * The mcp-remote OAuth args needed to reach the Tome MCP endpoint — shared
 * by the .mcpb bundle (prefixed with its own proxy.js path, below) and the
 * manual `claude_desktop_config.json` fallback in McpConnectDialog.tsx
 * (prefixed with `-y mcp-remote` for `npx`), so both stay in lockstep.
 */
export function buildMcpRemoteOAuthArgs({ endpoint, allowHttp }: McpRemoteOAuthArgsOptions): string[] {
  const args = [
    endpoint,
    OAUTH_CALLBACK_PORT,
    "--transport",
    "http-only",
    "--static-oauth-client-info",
    JSON.stringify({ client_id: KEYCLOAK_CLI_CLIENT_ID }),
  ];
  if (allowHttp) args.push("--allow-http");
  return args;
}

export function buildTomeMcpbManifest({ origin, allowHttp }: TomeMcpbManifestOptions) {
  const endpoint = `${origin.replace(/\/$/, "")}/api/tome/mcp`;

  const args = [
    "${__dirname}/node_modules/mcp-remote/dist/proxy.js",
    ...buildMcpRemoteOAuthArgs({ endpoint, allowHttp }),
  ];

  return {
    manifest_version: "0.3",
    name: "tome-mcp",
    display_name: "CAIPE Tome",
    version: "1.0.0",
    description: "Connect Claude Desktop to your CAIPE Tome projects via MCP.",
    author: { name: "CAIPE" },
    icon: "icon.png",
    server: {
      type: "node",
      entry_point: "node_modules/mcp-remote/dist/proxy.js",
      mcp_config: {
        command: "node",
        args,
      },
    },
    compatibility: {
      platforms: ["darwin", "win32", "linux"],
      runtimes: { node: ">=18.0.0" },
    },
  };
}

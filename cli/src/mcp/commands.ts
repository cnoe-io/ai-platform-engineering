/**
 * `caipe mcp list|connect` — OAuth connector discovery via BFF.
 */

import { getAuthUrl, getServerUrl, ServerNotConfigured } from "../platform/config.js";
import { getValidToken } from "../auth/tokens.js";
import { spawnSync } from "node:child_process";

interface ConnectorRow {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
}

async function fetchConnectors(serverUrl: string, getToken: () => Promise<string>): Promise<ConnectorRow[]> {
  const token = await getToken();
  const res = await fetch(`${serverUrl}/api/credentials/oauth-connectors`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) {
    throw new Error("Credential features are disabled on this server.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to list connectors: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: ConnectorRow[] };
  return json.data ?? [];
}

export async function runMcpList(
  opts: { json?: boolean },
  globalOpts: { url?: string },
): Promise<void> {
  let serverUrl: string;
  let authUrl: string;
  try {
    serverUrl = getServerUrl(globalOpts.url);
    authUrl = getAuthUrl(globalOpts.url);
  } catch (err) {
    if (err instanceof ServerNotConfigured) {
      process.stderr.write("[ERROR] Configure server.url first.\n");
      process.exit(3);
    }
    throw err;
  }

  const connectors = await fetchConnectors(serverUrl, () => getValidToken(authUrl));
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(connectors, null, 2)}\n`);
    return;
  }
  if (connectors.length === 0) {
    process.stdout.write("No OAuth connectors enabled.\n");
    return;
  }
  for (const c of connectors) {
    process.stdout.write(`${c.provider.padEnd(16)} ${c.name} (${c.id})\n`);
  }
}

export async function runMcpConnect(
  providerKey: string,
  globalOpts: { url?: string },
): Promise<void> {
  let serverUrl: string;
  let authUrl: string;
  try {
    serverUrl = getServerUrl(globalOpts.url);
    authUrl = getAuthUrl(globalOpts.url);
  } catch (err) {
    if (err instanceof ServerNotConfigured) {
      process.stderr.write("[ERROR] Configure server.url first.\n");
      process.exit(3);
    }
    throw err;
  }

  await getValidToken(authUrl);
  const connectUrl = `${serverUrl}/api/credentials/oauth/${encodeURIComponent(providerKey)}/connect`;
  process.stdout.write(`Open in browser to connect ${providerKey}:\n${connectUrl}\n`);

  if (process.platform === "darwin") {
    spawnSync("open", [connectUrl], { stdio: "ignore" });
  } else if (process.platform === "linux") {
    spawnSync("xdg-open", [connectUrl], { stdio: "ignore" });
  }
}

/**
 * `caipe doctor` — connectivity and auth diagnostics.
 */

import { fetchAgents } from "../agents/registry.js";
import { loadTokens } from "../auth/keychain.js";
import { isAuthenticatedSession } from "../auth/session.js";
import { getValidToken } from "../auth/tokens.js";
import { getAuthUrl, getServerUrl, ServerNotConfigured } from "../platform/config.js";

interface GlobalOpts {
  url?: string;
  json?: boolean;
}

export async function runDoctor(opts: Record<string, unknown>, globalOpts: GlobalOpts): Promise<void> {
  const asJson = opts.json === true || globalOpts.json === true;
  const lines: { check: string; ok: boolean; detail: string }[] = [];

  let authUrl: string | null = null;
  let serverUrl: string | null = null;

  try {
    authUrl = getAuthUrl(globalOpts.url);
    lines.push({ check: "auth.url", ok: true, detail: authUrl });
  } catch (err) {
    lines.push({
      check: "auth.url",
      ok: false,
      detail: err instanceof ServerNotConfigured ? "not configured" : String(err),
    });
  }

  try {
    serverUrl = getServerUrl(globalOpts.url);
    lines.push({ check: "server.url", ok: true, detail: serverUrl });
  } catch (err) {
    lines.push({
      check: "server.url",
      ok: false,
      detail: err instanceof ServerNotConfigured ? "not configured" : String(err),
    });
  }

  const stored = await loadTokens();
  const authOk = stored !== null && isAuthenticatedSession(stored);
  lines.push({
    check: "credentials",
    ok: authOk,
    detail: authOk ? (stored!.identity ?? stored!.displayName ?? "session ok") : "missing or incomplete",
  });

  if (serverUrl && authOk && authUrl) {
    try {
      const healthUrl = `${serverUrl}/api/health`;
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(15_000) });
      lines.push({
        check: "bff.health",
        ok: res.ok,
        detail: `${healthUrl} → HTTP ${res.status}`,
      });
    } catch (err) {
      lines.push({
        check: "bff.health",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const agents = await fetchAgents(serverUrl, () => getValidToken(authUrl!));
      lines.push({
        check: "agents.accessible",
        ok: agents.length > 0,
        detail: `${agents.length} agent(s): ${agents.map((a) => a.name).join(", ") || "(none)"}`,
      });
    } catch (err) {
      lines.push({
        check: "agents.accessible",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ checks: lines }, null, 2)}\n`);
    return;
  }

  process.stdout.write("CAIPE CLI doctor\n\n");
  for (const row of lines) {
    const mark = row.ok ? "ok" : "FAIL";
    process.stdout.write(`  [${mark}] ${row.check}: ${row.detail}\n`);
  }
  const failed = lines.some((l) => !l.ok);
  if (failed) process.exitCode = 3;
}

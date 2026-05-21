"use client";

import React from "react";

interface ProviderConnection {
  id: string;
  connectorId?: string;
  provider: string;
  status: string;
  updatedAt?: string | Date;
  connectedAt?: string | Date;
  expiresAt?: string | Date;
}

interface OAuthConnector {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
}

interface ProviderProfileCheckResult {
  ok: boolean;
  provider: string;
  status?: number;
  profile?: Record<string, unknown>;
  profile_check?: {
    ok: boolean;
    status?: number;
    message?: string;
  };
  accessible_resources?: Array<Record<string, unknown>>;
  diagnostics?: TokenDiagnostic[];
  next_action?: string;
  message?: string;
}

interface TokenDiagnostic {
  id: string;
  label: string;
  status: "passed" | "warning" | "failed";
  detail: string;
  action: string;
  http_status?: number;
}

interface ProviderConnectionRefreshResult {
  id: string;
  provider: string;
  ok: boolean;
  expires_in?: number;
}

interface ProfileCheckState {
  loading: boolean;
  result?: ProviderProfileCheckResult;
  error?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

export function ProviderConnections() {
  const [connections, setConnections] = React.useState<ProviderConnection[]>([]);
  const [connectors, setConnectors] = React.useState<OAuthConnector[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [profileChecks, setProfileChecks] = React.useState<Record<string, ProfileCheckState>>({});
  const [autoRefreshStates, setAutoRefreshStates] = React.useState<Record<string, { loading: boolean; error?: string }>>({});
  const [diagnosticModal, setDiagnosticModal] = React.useState<{
    connectorName: string;
    result: ProviderProfileCheckResult;
  } | null>(null);
  const autoRefreshAttempted = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    try {
      const [connectionsResponse, connectorsResponse] = await Promise.all([
        fetch("/api/credentials/connections"),
        fetch("/api/credentials/oauth-connectors"),
      ]);
      if (!connectionsResponse.ok || !connectorsResponse.ok) {
        throw new Error("Could not load provider connections");
      }
      setConnections(await parseApiResponse<ProviderConnection[]>(connectionsResponse));
      setConnectors(await parseApiResponse<OAuthConnector[]>(connectorsResponse));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load provider connections");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "caipe.oauth.connection") return;
      void load();
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [load]);

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("caipe.oauth.connection");
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "caipe.oauth.connection") {
        void load();
      }
    });
    return () => channel.close();
  }, [load]);

  const handleProfileCheck = async (connector: OAuthConnector, connection: ProviderConnection) => {
    setProfileChecks((current) => ({
      ...current,
      [connection.id]: { loading: true },
    }));

    try {
      const response = await fetch(`/api/credentials/connections/${connection.id}/profile`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Profile check failed");
      }
      const result = await parseApiResponse<ProviderProfileCheckResult>(response);
      setProfileChecks((current) => ({
        ...current,
        [connection.id]: { loading: false, result },
      }));
      setDiagnosticModal({
        connectorName: profileProviderLabel(connector.provider, connector.name),
        result,
      });
    } catch (err) {
      setProfileChecks((current) => ({
        ...current,
        [connection.id]: {
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : `${connector.name} profile check failed`,
        },
      }));
    }
  };

  const refreshConnection = React.useCallback(async (connection: ProviderConnection) => {
    setAutoRefreshStates((current) => ({
      ...current,
      [connection.id]: { loading: true },
    }));

    try {
      const response = await fetch(`/api/credentials/connections/${connection.id}/refresh`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Automatic refresh failed");
      }
      const result = await parseApiResponse<ProviderConnectionRefreshResult>(response);
      const refreshedAt = new Date();
      setConnections((current) =>
        current.map((candidate) =>
          candidate.id === connection.id
            ? {
                ...candidate,
                status: "connected",
                updatedAt: refreshedAt,
                expiresAt:
                  typeof result.expires_in === "number"
                    ? new Date(refreshedAt.getTime() + result.expires_in * 1000)
                    : candidate.expiresAt,
              }
            : candidate,
        ),
      );
      setAutoRefreshStates((current) => ({
        ...current,
        [connection.id]: { loading: false },
      }));
    } catch (err) {
      setAutoRefreshStates((current) => ({
        ...current,
        [connection.id]: {
          loading: false,
          error: err instanceof Error ? err.message : "Automatic refresh failed",
        },
      }));
    }
  }, []);

  const connectionForConnector = React.useMemo(() => {
    const byKey = new Map<string, ProviderConnection>();
    for (const connection of connections) {
      if (connection.connectorId) byKey.set(`id:${connection.connectorId}`, connection);
      byKey.set(`provider:${connection.provider}`, connection);
    }
    return byKey;
  }, [connections]);

  const connectionRows = React.useMemo(
    () =>
      connectors.map((connector) => ({
        connector,
        connection:
          connectionForConnector.get(`id:${connector.id}`) ??
          connectionForConnector.get(`provider:${connector.provider}`) ??
          null,
      })),
    [connectors, connectionForConnector],
  );

  React.useEffect(() => {
    for (const { connection } of connectionRows) {
      if (!connection || !needsAutoRefresh(connection)) continue;
      if (autoRefreshAttempted.current.has(connection.id)) continue;
      autoRefreshAttempted.current.add(connection.id);
      void refreshConnection(connection);
    }
  }, [connectionRows, refreshConnection]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">My Connections</h2>
        <p className="text-sm text-muted-foreground">
          OAuth provider connections available for impersonation-enabled MCP servers.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/80 shadow-xl shadow-black/10">
        {connectionRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed text-left">
              <thead className="bg-muted/40 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <tr>
                  <th className="w-[24%] px-5 py-4 font-semibold">Provider</th>
                  <th className="w-[14%] px-4 py-4 font-semibold">Token health</th>
                  <th className="w-[18%] px-4 py-4 font-semibold">Last successful</th>
                  <th className="w-[18%] px-4 py-4 font-semibold">Refresh status</th>
                  <th className="w-[12%] px-4 py-4 font-semibold">Status</th>
                  <th className="w-[14%] px-5 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {connectionRows.map(({ connector, connection }) => {
                  const connected = Boolean(connection);
                  const tokenHealth = describeTokenHealth(connection);
                  const profileCheck = connection ? profileChecks[connection.id] : undefined;
                  const autoRefreshState = connection ? autoRefreshStates[connection.id] : undefined;
                  const profileLabel = profileProviderLabel(connector.provider, connector.name);
                  return (
                    <tr key={connector.id} className="bg-card/60 transition-colors hover:bg-muted/30">
                      <td className="px-5 py-5 align-middle">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={cx(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-lg",
                              providerAccentClasses(connector.provider),
                            )}
                            aria-hidden="true"
                          >
                            {providerIconMark(connector.provider)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{connector.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{connector.provider}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-5 align-middle">
                        <StatusPill tone={healthTone(tokenHealth)}>{tokenHealth}</StatusPill>
                      </td>
                      <td className="px-4 py-5 align-middle text-sm text-muted-foreground">
                        {connected ? formatDateTime(connection?.connectedAt ?? connection?.updatedAt) : "Never connected"}
                      </td>
                      <td className="px-4 py-5 align-middle">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            {autoRefreshState?.loading
                              ? "refreshing"
                              : connected
                                ? connection?.status ?? "unknown"
                                : "No refresh yet"}
                          </p>
                          {connected && (
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(connection?.updatedAt)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-5 align-middle">
                        <StatusPill tone={connectionStatusTone(connection)}>
                          {connection?.status ?? "not connected"}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <div className="flex flex-col items-end gap-2">
                          {connection && (
                            <button
                              type="button"
                              className="w-full rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-200"
                              disabled={Boolean(profileCheck?.loading)}
                              onClick={() => void handleProfileCheck(connector, connection)}
                            >
                              {profileCheck?.loading
                                ? `Checking ${profileLabel} Profile`
                                : `Check ${profileLabel} Profile`}
                            </button>
                          )}
                          <a
                            className="w-full rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-2 text-center text-sm font-semibold text-white shadow-lg shadow-cyan-950/10 transition hover:from-teal-400 hover:to-cyan-400"
                            href={`/api/credentials/oauth/${connector.provider}/connect`}
                          >
                            {connected ? `Relink ${profileLabel}` : `Connect ${profileLabel}`}
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="space-y-2 border-t border-border/70 bg-muted/20 px-5 py-4">
              {connectionRows.map(({ connector, connection }) => {
                const profileCheck = connection ? profileChecks[connection.id] : undefined;
                const autoRefreshState = connection ? autoRefreshStates[connection.id] : undefined;
                const profileLabel = profileProviderLabel(connector.provider, connector.name);
                if (!profileCheck?.result && !profileCheck?.error && !autoRefreshState?.error) return null;
                return (
                  <div key={`${connector.id}-profile-check`}>
                    {autoRefreshState?.error && (
                      <p className="text-xs text-destructive">
                        {profileLabel} automatic refresh failed. Use Relink {profileLabel} to reconnect.
                      </p>
                    )}
                    {profileCheck?.result && (
                      <ProfileCheckResult
                        connectorName={profileLabel}
                        result={profileCheck.result}
                        onViewDetails={() =>
                          setDiagnosticModal({
                            connectorName: profileLabel,
                            result: profileCheck.result as ProviderProfileCheckResult,
                          })
                        }
                      />
                    )}
                    {profileCheck?.error && (
                      <p className="text-xs text-destructive">
                        {profileLabel} profile check failed: {profileCheck.error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : connections.length > 0 ? (
          <ul className="divide-y divide-border">
            {connections.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-4 p-4">
                <span className="font-medium">{connection.provider}</span>
                <span className="rounded bg-muted px-2 py-1 text-xs">{connection.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No provider connections yet.</p>
        )}
      </div>
      {diagnosticModal && (
        <TokenDiagnosticsModal
          connectorName={diagnosticModal.connectorName}
          result={diagnosticModal.result}
          onClose={() => setDiagnosticModal(null)}
        />
      )}
    </section>
  );
}

function ProfileCheckResult({
  connectorName,
  result,
  onViewDetails,
}: {
  connectorName: string;
  result: ProviderProfileCheckResult;
  onViewDetails?: () => void;
}) {
  const atlassianResourceSummary = summarizeAtlassianResources(result.accessible_resources);
  const summary =
    result.ok && atlassianResourceSummary
      ? `${connectorName} access check passed`
      : result.ok
        ? `${connectorName} profile check passed`
        : `${connectorName} profile check failed`;
  const details =
    result.ok && atlassianResourceSummary
      ? atlassianResourceSummary
      : result.ok
        ? summarizeProfile(result.profile)
        : result.message ?? "Provider did not accept the current token.";
  const warning =
    result.ok && result.profile_check?.ok === false && typeof result.profile_check.status === "number"
      ? `profile endpoint returned HTTP ${result.profile_check.status}`
      : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className={result.ok ? "text-xs font-medium text-emerald-700 dark:text-emerald-300" : "text-xs text-destructive"}>
        {summary}
        {details ? `: ${details}` : ""}
        {warning ? ` (${warning})` : ""}
      </p>
      {result.diagnostics?.length ? (
        <button
          type="button"
          className="rounded-full border border-cyan-400/40 px-2.5 py-1 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-400/10 dark:text-cyan-200"
          onClick={onViewDetails}
        >
          View details
        </button>
      ) : null}
    </div>
  );
}

function TokenDiagnosticsModal({
  connectorName,
  result,
  onClose,
}: {
  connectorName: string;
  result: ProviderProfileCheckResult;
  onClose: () => void;
}) {
  const diagnostics = result.diagnostics ?? [];
  const headingId = `token-diagnostics-${connectorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-title`;
  const overallTone = result.ok ? "good" : "danger";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-background shadow-2xl"
      >
        <div className="border-b border-border/70 bg-gradient-to-r from-slate-950 to-slate-800 px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Provider token validation
              </p>
              <h3 id={headingId} className="mt-1 text-xl font-semibold">
                {connectorName} token diagnostics
              </h3>
            </div>
            <button
              type="button"
              className="rounded-full border border-white/20 px-3 py-1 text-sm font-semibold text-white/90 transition hover:bg-white/10"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={overallTone}>{result.ok ? "token usable" : "action needed"}</StatusPill>
            {result.next_action && (
              <p className="text-sm text-muted-foreground">{result.next_action}</p>
            )}
          </div>
          <div className="space-y-3">
            {diagnostics.map((diagnostic) => (
              <div
                key={diagnostic.id}
                className="rounded-2xl border border-border/80 bg-card/70 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{diagnostic.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {diagnostic.detail}
                    </p>
                  </div>
                  <StatusPill tone={diagnosticStatusTone(diagnostic.status)}>
                    {diagnostic.status}
                  </StatusPill>
                </div>
                <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-sm text-foreground">
                  What to do: {diagnostic.action}
                </p>
              </div>
            ))}
          </div>
          {diagnostics.length === 0 && (
            <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              No detailed diagnostics were returned for this provider check.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function summarizeAtlassianResources(resources: Array<Record<string, unknown>> | undefined): string {
  if (!resources?.length) return "";
  const names = resources
    .map((resource) => resource.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  if (names.length > 0) return names.slice(0, 3).join(", ");
  const urls = resources
    .map((resource) => resource.url)
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  if (urls.length > 0) return urls.slice(0, 3).join(", ");
  return `${resources.length} accessible resource${resources.length === 1 ? "" : "s"}`;
}

function summarizeProfile(profile: Record<string, unknown> | undefined): string {
  if (!profile) return "";
  for (const key of ["login", "name", "email", "displayName", "userName", "account_id", "id"]) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  const emails = profile.emails;
  if (Array.isArray(emails) && typeof emails[0] === "string") return emails[0];
  return "";
}

function describeTokenHealth(connection: ProviderConnection | null): string {
  if (!connection) return "not linked";
  if (connection.status !== "connected") return "relink required";
  if (!connection.expiresAt) return "connected";
  const expiresAt = new Date(connection.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return "connected";
  if (expiresAt <= Date.now()) return "expired";
  if (expiresAt - Date.now() <= 15 * 60 * 1000) return "expiring soon";
  return "healthy";
}

function needsAutoRefresh(connection: ProviderConnection): boolean {
  if (connection.status !== "connected" || !connection.expiresAt) return false;
  const expiresAt = new Date(connection.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt <= Date.now() + 15 * 60 * 1000;
}

function providerAccentClasses(provider: string): string {
  switch (provider) {
    case "github":
      return "bg-gradient-to-br from-slate-800 to-slate-500 shadow-slate-950/20";
    case "atlassian":
      return "bg-gradient-to-br from-blue-600 to-sky-400 shadow-blue-950/20";
    case "webex":
      return "bg-gradient-to-br from-emerald-500 to-teal-400 shadow-emerald-950/20";
    default:
      return "bg-gradient-to-br from-violet-600 to-fuchsia-400 shadow-violet-950/20";
  }
}

function providerIconMark(provider: string): string {
  switch (provider) {
    case "github":
      return "GH";
    case "atlassian":
      return "A";
    case "webex":
      return "Wx";
    default:
      return "OAuth";
  }
}

function healthTone(health: string): "good" | "warning" | "danger" | "neutral" {
  switch (health) {
    case "healthy":
    case "connected":
      return "good";
    case "expiring soon":
    case "relink required":
      return "warning";
    case "expired":
      return "danger";
    default:
      return "neutral";
  }
}

function diagnosticStatusTone(status: TokenDiagnostic["status"]): "good" | "warning" | "danger" | "neutral" {
  if (status === "passed") return "good";
  if (status === "warning") return "warning";
  return "danger";
}

function connectionStatusTone(connection: ProviderConnection | null): "good" | "warning" | "danger" | "neutral" {
  if (!connection) return "neutral";
  if (connection.status === "connected") return "good";
  if (connection.status === "error" || connection.status === "failed") return "danger";
  return "warning";
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "warning" | "danger" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300"
        : tone === "danger"
          ? "border-rose-400/50 bg-rose-400/10 text-rose-700 dark:text-rose-300"
          : "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300";

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

function profileProviderLabel(provider: string, fallback: string): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "atlassian":
      return "Atlassian";
    case "webex":
      return "Webex";
    default:
      return fallback;
  }
}

function formatDateTime(value: string | Date | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

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

function oauthPopupFeatures(): string {
  return [
    "popup=yes",
    "width=640",
    "height=760",
    "resizable=yes",
    "scrollbars=yes",
    "noopener=yes",
  ].join(",");
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
    connector: OAuthConnector;
    connection: ProviderConnection;
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
      const nextConnections = await parseApiResponse<ProviderConnection[]>(connectionsResponse);
      const nextConnectors = await parseApiResponse<OAuthConnector[]>(connectorsResponse);
      setConnections(nextConnections);
      setConnectors((current) => {
        if (nextConnectors.length === 0 && current.length > 0) {
          return current;
        }
        return nextConnectors;
      });
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
        connector,
        connection,
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

  const handleOAuthConnect = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, connector: OAuthConnector) => {
      const url = `/api/credentials/oauth/${connector.provider}/connect`;
      event.preventDefault();
      const popup = window.open(url, `caipe-oauth-${connector.provider}`, oauthPopupFeatures());
      if (popup) {
        popup.focus?.();
      }
    },
    [],
  );

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
      <div className="overflow-hidden rounded-3xl border border-border/80 bg-card/85 shadow-2xl shadow-black/15 ring-1 ring-white/[0.03] backdrop-blur">
        {connectionRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] table-fixed text-left">
              <thead className="bg-gradient-to-r from-muted/55 via-muted/35 to-muted/55 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                <tr>
                  <th className="w-[24%] px-5 py-4 font-semibold">Provider</th>
                  <th className="w-[14%] px-4 py-4 font-semibold">Token health</th>
                  <th className="w-[18%] px-4 py-4 font-semibold">Last successful</th>
                  <th className="w-[16%] px-4 py-4 font-semibold">Refresh status</th>
                  <th className="w-[10%] px-4 py-4 font-semibold">Status</th>
                  <th className="w-[18%] px-5 py-4 text-right font-semibold">Actions</th>
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
                    <tr key={connector.id} className="bg-card/45 transition-colors hover:bg-muted/25">
                      <td className="px-5 py-5 align-middle">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={cx(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-lg ring-1 ring-white/10",
                              providerAccentClasses(connector.provider),
                            )}
                            role="img"
                            aria-label={`${profileLabel} logo`}
                          >
                            <ProviderLogo provider={connector.provider} />
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
                      <td className="px-4 py-5 align-middle text-sm text-muted-foreground/90">
                        {connected ? formatDateTime(connection?.connectedAt ?? connection?.updatedAt) : "Never connected"}
                      </td>
                      <td className="px-4 py-5 align-middle">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">
                            {autoRefreshState?.loading
                              ? "refreshing"
                              : connected
                                ? connection?.status ?? "unknown"
                                : "No refresh yet"}
                          </p>
                          {connected && (
                            <p className="text-xs text-muted-foreground/80">
                              {formatDateTime(connection?.updatedAt)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-5 align-middle">
                        <div className="flex items-center gap-2">
                          <ConnectionStatusMark connection={connection} providerLabel={profileLabel} />
                          {connection && (
                            <button
                              type="button"
                              className={cx(
                                "inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm ring-1 ring-white/[0.04] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100",
                                profileCheck?.result?.ok
                                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 hover:bg-emerald-400/20 dark:text-emerald-300"
                                  : profileCheck?.result || profileCheck?.error
                                    ? "border-amber-400/40 bg-amber-400/10 text-amber-700 hover:bg-amber-400/20 dark:text-amber-300"
                                    : "border-cyan-400/40 bg-cyan-400/10 text-cyan-700 hover:bg-cyan-400/20 dark:text-cyan-200",
                              )}
                              disabled={Boolean(profileCheck?.loading)}
                              aria-label={
                                profileCheck?.result
                                  ? `View ${profileLabel} profile check details`
                                  : `Test ${profileLabel} profile`
                              }
                              title={
                                profileCheck?.result
                                  ? `View ${profileLabel} profile check details`
                                  : `Test ${profileLabel} profile`
                              }
                              onClick={() => {
                                if (profileCheck?.result) {
                                  setDiagnosticModal({
                                    connector,
                                    connection,
                                    connectorName: profileLabel,
                                    result: profileCheck.result,
                                  });
                                  return;
                                }
                                void handleProfileCheck(connector, connection);
                              }}
                            >
                              {profileCheck?.loading ? (
                                <SpinnerIcon />
                              ) : profileCheck?.result?.ok ? (
                                <CheckCircleIcon />
                              ) : profileCheck?.result || profileCheck?.error ? (
                                <AlertCircleIcon />
                              ) : (
                                <LinkTestIcon />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <div className="flex justify-end">
                          <a
                            className="inline-flex min-w-[140px] items-center justify-center rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-lg shadow-cyan-950/20 transition hover:from-teal-400 hover:to-cyan-400 hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
                            href={`/api/credentials/oauth/${connector.provider}/connect`}
                            onClick={(event) => handleOAuthConnect(event, connector)}
                          >
                            <span className="truncate whitespace-nowrap">
                              {connected ? `Relink ${profileLabel}` : `Connect ${profileLabel}`}
                            </span>
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
                const tokenHealth = describeTokenHealth(connection);
                const isExpired = tokenHealth === "expired";
                if (!profileCheck?.result && !profileCheck?.error && !autoRefreshState?.error && !isExpired) return null;
                return (
                  <div key={`${connector.id}-profile-check`}>
                    {isExpired && (
                      <p className="text-xs font-medium text-rose-700 dark:text-rose-300">
                        {profileLabel} connection expired. Relink {profileLabel} to restore access.
                      </p>
                    )}
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
                            connector,
                            connection,
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
          onRunAgain={() => void handleProfileCheck(diagnosticModal.connector, diagnosticModal.connection)}
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
    result.ok
    && !atlassianResourceSummary
    && result.profile_check?.ok === false
    && typeof result.profile_check.status === "number"
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
  onRunAgain,
  onClose,
}: {
  connectorName: string;
  result: ProviderProfileCheckResult;
  onRunAgain: () => void;
  onClose: () => void;
}) {
  const rawDiagnostics = result.diagnostics ?? [];
  const hasActionableDiagnostic = rawDiagnostics.some(
    (diagnostic) => diagnostic.status !== "passed",
  );
  const diagnostics = rawDiagnostics.filter((diagnostic) => {
    if (diagnostic.id === "token_refresh") {
      return diagnostic.status !== "passed";
    }
    if (hasActionableDiagnostic && diagnostic.status === "passed" && diagnostic.action === "No action needed.") {
      return false;
    }
    return true;
  });
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
            {result.next_action && diagnostics.length === 0 && (
              <p className="text-sm text-muted-foreground">{result.next_action}</p>
            )}
            <button
              type="button"
              className="ml-auto rounded-full border border-cyan-400/40 px-3 py-1.5 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-400/10 dark:text-cyan-200"
              onClick={onRunAgain}
            >
              Run {connectorName} profile check again
            </button>
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
      return "bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 shadow-blue-950/30";
    case "webex":
      return "bg-gradient-to-br from-slate-950 via-cyan-950 to-teal-900 shadow-cyan-950/30";
    case "pagerduty":
      return "bg-gradient-to-br from-emerald-600 to-lime-500 shadow-emerald-950/20";
    case "gitlab":
      return "bg-gradient-to-br from-orange-500 to-amber-400 shadow-orange-950/20";
    default:
      return "bg-gradient-to-br from-violet-600 to-fuchsia-400 shadow-violet-950/20";
  }
}

function ProviderLogo({ provider }: { provider: string }) {
  switch (provider) {
    case "github":
      return (
        <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.2-.02-2.18-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.97 10.97 0 0 1 12 6.03c.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.79.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
      );
    case "atlassian":
      return (
        <img
          alt=""
          aria-hidden="true"
          className="h-7 w-7 object-contain"
          height={28}
          src="/provider-logos/atlassian.svg"
          width={28}
        />
      );
    case "webex":
      return (
        <img
          alt=""
          aria-hidden="true"
          className="h-7 w-7 object-contain"
          height={28}
          src="/provider-logos/webex.svg"
          width={28}
        />
      );
    case "pagerduty":
      return (
        <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5.25 2.25h7.65c3.66 0 6.45 2.68 6.45 6.22 0 3.62-2.79 6.32-6.45 6.32H9.64v6.96H5.25V2.25Zm7.17 8.76c1.52 0 2.55-1.02 2.55-2.48 0-1.42-1.03-2.41-2.55-2.41H9.64v4.89h2.78Z" />
        </svg>
      );
    case "gitlab":
      return (
        <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 21.15 3.95-12.17H8.05L12 21.15Z" opacity=".95" />
          <path d="M2.35 8.98 12 21.15 8.05 8.98H2.35Z" opacity=".72" />
          <path d="M21.65 8.98 12 21.15l3.95-12.17h5.7Z" opacity=".72" />
          <path d="M2.35 8.98 4.1 3.6c.18-.55.95-.55 1.13 0l2.82 5.38h-5.7ZM21.65 8.98 19.9 3.6c-.18-.55-.95-.55-1.13 0l-2.82 5.38h5.7Z" />
        </svg>
      );
    default:
      return <span aria-hidden="true" className="text-[10px] tracking-tight">OAuth</span>;
  }
}

function LinkTestIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <path d="M10 13.5a4 4 0 0 0 5.66 0l2.84-2.84A4 4 0 0 0 12.84 5L11.5 6.34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M14 10.5a4 4 0 0 0-5.66 0L5.5 13.34A4 4 0 0 0 11.16 19l1.34-1.34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="m17 17 3 3M20 17l-3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <path d="m8.5 12.2 2.25 2.25 4.9-5.1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

function AlertCircleIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.5v5.25M12 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
      <path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
  );
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

function ConnectionStatusMark({
  connection,
  providerLabel,
}: {
  connection: ProviderConnection | null;
  providerLabel: string;
}) {
  const status = connection?.status ?? "not connected";
  const tone = connectionStatusTone(connection);
  const className = cx(
    "inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm ring-1 ring-white/[0.04]",
    tone === "good" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
    tone === "warning" && "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300",
    tone === "danger" && "border-rose-400/40 bg-rose-400/10 text-rose-700 dark:text-rose-300",
    tone === "neutral" && "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  );

  return (
    <span
      className={className}
      role="img"
      aria-label={`${providerLabel} connection status ${status}`}
      title={`${providerLabel}: ${status}`}
    >
      {status === "connected" ? (
        <CheckCircleIcon />
      ) : tone === "danger" ? (
        <AlertCircleIcon />
      ) : (
        <LinkTestIcon />
      )}
    </span>
  );
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
        "inline-flex min-w-[82px] items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize shadow-sm",
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
    case "pagerduty":
      return "PagerDuty";
    case "gitlab":
      return "GitLab";
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

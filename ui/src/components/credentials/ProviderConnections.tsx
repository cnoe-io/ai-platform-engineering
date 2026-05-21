"use client";

import React from "react";

interface ProviderConnection {
  id: string;
  provider: string;
  status: string;
}

interface OAuthConnector {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

export function ProviderConnections() {
  const [connections, setConnections] = React.useState<ProviderConnection[]>([]);
  const [connectors, setConnectors] = React.useState<OAuthConnector[]>([]);
  const [error, setError] = React.useState<string | null>(null);

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

  const handleConnectClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    connector: OAuthConnector,
  ) => {
    const href = `/api/credentials/oauth/${connector.provider}/connect`;
    const popup = window.open(
      "",
      `caipe-oauth-${connector.provider}`,
      "popup=yes,width=720,height=820,menubar=no,toolbar=no,location=yes,status=no,scrollbars=yes,resizable=yes",
    );
    if (!popup) {
      return;
    }

    event.preventDefault();
    popup.opener = null;
    popup.location.href = href;
    popup.focus();
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">My Connections</h2>
        <p className="text-sm text-muted-foreground">
          OAuth provider connections available for impersonation-enabled MCP servers.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="rounded-lg border border-border bg-card">
        {connections.length > 0 ? (
          <ul className="divide-y divide-border">
            {connections.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-4 p-4">
                <span className="font-medium">{connection.provider}</span>
                <span className="rounded bg-muted px-2 py-1 text-xs">{connection.status}</span>
              </li>
            ))}
          </ul>
        ) : connectors.length > 0 ? (
          <ul className="divide-y divide-border">
            {connectors.map((connector) => (
              <li key={connector.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-medium">{connector.name}</p>
                  <p className="text-xs text-muted-foreground">{connector.provider}</p>
                </div>
                <a
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  href={`/api/credentials/oauth/${connector.provider}/connect`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => handleConnectClick(event, connector)}
                >
                  Connect {connector.name}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No provider connections yet.</p>
        )}
      </div>
    </section>
  );
}

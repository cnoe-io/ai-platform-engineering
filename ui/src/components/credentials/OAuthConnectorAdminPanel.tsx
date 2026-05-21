"use client";

import React from "react";

import { Button } from "@/components/ui/button";

interface OAuthConnectorMetadata {
  id: string;
  name: string;
  provider: string;
  clientId: string;
  clientSecretConfigured?: boolean;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

export function OAuthConnectorAdminPanel() {
  const [connectors, setConnectors] = React.useState<OAuthConnectorMetadata[]>([]);
  const [form, setForm] = React.useState({
    name: "",
    provider: "",
    clientId: "",
    clientSecret: "",
    authorizationUrl: "",
    tokenUrl: "",
    redirectUri: "",
  });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadConnectors = React.useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/admin/credentials/oauth-connectors");
      if (!response.ok) {
        throw new Error("Could not load OAuth connectors");
      }
      setConnectors(await parseApiResponse<OAuthConnectorMetadata[]>(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load OAuth connectors");
    }
  }, []);

  React.useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const updateForm = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch("/api/admin/credentials/oauth-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        scopes: ["offline_access"],
      }),
    });
    if (!response.ok) {
      setError("Could not save OAuth connector");
      return;
    }
    const connector = await parseApiResponse<OAuthConnectorMetadata>(response);
    setConnectors((current) => [...current, connector].sort((a, b) => a.name.localeCompare(b.name)));
    setForm({
      name: "",
      provider: "",
      clientId: "",
      clientSecret: "",
      authorizationUrl: "",
      tokenUrl: "",
      redirectUri: "",
    });
    setCreateOpen(false);
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Admin OAuth Connector Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Register standard OAuth 2.0 connectors. Client secrets are stored as encrypted
            credential payloads and are never shown here.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Add OAuth Provider
        </Button>
      </div>

      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add OAuth Provider"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-3xl rounded-lg border border-border bg-card p-5 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Add OAuth Provider</h2>
                <p className="text-sm text-muted-foreground">
                  Configure a standard authorization-code connector for user connections.
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-muted-foreground"
                onClick={() => setCreateOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Display name</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.name} onChange={updateForm("name")} required />
              </label>
              <label className="space-y-1 text-sm">
                <span>Provider</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.provider} onChange={updateForm("provider")} required />
              </label>
              <label className="space-y-1 text-sm">
                <span>Client ID</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.clientId} onChange={updateForm("clientId")} required />
              </label>
              <label className="space-y-1 text-sm">
                <span>Client secret</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.clientSecret} onChange={updateForm("clientSecret")} required type="password" />
              </label>
              <label className="space-y-1 text-sm">
                <span>Authorization URL</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.authorizationUrl} onChange={updateForm("authorizationUrl")} required />
              </label>
              <label className="space-y-1 text-sm">
                <span>Token URL</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.tokenUrl} onChange={updateForm("tokenUrl")} required />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span>Redirect URI</span>
                <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.redirectUri} onChange={updateForm("redirectUri")} required />
              </label>
            </div>
            <Button type="submit">Save Connector</Button>
          </form>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="rounded-lg border border-border bg-card">
        {connectors.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No OAuth connectors configured.</p>
        ) : (
          <ul className="divide-y divide-border">
            {connectors.map((connector) => (
              <li key={connector.id} className="p-4">
                <p className="font-medium">{connector.name}</p>
                <p className="text-xs text-muted-foreground">{connector.provider} / {connector.clientId}</p>
                <span className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs">
                  {connector.clientSecretConfigured ? "client secret configured" : "client secret missing"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

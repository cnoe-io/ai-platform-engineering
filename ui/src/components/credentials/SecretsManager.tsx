"use client";

import React from "react";

import { Button } from "@/components/ui/button";

import { SecretSharingPanel } from "./SecretSharingPanel";

interface SecretMetadata {
  id: string;
  name: string;
  type: string;
  maskedPreview: string;
  sharedWithTeams?: string[];
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

export function SecretsManager() {
  const [secrets, setSecrets] = React.useState<SecretMetadata[]>([]);
  const [name, setName] = React.useState("");
  const [secretValue, setSecretValue] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadSecrets = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/credentials/secrets");
      if (!response.ok) {
        throw new Error("Could not load secrets");
      }
      setSecrets(await parseApiResponse<SecretMetadata[]>(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load secrets");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/credentials/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        type: "bearer_token",
        value: secretValue,
      }),
    });

    if (!response.ok) {
      setError("Could not save secret");
      return;
    }

    const created = await parseApiResponse<SecretMetadata>(response);
    setSecrets((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
    setSecretValue("");
    setCreateOpen(false);
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">My Secrets</h2>
          <p className="text-sm text-muted-foreground">
            Store BYO credentials for Dynamic Agent MCP servers and internal services.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Add Secret
        </Button>
      </div>

      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add Secret"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleCreate}
            className="w-full max-w-2xl rounded-lg border border-border bg-card p-5 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Add Secret</h2>
                <p className="text-sm text-muted-foreground">
                  The value is sent once and stored as encrypted credential material.
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
                <span>Name</span>
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Secret value</span>
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={secretValue}
                  onChange={(event) => setSecretValue(event.target.value)}
                  required
                  type="password"
                />
              </label>
            </div>
            <Button type="submit">Save Secret</Button>
          </form>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading secrets...</p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          {secrets.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No secrets yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {secrets.map((secret) => (
                <li key={secret.id} className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">{secret.name}</p>
                      <p className="text-xs text-muted-foreground">{secret.type}</p>
                    </div>
                    <code className="rounded bg-muted px-2 py-1 text-xs">{secret.maskedPreview}</code>
                  </div>
                  <SecretSharingPanel
                    secretId={secret.id}
                    sharedWithTeams={secret.sharedWithTeams ?? []}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

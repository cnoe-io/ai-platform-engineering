"use client";

import React from "react";
import { Share2, Trash2, X } from "lucide-react";

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
  const [sharingSecretId, setSharingSecretId] = React.useState<string | null>(null);
  const [pendingDeleteSecretId, setPendingDeleteSecretId] = React.useState<string | null>(null);
  const [deletingSecretId, setDeletingSecretId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const sharingSecret = React.useMemo(
    () => secrets.find((secret) => secret.id === sharingSecretId) ?? null,
    [secrets, sharingSecretId],
  );

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

  const handleDelete = async (secret: SecretMetadata) => {
    setDeletingSecretId(secret.id);
    setError(null);
    try {
      const response = await fetch(`/api/credentials/secrets/${secret.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Could not delete secret");
      }
      setSecrets((current) => current.filter((item) => item.id !== secret.id));
      if (sharingSecretId === secret.id) {
        setSharingSecretId(null);
      }
      if (pendingDeleteSecretId === secret.id) {
        setPendingDeleteSecretId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete secret");
    } finally {
      setDeletingSecretId(null);
    }
  };

  const updateSecretSharing = (secretId: string, teamIds: string[]) => {
    setSecrets((current) =>
      current.map((secret) =>
        secret.id === secretId ? { ...secret, sharedWithTeams: teamIds } : secret,
      ),
    );
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
        <div className="overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm">
          {secrets.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No secrets yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {secrets.map((secret) => (
                <li key={secret.id} className="p-4 transition-colors hover:bg-muted/20">
                  <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{secret.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {secret.type}
                        {(secret.sharedWithTeams?.length ?? 0) > 0 && (
                          <span className="ml-2 rounded-full bg-teal-500/10 px-2 py-0.5 text-teal-300">
                            Shared with {secret.sharedWithTeams?.length} team
                            {secret.sharedWithTeams?.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </p>
                    </div>
                    <code className="w-fit rounded bg-muted px-2 py-1 text-xs">
                      {secret.maskedPreview}
                    </code>
                    <div className="flex items-center justify-end gap-1">
                      {pendingDeleteSecretId === secret.id ? (
                        <div className="flex items-center gap-2 rounded-full border border-destructive/20 bg-destructive/10 px-2 py-1">
                          <span className="text-xs font-medium text-destructive">
                            Delete {secret.name}?
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            disabled={deletingSecretId === secret.id}
                            onClick={() => setPendingDeleteSecretId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`Confirm delete ${secret.name}`}
                            className="h-7 bg-destructive px-2 text-xs text-destructive-foreground hover:bg-destructive/90"
                            disabled={deletingSecretId === secret.id}
                            onClick={() => void handleDelete(secret)}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Share ${secret.name}`}
                            title={`Share ${secret.name}`}
                            onClick={() => setSharingSecretId(secret.id)}
                          >
                            <Share2 className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${secret.name}`}
                            title={`Delete ${secret.name}`}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={deletingSecretId === secret.id}
                            onClick={() => setPendingDeleteSecretId(secret.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sharingSecret && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Share ${sharingSecret.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <div className="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-teal-300">
                  Team access
                </p>
                <h2 className="mt-1 text-lg font-semibold">Share {sharingSecret.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Grant a team access to this credential reference without exposing the secret value.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close sharing panel"
                onClick={() => setSharingSecretId(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="overflow-y-auto p-5">
              <SecretSharingPanel
                secretId={sharingSecret.id}
                sharedWithTeams={sharingSecret.sharedWithTeams ?? []}
                onSharingChange={(teamIds) => updateSecretSharing(sharingSecret.id, teamIds)}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

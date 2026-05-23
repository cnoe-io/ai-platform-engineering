"use client";

import React from "react";

import { Button } from "@/components/ui/button";

interface AdminSecretMetadata {
  id: string;
  name: string;
  type: string;
  owner: { type: string; id: string };
  maskedPreview: string;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

export function AdminSecretsManager() {
  const [secrets, setSecrets] = React.useState<AdminSecretMetadata[]>([]);
  const [editingSecret, setEditingSecret] = React.useState<AdminSecretMetadata | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const loadSecrets = React.useCallback(async () => {
    setError(null);
    const response = await fetch("/api/admin/credentials/secrets");
    if (!response.ok) {
      setError("Could not load global secrets");
      return;
    }
    setSecrets(await parseApiResponse<AdminSecretMetadata[]>(response));
  }, []);

  React.useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  async function deleteSecret(secretId: string) {
    const response = await fetch(`/api/admin/credentials/secrets/${secretId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Could not delete secret");
      return;
    }
    setSecrets((current) => current.filter((secret) => secret.id !== secretId));
  }

  function openEdit(secret: AdminSecretMetadata) {
    setEditingSecret(secret);
    setEditName(secret.name);
    setEditDescription("");
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSecret) return;
    const response = await fetch(`/api/admin/credentials/secrets/${editingSecret.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDescription }),
    });
    if (!response.ok) {
      setError("Could not update secret");
      return;
    }
    const updated = await parseApiResponse<AdminSecretMetadata>(response);
    setSecrets((current) => current.map((secret) => (secret.id === updated.id ? updated : secret)));
    setEditingSecret(null);
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Global Secrets Manager</h2>
        <p className="text-sm text-muted-foreground">
          Super-admin view of credential metadata across users and teams. Raw values are never displayed.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="rounded-lg border border-border bg-card">
        {secrets.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No secrets found.</p>
        ) : (
          <ul className="divide-y divide-border">
            {secrets.map((secret) => (
              <li key={secret.id} className="grid gap-3 p-4 md:grid-cols-[2fr_1.5fr_1fr_auto] md:items-center">
                <div>
                  <p className="font-medium">{secret.name}</p>
                  <p className="text-xs text-muted-foreground">{secret.type}</p>
                </div>
                <code className="rounded bg-muted px-2 py-1 text-xs">
                  {secret.owner.type}:{secret.owner.id}
                </code>
                <code className="rounded bg-muted px-2 py-1 text-xs">{secret.maskedPreview}</code>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(secret)}>
                    Edit
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => void deleteSecret(secret.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editingSecret && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit Secret"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={(event) => void saveEdit(event)}
            className="w-full max-w-xl rounded-lg border border-border bg-card p-5 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Edit Secret</h2>
                <p className="text-sm text-muted-foreground">
                  Update metadata only. Browser responses do not include credential material.
                </p>
              </div>
              <button type="button" className="text-sm text-muted-foreground" onClick={() => setEditingSecret(null)}>
                Close
              </button>
            </div>
            <label className="space-y-1 text-sm block">
              <span>Name</span>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                required
              />
            </label>
            <label className="space-y-1 text-sm block">
              <span>Description</span>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </label>
            <Button type="submit">Save Changes</Button>
          </form>
        </div>
      )}
    </section>
  );
}

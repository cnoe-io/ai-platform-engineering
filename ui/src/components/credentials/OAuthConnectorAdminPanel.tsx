"use client";

import React from "react";

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Button } from "@/components/ui/button";
import { BUILT_IN_OAUTH_CONNECTORS } from "@/lib/credentials/built-in-oauth-connectors";

interface OAuthConnectorMetadata {
  id: string;
  name: string;
  provider: string;
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  enabled?: boolean;
  authType?: "authorization_code" | "client_certificate";
  clientSecretConfigured?: boolean;
  certificateConfigured?: boolean;
  certificateThumbprint?: string;
  certificateExpiresAt?: string | Date;
  pkce?: boolean;
}

interface OAuthConnectorForm {
  name: string;
  provider: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  authType: "authorization_code" | "client_certificate";
  certificatePfx: string;
  certificateFileName: string;
  certificatePassword: string;
  certificateThumbprint: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string;
  redirectUri: string;
  pkce: boolean;
}

const EMPTY_CONNECTOR_FORM: OAuthConnectorForm = {
  name: "",
  provider: "",
  tenantId: "",
  clientId: "",
  clientSecret: "",
  authType: "authorization_code",
  certificatePfx: "",
  certificateFileName: "",
  certificatePassword: "",
  certificateThumbprint: "",
  authorizationUrl: "",
  tokenUrl: "",
  scopes: "",
  redirectUri: "",
  pkce: false,
};

function callbackUri(provider: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/credentials/oauth/${encodeURIComponent(provider)}/callback`;
}

const ENTRA_TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function applyTenantId(value: string, tenantId: string): string {
  return value.replaceAll("{tenantId}", tenantId || "{tenantId}");
}

function tenantIdFromAuthorizationUrl(provider: string, authorizationUrl: string): string {
  if (provider !== "sharepoint") return "";
  const match = authorizationUrl.match(
    /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/oauth2\/v2\.0\/authorize$/i,
  );
  return match && ENTRA_TENANT_ID_PATTERN.test(match[1]) ? match[1] : "";
}

function builtInConnectorForm(provider: string, tenantId = ""): OAuthConnectorForm | null {
  const descriptor = BUILT_IN_OAUTH_CONNECTORS.find(
    (candidate) => candidate.provider === provider,
  );
  if (!descriptor) return null;
  return {
    ...EMPTY_CONNECTOR_FORM,
    name: descriptor.name,
    provider: descriptor.provider,
    tenantId,
    authorizationUrl: applyTenantId(descriptor.authorizationUrl, tenantId),
    tokenUrl: applyTenantId(descriptor.tokenUrl, tenantId),
    scopes: descriptor.scopes.map((scope) => applyTenantId(scope, tenantId)).join(" "),
    redirectUri: callbackUri(descriptor.provider),
    authType: descriptor.authType ?? "authorization_code",
    pkce: descriptor.pkce === true,
  };
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

async function parseApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const json = (await response.json()) as { error?: unknown };
    if (typeof json.error === "string" && json.error.trim()) {
      return json.error;
    }
  } catch {
    // Preserve the fallback when an upstream proxy returns a non-JSON error.
  }
  return fallback;
}

export function OAuthConnectorAdminPanel({
  readOnly = false,
  initialProvider,
  initialTenantId,
}: {
  readOnly?: boolean;
  initialProvider?: string;
  initialTenantId?: string;
}) {
  const [connectors, setConnectors] = React.useState<OAuthConnectorMetadata[]>([]);
  const [connectorsLoaded, setConnectorsLoaded] = React.useState(false);
  const [form, setForm] = React.useState<OAuthConnectorForm>(EMPTY_CONNECTOR_FORM);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingConnector, setEditingConnector] = React.useState<OAuthConnectorMetadata | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const initialProviderHandled = React.useRef<string | null>(null);

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
    } finally {
      setConnectorsLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  React.useEffect(() => {
    if (
      !connectorsLoaded ||
      !initialProvider ||
      initialProviderHandled.current === initialProvider ||
      readOnly
    ) {
      return;
    }
    initialProviderHandled.current = initialProvider;

    const existing = connectors.find((connector) => connector.provider === initialProvider);
    if (existing) {
      setEditingConnector(existing);
      setForm({
        name: existing.name,
        provider: existing.provider,
        tenantId: tenantIdFromAuthorizationUrl(existing.provider, existing.authorizationUrl),
        clientId: existing.clientId,
        clientSecret: "",
        authType: existing.authType ?? "authorization_code",
        certificatePfx: "",
        certificateFileName: "",
        certificatePassword: "",
        certificateThumbprint: existing.certificateThumbprint ?? "",
        authorizationUrl: existing.authorizationUrl,
        tokenUrl: existing.tokenUrl,
        scopes: existing.scopes.join(" "),
        redirectUri: existing.redirectUri,
        pkce: existing.pkce ?? false,
      });
      setCreateOpen(true);
      return;
    }

    const template = builtInConnectorForm(initialProvider, initialTenantId);
    if (template) {
      setEditingConnector(null);
      setForm(template);
      setCreateOpen(true);
    }
  }, [connectors, connectorsLoaded, initialProvider, initialTenantId, readOnly]);

  const updateForm = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const applyBuiltInTemplate = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = event.target.value;
    if (!provider) {
      setForm(EMPTY_CONNECTOR_FORM);
      return;
    }
    const template = builtInConnectorForm(provider);
    if (!template) return;
    setForm((current) => ({
      ...template,
      clientId: current.clientId,
    }));
  };

  const handleCertificateFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      setForm((current) => ({
        ...current,
        certificatePfx: "",
        certificateFileName: "",
      }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("PFX certificate must be smaller than 2 MiB");
      event.target.value = "";
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    setForm((current) => ({
      ...current,
      certificatePfx: window.btoa(binary),
      certificateFileName: file.name,
    }));
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    const body = {
      name: form.name,
      provider: form.provider,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
      authType: form.authType,
      certificatePfx: form.certificatePfx,
      certificatePassword: form.certificatePassword,
      certificateThumbprint: form.certificateThumbprint,
      authorizationUrl: form.authorizationUrl,
      tokenUrl: form.tokenUrl,
      scopes: form.scopes
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
      redirectUri: form.redirectUri,
      pkce: form.pkce,
    };
    const url = editingConnector
      ? `/api/admin/credentials/oauth-connectors/${editingConnector.id}`
      : "/api/admin/credentials/oauth-connectors";
    const method = editingConnector ? "PUT" : "POST";
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await parseApiError(response, "Could not save OAuth connector"));
        return;
      }
      const connector = await parseApiResponse<OAuthConnectorMetadata>(response);
      if (editingConnector) {
        setConnectors((current) =>
          current.map((c) => (c.id === connector.id ? connector : c)).sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else {
        setConnectors((current) => [...current, connector].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setForm(EMPTY_CONNECTOR_FORM);
      setEditingConnector(null);
      setCreateOpen(false);
    } catch {
      setError("Could not save OAuth connector");
    }
  };

  const openCreateDialog = () => {
    setEditingConnector(null);
    setForm(EMPTY_CONNECTOR_FORM);
    setCreateOpen(true);
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setEditingConnector(null);
    setForm(EMPTY_CONNECTOR_FORM);
  };

  const handleEdit = (connector: OAuthConnectorMetadata) => {
    if (readOnly) return;
    setEditingConnector(connector);
    setForm({
      name: connector.name,
      provider: connector.provider,
      tenantId: tenantIdFromAuthorizationUrl(connector.provider, connector.authorizationUrl),
      clientId: connector.clientId,
      clientSecret: "",
      authType: connector.authType ?? "authorization_code",
      certificatePfx: "",
      certificateFileName: "",
      certificatePassword: "",
      certificateThumbprint: connector.certificateThumbprint ?? "",
      authorizationUrl: connector.authorizationUrl,
      tokenUrl: connector.tokenUrl,
      scopes: connector.scopes.join(" "),
      redirectUri: connector.redirectUri,
      pkce: connector.pkce ?? false,
    });
    setCreateOpen(true);
  };

  const handleDelete = async (connector: OAuthConnectorMetadata) => {
    if (readOnly) return;
    if (!confirm(`Delete "${connector.name}"? This will disable it and cannot be undone.`)) return;
    const response = await fetch(`/api/admin/credentials/oauth-connectors/${connector.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(`Could not delete ${connector.name}`);
      return;
    }
    setConnectors((current) => current.filter((c) => c.id !== connector.id));
  };

  const handleEnabledChange = async (connector: OAuthConnectorMetadata, enabled: boolean) => {
    if (readOnly) return;
    const response = await fetch(`/api/admin/credentials/oauth-connectors/${connector.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: enabled ? "enable" : "disable" }),
    });
    if (!response.ok) {
      setError(`Could not ${enabled ? "enable" : "disable"} ${connector.name}`);
      return;
    }
    setConnectors((current) =>
      current.map((candidate) =>
        candidate.id === connector.id ? { ...candidate, enabled } : candidate,
      ),
    );
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
        <Button type="button" onClick={openCreateDialog} disabled={readOnly}>
          Add OAuth Provider
        </Button>
      </div>

      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingConnector ? "Edit OAuth Provider" : "Add OAuth Provider"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-3xl rounded-lg border border-border bg-card p-5 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">{editingConnector ? "Edit OAuth Provider" : "Add OAuth Provider"}</h2>
                <p className="text-sm text-muted-foreground">
                  Configure a standard authorization-code connector for user connections.
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-muted-foreground"
                onClick={closeCreateDialog}
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span>Built-in template</span>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={
                    BUILT_IN_OAUTH_CONNECTORS.some(
                      (descriptor) => descriptor.provider === form.provider,
                    )
                      ? form.provider
                      : ""
                  }
                  onChange={applyBuiltInTemplate}
                >
                  <option value="">Custom OAuth provider</option>
                  {BUILT_IN_OAUTH_CONNECTORS.map((descriptor) => (
                    <option key={descriptor.provider} value={descriptor.provider}>
                      {descriptor.name}
                    </option>
                  ))}
                </select>
              </label>
              <>
                  <label className="space-y-1 text-sm">
                    <span>Display name</span>
                    <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.name} onChange={updateForm("name")} required />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Provider</span>
                    <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.provider} onChange={updateForm("provider")} required />
                  </label>
                  {form.provider === "sharepoint" && (
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span>Microsoft Entra tenant ID</span>
                      <input
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                        value={form.tenantId}
                        onChange={(event) => {
                          const tenantId = event.target.value.trim();
                          const template = builtInConnectorForm("sharepoint", tenantId);
                          if (!template) return;
                          setForm((current) => ({
                            ...template,
                            clientId: current.clientId,
                            certificatePfx: current.certificatePfx,
                            certificateFileName: current.certificateFileName,
                            certificatePassword: current.certificatePassword,
                            certificateThumbprint: current.certificateThumbprint,
                          }));
                        }}
                        pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                        placeholder="00000000-0000-4000-8000-000000000000"
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Work IQ endpoints and application scopes are tenant-specific.
                      </p>
                    </label>
                  )}
                  <label className="space-y-1 text-sm">
                    <span>Client ID</span>
                    <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.clientId} onChange={updateForm("clientId")} required />
                  </label>
                  {form.authType === "authorization_code" && !form.pkce && (
                    <label className="space-y-1 text-sm">
                      <span>Client secret</span>
                      <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.clientSecret} onChange={updateForm("clientSecret")} required type="password" />
                    </label>
                  )}
                  {form.authType === "client_certificate" && (
                    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4 md:col-span-2">
                      <div>
                        <p className="text-sm font-medium">Certificate OAuth</p>
                        <p className="text-xs text-muted-foreground">
                          Upload a password-protected PFX containing the app certificate and
                          private key. CAIPE encrypts both the PFX and password at rest.
                        </p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-1 text-sm">
                          <span>PFX certificate</span>
                          <input
                            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            type="file"
                            accept=".pfx,.p12,application/x-pkcs12"
                            onChange={(event) => void handleCertificateFile(event)}
                            required={!editingConnector?.certificateConfigured}
                          />
                          <p className="text-xs text-muted-foreground">
                            {form.certificateFileName ||
                              (editingConnector?.certificateConfigured
                                ? "A certificate is already stored; leave blank to keep it."
                                : "Maximum size: 2 MiB")}
                          </p>
                        </label>
                        <label className="space-y-1 text-sm">
                          <span>PFX password</span>
                          <input
                            className="w-full rounded-md border border-input bg-background px-3 py-2"
                            value={form.certificatePassword}
                            onChange={updateForm("certificatePassword")}
                            required={!editingConnector?.certificateConfigured || Boolean(form.certificatePfx)}
                            type="password"
                            autoComplete="new-password"
                          />
                        </label>
                        <label className="space-y-1 text-sm md:col-span-2">
                          <span>Expected certificate thumbprint</span>
                          <input
                            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono"
                            value={form.certificateThumbprint}
                            onChange={updateForm("certificateThumbprint")}
                            placeholder="40-character SHA-1 thumbprint from Microsoft Entra"
                            pattern="[0-9a-fA-F: ]{40,59}"
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            CAIPE calculates the uploaded certificate thumbprint and rejects a
                            mismatch before storing it.
                          </p>
                        </label>
                      </div>
                    </div>
                  )}
                  {form.authType === "authorization_code" && (
                    <>
                      <label className="flex items-center gap-2 text-sm md:col-span-2">
                        <input
                          type="checkbox"
                          checked={form.pkce}
                          onChange={(e) => setForm((current) => ({ ...current, pkce: e.target.checked, clientSecret: "" }))}
                        />
                        <span>Public client (PKCE only — no client secret)</span>
                      </label>
                      <label className="space-y-1 text-sm">
                        <span>Authorization URL</span>
                        <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.authorizationUrl} onChange={updateForm("authorizationUrl")} required />
                      </label>
                    </>
                  )}
                  <label className="space-y-1 text-sm">
                    <span>Token URL</span>
                    <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.tokenUrl} onChange={updateForm("tokenUrl")} required />
                  </label>
                  <label className="space-y-1 text-sm md:col-span-2">
                    <span>Scopes</span>
                    <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.scopes} onChange={updateForm("scopes")} placeholder="offline_access read_user" />
                  </label>
                  {form.authType === "authorization_code" && (
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span>Redirect URI</span>
                      <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={form.redirectUri} onChange={updateForm("redirectUri")} required />
                    </label>
                  )}
              </>
            </div>
            <SaveButton
              type="submit"
              saving={false}
              ariaLabel="Save connector"
              disabled={
                (form.provider === "sharepoint" &&
                  !ENTRA_TENANT_ID_PATTERN.test(form.tenantId)) ||
                (form.authType === "client_certificate" &&
                  !editingConnector?.certificateConfigured &&
                  (!form.certificatePfx || !form.certificatePassword))
              }
            />
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
              <li key={connector.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="font-medium">{connector.name}</p>
                  <p className="text-xs text-muted-foreground">{connector.provider} / {connector.clientId}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-block rounded bg-muted px-2 py-1 text-xs">
                      {connector.authType === "client_certificate"
                        ? connector.certificateConfigured
                          ? "certificate configured"
                          : "certificate missing"
                        : connector.pkce
                          ? "public client (PKCE)"
                          : connector.clientSecretConfigured
                            ? "client secret configured"
                            : "client secret missing"}
                    </span>
                    <span className="inline-block rounded bg-muted px-2 py-1 text-xs">
                      {connector.enabled === false ? "disabled" : "enabled"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${connector.name}`}
                    onClick={() => handleEdit(connector)}
                    disabled={readOnly}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${connector.enabled === false ? "Enable" : "Disable"} ${connector.name}`}
                    onClick={() => void handleEnabledChange(connector, connector.enabled === false)}
                    disabled={readOnly}
                  >
                    {connector.enabled === false ? "Enable" : "Disable"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${connector.name}`}
                    onClick={() => void handleDelete(connector)}
                    disabled={readOnly}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

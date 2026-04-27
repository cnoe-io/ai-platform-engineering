"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Settings,
  Loader2,
  AlertCircle,
  Trash2,
  Server,
  RefreshCw,
  Plus,
  Pencil,
  Lock,
  ShieldCheck,
  ShieldAlert,
  TestTube,
} from "lucide-react";
import type { ProviderDefinition } from "@/app/api/admin/llm-providers/route";

// Mirror of the MASKED_SECRET sentinel produced by @/lib/crypto. Hard-coded
// here because that module is server-only; any drift between the two breaks
// the "did the user edit this password?" check.
const MASKED = "••••••••";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderStatus {
  id: string;
  name: string;
  description: string;
  fields: ProviderDefinition["fields"];
  source: "env" | "db" | "both" | "none";
  enabled: boolean;
  configured_fields: Record<string, string>;
  env_configured: Record<string, boolean>;
  db_configured: Record<string, boolean>;
  updated_at: string | null;
  // Credential-test verdict from the last manual "Test" click. null = never
  // tested. Drives the "Authenticated" / "Test failed" badge.
  last_test_success: boolean | null;
  last_test_detail: string | null;
  last_tested_at: string | null;
}

interface LLMModel {
  model_id: string;
  name: string;
  provider: string;
  description: string;
  /** True when this row was seeded from config.yaml (IaC). When false, it was
   *  added via the UI (stored in MongoDB). Exactly one row per model_id
   *  exists — the list endpoint now returns the merged canonical set. */
  config_driven?: boolean;
}

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

/**
 * Right-side status pill. Three presentations:
 *
 *   last_test_success === true  → emerald "Connected" pill  (shield-check)
 *   last_test_success === false → red "Error" pill           (shield-alert)
 *   null / never tested         → nothing (neutral card; user hasn't verified yet)
 *
 * The pill title carries the most recent test detail so admins can hover
 * to see e.g. the Bedrock region + model count, or the AWS auth error,
 * without opening the Configure dialog.
 */
function ProviderStatusPill({ provider }: { provider: ProviderStatus }) {
  if (provider.source === "none") return null;
  if (provider.last_test_success === true) {
    return (
      <span
        title={provider.last_test_detail ?? "Connected"}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium"
      >
        <ShieldCheck className="h-3 w-3" />
        Connected
      </span>
    );
  }
  if (provider.last_test_success === false) {
    return (
      <span
        title={provider.last_test_detail ?? "Error"}
        className="inline-flex items-center gap-1 rounded-full border border-destructive/60 text-destructive bg-destructive/10 px-2 py-0.5 text-xs font-medium"
      >
        <ShieldAlert className="h-3 w-3" />
        Error
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider editor dialog
// ---------------------------------------------------------------------------

interface EditorDialogProps {
  provider: ProviderStatus | null;
  onClose: () => void;
  onSaved: () => void;
}

function ProviderEditorDialog({ provider, onClose, onSaved }: EditorDialogProps) {
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Inline verdict from the most recent Test click inside this dialog.
  // Distinct from `error` (which is for save/connectivity errors) so we can
  // show a green success banner alongside field edits.
  const [testResult, setTestResult] = React.useState<{ success: boolean; detail: string } | null>(null);

  React.useEffect(() => {
    if (provider) {
      // Pre-fill with existing masked values so non-secret fields show correctly
      const initial: Record<string, string> = {};
      for (const f of provider.fields) {
        initial[f.id] = provider.configured_fields[f.id] ?? "";
      }
      setFieldValues(initial);
      setError(null);
      setTestResult(null);
    }
  }, [provider]);

  if (!provider) return null;

  /** Build the fields dict to submit — strips env-locked entries and fields
   *  still showing the mask sentinel (meaning unchanged from stored). */
  const buildSubmittable = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [id, val] of Object.entries(fieldValues)) {
      if (provider.env_configured[id]) continue;
      if (!val || val === MASKED) continue;
      out[id] = val;
    }
    return out;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // Send the in-dialog (possibly unsaved) values in `fields`. The server
      // layers them on top of DB values, with env always winning. This lets
      // admins validate credentials BEFORE committing them.
      const res = await fetch("/api/admin/llm-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: provider.id,
          fields: buildSubmittable(),
        }),
      });
      const data = await res.json();
      setTestResult({ success: !!data.success, detail: data.detail ?? JSON.stringify(data).slice(0, 300) });
    } catch (e: any) {
      setTestResult({ success: false, detail: e?.message ?? "Test request failed." });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    try {
      // Only submit fields the admin can actually influence — env-locked fields
      // are ignored at runtime anyway, and sending them would create confusing
      // "DB has a value that's never read" state. The PUT endpoint treats a
      // missing field as "no change" (existing DB value preserved), which is
      // what we want.
      const submittable = buildSubmittable();

      const res = await fetch("/api/admin/llm-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: provider.id, fields: submittable }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");

      // After a successful save, run a verification test against the just-
      // saved values. This persists last_test_* on the provider doc and the
      // parent list refresh then shows the correct status icon. If the test
      // fails we keep the saved state but leave the dialog open with the
      // failure so the admin can correct without losing their edits.
      try {
        const testRes = await fetch("/api/admin/llm-providers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider_id: provider.id }),
        });
        const testData = await testRes.json();
        setTestResult({
          success: !!testData.success,
          detail: testData.detail ?? "Saved.",
        });
        if (testData.success) {
          onSaved();
          onClose();
          return;
        }
        // Test failed after save — refresh the parent so the card shows the
        // failed verdict, but stay open so the admin can fix + retry.
        onSaved();
      } catch (e: any) {
        // Couldn't reach the test endpoint (network) — still consider save
        // successful and close; the card will show "Not tested".
        console.warn("[llm-test] post-save verification failed to run:", e?.message ?? e);
        onSaved();
        onClose();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${provider.name} configuration from database? Environment variables are unaffected.`)) return;
    setLoading(true);
    try {
      await fetch(`/api/admin/llm-providers?provider_id=${provider.id}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Precedence model: IaC (env vars) wins over DB. The UI's role is to
  // visualize the combined state and let admins "season" fields that IaC
  // didn't set — it must never pretend a save will override an env-locked
  // field, and it must never let us try (silently ignored saves are worse
  // than a disabled field the admin can see).
  const anyEnvField = provider.fields.some((f) => provider.env_configured[f.id]);

  return (
    <Dialog open={!!provider} onOpenChange={() => onClose()}>
      {/* Wider than the default form dialog so long Test-result messages
          (e.g. AWS SDK error traces, "getaddrinfo ENOTFOUND <long-host>")
          have room to wrap without pushing the input fields off-screen. */}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure {provider.name}</DialogTitle>
          <DialogDescription>
            Values are encrypted at rest. Leave a field blank to keep the existing value.
            {anyEnvField && (
              <span className="block mt-2 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-xs text-blue-700 dark:text-blue-300">
                <Lock className="inline h-3 w-3 mr-1 -mt-0.5" />
                Some fields are locked by environment variables (IaC). You can
                still fill in any field that doesn&apos;t have an <span className="font-mono">env</span> badge
                — those values will be read from the database at runtime. Env
                values always win; saves here never override them.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {provider.fields.map((field) => {
            const envLocked = !!provider.env_configured[field.id];
            const dbOnly = !!provider.db_configured[field.id] && !envLocked;
            return (
              <div key={field.id} className="space-y-1.5">
                <Label htmlFor={field.id} className="text-sm flex items-center">
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                  {envLocked && (
                    <Badge
                      variant="outline"
                      title={`Overridden by ${field.envVar}; this form cannot change it. Update your deployment environment.`}
                      className="ml-2 text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400 gap-1"
                    >
                      <Lock className="h-2.5 w-2.5" />
                      env
                    </Badge>
                  )}
                  {dbOnly && (
                    <Badge variant="outline" className="ml-2 text-[10px] border-emerald-500/40 text-emerald-500">
                      saved
                    </Badge>
                  )}
                </Label>
                <Input
                  id={field.id}
                  type={field.type === "password" ? "password" : "text"}
                  placeholder={
                    envLocked
                      ? `Set via ${field.envVar}; locked by IaC`
                      : dbOnly
                      ? "Already set (leave blank to keep)"
                      : field.placeholder ?? ""
                  }
                  value={
                    envLocked && field.showEnvValue
                      ? provider.configured_fields[field.id] ?? ""
                      : fieldValues[field.id] ?? ""
                  }
                  onChange={(e) =>
                    setFieldValues((v) => ({ ...v, [field.id]: e.target.value }))
                  }
                  disabled={loading || envLocked}
                  className="font-mono text-sm"
                  autoComplete="off"
                />
              </div>
            );
          })}

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Inline Test result. Success is emerald, failure is destructive.
              Kept visible after Save so the admin sees the verification
              verdict before (or if) the dialog closes. */}
          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                testResult.success
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {testResult.success ? (
                <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              {/* min-w-0 lets the span shrink inside the flex row so long
                  tokens don't overflow; break-all catches hostnames /
                  error blobs with no natural break points. */}
              <span className="min-w-0 flex-1 break-all">{testResult.detail}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div>
            {provider.source !== "none" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive gap-1"
                onClick={handleDelete}
                disabled={loading || testing}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove DB config
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={loading || testing}
              title="Verify these credentials against the provider without saving"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <TestTube className="h-4 w-4 mr-1" />}
              Test
            </Button>
            <Button variant="outline" onClick={onClose} disabled={loading || testing}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading || testing}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save &amp; verify
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Custom model add/edit dialog
// ---------------------------------------------------------------------------

interface CustomModelDialogProps {
  model: Partial<LLMModel> | null; // null = closed
  providers: ProviderStatus[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Fetched live from /api/admin/llm-providers/:id/models. `id` is what the
 * provider actually accepts as `model_id`; `name` is a display hint only.
 */
interface ProviderModelOption {
  id: string;
  name?: string;
  source?: 'foundation' | 'profile' | 'api';
}

function CustomModelDialog({ model, providers, onClose, onSaved }: CustomModelDialogProps) {
  // Editing an existing row only makes sense for custom (UI-added) models.
  // config_driven rows are IaC and not editable from the UI.
  const isEdit = model?.config_driven === false && !!model.model_id;

  // Field order in state mirrors the new UI order: provider → model → name → description.
  const [provider, setProvider] = React.useState(model?.provider ?? "");
  const [modelId, setModelId] = React.useState(model?.model_id ?? "");
  const [name, setName] = React.useState(model?.name ?? "");
  const [description, setDescription] = React.useState(model?.description ?? "");
  // Tracks whether the Display Name was auto-populated (vs manually typed).
  // Auto-populated names are replaced when a new model is selected; user-typed
  // names are left alone so edits are never silently discarded.
  const nameAutoFilled = React.useRef(false);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Live model list from the selected provider's API (e.g. Bedrock
  // ListFoundationModels + ListInferenceProfiles, OpenAI /v1/models).
  // null = not fetched yet, [] = fetched but empty or failed.
  const [availableModels, setAvailableModels] = React.useState<ProviderModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);

  // Only providers that actually have credentials configured are offered.
  // IaC-only, DB-only, or Env+DB all count — "none" means no way to test.
  const configuredProviders = React.useMemo(
    () => providers.filter((p) => p.source !== "none"),
    [providers],
  );

  React.useEffect(() => {
    if (model) {
      // Don't pre-select a provider when creating a new custom model — force
      // the admin to make an explicit choice. Only respect the pre-existing
      // provider when EDITING an existing row.
      setProvider(model.provider ?? "");
      setModelId(model.model_id ?? "");
      setName(model.name ?? "");
      setDescription(model.description ?? "");
      setError(null);
      setAvailableModels(null);
      setModelsError(null);
    }
  }, [model]);

  // Fetch the provider's model list whenever `provider` changes. For offline
  // editing or providers that haven't implemented listing yet we just clear
  // the list — the user can still type a model_id manually.
  React.useEffect(() => {
    if (!provider) {
      setAvailableModels(null);
      setModelsError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingModels(true);
      setModelsError(null);
      try {
        const res = await fetch(`/api/admin/llm-providers/${encodeURIComponent(provider)}/models`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success && Array.isArray(data.models)) {
          setAvailableModels(data.models);
        } else {
          setAvailableModels([]);
          setModelsError(data.error || `Couldn't list models (HTTP ${res.status})`);
        }
      } catch (e: any) {
        if (!cancelled) {
          setAvailableModels([]);
          setModelsError(e?.message ?? "Network error listing models.");
        }
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  if (!model) return null;

  // Is the current modelId in the live list? Used to warn users who've typed
  // a string that the provider doesn't recognize BEFORE they save it.
  const modelInList = !!(
    availableModels &&
    modelId &&
    availableModels.some((m) => m.id === modelId)
  );
  const canShowListHint = !!availableModels && !loadingModels;

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      // Verify the model is reachable from the provider before persisting —
      // catches typos and stale IDs that would otherwise only surface on the
      // first chat message. Non-blocking: the admin can still save if they
      // confirm they want to proceed with an unrecognized ID.
      if (availableModels && modelId && !modelInList) {
        const proceed = window.confirm(
          `The model ID "${modelId}" wasn't found on the selected provider.\n\n` +
            `Save anyway? (Chat will fail at runtime if the provider doesn't actually accept this ID.)`,
        );
        if (!proceed) {
          setLoading(false);
          return;
        }
      }

      const res = await fetch("/api/admin/custom-models", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, name, provider, description }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove custom model "${modelId}"?`)) return;
    setLoading(true);
    try {
      await fetch(`/api/admin/custom-models?model_id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!model} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Custom Model" : "Add Custom Model"}</DialogTitle>
          <DialogDescription>
            Custom models extend the config.yaml list. They are stored in MongoDB and merged at runtime.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Provider — pinned to the top since every other field depends on it.
              Only providers with credentials configured are shown; that's the
              set where the Model-ID combobox can actually be backed by a live
              list. */}
          <div className="space-y-1.5">
            <Label htmlFor="cm-provider" className="text-sm">
              Provider <span className="text-destructive">*</span>
            </Label>
            <select
              id="cm-provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                // Clear modelId and auto-filled name so the user re-selects from the new provider's list.
                if (!isEdit) {
                  setModelId("");
                  if (nameAutoFilled.current) {
                    setName("");
                    nameAutoFilled.current = false;
                  }
                }
              }}
              disabled={loading || isEdit}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm disabled:opacity-60"
            >
              {/* The placeholder option is disabled and hidden from the open
                  dropdown so it only appears as the "nothing is selected yet"
                  face of the control. No badges/checkmarks per-provider — the
                  provider card itself is where authentication state is shown. */}
              <option value="" disabled hidden>
                Select a configured provider…
              </option>
              {configuredProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {configuredProviders.length === 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                No providers are configured yet. Configure credentials on a provider card first.
              </p>
            )}
          </div>

          {/* Model ID — combobox backed by provider's live list via native
              datalist. Users can pick from the list OR type a non-standard ID
              (e.g. a private Azure deployment name). Unknown IDs trigger a
              confirm prompt on save. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cm-model-id" className="text-sm">
                Model ID <span className="text-destructive">*</span>
              </Label>
              {loadingModels && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading available models…
                </span>
              )}
              {canShowListHint && availableModels!.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {availableModels!.length} available
                </span>
              )}
            </div>
            <Input
              id="cm-model-id"
              value={modelId}
              onChange={(e) => {
                const newId = e.target.value;
                setModelId(newId);
                // Auto-populate Display Name from the provider's model list when:
                //  - the typed/selected ID exactly matches a known model with a name, AND
                //  - the user hasn't manually typed their own display name yet
                //    (nameAutoFilled tracks whether the current value came from us)
                if (availableModels) {
                  const match = availableModels.find((m) => m.id === newId);
                  if (match?.name && match.name !== match.id) {
                    if (!name || nameAutoFilled.current) {
                      setName(match.name);
                      nameAutoFilled.current = true;
                    }
                  } else if (nameAutoFilled.current) {
                    // Selected an entry without a useful name; clear our auto-fill
                    setName("");
                    nameAutoFilled.current = false;
                  }
                }
              }}
              list={provider ? `cm-models-${provider}` : undefined}
              placeholder={
                provider
                  ? "Select from the list or type a model ID"
                  : "Select a provider first"
              }
              disabled={loading || isEdit || !provider}
              className="font-mono text-sm"
              autoComplete="off"
            />
            {provider && availableModels && availableModels.length > 0 && (
              <datalist id={`cm-models-${provider}`}>
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name && m.name !== m.id ? `${m.name} — ${m.source ?? ""}` : m.source ?? ""}
                  </option>
                ))}
              </datalist>
            )}
            {modelsError && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Couldn&apos;t fetch model list from provider: {modelsError}. You can still type an ID manually.
              </p>
            )}
            {canShowListHint &&
              modelId &&
              (modelInList ? (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  ✓ Verified: the provider reports this model as available.
                </p>
              ) : (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  ⚠ &ldquo;{modelId}&rdquo; isn&apos;t in the provider&apos;s list. You can still save, but chat will fail at runtime if the provider doesn&apos;t accept this ID.
                </p>
              ))}
            <p className="text-[10px] text-muted-foreground">
              The model identifier passed to the LLM provider (e.g. Azure deployment name, Bedrock model ID or inference profile).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-name" className="text-sm">
              Display Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cm-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                // User is typing their own name — stop auto-filling on model change
                nameAutoFilled.current = false;
              }}
              placeholder="e.g. GPT-4o (Production)"
              disabled={loading}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-description" className="text-sm">Description</Label>
            <Input
              id="cm-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              disabled={loading}
              className="text-sm"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between">
          <div>
            {isEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive gap-1"
                onClick={handleDelete}
                disabled={loading}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading || !modelId || !name || !provider}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {isEdit ? "Save" : "Add Model"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function LLMProvidersTab() {
  const [providers, setProviders] = React.useState<ProviderStatus[]>([]);
  // Single merged list keyed by model_id. Each entry has config_driven set,
  // which decides the badge and whether edit/delete is offered.
  const [models, setModels] = React.useState<LLMModel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editingProvider, setEditingProvider] = React.useState<ProviderStatus | null>(null);
  const [customModelDialog, setCustomModelDialog] = React.useState<Partial<LLMModel> | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // /api/dynamic-agents/models now returns the full merged set with
      // config_driven flags. We don't need a second call to
      // /api/admin/custom-models — that's what was producing duplicate rows
      // (same model listed once as "config" and once as "custom"). Keeping
      // the endpoint available for other admin flows (create/update/delete)
      // but dropping it from the list read.
      const [provRes, modRes] = await Promise.all([
        fetch("/api/admin/llm-providers"),
        fetch("/api/dynamic-agents/models").catch(() => null),
      ]);

      const provData = await provRes.json();
      if (provData.success) {
        setProviders(provData.data.providers);
      } else {
        throw new Error(provData.error || "Failed to load providers");
      }

      if (modRes?.ok) {
        const modData = await modRes.json().catch(() => ({}));
        if (modData.success) {
          // Defensive: collapse any duplicates left over from an older backend
          // by keeping the first occurrence per model_id. Stable because
          // the server already sorts by name.
          const seen = new Set<string>();
          const unique = (modData.data || []).filter((m: LLMModel) => {
            if (seen.has(m.model_id)) return false;
            seen.add(m.model_id);
            return true;
          });
          setModels(unique);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const configuredCount = providers.filter((p) => p.source !== "none").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">LLM Providers</h2>
          <p className="text-sm text-muted-foreground">
            Configure API keys for model providers.{" "}
            {configuredCount > 0
              ? `${configuredCount} of ${providers.length} configured.`
              : "No providers configured yet."}{" "}
            Environment variables take precedence over DB values.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((provider) => (
          <Card
            key={provider.id}
            className={`transition-colors ${
              provider.last_test_success === true
                ? "border-emerald-500/40 bg-emerald-500/5"
                : provider.last_test_success === false
                ? "border-destructive/50 bg-destructive/5"
                : ""
            }`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Generic provider icon — status lives in the pill on the
                      right and the card border color. */}
                  <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <CardTitle className="text-sm">{provider.name}</CardTitle>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ProviderStatusPill provider={provider} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Configure credentials (test available inside)"
                    onClick={() => setEditingProvider(provider)}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <CardDescription className="text-xs mt-1">
                {provider.description}
              </CardDescription>
            </CardHeader>

            {/* Single status line under the description — either the "Tested"
                timestamp on success (emerald) or the error detail on failure
                (red). No "DB updated" row; pill + border already convey state. */}
            {provider.last_tested_at && provider.last_test_success === true && (
              <CardContent className="pt-0">
                <p
                  className="text-xs text-emerald-700 dark:text-emerald-400 break-words"
                  title={provider.last_test_detail ?? undefined}
                >
                  ✓ Tested {new Date(provider.last_tested_at).toLocaleString()}
                  {provider.last_test_detail && (
                    <span className="text-muted-foreground"> — {provider.last_test_detail}</span>
                  )}
                </p>
              </CardContent>
            )}
            {provider.last_tested_at && provider.last_test_success === false && (
              <CardContent className="pt-0">
                {/* Failure reason is intentionally not inlined on the card —
                    it's available via the pill tooltip (hover) and in full
                    inside the Configure dialog's Test result. Keeping the
                    card clean avoids leaking things like provider hostnames
                    or stack snippets to passive viewers. */}
                <p
                  className="text-xs text-destructive"
                  title={provider.last_test_detail ?? undefined}
                >
                  ✗ Failed {new Date(provider.last_tested_at).toLocaleString()}
                </p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Available models list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Available Models</h2>
            <p className="text-sm text-muted-foreground">
              Models from configuration file, plus any custom models added below.
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5"
            onClick={() => setCustomModelDialog({})}>
            <Plus className="h-3.5 w-3.5" />
            Add Model
          </Button>
        </div>

        {models.length > 0 && (
          <div className="rounded-lg border divide-y">
            {models.map((model) => {
              const providerConfigured =
                providers.find((p) => p.id === model.provider)?.source !== "none";
              const isCustom = model.config_driven === false;
              return (
                <div
                  key={model.model_id}
                  className={`flex items-center justify-between px-4 py-2.5 text-sm ${isCustom ? "bg-purple-500/5" : ""}`}
                >
                  <div className="min-w-0">
                    <span className="font-medium">{model.name}</span>
                    {model.description && (
                      <span className="text-muted-foreground ml-2 text-xs">{model.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <span className="text-xs text-muted-foreground font-mono">{model.model_id}</span>
                    {isCustom ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400"
                      >
                        custom
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        config
                      </Badge>
                    )}
                    {providerConfigured ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      >
                        ready
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        needs key
                      </Badge>
                    )}
                    {isCustom && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setCustomModelDialog(model)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {models.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No models loaded. Start the dynamic agents backend or add a custom model.
          </p>
        )}
      </div>

      {/* Provider editor dialog */}
      <ProviderEditorDialog
        provider={editingProvider}
        onClose={() => setEditingProvider(null)}
        onSaved={load}
      />

      {/* Custom model add/edit dialog */}
      <CustomModelDialog
        model={customModelDialog}
        providers={providers}
        onClose={() => setCustomModelDialog(null)}
        onSaved={load}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, Save, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CUSTOM_MODEL_VALUE, MODEL_CATALOG, isCatalogModel } from "@/lib/tome/model-catalog";

export const MODEL_ROLES = [
  { role: "ingest", label: "Ingest", description: "Runs an ingest pass over source material." },
  { role: "chat", label: "Chat", description: "Answers questions and edits wiki pages." },
  { role: "synthesize", label: "Synthesize", description: "Rolls up child entity wikis." },
  { role: "compact", label: "Compact", description: "Tightens prose and fixes stale links." },
  { role: "presentation", label: "Presentation", description: "Generates and revises wiki-grounded slide decks." },
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number]["role"];

export interface ModelConfigView {
  role: ModelRole;
  model: string;
  version: number;
  tested_at: string;
  updated_at: string;
  updated_by: string | null;
}

type TestResult = { model: string; ok: true } | { model: string; ok: false; error: string };

const SCOPES = [
  { key: "global", label: "Global default", scope_kind: "global", scope_id: "" },
  { key: "project", label: "Project defaults", scope_kind: "type", scope_id: "project" },
  { key: "area", label: "Area defaults", scope_kind: "type", scope_id: "area" },
  { key: "bhag", label: "BHAG defaults", scope_kind: "type", scope_id: "bhag" },
] as const;

export function ModelConfigTab() {
  const { toast } = useToast();
  const [scopeKey, setScopeKey] = useState<(typeof SCOPES)[number]["key"]>("global");
  const scope = useMemo(() => SCOPES.find((item) => item.key === scopeKey) ?? SCOPES[0], [scopeKey]);
  const [docs, setDocs] = useState<Partial<Record<ModelRole, ModelConfigView>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<ModelRole, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ModelRole | null>(null);
  const [testingRole, setTestingRole] = useState<ModelRole | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<ModelRole, TestResult>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setTestResults({});
    try {
      const query = new URLSearchParams({ scope_kind: scope.scope_kind });
      if (scope.scope_id) query.set("scope_id", scope.scope_id);
      const response = await fetch(`/api/tome/model-config?${query}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load model config");
      const nextDocs: Partial<Record<ModelRole, ModelConfigView>> = {};
      const nextDrafts: Partial<Record<ModelRole, string>> = {};
      for (const doc of body.models as ModelConfigView[]) {
        nextDocs[doc.role] = doc;
        nextDrafts[doc.role] = doc.model;
      }
      setDocs(nextDocs);
      setDrafts(nextDrafts);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load model config", "error");
    } finally {
      setLoading(false);
    }
  }, [scope, toast]);

  useEffect(() => void load(), [load]);

  const setDraft = (role: ModelRole, model: string) => {
    setDrafts((current) => ({ ...current, [role]: model }));
    setTestResults((current) => ({ ...current, [role]: undefined }));
  };

  const test = async (role: ModelRole) => {
    const model = drafts[role]?.trim() ?? "";
    if (!model) return;
    setTestingRole(role);
    setTestResults((current) => ({ ...current, [role]: undefined }));
    try {
      const response = await fetch("/api/tome/model-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = await response.json();
      setTestResults((current) => ({
        ...current,
        [role]: response.ok && body.ok
          ? { model, ok: true }
          : { model, ok: false, error: body.error ?? "Test failed" },
      }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [role]: { model, ok: false, error: error instanceof Error ? error.message : "Test failed" },
      }));
    } finally {
      setTestingRole(null);
    }
  };

  const save = async (role: ModelRole) => {
    const model = drafts[role]?.trim() ?? "";
    const result = testResults[role];
    if (!result?.ok || result.model !== model) {
      toast("Test this exact model before saving.", "error");
      return;
    }
    setBusy(role);
    try {
      const response = await fetch(`/api/tome/model-config/${role}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, scope_kind: scope.scope_kind, scope_id: scope.scope_id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save model");
      setDocs((current) => ({ ...current, [role]: body.config }));
      setDrafts((current) => ({ ...current, [role]: body.config.model }));
      toast(`${scope.label} ${role} model updated`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to save model", "error");
    } finally {
      setBusy(null);
    }
  };

  const reset = async (role: ModelRole) => {
    setBusy(role);
    try {
      const response = await fetch(`/api/tome/model-config/${role}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_kind: scope.scope_kind, scope_id: scope.scope_id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to clear model override");
      setDocs((current) => ({ ...current, [role]: undefined }));
      setDrafts((current) => ({ ...current, [role]: "" }));
      setTestResults((current) => ({ ...current, [role]: undefined }));
      toast(`${scope.label} ${role} override cleared`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to clear model override", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Configure global and entity-type defaults. Exact Project, Area, and BHAG overrides live in
          that entity&apos;s Settings. Resolution is exact → type → global → environment → built-in.
        </p>
        <label className="block max-w-sm text-xs font-medium text-muted-foreground">
          Configuration scope
          <select
            value={scopeKey}
            onChange={(event) => setScopeKey(event.target.value as typeof scopeKey)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            {SCOPES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading model config…</p> : (
        <div className="space-y-3">
          {MODEL_ROLES.map(({ role, label, description }) => {
            const draft = drafts[role] ?? "";
            const doc = docs[role];
            const isCustom = draft === CUSTOM_MODEL_VALUE || (Boolean(draft) && !isCatalogModel(draft));
            const modelValue = draft === CUSTOM_MODEL_VALUE ? "" : draft;
            const result = testResults[role];
            const tested = result?.ok === true && result.model === modelValue.trim();
            const dirty = modelValue.trim() !== (doc?.model ?? "");
            return (
              <div key={role} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="font-medium">{label}</h3>
                  {doc?.updated_by && <span className="text-xs text-muted-foreground">Last edited by {doc.updated_by}</span>}
                </div>
                <p className="mb-3 text-xs text-muted-foreground">{description}</p>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={!draft ? "" : isCustom ? CUSTOM_MODEL_VALUE : draft}
                      onChange={(event) => setDraft(role, event.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Unset (inherit next level)</option>
                      {MODEL_CATALOG.map((id) => <option key={id} value={id}>{id}</option>)}
                      <option value={CUSTOM_MODEL_VALUE}>Custom…</option>
                    </select>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => void test(role)} disabled={!modelValue.trim() || testingRole === role} className="gap-2">
                        {testingRole === role ? <Loader2 className="h-4 w-4 animate-spin" /> : result?.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : result && !result.ok ? <XCircle className="h-4 w-4 text-destructive" /> : null}
                        Test
                      </Button>
                      <Button size="sm" onClick={() => void save(role)} disabled={!dirty || !tested || busy === role} className="gap-2">
                        <Save className="h-4 w-4" /> Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void reset(role)} disabled={!doc || busy === role} className="gap-2">
                        <RotateCcw className="h-4 w-4" /> Clear
                      </Button>
                    </div>
                  </div>
                  {isCustom && <Input value={modelValue} onChange={(event) => setDraft(role, event.target.value)} placeholder="provider/model-id" className="font-mono text-sm" />}
                  {result && !result.ok && "error" in result && <p className="text-xs text-destructive">{result.error}</p>}
                  {tested && <p className="text-xs text-emerald-600">Model responded successfully. Save is enabled.</p>}
                  {!doc && !draft && <p className="text-xs text-muted-foreground">No value at this scope; the next resolution level will be used.</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

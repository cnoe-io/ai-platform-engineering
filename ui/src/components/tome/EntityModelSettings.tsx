"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, Save, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { MODEL_ROLES, type ModelConfigView, type ModelRole } from "@/components/tome/admin/ModelConfigTab";
import { CUSTOM_MODEL_VALUE, MODEL_CATALOG, isCatalogModel } from "@/lib/tome/model-catalog";
import type { ProjectType } from "@/types/projects";

interface ResolvedModelView {
  role: ModelRole;
  model: string;
  source: "exact" | "type" | "global";
  config_version: number;
}

type TestResult = { model: string; ok: true } | { model: string; ok: false; error: string };

export function EntityModelSettings({
  slug,
  entityType,
  canEdit,
}: {
  slug: string;
  entityType: ProjectType;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<Partial<Record<ModelRole, ModelConfigView>>>({});
  const [resolved, setResolved] = useState<Partial<Record<ModelRole, ResolvedModelView>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<ModelRole, string>>>({});
  const [results, setResults] = useState<Partial<Record<ModelRole, TestResult>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ModelRole | null>(null);

  const endpoint = `/api/tome/projects/${encodeURIComponent(slug)}/model-config`;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load model settings");
      const nextConfigs: Partial<Record<ModelRole, ModelConfigView>> = {};
      const nextResolved: Partial<Record<ModelRole, ResolvedModelView>> = {};
      const nextDrafts: Partial<Record<ModelRole, string>> = {};
      for (const config of body.configs as ModelConfigView[]) {
        nextConfigs[config.role] = config;
        nextDrafts[config.role] = config.model;
      }
      for (const value of body.resolved as ResolvedModelView[]) nextResolved[value.role] = value;
      setConfigs(nextConfigs);
      setResolved(nextResolved);
      setDrafts(nextDrafts);
      setResults({});
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load model settings", "error");
    } finally {
      setLoading(false);
    }
  }, [endpoint, toast]);

  useEffect(() => void load(), [load]);

  const setDraft = (role: ModelRole, value: string) => {
    setDrafts((current) => ({ ...current, [role]: value }));
    setResults((current) => ({ ...current, [role]: undefined }));
  };

  const test = async (role: ModelRole) => {
    const model = drafts[role]?.trim() ?? "";
    if (!model) return;
    setBusy(role);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = await response.json();
      setResults((current) => ({
        ...current,
        [role]: response.ok && body.ok
          ? { model, ok: true }
          : { model, ok: false, error: body.error ?? "Test failed" },
      }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [role]: { model, ok: false, error: error instanceof Error ? error.message : "Test failed" },
      }));
    } finally {
      setBusy(null);
    }
  };

  const save = async (role: ModelRole) => {
    const model = drafts[role]?.trim() ?? "";
    const result = results[role];
    if (!result?.ok || result.model !== model) return;
    setBusy(role);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, model }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save model override");
      toast(`${role} model override saved`, "success");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to save model override", "error");
    } finally {
      setBusy(null);
    }
  };

  const clear = async (role: ModelRole) => {
    setBusy(role);
    try {
      const response = await fetch(`${endpoint}?role=${role}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to clear model override");
      toast(`${role} now inherits its model`, "success");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to clear model override", "error");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading model settings…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Exact {entityType} overrides</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          An override here wins over the {entityType} default and global default. Clear it to inherit.
          Every new value must pass a live model test before Save is enabled.
        </p>
      </div>
      {MODEL_ROLES.map(({ role, label, description }) => {
        const config = configs[role];
        const effective = resolved[role];
        const draft = drafts[role] ?? "";
        const custom = draft === CUSTOM_MODEL_VALUE || (Boolean(draft) && !isCatalogModel(draft));
        const modelValue = draft === CUSTOM_MODEL_VALUE ? "" : draft;
        const result = results[role];
        const tested = result?.ok === true && result.model === modelValue.trim();
        return (
          <div key={role} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div>
              <p className="text-xs text-muted-foreground">
                Effective: <span className="font-mono text-foreground">{effective?.model ?? "environment / built-in fallback"}</span>
                {effective ? ` (${effective.source}, v${effective.config_version})` : ""}
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={!draft ? "" : custom ? CUSTOM_MODEL_VALUE : draft}
                  onChange={(event) => setDraft(role, event.target.value)}
                  disabled={!canEdit}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">Inherit</option>
                  {MODEL_CATALOG.map((id) => <option key={id} value={id}>{id}</option>)}
                  <option value={CUSTOM_MODEL_VALUE}>Custom…</option>
                </select>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void test(role)} disabled={!canEdit || !modelValue.trim() || busy === role}>
                    {busy === role ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : result?.ok ? <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-500" /> : result && !result.ok ? <XCircle className="mr-1 h-4 w-4 text-destructive" /> : null} Test
                  </Button>
                  <Button size="sm" onClick={() => void save(role)} disabled={!canEdit || modelValue.trim() === (config?.model ?? "") || !tested || busy === role}><Save className="mr-1 h-4 w-4" /> Save</Button>
                  <Button size="sm" variant="outline" onClick={() => void clear(role)} disabled={!canEdit || !config || busy === role}><RotateCcw className="mr-1 h-4 w-4" /> Inherit</Button>
                </div>
              </div>
              {custom && <Input value={modelValue} onChange={(event) => setDraft(role, event.target.value)} disabled={!canEdit} placeholder="provider/model-id" className="font-mono text-sm" />}
              {result && !result.ok && "error" in result && <p className="text-xs text-destructive">{result.error}</p>}
              {tested && <p className="text-xs text-emerald-600">Model responded successfully. Save is enabled.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

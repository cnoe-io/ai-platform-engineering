"use client";

import React from "react";
import { Lock, RefreshCw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { FlagDefinition } from "@/app/api/admin/feature-flags/route";

interface FlagState extends FlagDefinition {
  value: boolean;
  source: "env" | "db" | "default";
  locked: boolean;
}

export function OptionsPanel() {
  const [flags, setFlags] = React.useState<FlagState[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  // Track local edits before saving
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/feature-flags");
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load");
      setFlags(data.data.flags);
      setPending({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleToggle = (flagId: string, newValue: boolean) => {
    // Update pending state; if reverting to original, remove from pending
    const original = flags.find((f) => f.id === flagId)?.value;
    setPending((prev) => {
      const next = { ...prev };
      if (newValue === original) {
        delete next[flagId];
      } else {
        next[flagId] = newValue;
      }
      return next;
    });
  };

  const hasPending = Object.keys(pending).length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");

      setSuccess("Options saved. Reloading to apply changes…");
      setPending({});
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Platform Feature Options</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Toggle platform features on or off. Options set via environment variables or config
          files are locked and cannot be changed here — they always take precedence.
        </p>
      </div>

      <div className="space-y-1 rounded-lg border divide-y">
        {flags.map((flag) => {
          const currentValue = flag.id in pending ? pending[flag.id] : flag.value;

          return (
            <div
              key={flag.id}
              className={`flex items-center justify-between px-4 py-4 ${
                flag.locked ? "opacity-60" : ""
              }`}
            >
              <div className="flex-1 min-w-0 pr-8">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor={`flag-${flag.id}`}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {flag.label}
                  </Label>
                  {flag.locked && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      <Lock className="h-2.5 w-2.5" />
                      {flag.source === "env" ? "Set in environment" : "Locked"}
                    </span>
                  )}
                  {!flag.locked && flag.source === "db" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Saved
                    </span>
                  )}
                  {!flag.locked && flag.id in pending && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Unsaved
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>
                {flag.locked && (
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                    {flag.envVar}={flag.value ? "true" : "false"}
                  </p>
                )}
              </div>

              <Switch
                id={`flag-${flag.id}`}
                checked={currentValue}
                onCheckedChange={(val) => handleToggle(flag.id, val)}
                disabled={flag.locked || saving}
                aria-label={flag.label}
              />
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={load} disabled={saving} className="gap-1 text-xs">
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasPending || saving}
          className="gap-1"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? "Saving…" : "Save & Apply"}
        </Button>
      </div>
    </div>
  );
}

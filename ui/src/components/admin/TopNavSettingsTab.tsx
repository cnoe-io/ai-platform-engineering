"use client";

// Admin → Settings → Navigation. Lets an admin reorder the top-navigation
// tabs (up/down) and enable/disable each one. Persists to
// platform_config.top_nav via PATCH /api/admin/platform-config; the AppHeader
// reads the same config (GET) and applies it for every user.
//
// assisted-by claude code claude-opus-4-8

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveButton } from "@/components/admin/SaveButton";
import { cn } from "@/lib/utils";
import {
  BUILT_IN_TOP_NAV_ITEMS,
  applyTopNavConfig,
  normalizeTopNavConfig,
  type TopNavConfig,
  type TopNavItemMeta,
} from "@/lib/nav/top-nav-items";

interface TopNavSettingsTabProps {
  isAdmin: boolean;
}

type Row = TopNavItemMeta & { enabled: boolean; pinnedApp?: boolean };

/** Build the editor rows from the live catalog + the saved config order/hidden. */
function buildRows(catalog: Row[], config: TopNavConfig): Row[] {
  const hidden = new Set(config.hidden);
  const withEnabled = catalog.map((item) => ({
    ...item,
    enabled: !hidden.has(item.key),
  }));
  // Reuse the same ordering the header applies, but DON'T drop hidden items —
  // the admin still needs to see + re-enable them. Temporarily clear hidden so
  // applyTopNavConfig only reorders.
  return applyTopNavConfig(withEnabled, { order: config.order, hidden: [] });
}

export function TopNavSettingsTab({ isAdmin }: TopNavSettingsTabProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [savedKey, setSavedKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull the saved config + the live set of pinned agentic-app tabs so the
      // editor can reorder/hide those too (not just the built-in tabs).
      const [cfgRes, appsRes] = await Promise.all([
        fetch("/api/admin/platform-config"),
        fetch("/api/agentic-apps").catch(() => null),
      ]);
      const cfgBody = cfgRes.ok ? await cfgRes.json() : null;
      const config = normalizeTopNavConfig(cfgBody?.data?.top_nav);

      const pinned: Row[] = [];
      if (appsRes && appsRes.ok) {
        const appsBody = await appsRes.json().catch(() => null);
        const items = (appsBody?.items ?? appsBody?.data?.items ?? []) as Array<{
          appId: string;
          displayName?: string;
          surfaces?: { showInTopNav?: boolean };
        }>;
        for (const a of items) {
          if (a?.surfaces?.showInTopNav) {
            pinned.push({
              key: `app-${a.appId}`,
              label: a.displayName ?? a.appId,
              enabled: true,
              pinnedApp: true,
            });
          }
        }
      }

      const catalog: Row[] = [
        ...BUILT_IN_TOP_NAV_ITEMS.map((m) => ({ ...m, enabled: true })),
        ...pinned,
      ];
      setRows(buildRows(catalog, config));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Serialize current row state to compare against the last-saved snapshot.
  const currentKey = useMemo(
    () =>
      JSON.stringify(rows.map((r) => [r.key, r.enabled] as const)),
    [rows],
  );
  useEffect(() => {
    if (!loading && savedKey === "") setSavedKey(currentKey);
    // only seed once after initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  const dirty = savedKey !== "" && currentKey !== savedKey;

  const move = (index: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  };

  const toggle = (index: number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r)),
    );
    setResult(null);
  };

  const save = async () => {
    setSaving(true);
    setResult(null);
    setError(null);
    try {
      const payload: TopNavConfig = {
        order: rows.map((r) => r.key),
        hidden: rows.filter((r) => !r.enabled).map((r) => r.key),
      };
      const res = await fetch("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ top_nav: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setSavedKey(currentKey);
      setResult("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult("error");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    setSaving(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ top_nav: { order: [], hidden: [] } }),
      });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      setSavedKey("");
      await load();
      setResult("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult("error");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          You need admin access to customize the top navigation.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Navigation</CardTitle>
        <CardDescription>
          Reorder the top-navigation tabs and enable or disable them. Changes
          apply to every user. Disabled tabs are hidden from the header (their
          pages remain reachable by direct URL).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5",
                    !row.enabled && "opacity-60",
                  )}
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label={`Move ${row.label} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${row.label} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="flex-1 text-sm font-medium">
                    {row.label}
                    {row.pinnedApp && (
                      <span className="ml-2 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-600">
                        App
                      </span>
                    )}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground/60">
                    {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant={row.enabled ? "outline" : "ghost"}
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    aria-label={
                      row.enabled ? `Disable ${row.label}` : `Enable ${row.label}`
                    }
                    onClick={() => toggle(index)}
                  >
                    {row.enabled ? (
                      <>
                        <Eye className="h-3.5 w-3.5" /> Enabled
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> Disabled
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground"
                onClick={() => void resetToDefault()}
                disabled={saving}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to default
              </Button>
              <SaveButton
                onSave={save}
                saving={saving}
                dirty={dirty}
                result={result}
                ariaLabel="Save navigation settings"
                testId="save-top-nav-settings"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

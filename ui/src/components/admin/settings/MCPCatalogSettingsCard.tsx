"use client";

// assisted-by claude code claude-sonnet-4-6

import { AdminBadge } from "@/components/admin/shared/AdminBadge";
import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";

const BUILTIN_PROVIDERS = [
  { key: "amplitude", name: "Amplitude" },
  { key: "atlassian", name: "Atlassian" },
  { key: "aws", name: "AWS" },
  { key: "figma", name: "Figma" },
  { key: "github", name: "GitHub Copilot" },
  { key: "linear", name: "Linear" },
  { key: "notion", name: "Notion" },
  { key: "pagerduty", name: "PagerDuty" },
  { key: "thousandeyes", name: "ThousandEyes" },
] as const;

interface CustomEntry {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  logo_url: string;
  provider_key: string;
}

const EMPTY_FORM: Omit<CustomEntry, "id"> = {
  name: "",
  description: "",
  endpoint: "",
  logo_url: "",
  provider_key: "",
};

function EntryDialog({
  open,
  initial,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initial: Partial<CustomEntry> | null;
  onOpenChange: (open: boolean) => void;
  onSave: (entry: CustomEntry) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [urlError, setUrlError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name ?? "",
        description: initial?.description ?? "",
        endpoint: initial?.endpoint ?? "",
        logo_url: initial?.logo_url ?? "",
        provider_key: initial?.provider_key ?? "",
      });
      setUrlError("");
    }
  }, [open, initial]);

  const set = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      new URL(form.endpoint.trim());
      setUrlError("");
    } catch {
      setUrlError("Enter a valid URL (e.g. https://mcp.example.com/mcp)");
      return;
    }
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      description: form.description.trim(),
      endpoint: form.endpoint.trim(),
      logo_url: form.logo_url.trim(),
      provider_key: form.provider_key.trim().toLowerCase(),
    });
    onOpenChange(false);
  };

  const isEdit = Boolean(initial?.id);
  const canSave = form.name.trim() && form.endpoint.trim() && form.provider_key.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit provider" : "Add custom provider"}</DialogTitle>
          <DialogDescription>
            Define a remote MCP server that will appear as a tile in the catalog.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="entry-name">Name *</Label>
            <Input id="entry-name" value={form.name} onChange={set("name")} placeholder="My Service" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-desc">Description</Label>
            <Input id="entry-desc" value={form.description} onChange={set("description")} placeholder="Short description shown on the tile" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-endpoint">MCP endpoint URL *</Label>
            <Input
              id="entry-endpoint"
              value={form.endpoint}
              onChange={(e) => { set("endpoint")(e); setUrlError(""); }}
              placeholder="https://mcp.example.com/mcp"
              required
            />
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-logo">Logo URL</Label>
            <Input id="entry-logo" value={form.logo_url} onChange={set("logo_url")} placeholder="https://cdn.example.com/logo.svg" />
            <p className="text-xs text-muted-foreground">Remote image URL shown on the tile. Leave blank to use a generic icon.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-provider">OAuth connector key *</Label>
            <Input id="entry-provider" value={form.provider_key} onChange={set("provider_key")} placeholder="my-service" required />
            <p className="text-xs text-muted-foreground">
              Matches the <code>provider</code> key of a registered OAuth connector (e.g. <code>amplitude</code>, <code>my-service</code>).
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>{isEdit ? "Save changes" : "Add provider"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface MCPCatalogSettingsCardProps {
  isAdmin: boolean;
  readOnly?: boolean;
}

export function MCPCatalogSettingsCard({ isAdmin, readOnly = false }: MCPCatalogSettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

  const [enabledProviders, setEnabledProviders] = useState<string[] | null>(null);
  const [customEntries, setCustomEntries] = useState<CustomEntry[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState("");

  const [entryDialog, setEntryDialog] = useState<{ open: boolean; initial: Partial<CustomEntry> | null }>({
    open: false,
    initial: null,
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/platform-config")
      .then((r) => r.json())
      .catch(() => ({ success: false }))
      .then((data) => {
        if (data.success && data.data?.remote_mcp_catalog) {
          const { enabled_providers, custom_entries } = data.data.remote_mcp_catalog;
          setEnabledProviders(enabled_providers ?? null);
          const entries = (custom_entries ?? []).map((e: CustomEntry) => ({ ...e, logo_url: e.logo_url ?? "" }));
          setCustomEntries(entries);
          setSavedSnapshot(JSON.stringify({ enabled_providers: enabled_providers ?? null, custom_entries: entries }));
        } else {
          setSavedSnapshot(JSON.stringify({ enabled_providers: null, custom_entries: [] }));
        }
        setLoading(false);
      });
  }, []);

  const snapshot = JSON.stringify({ enabled_providers: enabledProviders, custom_entries: customEntries });
  const isDirty = snapshot !== savedSnapshot;

  const isAllEnabled = enabledProviders === null;
  const isProviderEnabled = (key: string) => isAllEnabled || Boolean(enabledProviders?.includes(key));

  const toggleProvider = (key: string) => {
    if (isAllEnabled) {
      setEnabledProviders(BUILTIN_PROVIDERS.map((p) => p.key).filter((k) => k !== key));
    } else {
      const next = enabledProviders!.includes(key)
        ? enabledProviders!.filter((k) => k !== key)
        : [...enabledProviders!, key];
      setEnabledProviders(next.length === BUILTIN_PROVIDERS.length ? null : next);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remote_mcp_catalog: {
            enabled_providers: enabledProviders,
            custom_entries: customEntries.map((e) => ({ ...e, logo_url: e.logo_url || undefined })),
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedSnapshot(snapshot);
        setSaveResult("success");
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult("error");
      }
    } catch {
      setSaveResult("error");
    } finally {
      setSaving(false);
    }
  };

  const handleEntrySave = (entry: CustomEntry) => {
    setCustomEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = entry;
        return next;
      }
      return [...prev, entry];
    });
  };

  const handleDelete = (id: string) => {
    setCustomEntries((prev) => prev.filter((e) => e.id !== id));
    setDeleteId(null);
  };

  const safeHostname = (url: string) => {
    try { return new URL(url).hostname; } catch { return url; }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Remote MCP Catalog
            <AdminBadge />
          </CardTitle>
          <CardDescription>
            Choose which providers appear in the &ldquo;Add Server&rdquo; catalog, and define custom MCP servers with their own logo and OAuth connector key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Built-in providers */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Built-in providers</p>
                  {isAdmin && !readOnly && (
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <button type="button" className="hover:text-foreground transition-colors" onClick={() => setEnabledProviders(null)}>
                        Enable all
                      </button>
                      <span aria-hidden>·</span>
                      <button type="button" className="hover:text-foreground transition-colors" onClick={() => setEnabledProviders([])}>
                        Disable all
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {BUILTIN_PROVIDERS.map((p) => (
                    <div key={p.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`mcp-builtin-${p.key}`}
                        checked={isProviderEnabled(p.key)}
                        onChange={() => toggleProvider(p.key)}
                        disabled={!isAdmin || readOnly}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <label htmlFor={`mcp-builtin-${p.key}`} className="text-sm select-none cursor-pointer">
                        {p.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom providers */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Custom providers</p>
                  {isAdmin && !readOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-7 text-xs"
                      onClick={() => setEntryDialog({ open: true, initial: null })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add provider
                    </Button>
                  )}
                </div>

                {customEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No custom providers configured.</p>
                ) : (
                  <div className="divide-y rounded-md border text-sm">
                    {customEntries.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
                        {entry.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={entry.logo_url} alt="" aria-hidden className="h-5 w-5 object-contain flex-shrink-0" width={20} height={20} />
                        ) : (
                          <div className="h-5 w-5 rounded bg-muted flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{entry.name}</span>
                          <span className="text-muted-foreground ml-2 text-xs">{safeHostname(entry.endpoint)}</span>
                        </div>
                        <code className="text-xs text-muted-foreground hidden sm:block">{entry.provider_key}</code>
                        {isAdmin && !readOnly && (
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setEntryDialog({ open: true, initial: entry })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteId(entry.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="border-t pt-4">
                  <SaveButton
                    onSave={handleSave}
                    saving={saving}
                    dirty={isDirty}
                    disabled={readOnly}
                    result={saveResult}
                    ariaLabel="Save MCP catalog settings"
                    testId="mcp-catalog-save"
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <EntryDialog
        open={entryDialog.open}
        initial={entryDialog.initial}
        onOpenChange={(open) => setEntryDialog((s) => ({ ...s, open }))}
        onSave={handleEntrySave}
      />

      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove custom provider?</DialogTitle>
            <DialogDescription>
              This provider will no longer appear in the catalog. You can re-add it at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

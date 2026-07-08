"use client";

// assisted-by claude code claude-opus-4-8
//
// Minimal browser + editor for the Backstage-style software catalog
// (domain → subdomain → system → component). Thin client over
// /api/projects/catalog. Writes require org-admin server-side; non-admins get
// a read-only tree (create/delete calls 403 and surface an error).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  Component as ComponentIcon,
  Globe,
  Layers,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CATALOG_KINDS,
  PARENT_KINDS,
  type CatalogEntityDocument,
  type CatalogKind,
} from "@/types/catalog";

const KIND_META: Record<
  CatalogKind,
  { label: string; icon: typeof Globe; badge: string }
> = {
  domain: { label: "Domain", icon: Globe, badge: "bg-violet-500/15 text-violet-300 border-violet-400/30" },
  subdomain: { label: "Sub-domain", icon: Layers, badge: "bg-sky-500/15 text-sky-300 border-sky-400/30" },
  system: { label: "System", icon: Boxes, badge: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" },
  component: { label: "Component", icon: ComponentIcon, badge: "bg-amber-500/15 text-amber-300 border-amber-400/30" },
};

interface CreateForm {
  kind: CatalogKind;
  name: string;
  parent: string;
  owner: string;
  type: string;
  lifecycle: string;
  description: string;
  tags: string;
}

const EMPTY_FORM: CreateForm = {
  kind: "domain",
  name: "",
  parent: "",
  owner: "",
  type: "",
  lifecycle: "",
  description: "",
  tags: "",
};

export function CatalogExplorer() {
  const [entities, setEntities] = useState<CatalogEntityDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/catalog");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load catalog");
      setEntities((body.data?.entities ?? []) as CatalogEntityDocument[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Children grouped by parent slug; roots are domains (parent === null).
  const byParent = useMemo(() => {
    const map = new Map<string | null, CatalogEntityDocument[]>();
    for (const e of entities) {
      const key = e.parent ?? null;
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [entities]);

  // Valid parent options for the kind currently selected in the form.
  const parentOptions = useMemo(() => {
    const allowed = PARENT_KINDS[form.kind];
    if (!allowed.length) return [];
    return entities
      .filter((e) => allowed.includes(e.kind))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entities, form.kind]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          name: form.name.trim(),
          parent: form.parent || undefined,
          owner: form.owner.trim() || undefined,
          type: form.type.trim() || undefined,
          lifecycle: form.lifecycle.trim() || undefined,
          description: form.description.trim() || undefined,
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create entity");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, load]);

  const remove = useCallback(
    async (entity: CatalogEntityDocument) => {
      const hasChildren = (byParent.get(entity.slug) ?? []).length > 0;
      const confirmMsg = hasChildren
        ? `Delete "${entity.name}" and ALL of its descendants?`
        : `Delete "${entity.name}"?`;
      if (!window.confirm(confirmMsg)) return;
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/catalog/${entity.slug}${hasChildren ? "?cascade=true" : ""}`,
          { method: "DELETE" },
        );
        // 204 No Content on success — only parse a body on error.
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to delete entity");
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [byParent, load],
  );

  const roots = byParent.get(null) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Boxes className="h-6 w-6 text-primary" />
            Software Catalog
          </h1>
          <p className="text-sm text-muted-foreground">
            Backstage-style domains, sub-domains, systems and components — backed by MongoDB.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            New entity
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {showForm && (
        <div className="space-y-4 rounded-xl border border-border bg-card/40 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind">
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.kind}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    kind: e.target.value as CatalogKind,
                    parent: "",
                  }))
                }
              >
                {CATALOG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_META[k].label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Name">
              <Input
                value={form.name}
                placeholder="Platform Engineering"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>

            {PARENT_KINDS[form.kind].length > 0 && (
              <Field label={`Parent (${PARENT_KINDS[form.kind].join(" or ")})`}>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.parent}
                  onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))}
                >
                  <option value="">— select parent —</option>
                  {parentOptions.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name} ({KIND_META[p.kind].label})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Owner (optional)">
              <Input
                value={form.owner}
                placeholder="group:platform"
                onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              />
            </Field>

            {(form.kind === "system" || form.kind === "component") && (
              <Field label="Type (optional)">
                <Input
                  value={form.type}
                  placeholder="service"
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                />
              </Field>
            )}

            {form.kind === "component" && (
              <Field label="Lifecycle (optional)">
                <Input
                  value={form.lifecycle}
                  placeholder="production"
                  onChange={(e) => setForm((f) => ({ ...f, lifecycle: e.target.value }))}
                />
              </Field>
            )}

            <Field label="Tags (comma-separated)">
              <Input
                value={form.tags}
                placeholder="caipe, ai"
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </Field>

            <Field label="Description (optional)" className="sm:col-span-2">
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={submitting || !form.name.trim()}
              onClick={() => void submit()}
            >
              {submitting ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading catalog…</p>
      ) : roots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No catalog entities yet. Create a domain to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {roots.map((root) => (
            <CatalogNode
              key={root.slug}
              entity={root}
              byParent={byParent}
              depth={0}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogNode({
  entity,
  byParent,
  depth,
  onDelete,
}: {
  entity: CatalogEntityDocument;
  byParent: Map<string | null, CatalogEntityDocument[]>;
  depth: number;
  onDelete: (e: CatalogEntityDocument) => void;
}) {
  const children = byParent.get(entity.slug) ?? [];
  const meta = KIND_META[entity.kind];
  const Icon = meta.icon;

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/40"
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        {children.length > 0 ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{entity.name}</span>
        <Badge variant="outline" className={cn("text-[10px]", meta.badge)}>
          {meta.label}
        </Badge>
        {entity.type && (
          <span className="text-xs text-muted-foreground">· {entity.type}</span>
        )}
        {entity.owner && (
          <span className="text-xs text-muted-foreground">· {entity.owner}</span>
        )}
        <code className="ml-auto text-xs text-muted-foreground/70">{entity.slug}</code>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={() => onDelete(entity)}
          aria-label={`Delete ${entity.name}`}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
      {children.map((child) => (
        <CatalogNode
          key={child.slug}
          entity={child}
          byParent={byParent}
          depth={depth + 1}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

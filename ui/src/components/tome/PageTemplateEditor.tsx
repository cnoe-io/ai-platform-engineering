"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CrepeEditor, type CrepeEditorHandle } from "@/components/tome/CrepeEditor";
import { PAGE_KINDS, type PageKind } from "@/types/tome";

const SCOPES = [
  { scope: "top-level", label: "Project" },
  { scope: "github", label: "GitHub" },
  { scope: "confluence", label: "Confluence" },
  { scope: "webex", label: "Webex" },
] as const;

type Scope = (typeof SCOPES)[number]["scope"];

interface StoredPageSpec {
  path: string;
  kind: PageKind;
  title: string;
  order: number;
  body?: string;
  enabled?: boolean;
}

interface TemplateDoc {
  scope: Scope;
  pages: StoredPageSpec[];
  version: number;
  updated_at: string;
  updated_by: string | null;
}

interface ValidationError {
  field: string;
  message: string;
}

const KIND_STYLES: Record<string, string> = {
  stable: "text-blue-500",
  dynamic: "text-emerald-500",
  hidden: "text-muted-foreground",
  report: "text-amber-500",
};

function blankPage(order: number): StoredPageSpec {
  return { path: "", kind: "dynamic", title: "", order, enabled: true };
}

export function PageTemplateEditor() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Record<string, TemplateDoc>>({});
  const [drafts, setDrafts] = useState<Record<string, StoredPageSpec[]>>({});
  const [activeScope, setActiveScope] = useState<Scope>("top-level");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  // Which rows have their seed-body editor expanded, and the live Crepe
  // handles to read markdown back from. Reset when the scope tab changes.
  const [openBodies, setOpenBodies] = useState<Set<number>>(new Set());
  const bodyRefs = useRef<Map<number, CrepeEditorHandle | null>>(new Map());

  useEffect(() => {
    setOpenBodies(new Set());
    bodyRefs.current.clear();
  }, [activeScope]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tome/page-templates");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load templates");
      const byScope: Record<string, TemplateDoc> = {};
      const draftByScope: Record<string, StoredPageSpec[]> = {};
      for (const t of body.templates as TemplateDoc[]) {
        byScope[t.scope] = t;
        draftByScope[t.scope] = t.pages.map((p) => ({ ...p }));
      }
      setDocs(byScope);
      setDrafts(draftByScope);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const draft = useMemo(() => drafts[activeScope] ?? [], [drafts, activeScope]);
  const doc = docs[activeScope];

  const dirty = useMemo(() => {
    if (!doc) return false;
    // Open body editors may hold unsaved markdown the diff can't see, so treat
    // any open editor as potentially dirty.
    return openBodies.size > 0 || JSON.stringify(draft) !== JSON.stringify(doc.pages);
  }, [draft, doc, openBodies]);

  const updateRow = (index: number, patch: Partial<StoredPageSpec>) => {
    setDrafts((prev) => {
      const next = [...(prev[activeScope] ?? [])];
      next[index] = { ...next[index], ...patch };
      return { ...prev, [activeScope]: next };
    });
  };

  /** Merge every open body editor's live markdown into the given rows. */
  const withFlushedBodies = (rows: StoredPageSpec[]): StoredPageSpec[] => {
    const out = rows.map((p) => ({ ...p }));
    for (const [i, handle] of bodyRefs.current) {
      if (handle && out[i]) {
        out[i] = { ...out[i], body: handle.getMarkdown() };
      }
    }
    return out;
  };

  /** Flush open editors into the draft and collapse them all (before any
   * structural change that would shift row indices). */
  const flushAndCloseAll = () => {
    setDrafts((prev) => ({
      ...prev,
      [activeScope]: withFlushedBodies(prev[activeScope] ?? []),
    }));
    bodyRefs.current.clear();
    setOpenBodies(new Set());
  };

  const toggleBody = (index: number) => {
    setOpenBodies((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        const handle = bodyRefs.current.get(index);
        if (handle) updateRow(index, { body: handle.getMarkdown() });
        bodyRefs.current.delete(index);
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const moveRow = (index: number, dir: -1 | 1) => {
    flushAndCloseAll();
    setDrafts((prev) => {
      const rows = [...(prev[activeScope] ?? [])];
      const target = index + dir;
      if (target < 0 || target >= rows.length) return prev;
      [rows[index], rows[target]] = [rows[target], rows[index]];
      return { ...prev, [activeScope]: rows };
    });
  };

  const removeRow = (index: number) => {
    flushAndCloseAll();
    setDrafts((prev) => ({
      ...prev,
      [activeScope]: (prev[activeScope] ?? []).filter((_, i) => i !== index),
    }));
  };

  const addRow = () => {
    flushAndCloseAll();
    setDrafts((prev) => {
      const rows = prev[activeScope] ?? [];
      const maxOrder = rows.reduce((m, r) => Math.max(m, r.order), 0);
      return { ...prev, [activeScope]: [...rows, blankPage(maxOrder + 10)] };
    });
  };

  const reset = () => {
    if (!doc) return;
    bodyRefs.current.clear();
    setOpenBodies(new Set());
    setDrafts((prev) => ({
      ...prev,
      [activeScope]: doc.pages.map((p) => ({ ...p })),
    }));
    setErrors([]);
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    // Pull any open editors' markdown into the payload first.
    const pages = withFlushedBodies(draft);
    try {
      const res = await fetch(`/api/tome/page-templates/${activeScope}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const body = await res.json();
      if (res.status === 422) {
        setErrors(body.errors ?? []);
        toast("Validation failed. Fix the highlighted issues.", "error");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
      bodyRefs.current.clear();
      setOpenBodies(new Set());
      setDocs((prev) => ({ ...prev, [activeScope]: body.template }));
      setDrafts((prev) => ({
        ...prev,
        [activeScope]: body.template.pages.map((p: StoredPageSpec) => ({ ...p })),
      }));
      toast(`Saved ${activeScope} template (v${body.template.version}).`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading templates…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.scope}
              type="button"
              onClick={() => {
                setActiveScope(s.scope);
                setErrors([]);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                activeScope === s.scope
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {doc && (
          <span className="text-xs text-muted-foreground">
            v{doc.version}
            {doc.updated_by ? ` · last edited by ${doc.updated_by}` : " · defaults"}
          </span>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {errors.map((e, i) => (
            <li key={i}>
              <span className="font-mono text-xs">{e.field}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5 w-10" title="Templating on/off">On</th>
              <th className="px-3 py-2.5">Path</th>
              <th className="px-3 py-2.5">Title</th>
              <th className="px-3 py-2.5">Kind</th>
              <th className="px-3 py-2.5 w-20">Order</th>
              <th className="px-3 py-2.5 w-32" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {draft.map((p, i) => (
              <Fragment key={i}>
              <tr className={`align-top ${p.enabled === false ? "opacity-50" : ""}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={p.enabled !== false}
                    onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                    className="mt-2 h-4 w-4 accent-primary"
                    aria-label="Templating enabled"
                    title={p.enabled === false ? "Templating off" : "Templating on"}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={p.path}
                    onChange={(e) => updateRow(i, { path: e.target.value })}
                    placeholder="overview.md"
                    className="h-8 font-mono text-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={p.title}
                    onChange={(e) => updateRow(i, { title: e.target.value })}
                    placeholder="Overview"
                    className="h-8"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={p.kind}
                    onChange={(e) => updateRow(i, { kind: e.target.value as PageKind })}
                    className={`h-8 rounded-md border border-border bg-background px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 ${KIND_STYLES[p.kind] ?? ""}`}
                  >
                    {PAGE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    value={p.order}
                    onChange={(e) => updateRow(i, { order: parseInt(e.target.value, 10) || 0 })}
                    className="h-8 w-16"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveRow(i, -1)}
                      disabled={i === 0}
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(i, 1)}
                      disabled={i === draft.length - 1}
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label="Remove row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBody(i)}
                      className={`rounded p-1 hover:bg-muted ${openBodies.has(i) ? "text-primary" : "text-muted-foreground"}`}
                      aria-label="Edit seed body"
                      title="Edit seed body"
                    >
                      {openBodies.has(i) ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
              {openBodies.has(i) && (
                <tr>
                  <td colSpan={6} className="px-3 pb-4">
                    <div className="rounded-lg border border-border bg-background">
                      <div className="border-b border-border px-3 py-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Seed body ·{" "}
                            <span className="font-mono">{p.path || "(unnamed)"}</span>
                          </span>
                        </div>
                        <p className="mt-0.5 pl-5 text-[11px] leading-snug text-muted-foreground">
                          Founding markdown a new project&apos;s page starts with. Dynamic pages
                          carry agent guidance as an HTML comment: keep or refine it.
                        </p>
                      </div>
                      <div className="px-2 py-1">
                        <CrepeEditor
                          key={`${activeScope}-${i}-${doc?.version ?? 0}`}
                          ref={(h) => {
                            bodyRefs.current.set(i, h);
                          }}
                          initialMarkdown={p.body ?? ""}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={addRow}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add page
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty || saving}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Reset
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

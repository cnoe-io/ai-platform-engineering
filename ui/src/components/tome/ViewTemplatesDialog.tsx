"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StoredPageSpec {
  path: string;
  kind: string;
  title: string;
  order: number;
  enabled?: boolean;
}

interface PageTemplateDoc {
  scope: string;
  pages: StoredPageSpec[];
  version: number;
  updated_at: string;
  updated_by: string | null;
}

const SCOPE_LABEL: Record<string, string> = {
  "top-level": "Top-level",
  github: "GitHub repos",
  confluence: "Confluence spaces",
  webex: "Webex rooms",
};

export function ViewTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [templates, setTemplates] = useState<PageTemplateDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tome/page-templates");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `failed to load templates (${res.status})`);
      setTemplates(json.templates as PageTemplateDoc[]);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && templates == null) void load();
  }, [open, templates, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Page templates</DialogTitle>
          <DialogDescription>
            The current page-template config every wiki is checked against. Defined by an admin
            (Project settings &gt; Page templates); read-only here.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading templates...
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {templates && (
          <div className="space-y-4">
            {templates.map((t) => (
              <div key={t.scope} className="rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
                  <span className="text-sm font-medium">{SCOPE_LABEL[t.scope] ?? t.scope}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="normal-case">
                      v{t.version}
                    </Badge>
                    {t.updated_by && <span>updated by {t.updated_by}</span>}
                  </div>
                </div>
                <ul className="divide-y">
                  {t.pages.map((p) => (
                    <li
                      key={p.path}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      <Badge variant="outline" className="shrink-0 text-[11px] normal-case">
                        {p.kind}
                      </Badge>
                      <span className="font-mono text-muted-foreground">{p.path}</span>
                      <span className="flex-1 truncate">{p.title}</span>
                      {p.enabled === false && (
                        <Badge variant="outline" className="shrink-0 text-[11px] normal-case">
                          disabled
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

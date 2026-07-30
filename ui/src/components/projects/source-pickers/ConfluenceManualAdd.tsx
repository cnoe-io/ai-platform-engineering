"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  isConfluencePageUrl,
  parseConfluenceUrl,
  type ConfluenceSourcePreview,
} from "@/lib/projects/confluence-source";
import { cn } from "@/lib/utils";
import type { ConfluencePageScope } from "@/types/projects";

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (url: string, scope?: ConfluencePageScope) => void;
}

function responseError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return `Could not preview this page (${status})`;
}

export function ConfluenceManualAdd({
  value,
  onValueChange,
  onSelect,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ConfluenceSourcePreview | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);

  const isPage = isConfluencePageUrl(value);

  const resetPreview = () => {
    setPreview(null);
    setError("");
    setTreeOpen(false);
    setIncludeDescendants(true);
  };

  const submit = async () => {
    const parsed = parseConfluenceUrl(value);
    if (!parsed) {
      setError("Paste a valid Confluence space or page URL");
      return;
    }
    if (!parsed.page_id) {
      onSelect(parsed.url);
      onValueChange("");
      resetPreview();
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/projects/confluence/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: parsed.url }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: ConfluenceSourcePreview;
      };
      if (!response.ok || !body.data) {
        throw new Error(responseError(body, response.status));
      }
      setPreview(body.data);
      setIncludeDescendants(true);
      setTreeOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const confirm = () => {
    if (!preview) return;
    onSelect(preview.source_url, {
      ...preview.scope,
      include_descendants: includeDescendants,
    });
    onValueChange("");
    resetPreview();
  };

  return (
    <div className="rounded-lg border border-dashed border-border/60 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Know the source? Paste a space or page URL.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            if (preview || error) resetPreview();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="https://your.atlassian.net/wiki/spaces/PROJ/pages/123/Page"
          aria-label="Confluence space or page URL"
          className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={!value.trim() || loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {isPage ? "Preview" : "Use"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-start gap-2.5 border-b border-border bg-muted/30 p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Page found
              </p>
              <a
                href={preview.pages[0]?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex max-w-full items-center gap-1 text-sm font-semibold hover:underline"
              >
                <span className="truncate">
                  {preview.scope.space_key} / {preview.scope.page_title}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {preview.pages.length - 1} accessible subpage
                {preview.pages.length - 1 === 1 ? "" : "s"}
                {preview.truncated ? " (preview limited to 500)" : ""}
              </p>
            </div>
          </div>

          <fieldset className="space-y-2 p-3">
            <legend className="mb-2 text-xs font-semibold">Scope</legend>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="confluence-scope"
                checked={includeDescendants}
                onChange={() => setIncludeDescendants(true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">This page and all subpages</span>
                <span className="block text-xs text-muted-foreground">
                  New subpages added beneath it are included automatically.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="confluence-scope"
                checked={!includeDescendants}
                onChange={() => setIncludeDescendants(false)}
                className="mt-0.5"
              />
              <span className="font-medium">This page only</span>
            </label>
          </fieldset>

          {includeDescendants && preview.pages.length > 1 ? (
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => setTreeOpen((open) => !open)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium hover:bg-muted/40"
                aria-expanded={treeOpen}
              >
                {treeOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Preview included pages
              </button>
              {treeOpen ? (
                <ul className="max-h-48 overflow-y-auto border-t border-border/60 px-3 py-2">
                  {preview.pages.map((page) => (
                    <li
                      key={page.id}
                      className={cn(
                        "truncate py-1 text-xs",
                        page.depth === 0
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                      style={{ paddingLeft: `${page.depth * 16}px` }}
                      title={page.title}
                    >
                      {page.depth > 0 ? "└ " : ""}
                      {page.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-3">
            <Button variant="ghost" size="sm" onClick={resetPreview}>
              Back
            </Button>
            <Button size="sm" onClick={confirm}>
              Add source
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Loader2, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSourceOptions } from "./useSourceOptions";

/**
 * Confluence space source picker — pick the space this project documents from
 * your connected Atlassian, or paste a URL. Single-select (the project stores
 * one `confluence_url`).
 *
 * The server lists the site's non-personal spaces (personal `~`-keyed spaces
 * are excluded — they flood large sites and are never a project's docs). The
 * search box filters that list locally; to find a personal space, type `~`
 * which re-queries the server with personal spaces included.
 */
export function ConfluenceSpacePicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { connected, connectedTo, options, loading, manageUrl, search, reload } =
    useSourceOptions("atlassian");
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const current = selected[0] ?? "";

  const pick = (value: string) => onChange(current === value ? [] : [value]);

  // The server enumerates only the spaces the user has *joined*; a space they
  // can view but haven't joined is reachable only by search. So search hits the
  // server (by name and key), not a local filter. `options` is already the
  // server's result for the current query.
  const rows = options;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        {connected ? (
          <span className="text-muted-foreground">
            Connected{connectedTo ? <> to <span className="font-medium text-emerald-500">{connectedTo}</span></> : null}
            {" · "}
            {loading
              ? "loading…"
              : query.trim()
                ? `${rows.length} match${rows.length === 1 ? "" : "es"}`
                : `${rows.length} spaces`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {manageUrl ? (
              <>
                Confluence not connected — link Atlassian in{" "}
                <a
                  href={manageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Connections
                </a>
                , or paste a space URL below.
              </>
            ) : (
              "Paste a Confluence space URL below."
            )}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={reload} title="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Search */}
      {connected && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              search(v.trim());
            }}
            placeholder="Search spaces by name or key…"
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </div>
      )}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading spaces…
              </>
            ) : query.trim() ? (
              "No spaces match. Paste a URL below."
            ) : (
              "No spaces to show. Paste a URL below."
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((o) => {
              const active = current === o.value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => pick(o.value)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manual.trim()) {
              e.preventDefault();
              onChange([manual.trim()]);
              setManual("");
            }
          }}
          placeholder="https://your.atlassian.net/wiki/spaces/PROJ"
          className="flex-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (manual.trim()) {
              onChange([manual.trim()]);
              setManual("");
            }
          }}
          disabled={!manual.trim()}
        >
          Use
        </Button>
      </div>

      {current && (
        <p className="truncate text-xs text-muted-foreground">
          Selected: <span className="font-medium text-foreground">{current}</span>
        </p>
      )}
    </div>
  );
}

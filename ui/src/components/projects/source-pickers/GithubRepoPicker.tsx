"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSourceOptions, type SourceOption } from "./useSourceOptions";

const stripGh = (v: string) => v.replace(/^https?:\/\/github\.com\//i, "");

/**
 * GitHub repos source picker — browse the repos from your connected GitHub and
 * check the ones this project covers, with server-side search. Selections are
 * the confirmed set (checked rows). Paste an `org/repo` or URL to add one that
 * isn't listed. Multi-select.
 */
export function GithubRepoPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { connected, connectedTo, options, loading, manageUrl, search, reload } =
    useSourceOptions("github");
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Selected repos pinned at top (checked), then the rest of the live list.
  const rows: SourceOption[] = useMemo(() => {
    const sel = selected.map((v) => ({ value: v, label: stripGh(v) }));
    const rest = options.filter((o) => !selectedSet.has(o.value));
    return [...sel, ...rest];
  }, [selected, options, selectedSet]);

  const toggle = (value: string) =>
    onChange(
      selectedSet.has(value)
        ? selected.filter((s) => s !== value)
        : [...selected, value],
    );

  const addManual = () => {
    const v = manual.trim();
    if (!v || selectedSet.has(v)) return;
    onChange([...selected, v]);
    setManual("");
  };

  return (
    <div className="space-y-3">
      {/* Connection status */}
      <div className="flex items-center justify-between text-sm">
        {connected ? (
          <span className="text-muted-foreground">
            Connected{connectedTo ? <> as <span className="font-medium text-emerald-500">{connectedTo}</span></> : null}
            {" · "}
            {loading ? "loading…" : `${options.length} repos`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {manageUrl ? (
              <>
                GitHub not connected — link it in{" "}
                <a
                  href={manageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Connections
                </a>{" "}
                to browse your repos, or paste one below.
              </>
            ) : (
              "Type an org/name or paste a repo URL below."
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
              setQuery(e.target.value);
              search(e.target.value);
            }}
            placeholder="Search your repos (or type org/name)…"
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </div>
      )}

      {/* Live list */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading repos…
              </>
            ) : (
              "No repos to show. Paste one below."
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((r) => {
              const checked = selectedSet.has(r.value);
              return (
                <li key={r.value}>
                  <button
                    type="button"
                    onClick={() => toggle(r.value)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{r.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Manual add */}
      <div className="flex items-center gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder="org/name or repo URL"
          className="flex-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <Button variant="outline" size="sm" onClick={addManual} disabled={!manual.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {`${selected.length} selected`} · these scope the project&apos;s
        read-only agent access.
      </p>
    </div>
  );
}

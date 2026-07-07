"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSourceOptions, type SourceOption } from "./useSourceOptions";

/**
 * Per-source behavior the generic picker can't infer. The three connectors
 * (GitHub repos, Confluence space, Webex rooms) share all the chrome — status
 * header, search, scrollable checkmark list with selected pinned to the top,
 * optional manual-add, footer — and differ only on the axes below. Adding a new
 * source connector is now an adapter, not a new component.
 */
export interface SourceAdapter {
  /** Credentials provider id behind `useSourceOptions`. */
  provider: "github" | "atlassian" | "webex";
  /** Multi-select (repos/rooms) vs single-select (one Confluence space). */
  multi: boolean;
  /** Singular / plural noun for counts and copy ("repo"/"repos"). */
  nounOne: string;
  nounMany: string;
  /** Status header preposition: "Connected as X" (github/webex) vs "to X" (confluence). */
  connectedPreposition: "as" | "to";
  /** Show "N matches" while searching (confluence/webex) vs always "N nounMany" (github). */
  showMatchCount: boolean;
  searchPlaceholder: string;
  /** Empty-list copy. `noMatch` falls back to `none` when omitted. */
  emptyNone: string;
  emptyNoMatch?: string;
  /** Not-connected copy: rich (with a Connections link) and the bare fallback. */
  notConnectedHowTo: (connectionsLink: ReactNode) => ReactNode;
  notConnectedBare: string;

  /** Stored selected value → stable key used to match options and dedupe. */
  selectedKeyOf: (value: string) => string;
  /** Option → its matching key (defaults to `option.value`). */
  optionKeyOf?: (option: SourceOption) => string;
  /** Render label for a pinned selected value that may not be in `options`. */
  labelOf: (value: string) => string;
  /** Option → the value stored on selection (identity, or webex blob encode). */
  encodeOnAdd: (option: SourceOption) => string;

  /** Optional manual-add row. */
  manualAdd?: {
    placeholder: string;
    button: string;
    withIcon?: boolean;
    /** Normalize raw input → stored value (null/empty rejects). Defaults to trim. */
    parse?: (input: string) => string | null;
  };
  /** Footer line; return null to omit. */
  footer?: (selected: string[]) => ReactNode;
}

interface Row {
  key: string;
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function SourceItemPicker({
  adapter,
  selected,
  onChange,
}: {
  adapter: SourceAdapter;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { connected, connectedTo, options, loading, manageUrl, search, reload } =
    useSourceOptions(adapter.provider);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");

  const optionKeyOf = adapter.optionKeyOf ?? ((o: SourceOption) => o.value);

  // Selected keys (ordered as stored) for matching + pinning.
  const selectedKeys = useMemo(
    () => selected.map(adapter.selectedKeyOf),
    [selected, adapter],
  );
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const removeByKey = (key: string) =>
    onChange(selected.filter((s) => adapter.selectedKeyOf(s) !== key));

  const addValue = (value: string) =>
    onChange(adapter.multi ? [...selected, value] : [value]);

  // Selected pinned at top (stable, in stored order), then unselected options.
  const rows: Row[] = useMemo(() => {
    const optionByKey = new Map(options.map((o) => [optionKeyOf(o), o]));
    const pinned: Row[] = selected.map((value) => {
      const key = adapter.selectedKeyOf(value);
      const opt = optionByKey.get(key);
      return {
        key,
        label: opt ? opt.label : adapter.labelOf(value),
        selected: true,
        onToggle: () => removeByKey(key),
      };
    });
    const rest: Row[] = options
      .filter((o) => !selectedKeySet.has(optionKeyOf(o)))
      .map((o) => ({
        key: optionKeyOf(o),
        label: o.label,
        selected: false,
        onToggle: () => addValue(adapter.encodeOnAdd(o)),
      }));
    return [...pinned, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, selected, selectedKeySet, adapter]);

  const addManual = () => {
    const parsed = adapter.manualAdd?.parse
      ? adapter.manualAdd.parse(manual)
      : manual.trim() || null;
    if (!parsed) return;
    if (adapter.multi && selectedKeySet.has(adapter.selectedKeyOf(parsed))) {
      setManual("");
      return;
    }
    addValue(parsed);
    setManual("");
  };

  const countText = loading
    ? "loading…"
    : query.trim() && adapter.showMatchCount
      ? `${options.length} match${options.length === 1 ? "" : "es"}`
      : `${options.length} ${adapter.nounMany}`;

  const connectionsLink = manageUrl ? (
    <a
      href={manageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
    >
      Connections
    </a>
  ) : null;

  return (
    <div className="space-y-3">
      {/* Connection status */}
      <div className="flex items-center justify-between text-sm">
        {connected ? (
          <span className="text-muted-foreground">
            Connected
            {connectedTo ? (
              <>
                {" "}
                {adapter.connectedPreposition}{" "}
                <span className="font-medium text-emerald-500">{connectedTo}</span>
              </>
            ) : null}
            {" · "}
            {countText}
          </span>
        ) : loading ? (
          // First load: connection status is still unknown — don't claim "not
          // connected" until we actually know.
          <span className="text-muted-foreground">Checking connection…</span>
        ) : (
          <span className="text-muted-foreground">
            {manageUrl ? adapter.notConnectedHowTo(connectionsLink) : adapter.notConnectedBare}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={reload} title="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Search — rendered during the first load too, so it doesn't pop in once
          the connection resolves (the common case is connected). Only hidden
          once we definitively know the provider is not connected. */}
      {(connected || loading) && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              const v = e.target.value;
              setQuery(v);
              search(v.trim());
            }}
            placeholder={adapter.searchPlaceholder}
            disabled={!connected}
            className="w-full bg-transparent py-2 text-sm outline-none disabled:cursor-default"
          />
        </div>
      )}

      {/* List */}
      <div className="h-52 overflow-y-auto rounded-lg border border-border/60">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading {adapter.nounMany}…
              </>
            ) : query.trim() ? (
              adapter.emptyNoMatch ?? adapter.emptyNone
            ) : (
              adapter.emptyNone
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={r.onToggle}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center border",
                      adapter.multi ? "rounded" : "rounded-full",
                      r.selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {r.selected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual add */}
      {adapter.manualAdd && (
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
            placeholder={adapter.manualAdd.placeholder}
            className="flex-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <Button variant="outline" size="sm" onClick={addManual} disabled={!manual.trim()}>
            {adapter.manualAdd.withIcon && <Plus className="h-3.5 w-3.5" />}
            {adapter.manualAdd.button}
          </Button>
        </div>
      )}

      {adapter.footer?.(selected)}
    </div>
  );
}

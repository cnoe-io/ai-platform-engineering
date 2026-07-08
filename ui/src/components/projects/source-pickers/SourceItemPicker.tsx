"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { cn } from "@/lib/utils";
import { useSourceOptions, type SourceOption } from "./useSourceOptions";

/**
 * Per-source behavior the generic picker can't infer. The three connectors
 * (GitHub repos, Confluence space, Webex rooms) share all the chrome — a
 * bounded card with a branded header (icon chip, title, status), a merged
 * search+list control, optional manual-add, footer — and differ only on the
 * axes below. Adding a new source connector is now an adapter, not a new
 * component.
 */
export interface SourceAdapter {
  /** Credentials provider id behind `useSourceOptions` (also the `ProviderLogo` key). */
  provider: "github" | "atlassian" | "webex";
  /** Card header title, e.g. "GitHub repos". */
  title: string;
  /** One-line context shown under the title, e.g. what these sources are used for. */
  subtitle: string;
  /** Header icon chip background — a brand-tinted wash or (GitHub) an inverted neutral. */
  chipClass: string;
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
  /**
   * Shown under the loading skeleton once a first load runs past ~2.5s, so a
   * slow provider (Confluence) reads as "expected" rather than "stuck".
   */
  slowLoadHint?: string;

  /** Stored selected value → stable key used to match options and dedupe. */
  selectedKeyOf: (value: string) => string;
  /** Option → its matching key (defaults to `option.value`). */
  optionKeyOf?: (option: SourceOption) => string;
  /** Render label for a pinned selected value that may not be in `options`. */
  labelOf: (value: string) => string;
  /** Option → the value stored on selection (identity, or webex blob encode). */
  encodeOnAdd: (option: SourceOption) => string;

  /** Optional manual-add row — rendered as its own prominent section, not an afterthought. */
  manualAdd?: {
    placeholder: string;
    button: string;
    withIcon?: boolean;
    /** Short label above the input, e.g. "Know the URL? Paste it directly". */
    hint: string;
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

  // A first load with no rows yet that runs past ~2.5s surfaces the adapter's
  // slow-load copy (Confluence in particular), so it reads as expected rather
  // than stuck.
  const [showSlowHint, setShowSlowHint] = useState(false);
  useEffect(() => {
    if (!loading || options.length > 0 || !adapter.slowLoadHint) {
      setShowSlowHint(false);
      return;
    }
    const t = setTimeout(() => setShowSlowHint(true), 2500);
    return () => clearTimeout(t);
  }, [loading, options.length, adapter.slowLoadHint]);

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
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header: brand chip + title/subtitle + connection status + refresh — one
          row, so each connector reads as its own distinct unit at a glance. */}
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
        <span className={cn("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg", adapter.chipClass)}>
          <ProviderLogo provider={adapter.provider} className="h-[15px] w-[15px] object-contain" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{adapter.title}</div>
          <div className="truncate text-xs text-muted-foreground">{adapter.subtitle}</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              connected ? "bg-emerald-500" : loading ? "bg-muted-foreground/40" : "bg-amber-500",
            )}
          />
          {connected ? (
            <>
              Connected
              {connectedTo ? (
                <>
                  {" "}
                  {adapter.connectedPreposition} <span className="font-medium text-foreground">{connectedTo}</span>
                </>
              ) : null}
            </>
          ) : loading ? (
            // First load: connection status is still unknown — don't claim "not
            // connected" until we actually know.
            "Checking…"
          ) : (
            "Not connected"
          )}
        </span>
        <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={reload} title="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="space-y-3 p-4">
        {!connected && !loading && (
          <p className="text-sm text-muted-foreground">
            {manageUrl ? adapter.notConnectedHowTo(connectionsLink) : adapter.notConnectedBare}
          </p>
        )}

        {/* Picker: search + list merged into one bounded control, so the two
            don't compete as separate peer boxes. */}
        {(connected || loading) && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3">
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
                className="w-full bg-transparent py-2.5 text-sm outline-none disabled:cursor-default"
              />
              {connected && (
                <span className="shrink-0 text-xs text-muted-foreground">{countText}</span>
              )}
            </div>
            <div className="h-40 overflow-y-auto">
              {rows.length === 0 && loading ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
                  <div className="w-full space-y-2" data-testid="skeleton">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2">
                        <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted-foreground/20" />
                        <div
                          className="h-3.5 animate-pulse rounded bg-muted-foreground/20"
                          style={{ width: `${60 - i * 8}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  {showSlowHint && adapter.slowLoadHint && (
                    <p className="max-w-[85%] text-center text-xs text-muted-foreground">
                      {adapter.slowLoadHint}
                    </p>
                  )}
                </div>
              ) : rows.length === 0 ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  {query.trim() ? adapter.emptyNoMatch ?? adapter.emptyNone : adapter.emptyNone}
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
          </div>
        )}

        {/* Manual add — the one intentionally-different (dashed) zone: the
            explicit "alternate path" to search. */}
        {adapter.manualAdd && (
          <div className="rounded-lg border border-dashed border-border/60 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{adapter.manualAdd.hint}</p>
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
                className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <Button size="sm" onClick={addManual} disabled={!manual.trim()}>
                {adapter.manualAdd.withIcon && <Plus className="h-3.5 w-3.5" />}
                {adapter.manualAdd.button}
              </Button>
            </div>
          </div>
        )}

        {adapter.footer?.(selected)}
      </div>
    </div>
  );
}

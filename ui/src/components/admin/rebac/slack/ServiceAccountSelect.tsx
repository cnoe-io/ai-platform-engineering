"use client";

// assisted-by Claude:claude-opus-4-8
//
// Reusable, searchable picker for an active service account owned by a specific
// team. Fetches from /api/admin/service-accounts?team=<slug> — the BFF bounds
// the result to the caller's memberships, so only SAs owned by that team (and
// visible to the caller) are returned. Used by the Slack route editor's
// "Run as → Service Account" flow.
//
// Self-contained: TeamPicker (ui/team-picker.tsx) is a generic popover keyed
// on team slugs with a `team:<slug>` suffix display. ServiceAccountSelect needs
// to fetch its own team-scoped SA data, key items by sa_sub (not slug), and
// show friendly SA names without any suffix. Sharing TeamPicker's popover
// skeleton would require parameterising identifier, display, and fetch logic in
// a way that adds more complexity than the ~70-line standalone implementation.
// Keeping it self-contained is the right call until there is a third consumer.

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ServiceAccountOption {
  // Renamed from `id` to `sa_sub` to match the domain model explicitly.
  // The BFF returns `item.id` which is the service account subject (sa_sub);
  // we map it here so callers always work with `sa_sub` and do not confuse it
  // with a Mongo `_id` or other `id` field.
  sa_sub: string;
  name: string;
  status: "active" | "revoked";
}

export function ServiceAccountSelect({
  value,
  onChange,
  teamSlug,
  displayName,
  disabled,
  error,
  id = "route-exec-sa",
  label = "Service account",
}: {
  /** Selected SA sub (sa_sub), or "" when none selected. */
  value: string;
  /** Called with the chosen sub and its display name. */
  onChange: (sub: string, name: string) => void;
  /** Owning team to scope the list to. When absent, no SAs are shown. */
  teamSlug?: string;
  /** Fallback display name when the SA list is empty but a value is already set (e.g. caller lacks team membership). */
  displayName?: string;
  disabled?: boolean;
  error?: string;
  id?: string;
  label?: string;
}) {
  const [serviceAccounts, setServiceAccounts] = React.useState<ServiceAccountOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [fetchError, setFetchError] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // A counter incremented by the retry button to re-trigger the useEffect.
  const [retryCount, setRetryCount] = React.useState(0);

  React.useEffect(() => {
    // No team assigned — nothing to show; surface the empty state below.
    if (!teamSlug) {
      setServiceAccounts([]);
      setFetchError(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load(team: string) {
      setLoading(true);
      setFetchError(false);
      try {
        // Server-side team filter (bounded by the caller's memberships) so no
        // other team's SA names reach the browser. Revoked SAs are excluded by
        // default (no include_revoked flag).
        const res = await fetch(
          `/api/admin/service-accounts?team=${encodeURIComponent(team)}`,
        );
        const payload = (await res.json()) as {
          success?: boolean;
          data?: { items?: Array<{ id: string; name: string; status: "active" | "revoked" }> };
        };
        if (cancelled) return;
        const items = payload?.data?.items ?? [];
        // Map server `item.id` → `sa_sub` (the BFF field is `id` but it IS the sub).
        // Defense in depth: keep only active SAs (server excludes revoked by default,
        // but guard here in case the client receives stale cached data).
        setServiceAccounts(
          items
            .filter((item) => item.status === "active")
            .map((item) => ({ sa_sub: item.id, name: item.name, status: item.status })),
        );
      } catch {
        if (!cancelled) {
          setServiceAccounts([]);
          setFetchError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load(teamSlug);
    return () => {
      cancelled = true;
    };
  }, [teamSlug, retryCount]);

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const selected = React.useMemo(
    () => serviceAccounts.find((sa) => sa.sa_sub === value),
    [serviceAccounts, value],
  );
  // When the caller lacks team membership the SA list is empty but a value may
  // already be saved on the route. Fall back to displayName so the picker shows
  // the current SA name rather than the "no SAs found" empty state.
  const resolvedDisplayName = selected?.name ?? ((value || displayName) ? displayName : undefined);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? serviceAccounts.filter((sa) => sa.name.toLowerCase().includes(needle))
      : serviceAccounts;
  }, [serviceAccounts, query]);

  return (
    <div className="flex flex-col gap-2">
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading service accounts…</p>
      ) : fetchError ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">Failed to load service accounts.</p>
          <button
            type="button"
            className="text-xs text-primary underline hover:no-underline"
            onClick={() => setRetryCount((c) => c + 1)}
          >
            Retry
          </button>
        </div>
      ) : serviceAccounts.length === 0 && !value && !displayName ? (
        <p className="text-xs text-muted-foreground">
          {!teamSlug
            ? "No team assigned to this channel — assign a team first."
            : `No active service accounts found for team:${teamSlug}. Create one in the Service Accounts tab.`}
        </p>
      ) : (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              aria-label={label}
              disabled={disabled}
              className={cn(
                "inline-flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm",
                "hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-60",
                error && "border-destructive focus:ring-destructive",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {resolvedDisplayName ? (
                  resolvedDisplayName
                ) : (
                  <span className="text-muted-foreground">Select service account...</span>
                )}
              </span>
              {selected && !disabled && (
                <X
                  role="button"
                  aria-label="Clear service account selection"
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange("", "");
                  }}
                />
              )}
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(360px,90vw)] p-0" portalled={false}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search service accounts..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
                aria-label="Search service accounts"
              />
            </div>
            <div
              className="max-h-[260px] overflow-y-auto py-1"
              role="listbox"
              aria-label={label}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  No service accounts match
                </div>
              ) : (
                filtered.map((sa) => {
                  const isSelected = sa.sa_sub === value;
                  return (
                    <button
                      key={sa.sa_sub}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(sa.sa_sub, sa.name);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                        "hover:bg-muted/50 focus:bg-muted/50 focus:outline-none",
                        isSelected && "bg-muted/30",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "text-primary" : "text-transparent",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{sa.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

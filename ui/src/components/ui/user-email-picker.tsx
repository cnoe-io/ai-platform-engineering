// Searchable single-select person picker, keyed by email. Mirrors the
// TeamPicker UX (trigger shows the current pick; popover opens an always-focused
// search box) but resolves people asynchronously via /api/users/search. Identity
// is the user's email. A typed full email that matches no directory result can
// still be used as-is, so you're never blocked on the directory.

"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface UserResult {
  email: string;
  name?: string;
  avatar_url?: string;
}

export function UserEmailPicker({
  value,
  onChange,
  placeholder = "Search people by email",
  disabled,
}: {
  value: string;
  onChange: (email: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<UserResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`);
        const body = await res.json();
        if (!cancelled) setResults((body?.data ?? body ?? []) as UserResult[]);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const pick = (email: string) => {
    onChange(email);
    setOpen(false);
    setQ("");
  };

  const term = q.trim();
  const canUseTyped = term.includes("@") && !results.some((r) => r.email === term);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {value && (
              <X
                className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
              />
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by email or name"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {term.length < 2 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          ) : loading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Searching...</p>
          ) : results.length === 0 && !canUseTyped ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matches.</p>
          ) : (
            <>
              {results.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => pick(u.email)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{u.name || u.email}</span>
                    {u.name && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    )}
                  </span>
                  {value === u.email && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}
              {canUseTyped && (
                <button
                  type="button"
                  onClick={() => pick(term)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  Use &ldquo;{term}&rdquo;
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

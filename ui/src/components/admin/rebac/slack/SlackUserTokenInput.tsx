"use client";

import { useEffect,useMemo,useState } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { joinList,splitList } from "./slack-route-draft";

interface SlackUserSuggestion {
  id: string;
  label: string;
  avatar?: string;
}

export function SlackUserTokenInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  kind = "all",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  kind?: "all" | "bots";
}) {
  const selectedIds = useMemo(() => splitList(value), [value]);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SlackUserSuggestion[]>([]);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "searching" | "ready" | "empty" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState("");
  const [knownUsers, setKnownUsers] = useState<Record<string, SlackUserSuggestion>>({});
  const userLookupEnabled = !disabled && query.trim().length >= 2;

  useEffect(() => {
    const trimmed = query.trim();
    if (!userLookupEnabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/slack/users/lookup?q=${encodeURIComponent(trimmed)}&limit=50${kind === "bots" ? "&kind=bots" : ""}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Slack user lookup failed"))))
        .then((payload) => {
          if (cancelled) return;
          const users = (payload?.data?.users ?? payload?.users ?? []) as SlackUserSuggestion[];
          const warming = Boolean(payload?.data?.warming ?? payload?.warming);
          const next = users.filter((user) => !selectedIds.includes(user.id));
          setSuggestions(next);
          setLookupStatus(next.length > 0 ? "ready" : "empty");
          setLookupMessage(warming
            ? "Slack user directory is loading in the background. Try again in a moment."
            : "No Slack users found. Press Enter to add the typed ID manually.");
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLookupStatus("error");
            setLookupMessage("Slack user lookup failed. Press Enter to add the typed ID manually.");
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, query, selectedIds, userLookupEnabled]);

  const closeLookup = () => {
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };

  const addUser = (user: SlackUserSuggestion) => {
    setKnownUsers((prev) => ({ ...prev, [user.id]: user }));
    onChange(joinList([...selectedIds, user.id]));
    setQuery("");
    closeLookup();
  };

  const addRawId = (id: string) => {
    onChange(joinList([...selectedIds, id]));
    setQuery("");
    closeLookup();
  };

  const removeId = (id: string) => {
    onChange(joinList(selectedIds.filter((candidate) => candidate !== id)));
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <div
          className={cn(
            "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
            disabled && "cursor-not-allowed opacity-50",
          )}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeLookup();
          }}
        >
          {selectedIds.map((id) => {
            const user = knownUsers[id];
            const display = user ? `${user.label} (${id})` : id;
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                {display}
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => removeId(id)} disabled={disabled} aria-label={`Remove ${id}`}>×</button>
              </span>
            );
          })}
          <input
            value={query}
            disabled={disabled}
            placeholder={selectedIds.length > 0 ? "Search or paste ID" : placeholder}
            className="min-w-[160px] flex-1 appearance-none border-0 bg-transparent px-1 py-0.5 outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setSuggestions([]);
              setLookupMessage("");
              setLookupStatus(!disabled && next.trim().length >= 2 ? "searching" : "idle");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) {
                event.preventDefault();
                addRawId(query.trim());
              }
              if (event.key === "Backspace" && !query && selectedIds.length > 0) {
                removeId(selectedIds[selectedIds.length - 1]);
              }
            }}
          />
        </div>
        {userLookupEnabled && lookupStatus !== "idle" && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg" onMouseDown={(event) => event.preventDefault()}>
            {lookupStatus === "searching" && <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching Slack users...</div>}
            {lookupStatus === "empty" && <div className="px-2 py-1.5 text-xs text-muted-foreground">{lookupMessage}</div>}
            {lookupStatus === "error" && <div className="px-2 py-1.5 text-xs text-destructive">{lookupMessage}</div>}
            {lookupStatus === "ready" && suggestions.map((user) => (
              <button key={user.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => addUser(user)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {user.avatar && <img src={user.avatar} alt="" className="h-5 w-5 rounded" />}
                <span className="font-medium">{user.label}</span>
                <span className="text-xs text-muted-foreground">({user.id})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Press Enter to add a raw Slack ID if lookup is unavailable.</p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SlackEmojiSuggestion {
  name: string;
  url?: string;
  alias_for?: string;
}

export function SlackEmojiCombobox({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error?: string;
}) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<SlackEmojiSuggestion[]>([]);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "searching" | "ready" | "empty" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState("");

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const trimmed = query.trim().replace(/^:|:$/g, "");
    if (disabled || trimmed.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/slack/emoji?q=${encodeURIComponent(trimmed)}&limit=25`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Slack emoji lookup failed"))))
        .then((payload) => {
          if (cancelled) return;
          const emoji = (payload?.data?.emoji ?? payload?.emoji ?? []) as SlackEmojiSuggestion[];
          const warming = Boolean(payload?.data?.warming ?? payload?.warming);
          setSuggestions(emoji);
          setLookupStatus(emoji.length > 0 ? "ready" : "empty");
          setLookupMessage(warming
            ? "Slack emoji directory is loading in the background. Try again in a moment."
            : "No Slack emoji found. You can still type a standard reaction name.");
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLookupStatus("error");
            setLookupMessage("Slack emoji lookup failed. You can still type a reaction name.");
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [disabled, query]);

  const closeLookup = () => {
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };

  const commit = (next: string) => {
    const normalized = next.trim().replace(/^:|:$/g, "");
    onChange(normalized);
    setQuery(normalized);
    closeLookup();
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="route-esc-emoji">Emoji name</Label>
      <div className="relative">
        <Input
          id="route-esc-emoji"
          value={query}
          disabled={disabled}
          className={cn(error && "border-destructive focus-visible:ring-destructive")}
          placeholder="eyes"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setSuggestions([]);
            setLookupMessage("");
            setLookupStatus(!disabled && next.trim().replace(/^:|:$/g, "").length >= 1 ? "searching" : "idle");
            onChange(next.trim().replace(/^:|:$/g, ""));
          }}
          onBlur={() => {
            commit(query);
            closeLookup();
          }}
        />
        {lookupStatus !== "idle" && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg" onMouseDown={(event) => event.preventDefault()}>
            {lookupStatus === "searching" && <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching Slack emoji...</div>}
            {lookupStatus === "empty" && <div className="px-2 py-1.5 text-xs text-muted-foreground">{lookupMessage}</div>}
            {lookupStatus === "error" && <div className="px-2 py-1.5 text-xs text-destructive">{lookupMessage}</div>}
            {lookupStatus === "ready" && suggestions.map((emoji) => (
              <button key={emoji.name} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(emoji.name)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {emoji.url && !emoji.alias_for && <img src={emoji.url} alt="" className="h-5 w-5" />}
                <span className="font-medium">:{emoji.name}:</span>
                {emoji.alias_for && <span className="text-xs text-muted-foreground">alias of :{emoji.alias_for}:</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Custom Slack emoji are suggested when available; standard reaction names still work.</p>
    </div>
  );
}

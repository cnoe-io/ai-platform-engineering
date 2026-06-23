"use client";

import { useState } from "react";
import { Check, Loader2, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decodeWebexRoom, encodeWebexRoom } from "@/lib/projects/webex-room";
import { useSourceOptions } from "./useSourceOptions";

/**
 * Webex rooms source picker — pick the rooms this project communicates in
 * from your connected Webex account. Multi-select (a project can have several
 * attached rooms).
 */
export function WebexRoomsPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { connected, connectedTo, options, loading, manageUrl, search, reload } =
    useSourceOptions("webex");
  const [query, setQuery] = useState("");

  // `selected` carries encoded {room_id, name} blobs; match the live option
  // list by room_id so checkmarks render regardless of name drift.
  const selectedIds = new Set(selected.map((s) => decodeWebexRoom(s).room_id));

  const toggle = (roomId: string, name: string) => {
    if (selectedIds.has(roomId)) {
      onChange(selected.filter((s) => decodeWebexRoom(s).room_id !== roomId));
    } else {
      onChange([...selected, encodeWebexRoom(roomId, name)]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        {connected ? (
          <span className="text-muted-foreground">
            Connected{connectedTo ? <> as <span className="font-medium text-emerald-500">{connectedTo}</span></> : null}
            {" · "}
            {loading
              ? "loading…"
              : query.trim()
                ? `${options.length} match${options.length === 1 ? "" : "es"}`
                : `${options.length} rooms`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {manageUrl ? (
              <>
                Webex not connected — link Webex in{" "}
                <a
                  href={manageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Connections
                </a>
                .
              </>
            ) : (
              "Webex not connected."
            )}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={reload} title="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

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
            placeholder="Search rooms…"
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </div>
      )}

      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
        {options.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading rooms…
              </>
            ) : query.trim() ? (
              "No rooms match."
            ) : (
              "No rooms to show."
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {options.map((o) => {
              const active = selectedIds.has(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value, o.label)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
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

      {selected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selected.length} room{selected.length === 1 ? "" : "s"} selected
        </p>
      )}
    </div>
  );
}

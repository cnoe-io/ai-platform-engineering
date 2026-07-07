"use client";

/**
 * Spec-Kit command palette (Cmd/Ctrl + K).
 *
 * Lightweight, dependency-free overlay listing the four spec-kit
 * commands and a free-form "Ask an agent" input. The list is keyboard
 * navigable with arrow keys + Enter. Hidden by default, opened by
 * keyboard or by clicking the floating button rendered in the page
 * footer.
 *
 * Today this is a UI scaffold: selecting a command emits a
 * `agentic-sdlc:palette-action` event so other parts of the app (or
 * later waves) can react. No commands run from the palette directly.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { Command, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  group: "Spec-Kit" | "Layout" | "Quick";
}

const ACTIONS: PaletteAction[] = [
  { id: "speckit.specify", label: "/speckit.specify", hint: "Capture intent from a free-form prompt", group: "Spec-Kit" },
  { id: "speckit.plan", label: "/speckit.plan", hint: "Generate implementation plan from spec", group: "Spec-Kit" },
  { id: "speckit.tasks", label: "/speckit.tasks", hint: "Break plan into executable tasks", group: "Spec-Kit" },
  { id: "speckit.implement", label: "/speckit.implement", hint: "Execute tasks to produce code", group: "Spec-Kit" },
  { id: "layout.reset", label: "Reset panel layout", hint: "Restore default visible panels for this surface", group: "Layout" },
  { id: "layout.toggle-density", label: "Toggle density", hint: "Compact ↔ comfortable", group: "Layout" },
  { id: "agent.ask", label: "Ask an agent…", hint: "Send a free-form prompt to the platform engineer", group: "Quick" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS;
    return ACTIONS.filter(
      (a) => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (
        (ev.metaKey || ev.ctrlKey) &&
        (ev.key === "k" || ev.key === "K")
      ) {
        ev.preventDefault();
        setOpen((v) => !v);
      }
      if (ev.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const fire = useCallback((action: PaletteAction) => {
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent("agentic-sdlc:palette-action", {
        detail: { id: action.id },
      }),
    );
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
        aria-label="Open command palette (Cmd+K)"
      >
        <Command className="h-3 w-3" aria-hidden /> ⌘K
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/50 p-12 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/40 bg-card/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                setHighlight((h) => Math.min(filtered.length - 1, h + 1));
              } else if (e.key === "ArrowUp") {
                setHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === "Enter" && filtered[highlight]) {
                fire(filtered[highlight]);
              }
            }}
            placeholder="/speckit, panel, agent…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded-sm border border-border/40 bg-background/40 px-1 text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>
        <ul className="max-h-72 overflow-auto py-1">
          {filtered.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => fire(a)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs ${
                  i === highlight ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-background/40"
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{a.label}</span>
                  <span className="text-[10px] text-muted-foreground">{a.hint}</span>
                </span>
                <span className="rounded-sm border border-border/40 bg-background/40 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                  {a.group}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              No matches.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

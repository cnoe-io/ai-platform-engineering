/**
 * CAIPE interactive chat REPL built with Ink 5 + React 18.
 *
 * Architecture:
 *   - During streaming, raw text chunks are pushed to <Static>
 *     (append-only, never redrawn — no flashing).
 *   - When streaming finishes, the screen is cleared and ALL messages
 *     are re-rendered with full markdown (tables, code blocks, headings)
 *     by rebuilding the <Static> items from history.
 *   - The dynamic area (input bar + status) is only ~4 lines, so its
 *     1 Hz elapsed-timer updates are imperceptible.
 */
// assisted-by Codex Codex-sonnet-4-6

import { Box, Static, Text, useApp, useInput } from "ink";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { loginBrowser } from "../auth/oauth.js";
import { getValidToken } from "../auth/tokens.js";
import { fetchAgents } from "../agents/registry.js";
import { type Agent, DEFAULT_AGENT } from "../agents/types.js";
import { authEndpoints, getAuthUrl, getServerUrl, readSettings, settingsJsonPath } from "../platform/config.js";
import { StreamingSpinner } from "../platform/display.js";
import { renderMarkdown } from "../platform/markdown.js";
import { fetchSupervisorSkills } from "../skills/catalog.js";
import type { ChatSession } from "./history.js";
import { parseInput, pipeThrough, runShellCommand } from "./pipes.js";
import { createAdapter } from "./stream.js";
import type { StreamAdapter } from "./stream.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplProps {
  session: ChatSession;
  adapter: StreamAdapter;
  systemContext: string;
  serverUrl?: string;
  onExit: (session: ChatSession) => void;
}

/**
 * Every item in the <Static> list.  Once pushed, it is rendered once and
 * never touched again — this is what prevents flashing.
 */
type StaticItem =
  | ({ kind: "user"; text: string } & { _key: number })
  | ({ kind: "assistant"; text: string } & { _key: number })
  | ({ kind: "chunk"; text: string } & { _key: number })
  | ({ kind: "tool"; name: string } & { _key: number });
type StaticItemInput =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "chunk"; text: string }
  | { kind: "tool"; name: string };

// Internal message for history tracking (not rendered directly)
type HistoryEntry = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// Slash command registry
// ---------------------------------------------------------------------------

interface SlashCommand {
  name: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/clear", description: "Clear conversation context" },
  { name: "/compact", description: "Summarize and compress history" },
  { name: "/login", description: "Re-authenticate (opens browser)" },
  { name: "/settings", description: "View or edit CLI configuration" },
  { name: "/exit", description: "End session and save history" },
  { name: "/skills", description: "Show skills loaded in supervisor" },
  { name: "/agents", description: "Switch to a different agent" },
  { name: "/memory", description: "Edit memory file" },
  { name: "/help", description: "Show available commands" },
];

// ---------------------------------------------------------------------------
// SlashPicker
// ---------------------------------------------------------------------------

interface SlashPickerProps {
  input: string;
  selectedIndex: number;
  filtered: SlashCommand[];
}

function SlashPicker({ input, selectedIndex, filtered }: SlashPickerProps): React.ReactElement {
  const query = input.slice(1).toLowerCase();
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      marginX={1}
      marginBottom={0}
    >
      {filtered.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>No commands match "{query}"</Text>
        </Box>
      ) : (
        filtered.map((cmd, i) => {
          const sel = i === selectedIndex;
          return (
            <Box key={cmd.name} paddingX={1}>
              <Text color={sel ? "cyan" : undefined}>{sel ? "▶ " : "  "}</Text>
              <Text color={sel ? "cyan" : "white"} bold={sel}>
                {cmd.name.padEnd(14)}
              </Text>
              <Text dimColor={!sel} color={sel ? "white" : undefined}>
                {cmd.description}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// InputBar (memoized — props rarely change during streaming)
// ---------------------------------------------------------------------------

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onUp: () => void;
  onDown: () => void;
  onEscape: () => void;
  pickerActive: boolean;
  disabled?: boolean;
  /** Previous inputs for Up/Down history navigation */
  history?: string[];
}

/**
 * InputBar with readline-style keybindings and cursor movement.
 *
 * Keybindings (implemented from scratch — no GPL readline code):
 *   Ctrl+A       Move cursor to start of line
 *   Ctrl+E       Move cursor to end of line
 *   Ctrl+B       Move cursor back one character
 *   Ctrl+F       Move cursor forward one character
 *   Alt+B        Move cursor back one word
 *   Alt+F        Move cursor forward one word
 *   Ctrl+U       Delete from cursor to start of line
 *   Ctrl+K       Delete from cursor to end of line
 *   Ctrl+W       Delete word before cursor
 *   Ctrl+D       EOF / exit (when line is empty)
 *   Ctrl+C       Stop streaming or exit
 *   Ctrl+P / Up  Previous history entry
 *   Ctrl+N / Down Next history entry
 *   Left/Right   Move cursor
 *   Backspace    Delete character before cursor
 *   Delete       Delete character at cursor
 */
function InputBar({
  value,
  onChange,
  onSubmit,
  onUp,
  onDown,
  onEscape,
  pickerActive,
  disabled = false,
  history = [],
}: InputBarProps): React.ReactElement {
  const [cursor, setCursor] = useState(value.length);
  // historyIdx === history.length means "current input" (not browsing history)
  const [historyIdx, setHistoryIdx] = useState(history.length);
  // Stash the in-progress input when the user starts browsing history
  const stashedRef = useRef("");

  // Keep cursor in bounds when value changes externally (e.g. after submit clears it)
  useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value]);

  // Reset history index when history length changes (new entry added after submit)
  useEffect(() => {
    setHistoryIdx(history.length);
  }, [history.length]);

  // Helper: find the start of the previous word boundary
  const prevWordBoundary = (pos: number): number => {
    let i = pos;
    while (i > 0 && value[i - 1] === " ") i--; // skip trailing spaces
    while (i > 0 && value[i - 1] !== " ") i--; // skip word chars
    return i;
  };

  // Helper: find the end of the next word boundary
  const nextWordBoundary = (pos: number): number => {
    let i = pos;
    while (i < value.length && value[i] === " ") i++; // skip leading spaces
    while (i < value.length && value[i] !== " ") i++; // skip word chars
    return i;
  };

  // History navigation helpers — extracted so both arrow keys and Ctrl+P/N use the same path
  const historyPrev = useCallback(() => {
    if (history.length === 0 || historyIdx <= 0) return;
    if (historyIdx === history.length) stashedRef.current = value;
    const idx = historyIdx - 1;
    setHistoryIdx(idx);
    const entry = history[idx];
    if (!entry) return;
    onChange(entry);
    setCursor(entry.length);
  }, [history, historyIdx, value, onChange]);

  const historyNext = useCallback(() => {
    if (historyIdx >= history.length) return;
    const idx = historyIdx + 1;
    setHistoryIdx(idx);
    const entry = idx === history.length ? stashedRef.current : history[idx]!;
    onChange(entry);
    setCursor(entry.length);
  }, [history, historyIdx, onChange]);

  useInput(
    (char, key) => {
      if (disabled) return;

      // ── Up: picker navigation or history ──
      if (key.upArrow || (key.ctrl && char === "p")) {
        if (pickerActive) {
          onUp();
        } else {
          historyPrev();
        }
        return;
      }
      // ── Down: picker navigation or history ──
      if (key.downArrow || (key.ctrl && char === "n")) {
        if (pickerActive) {
          onDown();
        } else {
          historyNext();
        }
        return;
      }
      if (key.leftArrow) {
        if (key.meta) {
          // Alt+Left = word back
          setCursor(prevWordBoundary(cursor));
        } else {
          setCursor((c) => Math.max(0, c - 1));
        }
        return;
      }
      if (key.rightArrow) {
        if (key.meta) {
          // Alt+Right = word forward
          setCursor(nextWordBoundary(cursor));
        } else {
          setCursor((c) => Math.min(value.length, c + 1));
        }
        return;
      }
      if (key.escape) {
        onEscape();
        return;
      }

      // ── Submit ──
      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          onChange("");
          setCursor(0);
          setHistoryIdx(history.length + 1); // will be clamped by useEffect
          stashedRef.current = "";
        }
        return;
      }

      // ── Ctrl keybindings ──
      if (key.ctrl) {
        switch (char) {
          case "a": // Ctrl+A — start of line
            setCursor(0);
            return;
          case "e": // Ctrl+E — end of line
            setCursor(value.length);
            return;
          case "b": // Ctrl+B — back one char
            setCursor((c) => Math.max(0, c - 1));
            return;
          case "f": // Ctrl+F — forward one char
            setCursor((c) => Math.min(value.length, c + 1));
            return;
          case "u": {
            // Ctrl+U — kill to start of line
            const after = value.slice(cursor);
            onChange(after);
            setCursor(0);
            return;
          }
          case "k": {
            // Ctrl+K — kill to end of line
            onChange(value.slice(0, cursor));
            return;
          }
          case "w": {
            // Ctrl+W — kill word back
            const boundary = prevWordBoundary(cursor);
            onChange(value.slice(0, boundary) + value.slice(cursor));
            setCursor(boundary);
            return;
          }
          case "c":
            onSubmit("/stop-or-exit");
            return;
          case "d":
            onSubmit("/ctrl-d");
            return;
        }
        return;
      }

      // ── Alt/Meta keybindings ──
      if (key.meta) {
        switch (char) {
          case "b": {
            // Alt+B — word back
            setCursor(prevWordBoundary(cursor));
            return;
          }
          case "f": {
            // Alt+F — word forward
            setCursor(nextWordBoundary(cursor));
            return;
          }
          case "d": {
            // Alt+D — kill word forward
            const boundary = nextWordBoundary(cursor);
            onChange(value.slice(0, cursor) + value.slice(boundary));
            return;
          }
        }
        return;
      }

      // ── Backspace / Delete ──
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor((c) => c - 1);
        }
        return;
      }

      // ── Regular character input ──
      if (char) {
        onChange(value.slice(0, cursor) + char + value.slice(cursor));
        setCursor((c) => c + 1);
      }
    },
    { isActive: !disabled },
  );

  // Render: text before cursor, cursor block, text after cursor
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? "";
  const after = value.slice(cursor + (at ? 1 : 0));

  return (
    <Box paddingX={1}>
      <Text color={disabled ? "gray" : "green"} bold>
        {"❯ "}
      </Text>
      <Text>{before}</Text>
      {!disabled && (
        <Text color="green" inverse>
          {at || " "}
        </Text>
      )}
      <Text>{after}</Text>
      {pickerActive && <Text dimColor> ↑↓ · Enter · Esc</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// HRule (memoized)
// ---------------------------------------------------------------------------

const HRule = React.memo(function HRule({
  color = "gray",
}: { color?: string }): React.ReactElement {
  const cols = process.stdout.columns ?? 80;
  return <Text color={color}>{"─".repeat(cols)}</Text>;
});

// ---------------------------------------------------------------------------
// Quick greeting matcher
// ---------------------------------------------------------------------------

const GREETINGS: Array<[RegExp, string[]]> = [
  [
    /^(hi|hey|hello|howdy|yo|sup|hola|heya)\b/i,
    [
      "Hey! How can I help you today?",
      "Hello! What can I do for you?",
      "Hi there! Ready when you are.",
    ],
  ],
  [
    /^(how are you|how('s| is) it going|what'?s up)\??$/i,
    [
      "Doing great, thanks! What are you working on?",
      "All good here! What can I help with?",
      "Ready to go! What do you need?",
    ],
  ],
  [
    /^(good (morning|afternoon|evening))\b/i,
    ["Good day! What can I help with?", "Hello! What are we working on?"],
  ],
  [
    /^(thanks|thank you|thx|ty)\b/i,
    ["You're welcome! Anything else?", "Happy to help! Need anything else?"],
  ],
  [/^(bye|goodbye|see ya|cya|later)\b/i, ["See you! Type /exit when you're ready to close."]],
];

function matchGreeting(input: string): string | null {
  const trimmed = input.trim().replace(/[!.]+$/, "");
  for (const [pattern, responses] of GREETINGS) {
    if (pattern.test(trimmed)) {
      return responses[Math.floor(Math.random() * responses.length)]!;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main REPL
// ---------------------------------------------------------------------------

export function Repl({
  session,
  adapter,
  systemContext,
  serverUrl,
  onExit,
}: ReplProps): React.ReactElement {
  const { exit } = useApp();

  // ── Static items: the ONLY thing that appears on screen ──
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  const staticKeyRef = useRef(0);
  const nextKey = () => staticKeyRef.current++;

  // Generation counter — incrementing forces <Static> to remount,
  // which re-renders ALL items (needed for the streaming→markdown swap).
  const [generation, setGeneration] = useState(0);

  // ── History: for sending context to the agent ──
  const historyRef = useRef<HistoryEntry[]>([]);
  const accumulatedRef = useRef(""); // full response text during streaming

  // ── Active adapter + agent — swappable via /agents ──
  const adapterRef = useRef<StreamAdapter>(adapter);
  const [currentAgent, setCurrentAgent] = useState<Agent>(DEFAULT_AGENT);

  // ── Input history: previous user inputs for Up/Down navigation ──
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  // ── UI state ──
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [streamPhase, setStreamPhase] = useState<"thinking" | "generating">("generating");
  const [streamTokenCount, setStreamTokenCount] = useState(0);
  const [totalTokenDisplay, setTotalTokenDisplay] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const tokenCountRef = useRef(0);
  const streamStartRef = useRef(0);
  const streamTokenRef = useRef(0);
  const sessionStartRef = useRef(Date.now());
  const ctrlDCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingTokensRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers to push items to the Static list ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: nextKey is a stable ref-based counter, not a reactive dependency
  const pushStatic = useCallback((item: StaticItemInput) => {
    const _key = nextKey();
    setStaticItems((prev) => [...prev, { ...item, _key } as StaticItem]);
  }, []);

  const pushUser = useCallback(
    (text: string) => {
      pushStatic({ kind: "user", text });
      historyRef.current.push({ role: "user", content: text });
      // Add to input history for Up/Down navigation (dedup consecutive)
      setInputHistory((prev) => (prev[prev.length - 1] === text ? prev : [...prev, text]));
    },
    [pushStatic],
  );

  const pushAssistant = useCallback(
    (text: string) => {
      pushStatic({ kind: "assistant", text: renderMarkdown(text) });
      historyRef.current.push({ role: "assistant", content: text });
    },
    [pushStatic],
  );

  const pushChunk = useCallback(
    (text: string) => {
      pushStatic({ kind: "chunk", text });
    },
    [pushStatic],
  );

  const pushToolItem = useCallback(
    (name: string) => {
      pushStatic({ kind: "tool", name });
    },
    [pushStatic],
  );

  // ── Flush buffered streaming tokens directly to Static ──
  const flushTokens = useCallback(() => {
    const text = pendingTokensRef.current;
    if (!text) return;
    pendingTokensRef.current = "";
    accumulatedRef.current += text;
    // Switch from "Thinking…" to "Generating…" on first real token
    setStreamPhase("generating");
    streamTokenRef.current += Math.ceil(text.length / 4);
    setStreamTokenCount(streamTokenRef.current);
    pushChunk(text);
  }, [pushChunk]);

  // Flush any remaining pending tokens (called when streaming ends)
  const flushLineBuffer = useCallback(() => {
    const text = pendingTokensRef.current;
    if (text) {
      pendingTokensRef.current = "";
      accumulatedRef.current += text;
      pushChunk(text);
    }
  }, [pushChunk]);

  /**
   * Rebuild all Static items from history with full markdown rendering.
   * Called after streaming ends to replace raw chunks with styled output.
   * Clears the terminal first so the old raw text is gone.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: nextKey is a stable ref-based counter
  const rebuildWithMarkdown = useCallback(() => {
    // Clear the terminal so old raw chunks disappear
    process.stdout.write("\x1b[2J\x1b[H");

    // Rebuild items from history — each assistant message gets renderMarkdown
    staticKeyRef.current = 0;
    const items: StaticItem[] = [];
    for (const msg of historyRef.current) {
      const _key = nextKey();
      if (msg.role === "user") {
        items.push({ _key, kind: "user" as const, text: msg.content });
      } else {
        items.push({ _key, kind: "assistant" as const, text: renderMarkdown(msg.content) });
      }
    }
    setStaticItems(items);
    // Increment generation to force <Static> remount so it re-renders all items
    setGeneration((g) => g + 1);
  }, []);

  // ── Slash picker ──
  const filteredCommands = useMemo<SlashCommand[]>(() => {
    if (!input?.startsWith("/")) return [];
    const query = input.slice(1).toLowerCase();
    if (query === "") return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(query));
  }, [input]);

  const showPicker = !!input?.startsWith("/") && !streaming;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset picker on filter count change, not on array identity
  useEffect(() => {
    setPickerIndex(0);
  }, [filteredCommands.length]);

  // ── Elapsed timer ──
  // Only redraws the ~4-line dynamic area (input bar + status), not Static content.
  useEffect(() => {
    if (!streaming) {
      setStreamElapsed(0);
      setStreamPhase("generating");
      setStreamTokenCount(0);
      streamTokenRef.current = 0;
      return;
    }
    streamStartRef.current = Date.now();
    setStreamPhase("thinking");
    const id = setInterval(() => {
      setStreamElapsed(Math.floor((Date.now() - streamStartRef.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [streaming]);

  // ── Exit ──
  const handleExit = useCallback(() => {
    const finishedMessages: {
      role: "user" | "assistant";
      content: string;
      timestamp: string;
      agentName: string;
      tokenCount: null;
    }[] = historyRef.current.map((m) => ({
      ...m,
      timestamp: new Date().toISOString(),
      agentName: session.agentName,
      tokenCount: null,
    }));

    const turns = historyRef.current.filter((m) => m.role === "user").length;
    const elapsedSec = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const tokens = tokenCountRef.current;
    process.stdout.write(
      `\n  Session ended · ${turns} turn${turns !== 1 ? "s" : ""} · ~${tokens} tokens · ${duration}\n\n`,
    );

    onExit({ ...session, messages: finishedMessages });
    exit();
  }, [session, onExit, exit]);

  // ── Slash commands ──
  const executeSlashCommand = useCallback(
    async (cmd: string) => {
      const base = cmd.split(" ")[0]?.toLowerCase() ?? "";

      switch (base) {
        case "/exit":
          handleExit();
          break;

        case "/stop-or-exit":
          if (streaming && abortControllerRef.current) {
            abortControllerRef.current.abort();
            setStreaming(false);
          } else {
            handleExit();
          }
          break;

        case "/ctrl-d":
          ctrlDCountRef.current += 1;
          if (ctrlDCountRef.current >= 2) {
            handleExit();
          } else {
            setStatusText("Press Ctrl+D again to exit.");
            setTimeout(() => {
              ctrlDCountRef.current = 0;
              setStatusText(null);
            }, 2000);
          }
          break;

        case "/clear":
          process.stdout.write("\x1b[2J\x1b[H");
          setStaticItems([]);
          staticKeyRef.current = 0;
          historyRef.current = [];
          tokenCountRef.current = 0;
          setTotalTokenDisplay(0);
          setGeneration((g) => g + 1);
          setStatusText("Context cleared.");
          setTimeout(() => setStatusText(null), 2000);
          break;

        case "/compact":
          setStatusText("Compacting history…");
          historyRef.current = historyRef.current.slice(-6);
          tokenCountRef.current = Math.floor(tokenCountRef.current * 0.3);
          setTotalTokenDisplay(tokenCountRef.current);
          setTimeout(() => setStatusText(null), 1500);
          break;

        case "/help":
          pushAssistant(SLASH_COMMANDS.map((c) => `**${c.name}** — ${c.description}`).join("\n"));
          break;

        case "/skills":
          setStatusText("Loading skills from supervisor…");
          try {
            let skillsUrl: string;
            try { skillsUrl = getServerUrl(); } catch { skillsUrl = serverUrl ?? ""; }
            const skillsAuthUrl = (() => { try { return getAuthUrl(); } catch { return skillsUrl; } })();
            const { skills, meta } = await fetchSupervisorSkills(() => getValidToken(skillsAuthUrl), skillsUrl);
            if (skills.length === 0) {
              pushAssistant("No skills loaded in supervisor.");
            } else {
              const header = `**${meta.total} skills loaded** (sources: ${(meta.sources_loaded ?? []).join(", ") || "unknown"})\n\n`;
              const table = skills
                .map((s) => {
                  const tags = (s.metadata?.tags ?? []).join(", ");
                  return `- **${s.name}** — ${s.description || "(no description)"}${tags ? ` [${tags}]` : ""} _(${s.source})_`;
                })
                .join("\n");
              pushAssistant(header + table);
            }
          } catch (err) {
            pushAssistant(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setStatusText(null);
          }
          break;

        case "/agents": {
          setStatusText("Loading agents from registry…");
          try {
            let sv: string;
            try { sv = getServerUrl(); } catch { sv = serverUrl ?? ""; }
            const authUrl2 = (() => { try { return getAuthUrl(); } catch { return sv; } })();
            const agents = await fetchAgents(sv, () => getValidToken(authUrl2));
            const arg = cmd.split(" ")[1]?.trim();
            if (arg) {
              // /agents <name> — switch directly
              const target = agents.find((a) => a.name === arg);
              if (!target) {
                pushAssistant(`Agent **${arg}** not found. Available: ${agents.map((a) => a.name).join(", ")}`);
              } else {
                const ep = authEndpoints(sv);
                adapterRef.current = createAdapter(target, ep.streamStart, () => getValidToken(authUrl2));
                setCurrentAgent(target);
                pushAssistant(`Switched to agent **${target.displayName ?? target.name}** — ${target.description}`);
              }
            } else {
              // /agents — list with switch hint
              const lines = agents.map((a) => {
                const active = a.name === currentAgent.name ? " _(active)_" : "";
                return `- **${a.name}**${active} — ${a.description}`;
              });
              pushAssistant(`**Available agents** (use \`/agents <name>\` to switch)\n\n${lines.join("\n")}`);
            }
          } catch (err) {
            pushAssistant(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setStatusText(null);
          }
          break;
        }

        case "/login":
          setStatusText("Opening browser for re-authentication…");
          try {
            let authUrl: string;
            try {
              authUrl = getAuthUrl();
            } catch {
              authUrl = serverUrl ?? "";
            }
            const tokens = await loginBrowser(authUrl, "caipe-cli");
            const who = tokens.displayName || tokens.identity || "(authenticated)";
            pushAssistant(`Re-authenticated as **${who}**.`);
          } catch (err) {
            pushAssistant(
              `[ERROR] Re-auth failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            setStatusText(null);
          }
          break;

        case "/memory": {
          const { memoryFilePaths } = await import("../memory/loader.js");
          const paths = memoryFilePaths(process.cwd());
          const editor = process.env.VISUAL ?? process.env.EDITOR;
          if (editor && paths.length > 0) {
            const target = paths[0]!;
            setStatusText(`Opening ${target} in ${editor}…`);
            try {
              const { spawnSync } = await import("node:child_process");
              spawnSync(editor, [target], { stdio: "inherit" });
            } catch {
              // ignore
            } finally {
              setStatusText(null);
            }
          } else {
            const listed = paths.length > 0
              ? paths.map((p) => `- \`${p}\``).join("\n")
              : "_(none found)_";
            pushAssistant(
              `**Memory files** (loaded at session start):\n${listed}\n\nSet **EDITOR** to open inline, or edit files directly and restart the session.`,
            );
          }
          break;
        }

        case "/settings": {
          const s = readSettings();
          const path = settingsJsonPath();
          const editor = process.env.VISUAL ?? process.env.EDITOR;
          if (editor) {
            // Pause Ink, open editor, resume
            setStatusText(`Opening ${path} in ${editor}…`);
            try {
              const { spawnSync } = await import("node:child_process");
              spawnSync(editor, [path], { stdio: "inherit" });
            } catch {
              // ignore spawn errors
            } finally {
              setStatusText(null);
            }
          } else {
            // No editor — print current settings
            const lines = [
              `**Settings** — \`${path}\`\n`,
              `- **server.url** = \`${s.server?.url ?? "(not set)"}\``,
              `- **auth.url** = \`${s.auth?.url ?? "(not set)"}\``,
              `- **auth.idp-hint** = \`${s.auth?.idpHint ?? "(not set)"}\``,
              `- **auth.credential-storage** = \`${s.auth?.credentialStorage ?? "encrypted-file"}\``,
              `\nTo edit, set **EDITOR** or run \`caipe config set <key> <value>\``,
            ];
            pushAssistant(lines.join("\n"));
          }
          break;
        }

        default:
          pushAssistant(`Unknown command: ${cmd}. Type / to see available commands.`);
      }
    },
    [handleExit, pushAssistant, streaming, serverUrl, currentAgent],
  );

  // ── Submit: greeting / shell escape / pipe / agent prompt ──
  const handleSubmit = useCallback(
    async (text: string) => {
      if (text.startsWith("/")) {
        await executeSlashCommand(text);
        return;
      }

      // Quick local greetings
      const greeting = matchGreeting(text);
      if (greeting) {
        setStatusText(greeting);
        setTimeout(() => setStatusText(null), 3000);
        return;
      }

      const parsed = parseInput(text);

      // ── Shell escape: ! <cmd> ──
      if (parsed.shellCmd) {
        pushUser(text);
        setStatusText(`Running: ${parsed.shellCmd}`);
        try {
          const { stdout, stderr, exitCode } = await runShellCommand(parsed.shellCmd);
          const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).trim();
          pushAssistant(
            output
              ? `\`\`\`\n${output}\n\`\`\`${exitCode !== 0 ? `\n_(exit code ${exitCode})_` : ""}`
              : `_(no output, exit code ${exitCode})_`,
          );
        } catch (err) {
          pushAssistant(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setStatusText(null);
        }
        return;
      }

      // ── Agent prompt (with optional pipe) ──
      const prompt = parsed.prompt;
      pushUser(text);
      tokenCountRef.current += Math.ceil(prompt.length / 4);
      setTotalTokenDisplay(tokenCountRef.current);

      // Start streaming — push chunks to Static (no flashing)
      accumulatedRef.current = "";
      setStreaming(true);
      pushStatic({ kind: "chunk", text: "" }); // ⏺ spacer

      try {
        const gen = adapterRef.current.connect({
          prompt,
          systemContext,
          sessionId: session.sessionId,
          agentName: currentAgent.name,
          history: historyRef.current,
        });

        for await (const ev of gen) {
          if (ev.type === "token") {
            pendingTokensRef.current += ev.text;
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                flushTokens();
              }, 150);
            }
          } else if (ev.type === "tool") {
            // Flush pending tokens before showing the tool so it appears inline
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            flushTokens();
            pushToolItem(ev.name);
            setActiveToolName(ev.name);
          } else if (ev.type === "interrupted") {
            // Agent paused for human input — flush what it said, keep input bar open
            flushTokens();
            flushLineBuffer();
            break;
          } else if (ev.type === "error") {
            pushAssistant(`[ERROR] ${ev.message}`);
            break;
          } else if (ev.type === "done") {
            break;
          }
        }

        // Flush remaining buffered tokens + partial line
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushTokens();
        flushLineBuffer();

        // Store response in history
        let finalContent = accumulatedRef.current;
        if (parsed.pipeCmd && finalContent) {
          setStatusText(`Piping through: ${parsed.pipeCmd}`);
          finalContent = await pipeThrough(finalContent, parsed.pipeCmd);
        }
        if (finalContent) {
          historyRef.current.push({ role: "assistant", content: finalContent });
          tokenCountRef.current += Math.ceil(finalContent.length / 4);
          setTotalTokenDisplay(tokenCountRef.current);
        }

        // Clear screen and rebuild everything with markdown rendering
        rebuildWithMarkdown();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushAssistant(`[ERROR] ${msg}`);
      } finally {
        pendingTokensRef.current = "";
        setStreaming(false);
        setActiveToolName(null);
        setStatusText(null);
      }
    },
    [
      adapter,
      session,
      systemContext,
      executeSlashCommand,
      flushTokens,
      flushLineBuffer,
      pushUser,
      pushAssistant,
      pushStatic,
      pushToolItem,
      rebuildWithMarkdown,
    ],
  );

  // ── Picker navigation ──
  const handlePickerSubmit = useCallback(
    (raw: string) => {
      if (showPicker && filteredCommands.length > 0) {
        const selected = filteredCommands[pickerIndex];
        if (selected) {
          void executeSlashCommand(selected.name);
          return;
        }
      }
      void handleSubmit(raw);
    },
    [showPicker, filteredCommands, pickerIndex, executeSlashCommand, handleSubmit],
  );

  const handleUp = useCallback(() => {
    if (!showPicker) return;
    setPickerIndex((i) => (i === 0 ? filteredCommands.length - 1 : i - 1));
  }, [showPicker, filteredCommands.length]);

  const handleDown = useCallback(() => {
    if (!showPicker) return;
    setPickerIndex((i) => (i === filteredCommands.length - 1 ? 0 : i + 1));
  }, [showPicker, filteredCommands.length]);

  const handleEscape = useCallback(() => {
    if (streaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStreaming(false);
    } else {
      setInput("");
    }
  }, [streaming]);

  // ── Render ──

  const serverHost = serverUrl
    ? serverUrl
        .replace(/^https?:\/\//, "")
        .replace(/:443$/, "")
        .replace(/:80$/, "")
    : null;

  return (
    <Box flexDirection="column" height="100%">
      {/* ALL visible text lives here — rendered once per item, never redrawn */}
      <Static key={generation} items={staticItems}>
        {(item) => {
          switch (item.kind) {
            case "user":
              return (
                <Box key={item._key} paddingX={1} marginBottom={1}>
                  <Text color="green" bold>
                    {"❯ "}
                  </Text>
                  <Text>{item.text}</Text>
                </Box>
              );
            case "assistant":
              return (
                <Box key={item._key} paddingX={1} marginBottom={1}>
                  <Text color="blue">{"⏺ "}</Text>
                  <Text>{item.text}</Text>
                </Box>
              );
            case "chunk":
              return item.text ? (
                <Text key={item._key}>{item.text}</Text>
              ) : (
                <Box key={item._key} paddingX={1}>
                  <Text color="blue">{"⏺ "}</Text>
                </Box>
              );
            case "tool":
              return (
                <Box key={item._key} paddingX={1} marginLeft={2}>
                  <Text dimColor>
                    {"✓ "}
                    {item.name}
                  </Text>
                </Box>
              );
          }
        }}
      </Static>

      {/* Dynamic area: only input + status — tiny, no flashing */}
      <Box flexDirection="column" flexGrow={1} paddingY={0}>
        {staticItems.length === 0 && !streaming && (
          <Box paddingX={1}>
            <Text dimColor>Type a message or / for commands.</Text>
          </Box>
        )}
      </Box>

      {showPicker && (
        <SlashPicker input={input} selectedIndex={pickerIndex} filtered={filteredCommands} />
      )}

      <HRule />

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handlePickerSubmit}
        onUp={handleUp}
        onDown={handleDown}
        onEscape={handleEscape}
        pickerActive={showPicker}
        history={inputHistory}
      />

      <HRule />

      <Box paddingX={2} justifyContent="space-between">
        <Box>
          {streaming ? (
            <StreamingSpinner
              elapsed={streamElapsed}
              label={
                activeToolName
                  ? `⎔ ${activeToolName}`
                  : streamPhase === "thinking"
                    ? "Thinking"
                    : "Generating"
              }
              tokenCount={streamTokenCount}
            />
          ) : statusText !== null ? (
            <Text dimColor>{statusText}</Text>
          ) : (
            <Text dimColor>/ commands · Esc abort · Ctrl+D exit</Text>
          )}
        </Box>
        <Text dimColor>
          {currentAgent.name !== "hello-world" && currentAgent.name !== "default" ? `${currentAgent.name} · ` : ""}
          {totalTokenDisplay > 0 ? `~${totalTokenDisplay} tokens · ` : ""}
          {serverHost ?? ""}
        </Text>
      </Box>
    </Box>
  );
}

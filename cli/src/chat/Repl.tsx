/**
 * CAIPE interactive chat REPL built with Ink 5 + React 18.
 *
 * Features:
 *   - Scrollable message list with streamed token rendering
 *   - Animated spinner during response streaming
 *   - Agent + protocol + token-budget status header
 *   - Slash command picker: type "/" to open, filter by typing, navigate with ↑↓, Enter to run
 *   - Ctrl+C graceful exit
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { StreamAdapter, StreamEvent } from "./stream.js";
import type { ChatSession, Message } from "./history.js";
import { StreamingSpinner } from "../platform/display.js";
import { renderMarkdown } from "../platform/markdown.js";

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

type RenderedMessage = {
  role: "user" | "assistant";
  content: string;
  /** Streaming in progress */
  streaming?: boolean;
  /** Elapsed seconds since streaming started (updated live) */
  streamElapsed?: number;
  /** Tokens received so far in this response */
  streamTokens?: number;
  /** Tool calls made during this response */
  toolCalls?: Array<{ name: string; summary?: string }>;
};

// ---------------------------------------------------------------------------
// Slash command registry
// ---------------------------------------------------------------------------

interface SlashCommand {
  name: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/clear",   description: "Clear conversation context" },
  { name: "/compact", description: "Summarize and compress history" },
  { name: "/login",   description: "Re-authenticate with the CAIPE server" },
  { name: "/exit",    description: "End session and save history" },
  { name: "/skills",  description: "Open skills browser" },
  { name: "/agents",  description: "Switch to a different agent" },
  { name: "/memory",  description: "Edit memory file" },
  { name: "/help",    description: "Show available commands" },
];

// ---------------------------------------------------------------------------
// SlashPicker — shown above InputBar when input starts with "/"
// ---------------------------------------------------------------------------

interface SlashPickerProps {
  input: string;          // full input including leading "/"
  selectedIndex: number;
  filtered: SlashCommand[];
}

function SlashPicker({ input, selectedIndex, filtered }: SlashPickerProps): React.ReactElement {
  const query = input.slice(1).toLowerCase(); // text after "/"

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
          const selected = i === selectedIndex;
          return (
            <Box key={cmd.name} paddingX={1}>
              <Text color={selected ? "cyan" : undefined}>
                {selected ? "▶ " : "  "}
              </Text>
              <Text
                color={selected ? "cyan" : "white"}
                bold={selected}
              >
                {cmd.name.padEnd(14)}
              </Text>
              <Text dimColor={!selected} color={selected ? "white" : undefined}>
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
// InputBar — text input with cursor
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
}

function InputBar({
  value,
  onChange,
  onSubmit,
  onUp,
  onDown,
  onEscape,
  pickerActive,
  disabled = false,
}: InputBarProps): React.ReactElement {
  useInput(
    (char, key) => {
      if (disabled) return;

      if (key.upArrow) {
        onUp();
        return;
      }

      if (key.downArrow) {
        onDown();
        return;
      }

      if (key.escape) {
        onEscape();
        return;
      }

      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          onChange("");
        }
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      if (key.ctrl && char === "c") {
        onSubmit("/stop-or-exit");
        return;
      }

      if (key.escape) {
        onEscape();
        return;
      }

      if (key.ctrl && char === "d") {
        onSubmit("/ctrl-d");
        return;
      }

      if (!key.ctrl && !key.meta && char) {
        onChange(value + char);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box paddingX={1}>
      <Text color={disabled ? "gray" : "green"} bold>{"❯ "}</Text>
      <Text>{value}</Text>
      {!disabled && <Text color="green">▊</Text>}
      {pickerActive && (
        <Text dimColor>  ↑↓ · Enter · Esc</Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// MessageItem
// ---------------------------------------------------------------------------

interface MessageProps {
  message: RenderedMessage;
  index: number;
}

function MessageItem({ message, index }: MessageProps): React.ReactElement {
  const isUser = message.role === "user";

  return (
    <Box key={index} flexDirection="column" marginBottom={1}>
      {isUser ? (
        /* User message: ❯ <text> */
        <Box>
          <Text color="green" bold>{"❯ "}</Text>
          <Text>{message.content}</Text>
        </Box>
      ) : message.streaming === true ? (
        /* Streaming: spinner status line + tool calls + accumulated text below */
        <Box flexDirection="column">
          <StreamingSpinner
            elapsed={message.streamElapsed ?? 0}
            tokenCount={message.streamTokens ?? 0}
          />
          {(message.toolCalls ?? []).map((tc, i) => (
            <Box key={i} marginLeft={2}>
              <Text dimColor>{"⎔ "}{tc.name}</Text>
              {tc.summary != null && (
                <Text dimColor color="gray"> {tc.summary}</Text>
              )}
            </Box>
          ))}
          {message.content.length > 0 && (
            <Box marginLeft={2}>
              <Text>{renderMarkdown(message.content)}</Text>
            </Box>
          )}
        </Box>
      ) : (
        /* Completed AI response: ⏺ <text> + completed tool calls */
        <Box flexDirection="column">
          {(message.toolCalls ?? []).map((tc, i) => (
            <Box key={i} marginLeft={2}>
              <Text dimColor>{"✓ "}{tc.name}</Text>
            </Box>
          ))}
          <Box>
            <Text color="blue">{"⏺ "}</Text>
            <Text>{renderMarkdown(message.content)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Horizontal rule helper
// ---------------------------------------------------------------------------

function HRule({ color = "gray" }: { color?: string }): React.ReactElement {
  // Ink doesn't expose terminal width directly; 80 cols is a safe floor
  const cols = process.stdout.columns ?? 80;
  return <Text color={color}>{"─".repeat(cols)}</Text>;
}

// ---------------------------------------------------------------------------
// Token budget indicator
// ---------------------------------------------------------------------------

function TokenBudget({ used, max }: { used: number; max: number }): React.ReactElement {
  const pct = Math.min(1, used / max);
  const color = pct > 0.85 ? "red" : pct > 0.65 ? "yellow" : "green";
  return (
    <Text dimColor>
      <Text color={color}>{Math.round(used / 1000)}k</Text>/{Math.round(max / 1000)}k tokens
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Main REPL
// ---------------------------------------------------------------------------

export function Repl({ session, adapter, systemContext, serverUrl, onExit }: ReplProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const tokenCountRef = useRef(0);
  const streamStartRef = useRef(0);
  const ctrlDCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const MAX_TOKENS = 100_000;

  // Compute filtered commands whenever input changes
  const filteredCommands = useMemo<SlashCommand[]>(() => {
    if (!input.startsWith("/")) return [];
    const query = input.slice(1).toLowerCase();
    if (query === "") return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(query));
  }, [input]);

  const showPicker = input.startsWith("/") && !streaming;

  // Reset picker selection when filtered list changes
  useEffect(() => {
    setPickerIndex(0);
  }, [filteredCommands.length]);

  // Tick elapsed time every second while streaming
  useEffect(() => {
    if (!streaming) return;
    streamStartRef.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - streamStartRef.current) / 1000);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          next[next.length - 1] = { ...last, streamElapsed: elapsed };
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [streaming]);

  // Graceful exit
  const handleExit = useCallback(() => {
    const finishedMessages: Message[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date().toISOString(),
      agentName: session.agentName,
      tokenCount: null,
    }));
    onExit({ ...session, messages: finishedMessages });
    exit();
  }, [messages, session, onExit, exit]);

  // Slash command executor
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
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.streaming) {
                next[next.length - 1] = { ...last, streaming: false };
              }
              return next;
            });
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
          setMessages([]);
          tokenCountRef.current = 0;
          setStatusText("Context cleared.");
          setTimeout(() => setStatusText(null), 2000);
          break;

        case "/compact":
          setStatusText("Compacting history…");
          setMessages((prev) => prev.slice(-6));
          tokenCountRef.current = Math.floor(tokenCountRef.current * 0.3);
          setTimeout(() => setStatusText(null), 1500);
          break;

        case "/help":
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: SLASH_COMMANDS.map((c) => `**${c.name}** — ${c.description}`).join("\n"),
            },
          ]);
          break;

        case "/skills":
          setStatusText("Run `caipe skills list` for the full interactive browser.");
          setTimeout(() => setStatusText(null), 3000);
          break;

        case "/agents":
          setStatusText("Run `caipe agents list` to see and switch agents.");
          setTimeout(() => setStatusText(null), 3000);
          break;

        case "/login":
          setStatusText("Re-authenticating… run `caipe auth login` outside the session, then restart.");
          setTimeout(() => setStatusText(null), 4000);
          break;

        case "/memory":
          setStatusText("Run `caipe memory` outside the session to edit memory files.");
          setTimeout(() => setStatusText(null), 3000);
          break;

        default:
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Unknown command: ${cmd}. Type / to see available commands.`,
            },
          ]);
      }
    },
    [handleExit],
  );

  // Handle submit — dispatch slash or chat
  const handleSubmit = useCallback(
    async (text: string) => {
      if (text.startsWith("/")) {
        await executeSlashCommand(text);
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      tokenCountRef.current += Math.ceil(text.length / 4);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true, streamElapsed: 0, streamTokens: 0 },
      ]);
      setStreaming(true);

      try {
        let accumulated = "";
        let responseTokens = 0;
        const gen = adapter.connect({
          prompt: text,
          systemContext,
          sessionId: session.sessionId,
          agentName: session.agentName,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        });

        for await (const ev of gen) {
          if (ev.type === "token") {
            accumulated += ev.text;
            const newTokens = Math.ceil(ev.text.length / 4);
            tokenCountRef.current += newTokens;
            responseTokens += newTokens;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: accumulated,
                  streaming: true,
                  streamTokens: responseTokens,
                };
              }
              return next;
            });
          } else if (ev.type === "tool") {
            const summary = ev.input != null
              ? JSON.stringify(ev.input).slice(0, 50)
              : undefined;
            setActiveToolName(ev.name);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                const existing = last.toolCalls ?? [];
                next[next.length - 1] = {
                  ...last,
                  toolCalls: [...existing, { name: ev.name, summary }],
                };
              }
              return next;
            });
          } else if (ev.type === "error") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: `[ERROR] ${ev.message}`, streaming: false };
              }
              return next;
            });
            break;
          } else if (ev.type === "done") {
            break;
          }
        }

        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, streaming: false };
          }
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: `[ERROR] ${msg}`, streaming: false };
          }
          return next;
        });
      } finally {
        setStreaming(false);
        setActiveToolName(null);
      }
    },
    [adapter, messages, session, systemContext, executeSlashCommand],
  );

  // Picker navigation + submit: when picker is active, Enter runs the highlighted command
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
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          next[next.length - 1] = { ...last, streaming: false };
        }
        return next;
      });
    } else {
      setInput("");
    }
  }, [streaming]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Compact server host for display (strip scheme, port 443/80)
  const serverHost = serverUrl
    ? serverUrl.replace(/^https?:\/\//, "").replace(/:443$/, "").replace(/:80$/, "")
    : null;

  return (
    <Box flexDirection="column" height="100%">
      {/* Header: caipe  agent  server (subtle) */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">caipe</Text>
        <Text dimColor>
          {session.agentName !== "default" && (
            <Text>{session.agentName}{"  "}</Text>
          )}
          {serverHost !== null && <Text>{serverHost}</Text>}
        </Text>
        <TokenBudget used={tokenCountRef.current} max={MAX_TOKENS} />
      </Box>

      <HRule />

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1} paddingY={1}>
        {messages.length === 0 && (
          <Text dimColor>Type a message or / for commands.</Text>
        )}
        {messages.map((msg, i) => (
          <MessageItem key={i} message={msg} index={i} />
        ))}
        {statusText !== null && (
          <Text dimColor>{statusText}</Text>
        )}
      </Box>

      {/* Slash command picker */}
      {showPicker && (
        <SlashPicker
          input={input}
          selectedIndex={pickerIndex}
          filtered={filteredCommands}
        />
      )}

      <HRule />

      {/* Input — borderless, just ❯ prompt */}
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handlePickerSubmit}
        onUp={handleUp}
        onDown={handleDown}
        onEscape={handleEscape}
        pickerActive={showPicker}
        disabled={streaming}
      />

      <HRule />

      {/* Activity zone: tool calls or keyboard hints */}
      <Box paddingX={2}>
        {streaming && activeToolName !== null ? (
          <Text dimColor>{"⎔ "}{activeToolName}{" · esc to interrupt"}</Text>
        ) : streaming ? (
          <Text dimColor>esc to interrupt · Ctrl+D (twice) to exit</Text>
        ) : statusText !== null ? null : (
          <Text dimColor>? for shortcuts · Ctrl+C to stop · Ctrl+D (twice) to exit</Text>
        )}
      </Box>
    </Box>
  );
}

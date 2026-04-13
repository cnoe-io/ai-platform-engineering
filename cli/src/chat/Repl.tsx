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
        onSubmit("/exit");
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
    <Box borderStyle="round" borderColor={disabled ? "gray" : "cyan"} paddingX={1}>
      <Text color="cyan">{">"} </Text>
      <Text>{value}</Text>
      {!disabled && <Text color="cyan">█</Text>}
      {pickerActive && (
        <Text dimColor> ↑↓ navigate  Enter select  Esc dismiss</Text>
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
      <Box>
        {message.streaming === true ? (
          <StreamingSpinner
            elapsed={message.streamElapsed ?? 0}
            tokenCount={message.streamTokens ?? 0}
          />
        ) : (
          <Text bold color={isUser ? "green" : "blue"}>
            {isUser ? "You" : "CAIPE"}
          </Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text>{isUser ? message.content : renderMarkdown(message.content)}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Token budget indicator
// ---------------------------------------------------------------------------

function TokenBudget({ used, max }: { used: number; max: number }): React.ReactElement {
  const pct = Math.min(1, used / max);
  const color = pct > 0.85 ? "red" : pct > 0.65 ? "yellow" : "green";
  return (
    <Text dimColor>
      tokens: <Text color={color}>{Math.round(used / 1000)}k</Text>/{Math.round(max / 1000)}k
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Main REPL
// ---------------------------------------------------------------------------

export function Repl({ session, adapter, systemContext, onExit }: ReplProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const tokenCountRef = useRef(0);
  const streamStartRef = useRef(0);
  const ctrlDCountRef = useRef(0);
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
    setInput("");
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Box flexDirection="column" height="100%">
      {/* Status header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">caipe</Text>
        <Text dimColor>
          agent: <Text color="white">{session.agentName}</Text>
          {"  "}protocol: <Text color="white">{session.protocol}</Text>
        </Text>
        <TokenBudget used={tokenCountRef.current} max={MAX_TOKENS} />
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1} paddingY={1}>
        {messages.length === 0 && (
          <Box>
            <Text dimColor>Type a message or / to see commands.</Text>
          </Box>
        )}
        {messages.map((msg, i) => (
          <MessageItem key={i} message={msg} index={i} />
        ))}
        {statusText !== null && (
          <Box>
            <Text dimColor>{statusText}</Text>
          </Box>
        )}
      </Box>

      {/* Slash command picker — shown above input when input starts with "/" */}
      {showPicker && (
        <SlashPicker
          input={input}
          selectedIndex={pickerIndex}
          filtered={filteredCommands}
        />
      )}

      {/* Input */}
      <InputBar
        value={input}
        onChange={(v) => {
          setInput(v);
        }}
        onSubmit={handlePickerSubmit}
        onUp={handleUp}
        onDown={handleDown}
        onEscape={handleEscape}
        pickerActive={showPicker}
        disabled={streaming}
      />

      <Box paddingX={1}>
        <Text dimColor>Ctrl+C · Ctrl+D×2 · /exit to end session</Text>
      </Box>
    </Box>
  );
}

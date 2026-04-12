/**
 * CAIPE interactive chat REPL built with Ink 5 + React 19.
 *
 * Features:
 *   - Scrollable message list with streamed token rendering
 *   - Animated spinner during response streaming
 *   - Agent + protocol + token-budget status header
 *   - Logo on first render
 *   - Slash commands: /clear /compact /exit /skills /agents /memory
 *   - Ctrl+C graceful exit
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";

import type { StreamAdapter, StreamEvent } from "./stream.js";
import type { ChatSession, Message } from "./history.js";
import { Spinner } from "../platform/display.js";
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
};

// ---------------------------------------------------------------------------
// Slash command registry
// ---------------------------------------------------------------------------

const SLASH_COMMANDS: Record<string, string> = {
  "/clear": "Clear conversation context",
  "/compact": "Summarize and compress history",
  "/exit": "End session and save history",
  "/skills": "Open skills browser",
  "/agents": "Switch to a different agent",
  "/memory": "Edit memory file",
  "/help": "Show available commands",
};

// ---------------------------------------------------------------------------
// InputBar component
// ---------------------------------------------------------------------------

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
}

function InputBar({ value, onChange, onSubmit, disabled = false }: InputBarProps): React.ReactElement {
  useInput(
    (char, key) => {
      if (disabled) return;

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
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Message component
// ---------------------------------------------------------------------------

interface MessageProps {
  message: RenderedMessage;
  index: number;
}

function MessageItem({ message, index }: MessageProps): React.ReactElement {
  const isUser = message.role === "user";

  return (
    <Box
      key={index}
      flexDirection="column"
      marginBottom={1}
    >
      <Box>
        <Text
          bold
          color={isUser ? "green" : "blue"}
        >
          {isUser ? "You" : "CAIPE"}
        </Text>
        {message.streaming === true && (
          <Box marginLeft={1}>
            <Spinner label="" color="blue" />
          </Box>
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
  const tokenCountRef = useRef(0);
  const MAX_TOKENS = 100_000;

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

  // Slash command dispatcher
  const handleSlashCommand = useCallback(
    async (cmd: string) => {
      const base = cmd.split(" ")[0]?.toLowerCase();

      switch (base) {
        case "/exit":
          handleExit();
          break;

        case "/clear":
          setMessages([]);
          tokenCountRef.current = 0;
          setStatusText("Context cleared.");
          setTimeout(() => setStatusText(null), 2000);
          break;

        case "/compact":
          setStatusText("Compacting history…");
          // TODO T021: call summarize API; for now just trim old messages
          setMessages((prev) => prev.slice(-6));
          tokenCountRef.current = Math.floor(tokenCountRef.current * 0.3);
          setTimeout(() => setStatusText(null), 1500);
          break;

        case "/help":
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: Object.entries(SLASH_COMMANDS)
                .map(([k, v]) => `**${k}** — ${v}`)
                .join("\n"),
            },
          ]);
          break;

        case "/skills":
          setStatusText("Opening skills browser… (run `caipe skills list` for full browser)");
          setTimeout(() => setStatusText(null), 3000);
          break;

        case "/agents":
          setStatusText("Opening agent list… (run `caipe agents list` for full list)");
          setTimeout(() => setStatusText(null), 3000);
          break;

        case "/memory":
          setStatusText("Opening memory editor… (run `caipe memory` outside session)");
          setTimeout(() => setStatusText(null), 3000);
          break;

        default:
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Unknown command: ${cmd}. Type /help to see available commands.`,
            },
          ]);
      }
    },
    [handleExit],
  );

  // Send a message to the agent
  const handleSubmit = useCallback(
    async (text: string) => {
      if (text.startsWith("/")) {
        await handleSlashCommand(text);
        return;
      }

      // Add user message
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      tokenCountRef.current += Math.ceil(text.length / 4);

      // Add placeholder assistant message
      const assistantIdx = messages.length + 1;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);
      setStreaming(true);

      try {
        let accumulated = "";
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
            tokenCountRef.current += Math.ceil(ev.text.length / 4);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: accumulated,
                  streaming: true,
                };
              }
              return next;
            });
          } else if (ev.type === "error") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: `[ERROR] ${ev.message}`,
                  streaming: false,
                };
              }
              return next;
            });
            break;
          } else if (ev.type === "done") {
            break;
          }
        }

        // Mark streaming done
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
            next[next.length - 1] = {
              ...last,
              content: `[ERROR] ${msg}`,
              streaming: false,
            };
          }
          return next;
        });
      } finally {
        setStreaming(false);
        void assistantIdx;
      }
    },
    [adapter, messages, session, systemContext, handleSlashCommand],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Box flexDirection="column" height="100%">
      {/* Status header */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          caipe
        </Text>
        <Text dimColor>
          agent:{" "}
          <Text color="white">{session.agentName}</Text>
          {"  "}protocol:{" "}
          <Text color="white">{session.protocol}</Text>
        </Text>
        <TokenBudget used={tokenCountRef.current} max={MAX_TOKENS} />
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1} paddingY={1}>
        {messages.length === 0 && (
          <Box>
            <Text dimColor>
              Type a message to start chatting. Use /help for available commands.
            </Text>
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

      {/* Input */}
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={streaming}
      />

      <Box paddingX={1}>
        <Text dimColor>Ctrl+C or /exit to end session</Text>
      </Box>
    </Box>
  );
}

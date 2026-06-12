"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Loader2, Wrench } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "@/components/shared/timeline";

/**
 * Tome chat — the primary surface of a project's tome. Talks to the tome chat
 * agent via `POST /api/tome/projects/<slug>/chat`, which proxies an SSE stream
 * from the reused TTT Python agent (contract: `event: token|tool_call|
 * tool_result|session|done|error`). Grounded in the project's wiki; the agent
 * can cite and edit pages.
 *
 * Until the agent service is wired (`TOME_AGENT_URL`), the endpoint returns a
 * clear "not connected" message which renders inline — no throwaway UI.
 */

type Role = "user" | "assistant";

/**
 * A turn is an ordered list of parts in stream-arrival order — the SDK already
 * emits text deltas and tool calls interleaved, so we just preserve that order
 * instead of flattening text into one blob and tools into a separate bucket.
 */
type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string; path?: string };

interface ChatMsg {
  role: Role;
  parts: Part[];
  pending?: boolean;
}

interface Props {
  slug: string;
  /** Called when the agent reports it wrote a page, so the wiki can refresh. */
  onPagesChanged?: () => void;
  /** Open a wiki page (referenced by a tool chip) in the artifact pane. */
  onOpenPage?: (path: string) => void;
}

export function ChatPanel({ slug, onPagesChanged, onOpenPage }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the transcript pinned to the latest turn.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);
    setMessages((m) => [
      ...m,
      { role: "user", parts: [{ kind: "text", text }] },
      { role: "assistant", parts: [], pending: true },
    ]);

    // Mutate the last (assistant) message in place as the stream arrives.
    const patchLast = (fn: (m: ChatMsg) => ChatMsg) =>
      setMessages((msgs) => {
        const copy = msgs.slice();
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    // Append a token to the trailing text part, or open a new one if the last
    // part was a tool — this is what keeps text/tool order intact.
    const appendToken = (t: string) =>
      patchLast((m) => {
        const parts = m.parts.slice();
        const last = parts[parts.length - 1];
        if (last && last.kind === "text") {
          parts[parts.length - 1] = { kind: "text", text: last.text + t };
        } else {
          parts.push({ kind: "text", text: t });
        }
        return { ...m, parts };
      });

    const pushTool = (label: string, path?: string) =>
      patchLast((m) => ({
        ...m,
        parts: [...m.parts, { kind: "tool", label, path }],
      }));

    const pushErrorIfEmpty = (message: string) =>
      patchLast((m) => {
        const hasText = m.parts.some(
          (p) => p.kind === "text" && p.text.trim(),
        );
        return {
          ...m,
          pending: false,
          parts: hasText
            ? m.parts
            : [...m.parts, { kind: "text", text: `⚠️ ${message}` }],
        };
      });

    try {
      const res = await fetch(`/api/tome/projects/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sdk_session_id: sessionRef.current,
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        pushErrorIfEmpty(
          res.status === 503
            ? "The tome agent isn't connected yet (set `TOME_AGENT_URL`). Chat will work once the agent service is running."
            : `Chat failed (${res.status}). ${detail.slice(0, 300)}`,
        );
        return;
      }

      await consumeSse(res.body, {
        onToken: appendToken,
        onTool: pushTool,
        onSession: (id) => {
          sessionRef.current = id;
        },
        onPageWritten: () => onPagesChanged?.(),
        onError: pushErrorIfEmpty,
      });
      patchLast((m) => ({ ...m, pending: false }));
    } catch (e) {
      pushErrorIfEmpty(String((e as Error)?.message ?? e));
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, slug, onPagesChanged]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea viewportRef={scrollRef} className="flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
          {messages.length === 0 && <EmptyState slug={slug} />}
          {messages.map((m, i) => (
            <MessageRow key={i} msg={m} onOpenPage={onOpenPage} />
          ))}
        </div>
      </ScrollArea>

      {/* Floating composer — no hard divider above it; sits over the transcript. */}
      <div className="pointer-events-none px-4 pb-5 pt-2">
        <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur transition focus-within:ring-2 focus-within:ring-ring">
          <TextareaAutosize
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            minRows={1}
            maxRows={10}
            placeholder="Ask about this project…"
            className="flex-1 resize-none border-0 bg-transparent py-1 text-sm leading-relaxed outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            onClick={() => void send()}
            disabled={!input.trim() || streaming}
            title="Send"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">Chat with tome</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Ask about <span className="font-medium">{slug}</span> — status, recent
        changes, what shipped, who&apos;s working on what. The agent reads this
        project&apos;s wiki and sources, and can update pages for you.
      </p>
    </div>
  );
}

function MessageRow({
  msg,
  onOpenPage,
}: {
  msg: ChatMsg;
  onOpenPage?: (path: string) => void;
}) {
  const isUser = msg.role === "user";

  if (isUser) {
    const text = msg.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }

  // Assistant: render parts in arrival order — text segments and tool chips
  // interleaved exactly as the stream produced them.
  const lastTextIdx = msg.parts.reduce(
    (acc, p, i) => (p.kind === "text" ? i : acc),
    -1,
  );
  const lastPart = msg.parts[msg.parts.length - 1];
  const showDots =
    msg.pending && (msg.parts.length === 0 || lastPart?.kind === "tool");

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex max-w-[80%] flex-col gap-2">
        {msg.parts.map((p, i) =>
          p.kind === "tool" ? (
            <ToolChip
              key={i}
              label={p.label}
              path={p.path}
              onOpen={onOpenPage}
            />
          ) : (
            <div
              key={i}
              className="rounded-2xl bg-muted px-4 py-2 text-sm text-foreground"
            >
              <MarkdownRenderer
                content={p.text}
                isStreaming={Boolean(msg.pending) && i === lastTextIdx}
                variant="final"
              />
            </div>
          ),
        )}
        {showDots && (
          <div className="rounded-2xl bg-muted px-4 py-2 text-foreground">
            <PendingDots />
          </div>
        )}
      </div>
    </div>
  );
}

function ToolChip({
  label,
  path,
  onOpen,
}: {
  label: string;
  path?: string;
  onOpen?: (path: string) => void;
}) {
  const clickable = Boolean(path && onOpen);
  const className =
    "inline-flex max-w-[280px] items-center gap-1 self-start rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" +
    (clickable
      ? " cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
      : "");
  const content = (
    <>
      <Wrench className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  if (clickable) {
    return (
      <button
        type="button"
        title={`Open ${path}`}
        onClick={() => onOpen!(path!)}
        className={className}
      >
        {content}
      </button>
    );
  }
  return (
    <span title={label} className={className}>
      {content}
    </span>
  );
}

function PendingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// SSE consumption — parses `event: <type>\ndata: <json>\n\n` frames.
// ---------------------------------------------------------------------------

interface SseHandlers {
  onToken: (text: string) => void;
  onTool: (label: string, path?: string) => void;
  onSession: (id: string) => void;
  onPageWritten: () => void;
  onError: (message: string) => void;
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  h: SseHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      handleFrame(frame, h);
    }
  }
  if (buf.trim()) handleFrame(buf, h);
}

/**
 * Turn a tool_call event into a readable chip label, e.g. `Read overview.md`,
 * `Glob *.md`, `Grep "auth"`, `github_get_file caipe/ui`. Falls back to the
 * bare tool name when no recognizable argument is present.
 */
function describeTool(tool: string, rawInput: unknown): string {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  // Friendlier tool names (strip MCP prefixes like `mcp__github__`).
  const name = tool.replace(/^mcp__[^_]+__/, "").replace(/^github_/, "gh:");
  const arg = pick(
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "repo",
    "prompt",
  );
  if (!arg) return name;
  const short = arg.replace(/^\.\//, "");
  const quoted = /\s/.test(short) ? `"${short}"` : short;
  return `${name} ${quoted}`;
}

function handleFrame(frame: string, h: SseHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  switch (event) {
    case "token":
      if (typeof data.text === "string") h.onToken(data.text);
      break;
    case "tool_call": {
      const tool = String(data.tool ?? data.name ?? "tool");
      const input = (data.input ?? {}) as Record<string, unknown>;
      const fp =
        (typeof input.file_path === "string" && input.file_path) ||
        (typeof input.path === "string" && input.path) ||
        "";
      const pagePath = fp.replace(/^\.\//, "").trim();
      const isPage = /\.md$/.test(pagePath);
      h.onTool(describeTool(tool, data.input), isPage ? pagePath : undefined);
      // Edit/Write (and the agent's persist hook) mutate wiki pages.
      if (/write|edit/i.test(tool)) h.onPageWritten();
      break;
    }
    case "tool_result":
      break;
    case "session":
      if (typeof data.session_id === "string") h.onSession(data.session_id);
      break;
    case "error":
      h.onError(String(data.message ?? "agent error"));
      break;
    case "done":
      break;
  }
}

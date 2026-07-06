"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  CircleCheck,
  CircleDot,
  CircleX,
  GitCommit,
  GitPullRequest,
  Loader2,
  Megaphone,
  MessagesSquare,
  RefreshCw,
  Rss,
  Tag,
  User,
} from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MarkdownRenderer } from "@/components/shared/timeline";
import { cn } from "@/lib/utils";

/**
 * The project's Feed: conversation ABOUT the project plus live activity
 * (source events, ingest runs, promoted actions), all backed by one Mycelium
 * room (one room per project). The wiki holds the context; this holds the
 * discussion and the signal around it. Messages are attributed to the
 * CAIPE-authenticated user; agents posting via the MCP show up here under
 * their own identity too.
 *
 * Reverse infinite scroll: the newest page loads first (pinned to the bottom);
 * scrolling up loads older pages and anchors the viewport so it doesn't jump.
 * A short poll merges newly-arrived messages by id. Mycelium returns messages
 * newest-first with limit/offset; we hold them ascending for display.
 */

interface FeedMessage {
  id: string;
  sender_handle: string;
  recipient_handle: string | null;
  message_type: string;
  content: string;
  created_at: string;
  display_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Any typed `event` message's kind + payload, before we know which one. */
function feedEventMeta(m: FeedMessage): { kind: string; payload?: Record<string, unknown> } | null {
  if (m.message_type !== "event") return null;
  const md = m.metadata as { kind?: string; payload?: Record<string, unknown> } | null | undefined;
  if (!md?.kind) return null;
  return { kind: md.kind, payload: md.payload };
}

/** The asset an event concerns (mirrors the producer's SourceArtifact). */
type SourceArtifact = "pr" | "issue" | "release" | "commit";

/** Payload carried by a `source_event` feed item: a GitHub/etc. activity item. */
interface SourceEventPayload {
  source?: string;
  artifact?: SourceArtifact;
  event?: string;
  repo?: string;
  ref?: string;
  url?: string;
  actor?: string | null;
  ts?: string;
}

/** Payload carried by an `ingest_event` feed item — an ingest/synthesize run's
 * lifecycle transition, emitted the same way source events are. */
interface IngestEventPayload {
  run_id?: string;
  mode?: "ingest" | "bhag_rollup";
  status?: "running" | "succeeded" | "failed";
}

/** "View" button label per asset type. Keyed off the typed `artifact`
 * discriminator the producer sets — no parsing of the event string. */
const VIEW_LABEL: Record<SourceArtifact, string> = {
  pr: "View PR",
  issue: "View issue",
  release: "View release",
  commit: "View commit",
};

function viewLabel(artifact: SourceArtifact | undefined): string {
  return artifact ? VIEW_LABEL[artifact] : "View";
}

/** Icon per asset type, keyed off the typed `artifact` (Rss = generic feed). */
const ARTIFACT_ICON: Record<SourceArtifact, typeof GitPullRequest> = {
  pr: GitPullRequest,
  issue: CircleDot,
  release: Tag,
  commit: GitCommit,
};

/** Icon per ingest-run status. */
const INGEST_ICON: Record<NonNullable<IngestEventPayload["status"]>, typeof RefreshCw> = {
  running: RefreshCw,
  succeeded: CircleCheck,
  failed: CircleX,
};

/** Compact relative time, e.g. "just now", "2h ago", "3d ago". */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const PAGE = 30;
const POLL_MS = 4000;
const NEAR_TOP_PX = 80;
const NEAR_BOTTOM_PX = 80;

/** "jovarney@cisco.com" → "jovarney"; leave non-emails as-is. */
function displayName(handle: string): string {
  return handle.includes("@") ? handle.split("@")[0] : handle;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** Up to two initials from a display name or handle: "Julia Valenti" → "JV". */
function initialsOf(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts.length ? parts : [name]).slice(0, 2).map((p) => p[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/**
 * Best-effort agent vs human split: people post under an email handle; agents
 * (via MCP / connectors) post under a non-email handle. Easy to refine later.
 */
function isAgentHandle(handle: string): boolean {
  return !handle.includes("@");
}

interface Participant {
  handle: string;
  name: string;
  isAgent: boolean;
}

export function FeedPanel({
  slug,
  onOpenPage,
  onOpenIngestRun,
}: {
  slug: string;
  /** Navigate to a wiki page when an internal `tome://` link is clicked. */
  onOpenPage?: (path: string) => void;
  /** Navigate to an ingest run's detail view from an `ingest_event` row. */
  onOpenIngestRun?: (runId: string) => void;
}) {
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  // Mycelium's `total` is just the returned-page size, not a grand total, so we
  // can't use it for hasMore. Instead we stop paging when an older fetch returns
  // a short page (fewer than PAGE) or yields no new ids.
  const [reachedStart, setReachedStart] = useState(false);
  const firstLoadRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deep link to one message (feed-message links, e.g. from a promoted
  // action): scroll to it and pulse-highlight once it's loaded, paging
  // older until found or the room's start is reached.
  const targetMessageId = useSearchParams().get("to_message");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const targetResolvedRef = useRef(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Set before a prepend so the layout effect can keep the viewport anchored.
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  // Whether to pin to the bottom after the next render (new message + at bottom).
  const stickBottomRef = useRef(true);
  // First visit to the panel should land on the newest message (unless a
  // `to_message` deep link takes over). Resets on remount (i.e. each time the
  // Feed view is opened).
  const initialScrollRef = useRef(false);

  const hasMore = !reachedStart;

  // Unique participants seen in the loaded conversation (grows as older pages
  // load). Agents first, then people; each sorted by name.
  const participants = useMemo<Participant[]>(() => {
    const byHandle = new Map<string, Participant>();
    for (const m of messages) {
      // Activity events aren't conversation participants.
      if (m.message_type === "event") continue;
      if (byHandle.has(m.sender_handle)) continue;
      byHandle.set(m.sender_handle, {
        handle: m.sender_handle,
        name: m.display_name || displayName(m.sender_handle),
        isAgent: isAgentHandle(m.sender_handle),
      });
    }
    return [...byHandle.values()].sort(
      (a, b) =>
        Number(b.isAgent) - Number(a.isAgent) || a.name.localeCompare(b.name),
    );
  }, [messages]);

  const merge = useCallback((batch: FeedMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of batch) byId.set(m.id, m);
      return [...byId.values()].sort(
        (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
      );
    });
  }, []);

  const fetchPage = useCallback(
    async (offset: number): Promise<{ messages: FeedMessage[]; total: number } | null> => {
      const res = await fetch(`/api/tome/projects/${slug}/feed?limit=${PAGE}&offset=${offset}`, {
        cache: "no-store",
      });
      if (res.status === 503) {
        setNotConfigured(true);
        return null;
      }
      if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
      const body = await res.json();
      return {
        messages: (body?.data?.messages ?? body?.messages ?? []) as FeedMessage[],
        total: (body?.data?.total ?? body?.total ?? 0) as number,
      };
    },
    [slug],
  );

  // Live: poll the newest page and merge. Pin to bottom only if already there.
  const poll = useCallback(async () => {
    try {
      const page = await fetchPage(0);
      if (!page) return;
      const vp = viewportRef.current;
      stickBottomRef.current = vp
        ? vp.scrollHeight - vp.scrollTop - vp.clientHeight < NEAR_BOTTOM_PX
        : true;
      // First newest-page fetch: a short page means the whole room fits, no older.
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        if (page.messages.length < PAGE) setReachedStart(true);
      }
      merge(page.messages);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchPage, merge]);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    if (notConfigured) return;
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll, notConfigured]);

  // Older: fetch the next page past what we hold, prepend, keep viewport anchored.
  const loadOlder = useCallback(async () => {
    const vp = viewportRef.current;
    if (!vp || loadingOlder || reachedStart) return;
    setLoadingOlder(true);
    restoreRef.current = { height: vp.scrollHeight, top: vp.scrollTop };
    try {
      const page = await fetchPage(messages.length);
      if (page) {
        const existing = new Set(messages.map((m) => m.id));
        const fresh = page.messages.filter((m) => !existing.has(m.id));
        // Short page or nothing new → we've reached the start.
        if (page.messages.length < PAGE || fresh.length === 0) setReachedStart(true);
        if (fresh.length === 0) restoreRef.current = null;
        merge(page.messages);
      }
    } catch (e) {
      restoreRef.current = null;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingOlder(false);
    }
  }, [fetchPage, merge, messages, loadingOlder, reachedStart]);

  // Scroll listener: near the top → load older.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onScroll = () => {
      if (vp.scrollTop < NEAR_TOP_PX) void loadOlder();
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, [loadOlder]);

  // `?to_message=<id>` deep link: keep paging older until the target shows up
  // (it may be well before the initially-loaded window) or the room's start
  // is reached, then scroll to it and pulse-highlight briefly.
  useEffect(() => {
    if (!targetMessageId || targetResolvedRef.current || loading) return;
    if (messages.some((m) => m.id === targetMessageId)) {
      targetResolvedRef.current = true;
      requestAnimationFrame(() => {
        document
          .getElementById(`feed-message-${targetMessageId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      setHighlightId(targetMessageId);
      const t = setTimeout(() => setHighlightId(null), 2500);
      return () => clearTimeout(t);
    }
    if (!hasMore) {
      targetResolvedRef.current = true; // not found, give up quietly
      return;
    }
    void loadOlder();
  }, [targetMessageId, messages, loading, hasMore, loadOlder]);

  // After messages render: restore anchor on prepend, else pin to bottom if sticky.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (restoreRef.current) {
      vp.scrollTop = restoreRef.current.top + (vp.scrollHeight - restoreRef.current.height);
      restoreRef.current = null;
      return;
    }
    if (!initialScrollRef.current && messages.length > 0) {
      // First content render: always land on the newest message, UNLESS a
      // `to_message` deep link is resolving (that effect owns the scroll then).
      // Re-pin on the next frame as a backstop in case markdown height settles
      // after layout.
      initialScrollRef.current = true;
      if (!targetMessageId) {
        vp.scrollTop = vp.scrollHeight;
        requestAnimationFrame(() => {
          const v = viewportRef.current;
          if (v) v.scrollTop = v.scrollHeight;
        });
      }
      return;
    }
    if (stickBottomRef.current && !targetMessageId) {
      vp.scrollTop = vp.scrollHeight;
    }
  }, [messages, targetMessageId]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.message || b?.error || `Send failed (${res.status})`);
      }
      setDraft("");
      stickBottomRef.current = true; // jump to our just-sent message
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [draft, sending, slug, poll]);

  if (notConfigured) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center text-sm text-muted-foreground">
          <MessagesSquare className="mx-auto mb-3 h-8 w-8 opacity-50" />
          The Feed isn’t configured on this deployment.
          <div className="mt-1 text-xs">
            Set <code>MYCELIUM_URL</code> to enable it.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {participants.length > 0 && (
        <div className="flex items-center justify-end border-b px-4 py-2">
          <ParticipantStack participants={participants} />
        </div>
      )}
      <ScrollArea viewportRef={viewportRef} className="flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-0 p-4">
          {loadingOlder && (
            <div className="flex justify-center py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          )}
          {!hasMore && messages.length > 0 && (
            <p className="py-1 text-center text-[11px] text-muted-foreground/70">
              Beginning of the conversation
            </p>
          )}
          {loading && messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading the feed…</p>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <MessagesSquare className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">The {slug} feed</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Conversation about <span className="font-medium">{slug}</span>, plus its live
                activity, powered by Mycelium. People and agents post decisions, questions, and
                updates; source activity and ingest runs show up here too. The wiki holds the
                durable context; this holds the conversation and signal around it.
              </p>
            </div>
          ) : (
            messages.map((m, i) => {
              const evt = feedEventMeta(m);
              // Activity events render as a distinct full-width bar interleaved
              // in the stream, not a chat bubble.
              if (evt?.kind === "source_event") {
                return (
                  <SourceEventRow
                    key={m.id}
                    m={m}
                    payload={(evt.payload ?? {}) as SourceEventPayload}
                    highlighted={m.id === highlightId}
                  />
                );
              }
              if (evt?.kind === "ingest_event") {
                return (
                  <IngestEventRow
                    key={m.id}
                    m={m}
                    payload={(evt.payload ?? {}) as IngestEventPayload}
                    onOpenIngestRun={onOpenIngestRun}
                    highlighted={m.id === highlightId}
                  />
                );
              }
              if (evt?.kind === "promoted_action") {
                return (
                  <PromotedActionRow
                    key={m.id}
                    m={m}
                    onOpenPage={onOpenPage}
                    highlighted={m.id === highlightId}
                  />
                );
              }
              if (evt) return null; // unrecognized event kind — skip rather than mis-render
              const prev = i > 0 ? messages[i - 1] : null;
              // Posted via the MCP (agent acting as the user) vs typed in the UI.
              // Agents post with message_type "announce" (the only valid
              // room-wide Mycelium type we use for this); humans use "broadcast".
              const isAgent = m.message_type === "announce";
              // Discord-style grouping: consecutive messages from the same
              // sender within 5 minutes share one header. Break the group when
              // the source flips (human vs agent) so the badge stays accurate.
              const grouped =
                prev !== null &&
                prev.sender_handle === m.sender_handle &&
                (prev.message_type === "announce") === isAgent &&
                Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60 * 1000;
              return (
                <div
                  key={m.id}
                  id={`feed-message-${m.id}`}
                  className={cn(
                    "relative rounded-lg pl-12 transition-colors",
                    grouped ? "mt-0.5" : "mt-4 first:mt-0",
                    m.id === highlightId && "bg-primary/10",
                  )}
                >
                  {!grouped && (
                    <>
                      {/* Avatar sits in the left gutter, out of flow, so grouped
                          messages align cleanly under the first one. Agents get
                          a distinct violet tint. */}
                      <div
                        className={cn(
                          "absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-medium text-white",
                          isAgent
                            ? "bg-gradient-to-br from-violet-500 to-indigo-600"
                            : "gradient-primary-br",
                        )}
                      >
                        {initialsOf(m.display_name || m.sender_handle)}
                      </div>
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {m.display_name || displayName(m.sender_handle)}
                        </span>
                        {isAgent && (
                          <span className="inline-flex items-center gap-0.5 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-px text-[10px] font-medium text-violet-500">
                            <Bot className="h-3 w-3" />
                            agent
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {timeLabel(m.created_at)}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="break-words text-sm text-foreground/90">
                    <MarkdownRenderer
                      content={m.content}
                      variant="final"
                      onInternalLink={onOpenPage}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Composer, matches the agent chat's floating bar aesthetic. */}
      <div className="pointer-events-none px-4 pb-2 pt-2">
        {error && (
          <p className="pointer-events-auto mx-auto mb-1.5 max-w-4xl text-center text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-2 rounded-2xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur transition focus-within:ring-2 focus-within:ring-ring">
          <TextareaAutosize
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            minRows={1}
            maxRows={10}
            placeholder="Message the feed…"
            className="flex-1 resize-none border-0 bg-transparent py-1 text-sm leading-relaxed outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            title="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="pointer-events-auto mx-auto mt-1.5 max-w-4xl text-center text-[11px] text-muted-foreground">
          <a
            href="https://mycelium-io.github.io/"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground hover:underline"
          >
            Powered by Mycelium
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * A source-activity event rendered as a full-width bar: source icon on
 * the left, the event label + context subline in the middle, and a "view the
 * asset" button on the right. Distinct from chat bubbles so machine feed reads
 * as feed, not conversation.
 */
function SourceEventRow({
  m,
  payload,
  highlighted,
}: {
  m: FeedMessage;
  payload: SourceEventPayload;
  highlighted?: boolean;
}) {
  const Icon = payload.artifact ? ARTIFACT_ICON[payload.artifact] : Rss;
  const sub = [payload.actor ? `@${payload.actor}` : null, payload.repo, relativeTime(payload.ts || m.created_at)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div id={`feed-message-${m.id}`} className="mt-2 first:mt-0">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 transition-colors",
          highlighted && "border-primary/40 bg-primary/10",
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground/90">{m.content}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        {payload.url && (
          <a
            href={payload.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-foreground/80 transition hover:bg-background hover:text-foreground"
          >
            {viewLabel(payload.artifact)}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/** An ingest/synthesize run's lifecycle transition, same bar treatment as a
 * source event — "View run" jumps to the run's live/finished log. */
function IngestEventRow({
  m,
  payload,
  onOpenIngestRun,
  highlighted,
}: {
  m: FeedMessage;
  payload: IngestEventPayload;
  onOpenIngestRun?: (runId: string) => void;
  highlighted?: boolean;
}) {
  const status = payload.status ?? "running";
  const Icon = INGEST_ICON[status];
  const tone =
    status === "failed"
      ? "text-destructive"
      : status === "succeeded"
        ? "text-emerald-500"
        : "text-muted-foreground";
  const sub = [payload.mode === "bhag_rollup" ? "Synthesize" : "Ingest", relativeTime(m.created_at)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div id={`feed-message-${m.id}`} className="mt-2 first:mt-0">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 transition-colors",
          highlighted && "border-primary/40 bg-primary/10",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", tone, status === "running" && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground/90">{m.content}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        {payload.run_id && onOpenIngestRun && (
          <button
            type="button"
            onClick={() => onOpenIngestRun(payload.run_id!)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-foreground/80 transition hover:bg-background hover:text-foreground"
          >
            View run
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** A concern/action promoted out of a private 1:1 chat (#91). Attributed to
 * whoever actually raised it (real avatar/name), but wrapped in a callout so
 * it doesn't read as "I typed this in the Feed myself" — it's a summary the
 * agent lifted out of a private conversation, not a message they posted
 * here directly. `content` is the agent- or user-authored summary, which may
 * cite `tome://` pages. */
function PromotedActionRow({
  m,
  onOpenPage,
  highlighted,
}: {
  m: FeedMessage;
  onOpenPage?: (path: string) => void;
  highlighted?: boolean;
}) {
  const isAgent = isAgentHandle(m.sender_handle);
  return (
    <div
      id={`feed-message-${m.id}`}
      className={cn(
        "relative mt-4 rounded-xl border border-amber-300/60 bg-amber-50/60 py-3 pl-14 pr-3 transition-colors first:mt-0 dark:border-amber-500/20 dark:bg-amber-500/[0.04]",
        highlighted && "border-primary/50 bg-primary/10 dark:bg-primary/10",
      )}
    >
      <div
        className={cn(
          "absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-medium text-white ring-2 ring-amber-400/70",
          isAgent ? "bg-gradient-to-br from-violet-500 to-indigo-600" : "gradient-primary-br",
        )}
      >
        {initialsOf(m.display_name || m.sender_handle)}
      </div>
      <div className="mb-0.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {m.display_name || displayName(m.sender_handle)}
        </span>
        {isAgent && (
          <span className="inline-flex items-center gap-0.5 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-px text-[10px] font-medium text-violet-500">
            <Bot className="h-3 w-3" />
            agent
          </span>
        )}
        <span
          title="Raised in a private 1:1 chat, promoted here for team visibility"
          className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
        >
          <Megaphone className="h-3 w-3" />
          promoted via Tome agent
        </span>
        <span className="text-[11px] text-muted-foreground">{timeLabel(m.created_at)}</span>
      </div>
      <div className="break-words text-sm text-foreground/90">
        <MarkdownRenderer content={m.content} variant="final" onInternalLink={onOpenPage} />
      </div>
    </div>
  );
}

/** Avatar bubble for one participant (overlapping face-pile or list row). */
function ParticipantAvatar({
  participant,
  size = "sm",
}: {
  participant: Participant;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "h-8 w-8 text-[11px]" : "h-7 w-7 text-[10px]";
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full font-medium text-white",
        dim,
        participant.isAgent
          ? "bg-gradient-to-br from-violet-500 to-indigo-600"
          : "gradient-primary-br",
      )}
    >
      {initialsOf(participant.name)}
    </span>
  );
}

/**
 * Overlapping avatar face-pile of everyone in the conversation. Hovering lifts
 * an avatar; clicking opens the attendance list grouped into agents and people.
 */
function ParticipantStack({ participants }: { participants: Participant[] }) {
  const MAX = 5;
  const shown = participants.slice(0, MAX);
  const extra = participants.length - shown.length;
  const agents = participants.filter((p) => p.isAgent);
  const humans = participants.filter((p) => !p.isAgent);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Agents and humans in this conversation"
          className="flex items-center -space-x-2 rounded-full p-0.5 transition hover:opacity-90"
        >
          {shown.map((p) => (
            <span
              key={p.handle}
              title={p.name}
              className="relative inline-flex rounded-full ring-2 ring-background transition-transform hover:z-10 hover:scale-110"
            >
              <ParticipantAvatar participant={p} />
            </span>
          ))}
          {extra > 0 && (
            <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
              +{extra}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-semibold">Agents &amp; humans in this conversation</p>
          <p className="text-xs text-muted-foreground">
            {participants.length} so far
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {agents.length > 0 && (
            <ParticipantGroup icon={<Bot className="h-3.5 w-3.5" />} label="Agents" people={agents} />
          )}
          {humans.length > 0 && (
            <ParticipantGroup icon={<User className="h-3.5 w-3.5" />} label="Humans" people={humans} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ParticipantGroup({
  icon,
  label,
  people,
}: {
  icon: React.ReactNode;
  label: string;
  people: Participant[];
}) {
  return (
    <div className="mb-1 last:mb-0">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
        <span className="font-normal normal-case opacity-70">· {people.length}</span>
      </div>
      <ul>
        {people.map((p) => (
          <li
            key={p.handle}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
          >
            <ParticipantAvatar participant={p} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">{p.handle}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

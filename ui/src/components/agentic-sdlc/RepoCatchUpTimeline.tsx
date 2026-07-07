"use client";

import { Clock3, Loader2, Pause, Play, RotateCcw, Square, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { repoUpdateHighlightStyle } from "@/lib/agentic-sdlc/highlight-timing";
import { useAgenticSdlcUiSettings } from "@/hooks/use-agentic-sdlc-ui-settings";
import { cn } from "@/lib/utils";
import type { RepoSwimLane } from "@/lib/agentic-sdlc/repo-stats";

interface RepoCatchUpTimelineProps {
  owner: string;
  repo: string;
}

interface ReplaySnapshot {
  id: string;
  event_title: string;
  actor_label: string;
  occurred_at: string;
  artifact_id: string;
  swim_lanes: RepoSwimLane[];
}

interface ReplayResponse {
  snapshots?: ReplaySnapshot[];
}

const WINDOW_OPTIONS = [
  { label: "Last 1h", value: 1 },
  { label: "Last 2h", value: 2 },
  { label: "Last 6h", value: 6 },
  { label: "Last 24h", value: 24 },
];

export function RepoCatchUpTimeline({ owner, repo }: RepoCatchUpTimelineProps) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const [windowHours, setWindowHours] = useState(2);
  const [snapshots, setSnapshots] = useState<ReplaySnapshot[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { settings, updateSettings } = useAgenticSdlcUiSettings();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadReplayEvents() {
      setStatus("loading");
      setIsPlaying(false);
      setActiveIndex(0);
      try {
        const params = new URLSearchParams({
          windowHours: String(windowHours),
          limit: "100",
        });
        const response = await fetch(
          `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/board-replay?${params.toString()}`,
          { headers: { Accept: "application/json" }, cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as ReplayResponse;
        if (!cancelled) {
          setSnapshots(body.snapshots ?? []);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setSnapshots([]);
        }
      }
    }
    void loadReplayEvents();
    return () => {
      cancelled = true;
    };
  }, [open, owner, repo, windowHours]);

  const currentEvent = useMemo(() => {
    if (snapshots.length === 0) return null;
    return snapshots[Math.min(activeIndex, snapshots.length - 1)] ?? null;
  }, [activeIndex, snapshots]);

  const dispatchReplaySnapshot = useCallback(
    (snapshot: ReplaySnapshot) => {
      window.dispatchEvent(
        new CustomEvent("agentic-sdlc:board-snapshot", {
          detail: {
            owner,
            repo,
            snapshot,
          },
        }),
      );
      const artifactId = snapshot.artifact_id;
      if (!artifactId) return;
      window.dispatchEvent(
        new CustomEvent("agentic-sdlc:replay-highlight", {
          detail: {
            owner,
            repo,
            changedArtifactIds: [artifactId],
            replayEventId: snapshot.id,
          },
        }),
      );
    },
    [owner, repo],
  );

  const stopReplay = useCallback(
    (closePanel = false) => {
      setIsPlaying(false);
      setActiveIndex(0);
      window.dispatchEvent(
        new CustomEvent("agentic-sdlc:board-replay-stop", {
          detail: { owner, repo },
        }),
      );
      if (closePanel) {
        setOpen(false);
      }
    },
    [owner, repo],
  );

  const restartReplay = useCallback(() => {
    setIsPlaying(false);
    setActiveIndex(0);
    const firstSnapshot = snapshots[0];
    if (firstSnapshot) {
      dispatchReplaySnapshot(firstSnapshot);
    } else {
      stopReplay(false);
    }
  }, [dispatchReplaySnapshot, snapshots, stopReplay]);

  useEffect(() => {
    function onBoardReplayStop(event: Event) {
      const detail = (event as CustomEvent<{ owner?: string; repo?: string }>).detail;
      if (detail?.owner === owner && detail?.repo === repo) {
        setIsPlaying(false);
        setActiveIndex(0);
      }
    }
    window.addEventListener("agentic-sdlc:board-replay-stop", onBoardReplayStop);
    return () => {
      window.removeEventListener("agentic-sdlc:board-replay-stop", onBoardReplayStop);
    };
  }, [owner, repo]);

  useEffect(() => {
    if (!isPlaying) return;
    const snapshot = snapshots[activeIndex];
    if (!snapshot) {
      setIsPlaying(false);
      return;
    }
    dispatchReplaySnapshot(snapshot);
    const timer = setTimeout(() => {
      setActiveIndex((index) => index + 1);
    }, settings.replayIntervalSeconds * 1000);
    return () => clearTimeout(timer);
  }, [activeIndex, dispatchReplaySnapshot, isPlaying, settings.replayIntervalSeconds, snapshots]);

  const progress = snapshots.length > 0
    ? Math.min(100, Math.round(((Math.min(activeIndex, snapshots.length - 1) + 1) / snapshots.length) * 100))
    : 0;

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (isInteractiveDragTarget(event.target)) return;
      const panel = event.currentTarget.closest("[data-replay-panel]");
      if (!(panel instanceof HTMLElement)) return;
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      panel.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const maxX = Math.max(12, window.innerWidth - rect.width - 12);
        const maxY = Math.max(12, window.innerHeight - rect.height - 12);
        setPanelPosition({
          x: clamp(moveEvent.clientX - offsetX, 12, maxX),
          y: clamp(moveEvent.clientY - offsetY, 12, maxY),
        });
      };
      const stop = () => {
        panel.removeEventListener("pointermove", move);
        panel.removeEventListener("pointerup", stop);
        panel.removeEventListener("pointercancel", stop);
      };
      panel.addEventListener("pointermove", move);
      panel.addEventListener("pointerup", stop);
      panel.addEventListener("pointercancel", stop);
    },
    [],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open catch-up replay"
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-100 shadow-[0_0_18px_rgba(0,245,255,0.16)] transition hover:bg-cyan-400/15",
          open && "hidden",
        )}
      >
        <Clock3 className="h-3.5 w-3.5" aria-hidden />
        Replay
      </button>

      {open ? (
        <aside
          data-replay-panel
          className="fixed z-50 w-[min(42rem,calc(100vw-2rem))] rounded-2xl border border-cyan-400/35 bg-background/95 p-3 shadow-[0_0_36px_rgba(0,245,255,0.22)] backdrop-blur-xl"
          style={
            panelPosition
              ? { left: panelPosition.x, top: panelPosition.y }
              : { right: "1rem", top: "5rem" }
          }
          aria-label="Catch-up timeline"
        >
          <div
            className="mb-2 flex cursor-move touch-none items-start justify-between gap-3"
            onPointerDown={startDrag}
            title="Drag to move replay panel"
          >
            <div className="min-w-0">
              <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-100">
                <Clock3 className="h-3.5 w-3.5" aria-hidden />
                Catch-up timeline
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Replay point-in-time board snapshots without taking space from Agents in action.
              </p>
            </div>
            <button
              type="button"
              onClick={() => stopReplay(true)}
              aria-label="Stop and close catch-up replay"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-background/60 text-muted-foreground transition hover:bg-background hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-muted-foreground">
            Window
            <select
              value={windowHours}
              onChange={(event) => setWindowHours(Number(event.target.value))}
              className="h-7 rounded-md border border-border/40 bg-background/60 px-2 text-[11px] text-foreground"
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-muted-foreground">
            Replay interval
            <input
              type="number"
              min={1}
              value={settings.replayIntervalSeconds}
              onChange={(event) =>
                updateSettings({ replayIntervalSeconds: Number(event.target.value) })
              }
              className="h-7 w-14 rounded-md border border-border/40 bg-background/60 px-2 text-[11px] text-foreground"
            />
            <span className="text-[10px] text-muted-foreground/70">sec</span>
          </label>
          <button
            type="button"
            disabled={status !== "ready" || snapshots.length === 0}
            onClick={() => {
              if (activeIndex >= snapshots.length) setActiveIndex(0);
              setIsPlaying(true);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-cyan-400/35 bg-cyan-400/10 px-2.5 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            Play catch-up
          </button>
          <button
            type="button"
            disabled={!isPlaying}
            onClick={() => setIsPlaying(false)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 px-2.5 text-[11px] text-muted-foreground transition hover:bg-background/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Pause className="h-3.5 w-3.5" aria-hidden />
            Pause
          </button>
          <button
            type="button"
            disabled={snapshots.length === 0}
            onClick={() => stopReplay(false)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 px-2.5 text-[11px] text-muted-foreground transition hover:bg-background/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
            Stop
          </button>
          <button
            type="button"
            disabled={snapshots.length === 0}
            onClick={restartReplay}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 px-2.5 text-[11px] text-muted-foreground transition hover:bg-background/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Restart
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {snapshots.length} board snapshot{snapshots.length === 1 ? "" : "s"} · {settings.replayIntervalSeconds}s interval
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-background/60">
        <div
          className="h-full rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(0,245,255,0.65)] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {status === "loading" ? (
        <div className="rounded-lg border border-border/30 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading historical board snapshots...
        </div>
      ) : status === "error" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Could not load historical board snapshots.
        </div>
      ) : snapshots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 bg-background/25 px-3 py-2 text-center text-xs text-muted-foreground">
          No board snapshots in this replay window yet.
        </div>
      ) : (
        <div className="grid items-center gap-2 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border/30 bg-background/25 px-2 py-2">
            {snapshots.map((snapshot, index) => (
              <button
                key={snapshot.id}
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setActiveIndex(index);
                  dispatchReplaySnapshot(snapshot);
                }}
                className={cn(
                  "h-2.5 w-2.5 rounded-full border transition",
                  index <= activeIndex
                    ? "border-cyan-200 bg-cyan-300 shadow-[0_0_10px_rgba(0,245,255,0.65)]"
                    : "border-border/50 bg-muted/35 hover:border-cyan-300/60 hover:bg-cyan-300/40",
                )}
                title={`${snapshot.event_title} · ${formatTime(snapshot.occurred_at)}`}
              />
            ))}
          </div>
          <div
            className="rounded-lg border border-cyan-400/30 bg-card/70 px-2.5 py-2 text-xs"
            style={repoUpdateHighlightStyle(settings.haloColor)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-cyan-100">
                <Zap className="h-3 w-3" aria-hidden />
                {isPlaying ? "Playing" : "Ready"}
              </span>
              <time className="text-[9px] text-muted-foreground">
                {currentEvent ? formatTime(currentEvent.occurred_at) : "No event"}
              </time>
            </div>
            <h3 className="mt-1 truncate text-xs font-semibold text-foreground">
              {currentEvent?.event_title ?? "No board snapshot selected"}
            </h3>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {currentEvent
                ? `${countSnapshotItems(currentEvent)} work item${countSnapshotItems(currentEvent) === 1 ? "" : "s"} visible in this snapshot.`
                : "Choose a replay window to catch up."}
            </p>
            {currentEvent ? (
              <p className="mt-1 truncate text-[9px] uppercase tracking-wider text-cyan-200/80">
                {currentEvent.actor_label} · historical board state
              </p>
            ) : null}
          </div>
        </div>
      )}
          </div>
        </aside>
      ) : null}
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    ? Boolean(target.closest("button,input,select,textarea,a"))
    : false;
}

function countSnapshotItems(snapshot: ReplaySnapshot): number {
  return snapshot.swim_lanes.reduce((total, lane) => total + lane.items.length, 0);
}

function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "unknown";
  return new Date(parsed).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

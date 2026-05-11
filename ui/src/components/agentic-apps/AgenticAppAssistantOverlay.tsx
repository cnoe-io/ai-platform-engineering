"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, MessageCircle, Sparkles, Type, X } from "lucide-react";

import { ChatPanel } from "@/components/chat/DynamicAgentChatPanel";
import { buildAssistantClientContext } from "@/lib/agentic-apps/assistant-context";
import { cn } from "@/lib/utils";
import type { AgenticAppAssistantContextRecord } from "@/types/agentic-app";

const DEFAULT_PANEL_SIZE = { width: 720, height: 780 };
const MIN_PANEL_SIZE = { width: 480, height: 560 };
const MAX_PANEL_SIZE = { width: 1180, height: 940 };
const GLASS_MODE_STORAGE_KEY = "agentic-app-assistant-glass";
const FONT_SCALE_STORAGE_KEY = "agentic-app-assistant-font-scale";

type AssistantFontScale = "compact" | "default" | "large";

export interface AgenticAppAssistantOverlayProps {
  appId: string;
  appName: string;
  /**
   * Per-app label for the floating bubble button (e.g. "Ask FinOps"). Falls back to "Ask CAIPE".
   * Keep short — ~14 chars max renders cleanly.
   */
  assistantLabel?: string;
  /**
   * Per-app display name shown inside the chat panel header (e.g. "FinOps Assistant").
   * Falls back to "CAIPE assistant for {appName}".
   */
  assistantAgentName?: string;
  activeContext: AgenticAppAssistantContextRecord | null;
  onClearContext: () => void;
  assistantAgentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgenticAppAssistantOverlay({
  appId,
  appName,
  assistantLabel,
  assistantAgentName,
  activeContext,
  onClearContext,
  assistantAgentId,
  open,
  onOpenChange,
}: AgenticAppAssistantOverlayProps) {
  const bubbleLabel = (assistantLabel?.trim() || "Ask CAIPE").slice(0, 32);
  const headerTitle = (assistantAgentName?.trim() || `CAIPE assistant for ${appName}`).slice(0, 64);
  const chatPanelAgentName = (assistantAgentName?.trim() || "CAIPE Assistant").slice(0, 64);
  const [panelSize, setPanelSize] = useState(DEFAULT_PANEL_SIZE);
  const [glassMode, setGlassMode] = useState(readStoredGlassMode);
  const [fontScale, setFontScale] = useState<AssistantFontScale>(readStoredFontScale);
  const clientContext = useMemo(() => buildAssistantClientContext(activeContext), [activeContext]);
  const suggestedPrompts = activeContext?.suggestedPrompts?.length
    ? activeContext.suggestedPrompts
    : [`Summarize what I am viewing in ${appName}`];

  useEffect(() => {
    writeStoredGlassMode(glassMode);
  }, [glassMode]);

  useEffect(() => {
    writeStoredFontScale(fontScale);
  }, [fontScale]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startPoint = clientPoint(event);
      const startSize = panelSize;
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";

      function handlePointerMove(moveEvent: PointerEvent) {
        const nextPoint = clientPoint(moveEvent);
        setPanelSize(
          clampPanelSize({
            width: startSize.width + (startPoint.x - nextPoint.x),
            height: startSize.height + (startPoint.y - nextPoint.y),
          }),
        );
      }

      function handlePointerUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      }

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [panelSize],
  );

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {open ? (
        <section
          aria-label={headerTitle}
          className={cn(
            "pointer-events-auto relative flex flex-col overflow-hidden rounded-3xl border shadow-2xl transition-colors",
            glassMode
              ? "border-cyan-200/55 bg-cyan-950/15 shadow-[0_24px_120px_rgba(34,211,238,0.22),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_64px_rgba(34,211,238,0.10)] ring-1 ring-cyan-200/45 backdrop-blur-3xl backdrop-saturate-200"
              : "border-cyan-300/20 bg-slate-950/95 shadow-cyan-950/40",
          )}
          style={{
            width: `min(${panelSize.width}px, calc(100vw - 2rem))`,
            height: `min(${panelSize.height}px, calc(100vh - 7rem))`,
          }}
        >
          <button
            type="button"
            aria-label={`Resize ${bubbleLabel} assistant`}
            onPointerDown={handleResizeStart}
            className="absolute left-3 top-3 z-10 flex h-10 w-10 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-cyan-200/30 bg-slate-950/35 shadow-lg shadow-cyan-950/30 backdrop-blur-md transition hover:border-cyan-200/60 hover:bg-cyan-300/10"
          >
            <span className="absolute h-7 w-7 rounded-full border border-cyan-200/30" aria-hidden />
            <span className="absolute h-4 w-4 rounded-full border border-cyan-300/40" aria-hidden />
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.8)]" aria-hidden />
          </button>
          <header
            className={cn(
              "flex items-center justify-between gap-3 border-b border-white/10 py-3 pl-16 pr-4",
              glassMode ? "bg-cyan-950/30 backdrop-blur-3xl" : "bg-white/[0.02]",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full bg-cyan-300/15 p-2 text-cyan-100">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white">{headerTitle}</h2>
                <p className="truncate text-xs text-slate-400">
                  {activeContext ? `${activeContext.route} context active` : `Waiting for ${appId} context`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`Assistant font size ${fontScale}`}
                onClick={() => setFontScale((value) => nextFontScale(value))}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:text-white"
              >
                <Type className="h-3.5 w-3.5" aria-hidden />
                {fontScaleLabel(fontScale)}
              </button>
              <button
                type="button"
                aria-label={
                  glassMode
                    ? "Disable translucent assistant mode"
                    : "Enable translucent assistant mode"
                }
                aria-pressed={glassMode}
                onClick={() => setGlassMode((value) => !value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition",
                  glassMode
                    ? "border-cyan-200/70 bg-cyan-300/25 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.25)]"
                    : "border-white/10 bg-slate-950/40 text-slate-300 hover:text-white",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Glass
              </button>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Close assistant"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          <div className={cn(
            "border-b border-white/10 px-4 py-3 text-xs text-slate-300",
            glassMode ? "bg-cyan-300/15 backdrop-blur-2xl" : "bg-white/[0.03]",
          )}>
            {activeContext ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-cyan-100">
                    {activeContext.title ?? "Published app context"}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-white/10"
                    onClick={onClearContext}
                  >
                    Clear context
                  </button>
                </div>
                {activeContext.summary ? <p className="line-clamp-2 text-slate-400">{activeContext.summary}</p> : null}
              </div>
            ) : (
              <p>External apps can publish bounded page context. CAIPE treats it as untrusted data, not instructions.</p>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <ChatPanel
              endpoint="/api/dynamic-agents/chat"
              agentId={assistantAgentId}
              agentName={chatPanelAgentName}
              clientContext={clientContext}
              suggestedPrompts={suggestedPrompts}
              suggestedPromptsInitiallyHidden={false}
              emptyStateTitle={`Ask about ${appName}`}
              emptyStateSubtitle="The accepted app context is attached as structured metadata."
              surface={glassMode ? "glass" : "default"}
              fontScale={fontScale}
            />
          </div>
        </section>
      ) : null}

      <button
        type="button"
        aria-label={`Open ${bubbleLabel}`}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200"
        onClick={() => onOpenChange(!open)}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {bubbleLabel}
        {activeContext ? <span className="rounded-full bg-slate-950/15 px-2 py-0.5 text-xs">context</span> : null}
      </button>
    </div>
  );
}

function clientPoint(event: PointerEvent | React.PointerEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY };
}

function clampPanelSize(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(MIN_PANEL_SIZE.width, Math.min(MAX_PANEL_SIZE.width, size.width)),
    height: Math.max(MIN_PANEL_SIZE.height, Math.min(MAX_PANEL_SIZE.height, size.height)),
  };
}

function nextFontScale(scale: AssistantFontScale): AssistantFontScale {
  if (scale === "compact") return "default";
  if (scale === "default") return "large";
  return "compact";
}

function fontScaleLabel(scale: AssistantFontScale): string {
  if (scale === "compact") return "Small";
  if (scale === "large") return "Large";
  return "Default";
}

function readStoredGlassMode(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(GLASS_MODE_STORAGE_KEY);
  return raw === null ? true : raw === "true";
}

function writeStoredGlassMode(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GLASS_MODE_STORAGE_KEY, String(value));
}

function readStoredFontScale(): AssistantFontScale {
  if (typeof window === "undefined") return "compact";
  const raw = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY);
  if (raw === "default" || raw === "large") return raw;
  return "compact";
}

function writeStoredFontScale(value: AssistantFontScale): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, value);
}

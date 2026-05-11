"use client";

// assisted-by Codex Codex-sonnet-4-6

import { Bot, RotateCcw, Sparkles, Type, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ChatView } from "@/components/chat/DynamicAgentChatView";
import { useAgenticSdlcFeature } from "@/hooks/use-agentic-sdlc-feature";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

const AGENTIC_SDLC_AGENT_ID = "agent-agentic-sdlc";
const AGENTIC_SDLC_AGENT_NAME = "agentic-sdlc";
const ASSISTANT_DISPLAY_NAME = "Ask Agentic SDLC";
const DEFAULT_PANEL_SIZE = { width: 720, height: 780 };
const MIN_PANEL_SIZE = { width: 480, height: 560 };
const MAX_PANEL_SIZE = { width: 1180, height: 940 };
const GLASS_MODE_STORAGE_KEY = "agentic-sdlc-assistant-glass";
const FONT_SCALE_STORAGE_KEY = "agentic-sdlc-assistant-font-scale";
const SUGGESTIONS_SEEN_STORAGE_KEY = "agentic-sdlc-assistant-suggestions-seen";

type AssistantFontScale = "compact" | "default" | "large";

type AgenticSdlcPageContext =
  | {
      source: "agentic-sdlc";
      route: string;
      scope: "home";
      screen: "home";
    }
  | {
      source: "agentic-sdlc";
      route: string;
      scope: "repo";
      screen: "repo-detail";
      owner: string;
      repo: string;
      repository: string;
    }
  | {
      source: "agentic-sdlc";
      route: string;
      scope: "epic";
      screen: "epic-detail";
      owner: string;
      repo: string;
      repository: string;
      epicId: string;
    };

export function buildAgenticSdlcPageContext(
  pathname: string,
): AgenticSdlcPageContext {
  const [owner, repo, segment, epicId] = pathname
    .replace(/^\/apps\/agentic-sdlc\/?/, "")
    .replace(/^\/agentic-sdlc\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (owner && repo && segment === "epics" && epicId) {
    return {
      source: "agentic-sdlc",
      route: pathname,
      scope: "epic",
      screen: "epic-detail",
      owner,
      repo,
      repository: `${owner}/${repo}`,
      epicId,
    };
  }

  if (owner && repo) {
    return {
      source: "agentic-sdlc",
      route: pathname,
      scope: "repo",
      screen: "repo-detail",
      owner,
      repo,
      repository: `${owner}/${repo}`,
    };
  }

  return {
    source: "agentic-sdlc",
    route: pathname,
    scope: "home",
    screen: "home",
  };
}

export function AgenticSdlcAssistantBubble() {
  const pathname = usePathname() ?? "/apps/agentic-sdlc";
  const { enabled, assistantEnabled } = useAgenticSdlcFeature();
  const dynamicAgentsEnabled = getConfig("dynamicAgentsEnabled");
  const dynamicAgentsUrl = getConfig("dynamicAgentsUrl");
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const isConversationStreaming = useChatStore((s) => s.isConversationStreaming);

  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [agent, setAgent] = useState<DynamicAgentConfig | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "setup">(
    "idle",
  );
  const [panelSize, setPanelSize] = useState(DEFAULT_PANEL_SIZE);
  const [glassMode, setGlassMode] = useState(readStoredGlassMode);
  const [fontScale, setFontScale] = useState(readStoredFontScale);
  const [suggestionsSeen, setSuggestionsSeen] = useState(readStoredSuggestionsSeen);
  const [showSuggestionsOnThisOpen, setShowSuggestionsOnThisOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const pageContext = useMemo(
    () => buildAgenticSdlcPageContext(pathname),
    [pathname],
  );
  const suggestedPrompts = useMemo(
    () => buildAgenticSdlcSuggestedPrompts(pageContext),
    [pageContext],
  );
  const currentConversationStreaming = conversationId
    ? isConversationStreaming(conversationId)
    : false;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    writeStoredGlassMode(glassMode);
  }, [glassMode]);

  useEffect(() => {
    writeStoredFontScale(fontScale);
  }, [fontScale]);

  useEffect(() => {
    writeStoredSuggestionsSeen(suggestionsSeen);
  }, [suggestionsSeen]);

  useEffect(() => {
    if (!open || !assistantEnabled || !dynamicAgentsEnabled) {
      return;
    }

    let cancelled = false;

    async function bootstrapAssistant() {
      setStatus("loading");

      try {
        const [nextConversationId, response] = await Promise.all([
          conversationId ??
            createConversation(AGENTIC_SDLC_AGENT_ID).then((id) => {
              if (!cancelled) {
                setConversationId(id);
              }
              return id;
            }),
          fetch(`/api/dynamic-agents/agents/${AGENTIC_SDLC_AGENT_ID}`),
        ]);

        if (cancelled) {
          return;
        }

        setActiveConversation(nextConversationId);

        if (!response.ok) {
          setStatus("setup");
          return;
        }

        const body = (await response.json()) as { data?: DynamicAgentConfig };
        if (!body.data || body.data.enabled === false) {
          setStatus("setup");
          return;
        }

        setAgent(body.data);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("setup");
        }
      }
    }

    bootstrapAssistant();

    return () => {
      cancelled = true;
    };
  }, [
    assistantEnabled,
    conversationId,
    createConversation,
    dynamicAgentsEnabled,
    open,
    setActiveConversation,
  ]);

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

  const handleStartNewThread = useCallback(async () => {
    if (!assistantEnabled || !dynamicAgentsEnabled || currentConversationStreaming) {
      return;
    }

    setStatus("loading");
    try {
      const nextConversationId = await createConversation(AGENTIC_SDLC_AGENT_ID);
      setConversationId(nextConversationId);
      setActiveConversation(nextConversationId);
      setStatus(agent ? "ready" : "loading");
    } catch {
      setStatus("setup");
    }
  }, [
    agent,
    assistantEnabled,
    createConversation,
    currentConversationStreaming,
    dynamicAgentsEnabled,
    setActiveConversation,
  ]);

  if (!enabled || !mounted) {
    return null;
  }

  function toggleOpen(): void {
    setOpen((value) => {
      const nextOpen = !value;
      if (nextOpen) {
        setShowSuggestionsOnThisOpen(!suggestionsSeen);
        if (!suggestionsSeen) {
          setSuggestionsSeen(true);
        }
      } else {
        setShowSuggestionsOnThisOpen(false);
      }
      return nextOpen;
    });
  }

  const bubble = (
    <div
      className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3"
      style={{
        position: "fixed",
        right: "1.25rem",
        bottom: "1.25rem",
        top: "auto",
        left: "auto",
      }}
    >
      {open ? (
        <section
          aria-label="Agentic SDLC assistant"
          className={cn(
            "relative flex flex-col overflow-hidden rounded-2xl border shadow-2xl transition-colors",
            glassMode
              ? "border-cyan-200/55 bg-cyan-950/10 shadow-[0_24px_120px_rgba(34,211,238,0.22),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_64px_rgba(34,211,238,0.10)] ring-1 ring-cyan-200/45 backdrop-blur-3xl backdrop-saturate-200"
              : "border-primary/25 bg-background shadow-black/40",
          )}
          style={{
            width: `min(${panelSize.width}px, calc(100vw - 2rem))`,
            height: `min(${panelSize.height}px, calc(100vh - 7rem))`,
          }}
        >
          <button
            type="button"
            aria-label="Resize Agentic SDLC assistant"
            onPointerDown={handleResizeStart}
            className="absolute left-3 top-3 z-10 flex h-10 w-10 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-primary/25 bg-background/35 shadow-lg shadow-primary/10 backdrop-blur-md transition hover:border-primary/45 hover:bg-primary/10"
          >
            <span className="absolute h-7 w-7 rounded-full border border-primary/30" aria-hidden />
            <span className="absolute h-4 w-4 rounded-full border border-cyan-300/40" aria-hidden />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/80 shadow-[0_0_14px_hsl(var(--primary))]" aria-hidden />
          </button>
          <header
            className={cn(
              "flex items-center justify-between border-b border-border/50 py-3 pl-16 pr-4",
              glassMode
                ? "bg-cyan-950/30 shadow-[inset_0_-1px_0_rgba(34,211,238,0.18)] backdrop-blur-3xl"
                : "bg-card/80",
            )}
          >
            <div>
              <p className="text-sm font-semibold text-foreground">
                {ASSISTANT_DISPLAY_NAME}
              </p>
              <p className="text-xs text-muted-foreground">
                Dynamic agent: <code>{AGENTIC_SDLC_AGENT_NAME}</code>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Start new assistant thread"
                disabled={currentConversationStreaming || status === "loading"}
                onClick={handleStartNewThread}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground",
                  (currentConversationStreaming || status === "loading") &&
                    "cursor-not-allowed opacity-50 hover:text-muted-foreground",
                )}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                New
              </button>
              <button
                type="button"
                aria-label={`Assistant font size ${fontScale}`}
                onClick={() => setFontScale((value) => nextFontScale(value))}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
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
                    : "border-border/50 bg-background/50 text-muted-foreground hover:text-foreground",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Glass
              </button>
              <button
                type="button"
                aria-label="Close Agentic SDLC assistant"
                onClick={() => setOpen(false)}
                className="rounded-full border border-border/50 p-2 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          <div
            className={cn(
              "border-b border-border/40 px-4 py-2 text-xs text-muted-foreground",
              glassMode ? "bg-cyan-300/15 backdrop-blur-2xl" : "bg-primary/5",
            )}
          >
            Context: <span className="text-foreground">{contextLabel(pageContext)}</span>
          </div>

          {assistantEnabled &&
          dynamicAgentsEnabled &&
          status === "ready" &&
          agent &&
          conversationId ? (
            <div
              data-testid="agentic-sdlc-chat-slot"
              className="min-h-0 flex-1 overflow-hidden"
            >
              <ChatView
                key={conversationId}
                endpoint={`${dynamicAgentsUrl}/agents/${agent._id}/chat`}
                conversationId={conversationId}
                conversationTitle="Agentic SDLC Assistant"
                selectedAgentId={agent._id}
                agentName={agent.name}
                agentDescription={agent.description}
                agentModel={agent.model?.id}
                agentVisibility={agent.visibility}
                agentGradient={agent.ui?.gradient_theme}
                allowedTools={agent.allowed_tools}
                subagents={agent.subagents}
                agentSkills={agent.skills ?? []}
                agentDisabled={agent.enabled === false}
                clientContext={pageContext}
                suggestedPrompts={suggestedPrompts}
                suggestedPromptsInitiallyHidden={!showSuggestionsOnThisOpen}
                hideContextPanel
                emptyStateTitle="Agentic SDLC Assistant"
                emptyStateSubtitle="Ask about this repo, Epic, or the live development loop."
                surface={glassMode ? "glass" : "default"}
                fontScale={fontScale}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div className="max-w-xs space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {status === "loading"
                    ? "Connecting to the Agentic SDLC assistant..."
                    : !assistantEnabled
                      ? "Turn on SHIP_LOOP_ASSISTANT_ENABLED to use this chat bubble."
                      : "Create or enable the agentic-sdlc dynamic agent to use this assistant."}
                </p>
                <p className="text-xs text-muted-foreground">
                  This bubble uses the same chat backend as the main Chat tab and
                  is pinned to the <code>{AGENTIC_SDLC_AGENT_NAME}</code> agent.
                </p>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <button
        type="button"
        aria-label="Open Agentic SDLC assistant"
        title={ASSISTANT_DISPLAY_NAME}
        onClick={toggleOpen}
        className={cn(
          "inline-flex h-14 items-center justify-center gap-2 rounded-full border border-primary/40 bg-primary px-4 text-primary-foreground shadow-xl shadow-primary/20 transition hover:scale-105",
          open && "bg-background text-primary",
        )}
      >
        <Bot
          data-testid="agentic-sdlc-assistant-bot-icon"
          className="h-6 w-6"
          aria-hidden
        />
        <span className="text-sm font-semibold">{ASSISTANT_DISPLAY_NAME}</span>
      </button>
    </div>
  );

  return createPortal(bubble, document.body);
}

function contextLabel(context: AgenticSdlcPageContext): string {
  if (context.scope === "epic") {
    return `${context.owner}/${context.repo} Epic ${context.epicId}`;
  }
  if (context.scope === "repo") {
    return `${context.owner}/${context.repo}`;
  }
  return "Agentic SDLC home";
}

function clampPanelSize(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const viewportWidth =
    typeof window === "undefined" ? MAX_PANEL_SIZE.width : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? MAX_PANEL_SIZE.height : window.innerHeight;
  const maxWidth = Math.max(
    MIN_PANEL_SIZE.width,
    Math.min(MAX_PANEL_SIZE.width, viewportWidth - 32),
  );
  const maxHeight = Math.max(
    MIN_PANEL_SIZE.height,
    Math.min(MAX_PANEL_SIZE.height, viewportHeight - 112),
  );

  return {
    width: Math.min(maxWidth, Math.max(MIN_PANEL_SIZE.width, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_PANEL_SIZE.height, size.height)),
  };
}

function clientPoint(event: { clientX?: number; clientY?: number }): {
  x: number;
  y: number;
} {
  return {
    x: Number.isFinite(event.clientX) ? event.clientX! : 0,
    y: Number.isFinite(event.clientY) ? event.clientY! : 0,
  };
}

function readStoredGlassMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(GLASS_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredGlassMode(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(GLASS_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage failures; the toggle should still work for this render.
  }
}

function readStoredFontScale(): AssistantFontScale {
  if (typeof window === "undefined") {
    return "compact";
  }

  try {
    const value = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    return isAssistantFontScale(value) ? value : "compact";
  } catch {
    return "compact";
  }
}

function writeStoredFontScale(scale: AssistantFontScale): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, scale);
  } catch {
    // Ignore storage failures; the control still works for this render.
  }
}

function readStoredSuggestionsSeen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SUGGESTIONS_SEEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredSuggestionsSeen(seen: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SUGGESTIONS_SEEN_STORAGE_KEY, String(seen));
  } catch {
    // Ignore storage failures; this only controls a space-saving hint.
  }
}

function isAssistantFontScale(value: string | null): value is AssistantFontScale {
  return value === "compact" || value === "default" || value === "large";
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

export function buildAgenticSdlcSuggestedPrompts(
  context: AgenticSdlcPageContext,
): string[] {
  const repo =
    context.scope === "repo" || context.scope === "epic"
      ? `${context.owner}/${context.repo}`
      : "the selected repo";

  const prompts = [
    `Create a test Epic and child tasks for ${repo}.`,
    `Summarize what happened in this repo in the last 10 minutes.`,
    `Show open Agentic SDLC Epics in ${repo} that need human attention.`,
    `Which tasks or PRs are blocked in ${repo}, and what should happen next?`,
  ];

  if (context.scope === "epic") {
    return [
      `Summarize Epic ${context.epicId} in ${repo}.`,
      `What changed on Epic ${context.epicId} in the last 10 minutes?`,
      `List child tasks, PRs, and current stage for Epic ${context.epicId}.`,
      ...prompts.slice(2),
    ];
  }

  return prompts;
}

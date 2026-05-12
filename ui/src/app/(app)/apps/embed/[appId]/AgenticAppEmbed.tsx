"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

import { AgenticAppAssistantOverlay } from "@/components/agentic-apps/AgenticAppAssistantOverlay";
import { apiClient } from "@/lib/api-client";
import { validateAssistantContextMessage } from "@/lib/agentic-apps/assistant-context";
import type { AgenticAppAssistantContextRecord } from "@/types/agentic-app";

interface ResolvedApp {
  appId: string;
  displayName: string;
  description: string;
  /** Physical mount path (the proxy entry point). Iframe `src` is set to this. */
  mountPath: string;
  canLaunch: boolean;
  blockedReasons: string[];
  assistantEnabled?: boolean;
  assistantLabel?: string;
  assistantAgentName?: string;
}

interface State {
  status: "loading" | "ready" | "denied" | "not_found" | "error";
  app?: ResolvedApp;
  message?: string;
}

interface AgenticAppEmbedProps {
  appId: string;
  onUnauthorized?: (loginUrl: string) => void;
}

/**
 * Renders an Agentic App inside the standard CAIPE shell via an `<iframe>`.
 *
 * The iframe `src` is the upstream proxy mount path (e.g. `/apps/<id>`) —
 * the proxy at `/apps/[appId]/[[...path]]/route.ts` fronts every request
 * from within the iframe, including XHR/fetch made by the app's bundle.
 * CAIPE chrome (header/banner) stays visible above the iframe.
 *
 * Auth/access is checked client-side via `/api/agentic-apps`; that endpoint is
 * already gated server-side, so this fetch reliably reflects the user's
 * effective access. Unauthorized users see a clear message instead of an
 * unstyled error inside the iframe.
 */
export function AgenticAppEmbed({ appId, onUnauthorized }: AgenticAppEmbedProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [assistantContext, setAssistantContext] = useState<AgenticAppAssistantContextRecord | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const assistantEnabled = state.app?.assistantEnabled !== false;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiClient.getAgenticApps();
        if (cancelled) return;
        const found = res.items.find((item) => item.appId === appId);
        if (!found) {
          setState({ status: "not_found" });
          return;
        }
        // We need the *physical* mount path here, NOT the launch URL the API
        // computed for hub display (which would be /apps/embed/<id> and cause
        // the iframe to load this very page recursively). The proxy lives at
        // /apps/<appId> always.
        const mountPath = `/apps/${appId}`;
        if (!found.canLaunch) {
          setState({
            status: "denied",
            app: {
              appId: found.appId,
              displayName: found.displayName,
              description: found.description,
              mountPath,
              canLaunch: false,
              blockedReasons: found.blockedReasons ?? [],
              assistantEnabled: found.assistantEnabled,
              assistantLabel: found.assistantLabel,
              assistantAgentName: found.assistantAgentName,
            },
          });
          return;
        }
        setState({
          status: "ready",
          app: {
            appId: found.appId,
            displayName: found.displayName,
            description: found.description,
            mountPath,
            canLaunch: true,
            blockedReasons: [],
            assistantEnabled: found.assistantEnabled,
            assistantLabel: found.assistantLabel,
            assistantAgentName: found.assistantAgentName,
          },
        });
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorizedError(err)) {
          redirectToLogin(onUnauthorized);
          return;
        }
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load app",
        });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    if (!assistantEnabled) {
      setAssistantOpen(false);
      setAssistantContext(null);
      return;
    }

    function onMessage(event: MessageEvent) {
      if (
        isAssistantOpenMessage(event.data, appId) &&
        event.origin === window.location.origin &&
        event.source === (iframeRef.current?.contentWindow ?? null)
      ) {
        setAssistantOpen(true);
        return;
      }

      const result = validateAssistantContextMessage({
        message: event.data,
        appId,
        origin: event.origin,
        expectedOrigin: window.location.origin,
        source: event.source,
        expectedSource: iframeRef.current?.contentWindow ?? null,
      });
      if (result.ok) {
        setAssistantContext(result.record);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId, assistantEnabled]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-300">
        <span className="animate-pulse text-sm uppercase tracking-[0.24em]">
          Loading {appId}…
        </span>
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <EmbedError
        title="App not found"
        description={`No installed Agentic App with id "${appId}".`}
      />
    );
  }

  if (state.status === "denied" && state.app) {
    const reason = state.app.blockedReasons[0] ?? "unauthorized";
    return (
      <EmbedError
        title={`Access denied: ${state.app.displayName}`}
        description={`You do not have permission to launch this app (${reason}).`}
      />
    );
  }

  if (state.status === "error") {
    return (
      <EmbedError
        title="Could not load app"
        description={state.message ?? "Unexpected error"}
      />
    );
  }

  if (state.status === "ready" && state.app) {
    return (
      <div className="flex flex-1 flex-col">
        <EmbedToolbar app={state.app} />
        <iframe
          ref={iframeRef}
          // eslint-disable-next-line jsx-a11y/iframe-has-title
          title={state.app.displayName}
          src={state.app.mountPath}
          className="flex-1 w-full border-0 bg-slate-950"
          // Default sandboxing is intentionally omitted: the upstream is a
          // first-party CAIPE-trusted Agentic App fronted by our proxy, which
          // already strips X-Frame-Options/CSP frame-ancestors, sets
          // identity headers, and blocks credential smuggling. Adding
          // `sandbox` would break Next.js scripts the upstream needs to run.
          // If you need to host an untrusted app, switch the manifest to
          // `runtime.kind: "iframe-sandboxed"` and use a sandboxed embed.
          allow="clipboard-read; clipboard-write"
        />
        {assistantEnabled ? (
          <AgenticAppAssistantOverlay
            appId={state.app.appId}
            appName={state.app.displayName}
            assistantLabel={state.app.assistantLabel}
            assistantAgentName={state.app.assistantAgentName}
            activeContext={assistantContext}
            onClearContext={() => setAssistantContext(null)}
            assistantAgentId={resolveAssistantAgentId(state.app.appId)}
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
          />
        ) : null}
      </div>
    );
  }

  return null;
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && /\bHTTP 401\b|Unauthorized/i.test(error.message);
}

function redirectToLogin(onUnauthorized?: (loginUrl: string) => void): void {
  const path =
    window.location.pathname +
    window.location.search +
    window.location.hash;
  const loginUrl = `/login?callbackUrl=${encodeURIComponent(path || "/")}`;
  if (onUnauthorized) {
    onUnauthorized(loginUrl);
    return;
  }
  window.location.assign(loginUrl);
}

function resolveAssistantAgentId(appId: string): string {
  const assistantAgents: Record<string, string> = {
    finops: "agent-aws-cost-explorer",
    weather: "agent-weather-agent",
    "agentic-sdlc": "agent-agentic-sdlc",
  };
  return assistantAgents[appId] ?? "agent-agentic-sdlc";
}

function isAssistantOpenMessage(message: unknown, appId: string): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    "version" in message &&
    "appId" in message &&
    message.type === "caipe.agenticApp.assistant.open.v1" &&
    message.version === "1.0" &&
    message.appId === appId
  );
}

function EmbedToolbar({ app }: { app: ResolvedApp }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/5 bg-slate-950/60 px-4 py-2 text-sm text-slate-300">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-100">{app.displayName}</span>
        <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
          embedded
        </span>
      </div>
    </div>
  );
}

function EmbedError({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center">
        <h2 className="text-lg font-semibold text-red-100">{title}</h2>
        <p className="mt-2 text-sm text-red-200/80">{description}</p>
        <a
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-100 transition hover:bg-white/[0.08]"
          href="/apps"
        >
          Back to Apps Hub
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    </div>
  );
}

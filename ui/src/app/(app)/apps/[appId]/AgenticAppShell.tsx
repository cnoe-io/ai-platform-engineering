"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, SlidersHorizontal } from "lucide-react";

import { AgenticAppAssistantOverlay } from "@/components/agentic-apps/AgenticAppAssistantOverlay";
import { apiClient } from "@/lib/api-client";
import { validateAssistantContextMessage } from "@/lib/agentic-apps/assistant-context";
import { buildAgenticAppRuntimePath } from "@/lib/agentic-apps/runtime-path";
import {
  resolveUsableChatAgent,
  type ResolvedChatAgent,
} from "@/lib/chat-agent-selection";
import { createMicrofrontendInitializeMessage } from "@/packages/agentic-app-sdk";
import type { AgenticAppAssistantContextRecord, AgenticAppManifest } from "@/types/agentic-app";

type PreferenceValue = boolean | number | string;
type AppPreferences = Record<string, PreferenceValue>;
type AppPreferencesById = Record<string, AppPreferences>;

interface ResolvedApp {
  appId: string;
  displayName: string;
  description: string;
  /** Private same-origin gateway path loaded by the iframe. */
  runtimePath: string;
  canLaunch: boolean;
  blockedReasons: string[];
  assistantEnabled?: boolean;
  assistantLabel?: string;
  assistantAgentId?: string;
  assistantAgentName?: string;
  ui?: AgenticAppManifest["ui"];
}

interface State {
  status: "loading" | "ready" | "denied" | "not_found" | "error";
  app?: ResolvedApp;
  message?: string;
}

interface AgenticAppShellProps {
  appId: string;
  path?: string[];
  onUnauthorized?: (loginUrl: string) => void;
}

/**
 * Renders an Agentic App inside the standard CAIPE shell via an `<iframe>`.
 *
 * The browser-visible route is `/apps/<id>`. The iframe loads the private
 * runtime gateway at `/api/agentic-apps/runtime/<id>`, which fronts every
 * request from within the iframe, including XHR/fetch made by the app bundle.
 * CAIPE chrome (header/banner) stays visible above the iframe.
 *
 * Auth/access is checked client-side via `/api/agentic-apps`; that endpoint is
 * already gated server-side, so this fetch reliably reflects the user's
 * effective access. Unauthorized users see a clear message instead of an
 * unstyled error inside the iframe.
 */
export function AgenticAppShell({ appId, path = [], onUnauthorized }: AgenticAppShellProps) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const runtimePath = `${buildAgenticAppRuntimePath(appId, path)}${query ? `?${query}` : ""}`;
  const [state, setState] = useState<State>({ status: "loading" });
  const [assistantContext, setAssistantContext] = useState<AgenticAppAssistantContextRecord | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBinding, setAssistantBinding] = useState<{
    bindingKey: string;
    agent: ResolvedChatAgent;
  } | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>({});
  const [preferencesByApp, setPreferencesByApp] = useState<AppPreferencesById>({});
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const assistantBindingKey = `${appId}:${state.app?.assistantAgentId ?? "default"}`;
  const assistantAgent =
    assistantBinding?.bindingKey === assistantBindingKey ? assistantBinding.agent : null;
  const assistantConfigured = state.app?.assistantEnabled !== false;
  const assistantEnabled = assistantConfigured && assistantAgent !== null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [res, settings] = await Promise.all([
          apiClient.getAgenticApps(),
          apiClient.getSettings().catch(() => null),
        ]);
        if (cancelled) return;
        const found = res.items.find((item) => item.appId === appId);
        if (!found) {
          setState({ status: "not_found" });
          return;
        }
        const storedByApp = normalizePreferencesByApp(
          settings?.preferences.agentic_app_preferences,
        );
        const resolvedPreferences = resolvePreferences(
          found.ui?.preferences,
          storedByApp[appId],
        );
        setPreferencesByApp(storedByApp);
        setPreferences(resolvedPreferences);
        setTheme(normalizeTheme(settings?.preferences.theme));
        if (!found.canLaunch) {
          setState({
            status: "denied",
            app: {
              appId: found.appId,
              displayName: found.displayName,
              description: found.description,
              runtimePath,
              canLaunch: false,
              blockedReasons: found.blockedReasons ?? [],
              assistantEnabled: found.assistantEnabled,
              assistantLabel: found.assistantLabel,
              assistantAgentId: found.assistantAgentId,
              assistantAgentName: found.assistantAgentName,
              ui: found.ui,
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
            runtimePath,
            canLaunch: true,
            blockedReasons: [],
            assistantEnabled: found.assistantEnabled,
            assistantLabel: found.assistantLabel,
            assistantAgentId: found.assistantAgentId,
            assistantAgentName: found.assistantAgentName,
            ui: found.ui,
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
  }, [appId, onUnauthorized, runtimePath]);

  useEffect(() => {
    let cancelled = false;

    if (state.status !== "ready" || !assistantConfigured) {
      return () => {
        cancelled = true;
      };
    }

    resolveUsableChatAgent({
      requestedAgentId: state.app?.assistantAgentId,
      requireAvailableAgent: true,
    })
      .then((agent) => {
        if (!cancelled) setAssistantBinding({ bindingKey: assistantBindingKey, agent });
      })
      .catch((error: unknown) => {
        // Agent availability is already filtered through CAS/OpenFGA by
        // /api/dynamic-agents/available. Fail closed when no authorized agent
        // can back the contextual assistant instead of opening a chat that is
        // guaranteed to return Permission denied.
        console.warn(
          `[AgenticAppShell] Contextual assistant unavailable for ${appId}:`,
          error instanceof Error ? error.message : String(error),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [appId, assistantBindingKey, assistantConfigured, state.app?.assistantAgentId, state.status]);

  const publishHostContext = useCallback((): void => {
    const target = iframeRef.current?.contentWindow;
    if (!target || state.status !== "ready") return;
    target.postMessage(
      createMicrofrontendInitializeMessage(appId, {
        surface: "hosted",
        route: window.location.pathname,
        theme,
        locale: navigator.language || "en-US",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        preferences,
      }),
      window.location.origin,
    );
  }, [appId, preferences, state.status, theme]);

  useEffect(() => {
    publishHostContext();
  }, [publishHostContext]);

  const updatePreference = useCallback(
    async (key: string, value: PreferenceValue): Promise<void> => {
      const schema = state.app?.ui?.preferences;
      const field = schema?.fields.find((candidate) => candidate.key === key);
      if (!field || !isPreferenceValueValid(field, value)) return;

      const previous = preferences;
      const next = { ...preferences, [key]: value };
      const nextByApp = { ...preferencesByApp, [appId]: next };
      setPreferences(next);
      setPreferencesByApp(nextByApp);
      setPreferenceError(null);
      try {
        await apiClient.updatePreferences({ agentic_app_preferences: nextByApp });
      } catch {
        setPreferences(previous);
        setPreferencesByApp({ ...preferencesByApp, [appId]: previous });
        setPreferenceError("Could not save preferences");
      }
    },
    [appId, preferences, preferencesByApp, state.app?.ui?.preferences],
  );

  useEffect(() => {
    if (!assistantConfigured) {
      // Force-closing the assistant when it becomes disabled (e.g. app config
      // changes mid-session) is a genuine reaction to a prop change, not
      // derivable state — it must run here alongside the message-listener
      // setup below, which this same effect also owns.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [appId, assistantConfigured]);

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
      <AppError
        title="App not found"
        description={`No installed Agentic App with id "${appId}".`}
      />
    );
  }

  if (state.status === "denied" && state.app) {
    const reason = state.app.blockedReasons[0] ?? "unauthorized";
    return (
      <AppError
        title={`Access denied: ${state.app.displayName}`}
        description={`You do not have permission to launch this app (${reason}).`}
      />
    );
  }

  if (state.status === "error") {
    return (
      <AppError
        title="Could not load app"
        description={state.message ?? "Unexpected error"}
      />
    );
  }

  if (state.status === "ready" && state.app) {
    return (
      <div className="flex flex-1 flex-col">
        <AppToolbar
          app={state.app}
          preferences={preferences}
          preferenceError={preferenceError}
          onPreferenceChange={updatePreference}
        />
        <iframe
          ref={iframeRef}
          onLoad={publishHostContext}
          title={state.app.displayName}
          src={state.app.runtimePath}
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
            assistantAgentId={assistantAgent.id}
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

function AppToolbar({
  app,
  preferences,
  preferenceError,
  onPreferenceChange,
}: {
  app: ResolvedApp;
  preferences: AppPreferences;
  preferenceError: string | null;
  onPreferenceChange: (key: string, value: PreferenceValue) => Promise<void>;
}) {
  const fields = app.ui?.preferences?.fields ?? [];
  return (
    <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-slate-950/60 px-4 py-2 text-sm text-slate-300">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-semibold text-slate-100">{app.displayName}</span>
        <span className="shrink-0 text-xs uppercase tracking-[0.18em] text-slate-500">
          GRID app
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Link
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          href="/apps"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to Apps
        </Link>
        {fields.length > 0 ? (
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Customize
            </summary>
            <div className="absolute right-0 top-full z-30 mt-2 w-72 space-y-3 rounded-xl border border-white/10 bg-slate-950 p-4 shadow-2xl">
              {fields.map((field) => (
                <PreferenceControl
                  key={field.key}
                  field={field}
                  value={preferences[field.key] ?? field.default}
                  onChange={(value) => onPreferenceChange(field.key, value)}
                />
              ))}
              {preferenceError ? <p className="text-xs text-red-300">{preferenceError}</p> : null}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function PreferenceControl({
  field,
  value,
  onChange,
}: {
  field: NonNullable<NonNullable<AgenticAppManifest["ui"]>["preferences"]>["fields"][number];
  value: PreferenceValue;
  onChange: (value: PreferenceValue) => Promise<void>;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 text-xs">
        <span>{field.label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => void onChange(event.target.checked)}
        />
      </label>
    );
  }

  return (
    <label className="block text-xs">
      <span className="mb-1 block text-slate-300">{field.label}</span>
      {field.type === "enum" ? (
        <select
          className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-100"
          value={String(value)}
          onChange={(event) => void onChange(event.target.value)}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-100"
          type={field.type === "number" ? "number" : "text"}
          min={field.min}
          max={field.max}
          value={String(value)}
          onChange={(event) =>
            void onChange(field.type === "number" ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </label>
  );
}

function resolvePreferences(
  schema: NonNullable<AgenticAppManifest["ui"]>["preferences"] | undefined,
  stored: AppPreferences | undefined,
): AppPreferences {
  if (!schema) return {};
  return Object.fromEntries(
    schema.fields.map((field) => {
      const value = stored?.[field.key];
      return [field.key, isPreferenceValueValid(field, value) ? value : field.default];
    }),
  );
}

function isPreferenceValueValid(
  field: NonNullable<NonNullable<AgenticAppManifest["ui"]>["preferences"]>["fields"][number],
  value: unknown,
): value is PreferenceValue {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (field.min === undefined || value >= field.min) &&
      (field.max === undefined || value <= field.max)
    );
  }
  if (field.type === "string") return typeof value === "string";
  return typeof value === "string" && Boolean(field.options?.some((option) => option.value === value));
}

function normalizePreferencesByApp(value: unknown): AppPreferencesById {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AppPreferencesById;
}

function normalizeTheme(value: unknown): "dark" | "light" | "system" {
  return value === "dark" || value === "light" ? value : "system";
}

function AppError({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center">
        <h2 className="text-lg font-semibold text-red-100">{title}</h2>
        <p className="mt-2 text-sm text-red-200/80">{description}</p>
        <Link
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-100 transition hover:bg-white/[0.08]"
          href="/apps"
        >
          Back to Apps Hub
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

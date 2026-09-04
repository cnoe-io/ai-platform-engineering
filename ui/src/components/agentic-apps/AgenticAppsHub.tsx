"use client";

import {
  ArrowUpRight,
  CloudSun,
  DollarSign,
  Info,
  LayoutGrid,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AgenticAppSecurityDialog } from "@/components/agentic-apps/AgenticAppSecurityDialog";
import { apiClient } from "@/lib/api-client";
import type { PublicAgenticApp } from "@/types/agentic-app";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; apps: PublicAgenticApp[] }
  | { status: "error"; message: string };

export function AgenticAppsHub(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [favoriteAppIds, setFavoriteAppIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/agentic-apps", { cache: "no-store" }).then(async (response) => {
        if (response.status === 401) {
          window.location.assign(
            `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`,
          );
          return null;
        }
        if (!response.ok) {
          throw new Error(`Apps catalog returned HTTP ${response.status}`);
        }
        return response.json() as Promise<{ items: PublicAgenticApp[] }>;
      }),
      apiClient.getSettings().catch(() => null),
    ])
      .then(([payload, settings]) => {
        if (cancelled) return;
        if (payload) setState({ status: "ready", apps: payload.items });
        setFavoriteAppIds(
          normalizeFavoriteAppIds(settings?.preferences.favorite_agentic_apps),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load Apps",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleApps = useMemo(() => {
    if (state.status !== "ready") return [];
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    if (terms.length === 0) return state.apps;
    return state.apps.filter((app) => {
      const searchable = normalizeSearch(
        [
          app.appId,
          app.displayName,
          app.description,
          app.createdBy,
          ...app.categories,
          ...app.capabilities,
          ...app.requestedScopes,
        ].join(" "),
      );
      return terms.every((term) => searchable.includes(term));
    });
  }, [query, state]);

  async function toggleFavorite(appId: string): Promise<void> {
    const previous = favoriteAppIds;
    const next = previous.includes(appId)
      ? previous.filter((id) => id !== appId)
      : [...previous, appId];
    setFavoriteAppIds(next);
    try {
      const updated = await apiClient.updatePreferences({
        favorite_agentic_apps: next,
      });
      setFavoriteAppIds(
        normalizeFavoriteAppIds(updated.preferences.favorite_agentic_apps),
      );
    } catch {
      setFavoriteAppIds(previous);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34rem),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.12),transparent_28rem),#020617] px-5 py-5 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.045] px-5 py-4 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <div className="absolute -right-20 -top-28 h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="rounded-xl bg-cyan-300/10 p-2 text-cyan-200">
              <LayoutGrid className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
              <p className="mt-1 max-w-4xl text-sm leading-5 text-slate-300">
                Discover trusted apps with platform-managed sign-in, navigation,
                authorization, credentials, and policy.
              </p>
            </div>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-white/10 bg-slate-900/70">
            <LoaderCircle
              className="h-6 w-6 animate-spin text-slate-400"
              aria-label="Loading Apps"
            />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="rounded-xl border border-red-300/30 bg-red-400/10 p-6">
            <h2 className="font-semibold">Could not load Apps</h2>
            <p className="mt-2 text-sm text-slate-300">{state.message}</p>
          </div>
        ) : null}

        {state.status === "ready" ? (
          state.apps.length === 0 ? (
            <section className="rounded-xl border border-dashed border-slate-700 bg-slate-900/70 p-10 text-center">
              <h2 className="text-lg font-semibold">No Apps are configured</h2>
              <p className="mt-2 text-sm text-slate-400">
                An operator can add an app through the deployment-owned catalog.
              </p>
            </section>
          ) : (
            <>
              <section
                aria-label="Search Apps"
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3"
              >
                <label className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-slate-950/70 py-2 pl-10 pr-11 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-white/20 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15 [&::-webkit-search-cancel-button]:appearance-none"
                    type="search"
                    placeholder="Search by app, capability, category, or scope"
                    aria-label="Search apps"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </label>
                <p
                  className="shrink-0 px-1 text-xs font-medium text-slate-400"
                  aria-live="polite"
                >
                  {query.trim()
                    ? `${visibleApps.length} of ${state.apps.length} apps`
                    : `${state.apps.length} ${state.apps.length === 1 ? "app" : "apps"}`}
                </p>
              </section>

              {visibleApps.length === 0 ? (
                <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/70 px-6 py-12 text-center text-slate-300">
                  No Apps match &ldquo;{query.trim()}&rdquo;.
                </section>
              ) : (
                <section
                  className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                  aria-label="Available Apps"
                >
                  {visibleApps.map((app) => (
                    <AppCard
                      key={app.appId}
                      app={app}
                      isFavorite={favoriteAppIds.includes(app.appId)}
                      onToggleFavorite={() => toggleFavorite(app.appId)}
                    />
                  ))}
                </section>
              )}
            </>
          )
        ) : null}
      </div>
    </main>
  );
}

function AppCard({
  app,
  isFavorite,
  onToggleFavorite,
}: {
  app: PublicAgenticApp;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}): React.ReactElement {
  const presentation = getAppPresentation(app);
  const Icon = presentation.Icon;
  const blockedLabel = formatBlockedReasons(app.blockedReasons);

  return (
    <article className="group relative flex min-h-64 flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-900/78 p-4 shadow-xl shadow-slate-950/40 transition duration-200 hover:-translate-y-1 hover:border-cyan-200/30 hover:bg-slate-900/92">
      <div
        className={`absolute -right-20 -top-24 h-48 w-48 rounded-full bg-gradient-to-br ${presentation.glow} opacity-80 blur-3xl transition group-hover:opacity-100`}
      />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
        <div
          aria-label={`${app.displayName} app icon`}
          className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br ${presentation.gradient} text-white shadow-2xl shadow-slate-950/30`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${isFavorite ? "border-amber-200/50 bg-amber-300/20 text-amber-100" : "border-white/10 bg-white/[0.06] text-slate-300 hover:border-amber-200/40 hover:bg-amber-300/10 hover:text-amber-100"}`}
            onClick={onToggleFavorite}
            aria-label={
              isFavorite
                ? `Unpin ${app.displayName} from home`
                : `Pin ${app.displayName} to home`
            }
            title={isFavorite ? "Pinned to home" : "Pin to home"}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={isFavorite ? "currentColor" : "none"}
              aria-hidden
            />
          </button>
          <RuntimeInfoTooltip app={app} />
          {app.sharingEnabled ? (
            <AgenticAppSecurityDialog
              appId={app.appId}
              displayName={app.displayName}
              createdBy={app.createdBy}
              requestedScopes={app.requestedScopes}
              initialVisibility={app.visibility}
              initialSharedWithTeams={app.sharedWithTeams}
              canManage={app.canManage}
            />
          ) : null}
          {app.canLaunch ? (
            <a
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/15"
              href={app.href}
              aria-label={`Open ${app.displayName}`}
              title={`Open ${app.displayName}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <span
              className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-amber-200/20 bg-amber-300/10 text-amber-100"
              aria-label={`${app.displayName} launch blocked`}
              title={`Launch blocked: ${blockedLabel}`}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            </span>
          )}
        </div>
      </div>
      <div className="pointer-events-none relative z-10 mt-4">
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${presentation.badge}`}
        >
          {presentation.category}
        </span>
      </div>
      {app.canLaunch ? (
        <a
          href={app.href}
          aria-label={`Launch ${app.displayName}`}
          className="appcard-stretched-link absolute inset-0 z-[5] cursor-pointer rounded-[1.35rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          <span className="sr-only">Launch {app.displayName}</span>
        </a>
      ) : null}
      <h2 className="pointer-events-none relative z-10 mt-3 line-clamp-1 text-lg font-semibold text-white">
        {app.displayName}
      </h2>
      <p className="pointer-events-none relative z-10 mt-2 line-clamp-3 flex-1 text-xs leading-5 text-slate-300">
        {app.description}
      </p>
      <p className="pointer-events-none relative z-10 mt-3 text-[11px] text-slate-500">
        Created by {app.createdBy}
      </p>
      {!app.canLaunch ? (
        <div className="relative z-10 mt-3 rounded-2xl border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Launch blocked: {blockedLabel}
        </div>
      ) : null}
    </article>
  );
}

function getAppPresentation(app: PublicAgenticApp) {
  if (app.appId === "weather") {
    return {
      Icon: CloudSun,
      category: "Weather",
      gradient: "from-sky-300 via-cyan-300 to-blue-500",
      glow: "from-sky-300/40 to-cyan-500/10",
      badge: "bg-sky-400/10 text-sky-200",
    };
  }
  if (app.appId === "finops" || app.appId === "litellm") {
    return {
      Icon: DollarSign,
      category: app.categories[0] ?? "FinOps",
      gradient: "from-emerald-300 via-cyan-300 to-teal-500",
      glow: "from-emerald-300/40 to-cyan-500/10",
      badge: "bg-emerald-400/10 text-emerald-200",
    };
  }
  return {
    Icon: Sparkles,
    category: app.categories[0] ?? "Agentic app",
    gradient: "from-violet-300 via-cyan-300 to-indigo-500",
    glow: "from-violet-300/35 to-cyan-500/10",
    badge: "bg-violet-400/10 text-violet-200",
  };
}

function formatBlockedReasons(reasons: string[]): string {
  return reasons.length
    ? reasons.join(", ").replaceAll("_", " ")
    : "policy denied";
}

function RuntimeInfoTooltip({
  app,
}: {
  app: PublicAgenticApp;
}): React.ReactElement {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 8,
      left: Math.min(window.innerWidth - 300, Math.max(12, rect.right - 288)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-200 transition hover:border-cyan-200/40 hover:bg-cyan-300/10 hover:text-cyan-100"
        aria-label={`Runtime details for ${app.displayName}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className="fixed z-[60] w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-left text-xs leading-5 text-slate-200 shadow-2xl backdrop-blur"
              style={{ top: coords.top, left: coords.left }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                App runtime
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                {app.runtimeKind === "in-process" ? "In-process" : "Separate process"}
              </p>
              <p className="mt-1 text-slate-400">
                This app runs independently and is securely connected through the
                platform gateway.
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function normalizeFavoriteAppIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[-_:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

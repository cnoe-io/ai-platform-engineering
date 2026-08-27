"use client";

// assisted-by Codex Codex-sonnet-4-6

import {
  ArrowUpRight,
  CloudSun,
  DollarSign,
  Info,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

import { apiClient } from "@/lib/api-client";
import { AgenticAppSecurityDialog } from "@/components/agentic-apps/AgenticAppSecurityDialog";
import { filterAgenticApps } from "@/lib/agentic-apps/hub-search";
import { resolveAgenticAppLaunchUrl } from "@/lib/agentic-apps/launch-url";
import type {
  AgenticAppBlockedReason,
  AgenticAppHealthStatus,
  AgenticAppManifest,
  AgenticAppVisibility,
} from "@/types/agentic-app";

type AgenticAppsHubApp = AgenticAppManifest & {
  canLaunch?: boolean;
  blockedReasons?: AgenticAppBlockedReason[];
  runtimeStatus?: AgenticAppHealthStatus;
  visibility: AgenticAppVisibility;
  sharedWithTeams: string[];
  createdBy: string;
  canManage: boolean;
};

interface AgenticAppsHubProps {
  apps: AgenticAppsHubApp[];
}

export function AgenticAppsHub({ apps }: AgenticAppsHubProps) {
  const [favoriteAppIds, setFavoriteAppIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const visibleApps = useMemo(
    () => filterAgenticApps(apps, searchQuery),
    [apps, searchQuery],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFavorites() {
      try {
        const settings = await apiClient.getSettings();
        if (!cancelled) {
          setFavoriteAppIds(
            normalizeFavoriteAppIds(settings.preferences.favorite_agentic_apps),
          );
        }
      } catch {
        if (!cancelled) {
          setFavoriteAppIds([]);
        }
      }
    }

    loadFavorites();

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleFavorite(appId: string) {
    const wasFavorite = favoriteAppIds.includes(appId);
    const nextFavorites = wasFavorite
      ? favoriteAppIds.filter((id) => id !== appId)
      : [...favoriteAppIds, appId];

    setFavoriteAppIds(nextFavorites);
    try {
      const updated = await apiClient.updatePreferences({
        favorite_agentic_apps: nextFavorites,
      });
      setFavoriteAppIds(
        normalizeFavoriteAppIds(updated.preferences.favorite_agentic_apps),
      );
    } catch {
      setFavoriteAppIds(favoriteAppIds);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34rem),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.12),transparent_28rem),#020617] px-5 py-5 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <section className="relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.045] px-5 py-4 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <div className="absolute -right-20 -top-28 h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="absolute bottom-0 right-32 h-32 w-32 rounded-full bg-violet-400/10 blur-2xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Agentic Apps
              </h1>
              <p className="mt-1.5 max-w-4xl text-sm leading-5 text-slate-300">
                Discover trusted agentic apps with CAIPE-managed navigation,
                authorization, credentials, and policy—while each app remains
                independently owned and operated.
              </p>
            </div>
            <Link
              href="/apps/create"
              className="group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200/30 bg-cyan-300/10 text-cyan-100 shadow-lg shadow-cyan-950/20 transition hover:scale-105 hover:bg-cyan-300/20"
              aria-label="Create or add your app"
              title="Create or add your app"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="pointer-events-none absolute right-0 top-full mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover:block">
                Create or add your app
              </span>
            </Link>
          </div>
        </section>

        {apps.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/70 p-8 text-slate-300">
            <h2 className="text-xl font-semibold text-slate-100">
              No agentic apps are enabled
            </h2>
            <p className="mt-3">
              Enable the FinOps sample from the host with{" "}
              <code className="rounded bg-slate-800 px-2 py-1 text-cyan-200">
                AGENTIC_APPS_ENABLED=finops
              </code>{" "}
              and point{" "}
              <code className="rounded bg-slate-800 px-2 py-1 text-cyan-200">
                AGENTIC_APP_FINOPS_ORIGIN
              </code>{" "}
              at the separately running app.
            </p>
            <p className="mt-5 text-sm text-slate-400">
              Start with{" "}
              <Link className="font-semibold text-cyan-200" href="/apps/create">
                Create or add your app
              </Link>{" "}
              to choose a manifest, runtime, access policy, and integrated
              rendering mode.
            </p>
          </section>
        ) : (
          <>
            <section
              aria-label="Search agentic apps"
              className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3 shadow-lg shadow-slate-950/20 sm:flex-row sm:items-center"
            >
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by app, capability, category, or scope"
                  aria-label="Search apps"
                  className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-slate-950/70 py-2 pl-10 pr-11 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-white/20 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15 [&::-webkit-search-cancel-button]:appearance-none"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    title="Clear search"
                    className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <p
                className="shrink-0 px-1 text-xs font-medium text-slate-400"
                aria-live="polite"
              >
                {searchQuery.trim()
                  ? `${visibleApps.length} of ${apps.length} apps`
                  : `${apps.length} ${apps.length === 1 ? "app" : "apps"}`}
              </p>
            </section>

            {visibleApps.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/70 px-6 py-12 text-center text-slate-300">
                <Search
                  className="mx-auto h-8 w-8 text-slate-500"
                  aria-hidden
                />
                <h2 className="mt-4 text-xl font-semibold text-slate-100">
                  No apps match &ldquo;{searchQuery.trim()}&rdquo;
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Try an app name, capability, category, or access scope.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="mt-5 rounded-xl border border-cyan-200/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                >
                  Clear search
                </button>
              </section>
            ) : (
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleApps.map((app) => {
                  const presentation = getAppPresentation(app);
                  const Icon = presentation.Icon;
                  const isFavorite = favoriteAppIds.includes(app.id);
                  const isBlocked = app.canLaunch === false;
                  const blockedLabel = formatBlockedReasons(app.blockedReasons);

                  return (
                    <article
                      key={app.id}
                      className="group relative flex min-h-64 flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-900/78 p-4 shadow-xl shadow-slate-950/40 transition duration-200 hover:-translate-y-1 hover:border-cyan-200/30 hover:bg-slate-900/92"
                    >
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
                            className={`group/favorite relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
                              isFavorite
                                ? "border-amber-200/50 bg-amber-300/20 text-amber-100"
                                : "border-white/10 bg-white/[0.06] text-slate-300 hover:border-amber-200/40 hover:bg-amber-300/10 hover:text-amber-100"
                            }`}
                            onClick={() => toggleFavorite(app.id)}
                            aria-label={
                              isFavorite
                                ? `Unpin ${app.displayName} from home`
                                : `Pin ${app.displayName} to home`
                            }
                            title={
                              isFavorite
                                ? `Unpin ${app.displayName} from home`
                                : `Pin ${app.displayName} to home`
                            }
                          >
                            <Star
                              className="h-3.5 w-3.5"
                              fill={isFavorite ? "currentColor" : "none"}
                              aria-hidden
                            />
                            <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover/favorite:block">
                              {isFavorite ? "Pinned to home" : "Pin to home"}
                            </span>
                          </button>
                          <RuntimeInfoTooltip app={app} />
                          <AgenticAppSecurityDialog
                            appId={app.id}
                            displayName={app.displayName}
                            createdBy={app.createdBy}
                            requestedScopes={app.access.tokenScopes}
                            initialVisibility={app.visibility}
                            initialSharedWithTeams={app.sharedWithTeams}
                            canManage={app.canManage}
                          />
                          {isBlocked ? (
                            <span
                              className="relative inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-amber-200/20 bg-amber-300/10 text-amber-100"
                              aria-label={`${app.displayName} launch blocked`}
                              title={`Launch blocked: ${blockedLabel}`}
                            >
                              <ShieldCheck
                                className="h-3.5 w-3.5"
                                aria-hidden
                              />
                            </span>
                          ) : (
                            <a
                              className="group/action relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/15"
                              href={resolveAgenticAppLaunchUrl(app)}
                              aria-label={`Open ${app.displayName}`}
                              title={`Open ${app.displayName}`}
                            >
                              <ArrowUpRight
                                className="h-3.5 w-3.5"
                                aria-hidden
                              />
                              <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover/action:block">
                                Launch {app.displayName}
                              </span>
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="pointer-events-none relative z-10 mt-4 flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${presentation.badge}`}
                        >
                          {presentation.category}
                        </span>
                      </div>

                      {isBlocked ? null : (
                        <a
                          href={resolveAgenticAppLaunchUrl(app)}
                          aria-label={`Launch ${app.displayName}`}
                          title={`Launch ${app.displayName}`}
                          className="appcard-stretched-link absolute inset-0 z-[5] cursor-pointer rounded-[1.35rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                        >
                          <span className="sr-only">
                            Launch {app.displayName}
                          </span>
                        </a>
                      )}

                      <h2 className="pointer-events-none relative z-10 mt-3 line-clamp-1 text-lg font-semibold text-white">
                        {app.displayName}
                      </h2>
                      <p className="pointer-events-none relative z-10 mt-2 line-clamp-3 flex-1 text-xs leading-5 text-slate-300">
                        {app.description}
                      </p>
                      <p className="pointer-events-none relative z-10 mt-3 text-[11px] text-slate-500">
                        Created by {formatCreatedBy(app.createdBy)}
                      </p>

                      {isBlocked ? (
                        <div className="relative z-10 mt-3 rounded-2xl border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                          <p className="font-semibold">Launch blocked</p>
                          <p className="mt-1 text-amber-100/80">
                            {blockedLabel}
                          </p>
                        </div>
                      ) : null}

                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function formatCreatedBy(value: string): string {
  return value === "seed-config" || value === "system" ? "Deployment config" : value;
}

function getAppPresentation(app: AgenticAppManifest) {
  if (app.id === "agentic-sdlc") {
    return {
      Icon: Rocket,
      category: "SDLC",
      gradient: "from-fuchsia-300 via-cyan-300 to-indigo-500",
      glow: "from-fuchsia-300/35 to-cyan-500/10",
      badge: "bg-fuchsia-400/10 text-fuchsia-200",
    };
  }

  if (app.id === "weather") {
    return {
      Icon: CloudSun,
      category: "Starter",
      gradient: "from-sky-300 via-cyan-300 to-blue-500",
      glow: "from-sky-300/40 to-cyan-500/10",
      badge: "bg-sky-400/10 text-sky-200",
    };
  }

  if (app.id === "finops") {
    return {
      Icon: DollarSign,
      category: "FinOps",
      gradient: "from-emerald-300 via-cyan-300 to-teal-500",
      glow: "from-emerald-300/40 to-cyan-500/10",
      badge: "bg-emerald-400/10 text-emerald-200",
    };
  }

  return {
    Icon: Sparkles,
    category: "Agentic app",
    gradient: "from-violet-300 via-cyan-300 to-indigo-500",
    glow: "from-violet-300/35 to-cyan-500/10",
    badge: "bg-violet-400/10 text-violet-200",
  };
}

function formatBlockedReasons(
  reasons: AgenticAppBlockedReason[] | undefined,
): string {
  if (!reasons || reasons.length === 0) {
    return "policy denied";
  }
  return reasons.join(", ").replaceAll("_", " ");
}

function runtimeLabel(kind: AgenticAppManifest["runtime"]["kind"]): string {
  return kind === "in-process" ? "In-process" : "Separate process";
}

function RuntimeInfoTooltip({ app }: { app: AgenticAppManifest }) {
  const activeLabel = runtimeLabel(app.runtime.kind);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);

  // Client-mount guard for the `createPortal` below — `document.body` isn't
  // available during SSR, so this must flip after mount, not be derived.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const POPOVER_WIDTH = 288;
    const margin = 12;
    const left = Math.min(
      window.innerWidth - POPOVER_WIDTH - margin,
      Math.max(margin, rect.right - POPOVER_WIDTH),
    );
    const top = rect.bottom + 8;
    setCoords({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        buttonRef.current &&
        e.target instanceof Node &&
        !buttonRef.current.contains(e.target) &&
        !(e.target as HTMLElement).closest("[data-runtime-popover]")
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-200 transition hover:border-cyan-200/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        aria-label={`Runtime details for ${app.displayName}`}
        title={`Runtime: ${activeLabel} — click for details`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {mounted &&
        createPortal(
          <div
            role="tooltip"
            data-runtime-popover
            aria-hidden={!open}
            className={`fixed z-[60] w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-left text-xs leading-5 text-slate-200 shadow-2xl shadow-slate-950/40 backdrop-blur ${
              open ? "block" : "hidden"
            }`}
            style={
              coords
                ? { top: `${coords.top}px`, left: `${coords.left}px` }
                : { top: "-9999px", left: "-9999px" }
            }
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
              App runtime
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              This app: {activeLabel}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              runtime.kind ={" "}
              <code className="text-cyan-200">{app.runtime.kind}</code>
            </p>

            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  In-process
                </dt>
                <dd className="mt-1 text-slate-300">
                  The app runs inside the CAIPE shell as a regular Next.js page.
                  It shares the host&apos;s React tree, design system, and
                  session. Best for first-party features that ship with CAIPE.
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  Separate process
                </dt>
                <dd className="mt-1 text-slate-300">
                  The app runs as its own service (a container or Node process).
                  CAIPE proxies{" "}
                  <code className="text-cyan-200">/apps/&lt;id&gt;</code> to its
                  origin and signs each request with HMAC. Best when teams own
                  and ship their app independently.
                </dd>
              </div>
            </dl>
          </div>,
          document.body,
        )}
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

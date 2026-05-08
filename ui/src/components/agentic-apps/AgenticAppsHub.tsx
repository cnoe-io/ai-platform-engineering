"use client";

// assisted-by Codex Codex-sonnet-4-6

import {
  ArrowUpRight,
  CloudSun,
  DollarSign,
  Info,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { apiClient } from "@/lib/api-client";
import type { AgenticAppManifest } from "@/types/agentic-app";

interface AgenticAppsHubProps {
  apps: AgenticAppManifest[];
}

export function AgenticAppsHub({ apps }: AgenticAppsHubProps) {
  const [favoriteAppIds, setFavoriteAppIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadFavorites() {
      try {
        const settings = await apiClient.getSettings();
        if (!cancelled) {
          setFavoriteAppIds(normalizeFavoriteAppIds(settings.preferences.favorite_agentic_apps));
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
      setFavoriteAppIds(normalizeFavoriteAppIds(updated.preferences.favorite_agentic_apps));
    } catch {
      setFavoriteAppIds(favoriteAppIds);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34rem),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.12),transparent_28rem),#020617] px-6 py-8 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] p-8 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="absolute bottom-0 right-32 h-40 w-40 rounded-full bg-violet-400/10 blur-2xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
                CAIPE extensibility
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Agentic Apps Hub</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
                Discover trusted agentic apps that keep CAIPE in control of shell,
                RBAC, tokens, and policy while app runtimes stay independently owned.
              </p>
            </div>
            <a
              href="/apps/create"
              className="group relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-300/10 text-cyan-100 shadow-lg shadow-cyan-950/20 transition hover:scale-105 hover:bg-cyan-300/20"
              aria-label="Create or add your app"
              title="Create or add your app"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="pointer-events-none absolute right-0 top-full mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover:block">
                Create or add your app
              </span>
            </a>
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
              Start with <a className="font-semibold text-cyan-200" href="/apps/create">Create or add your app</a>{" "}
              to choose a manifest, runtime, access policy, and integrated rendering mode.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => {
              const presentation = getAppPresentation(app);
              const Icon = presentation.Icon;
              const isFavorite = favoriteAppIds.includes(app.id);

              return (
                <article
                  key={app.id}
                  className="group relative flex min-h-80 flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/78 p-6 shadow-xl shadow-slate-950/40 transition duration-200 hover:-translate-y-1 hover:border-cyan-200/30 hover:bg-slate-900/92"
                >
                  <div
                    className={`absolute -right-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br ${presentation.glow} opacity-80 blur-3xl transition group-hover:opacity-100`}
                  />
                  <div className="relative flex items-start justify-between gap-4">
                    <div
                      aria-label={`${app.displayName} app icon`}
                      className={`flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-white/15 bg-gradient-to-br ${presentation.gradient} text-white shadow-2xl shadow-slate-950/30`}
                    >
                      <Icon className="h-8 w-8" aria-hidden />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`group/favorite relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition ${
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
                          className="h-4 w-4"
                          fill={isFavorite ? "currentColor" : "none"}
                          aria-hidden
                        />
                        <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover/favorite:block">
                          {isFavorite ? "Pinned to home" : "Pin to home"}
                        </span>
                      </button>
                      <RuntimeInfoTooltip app={app} />
                      <IconTooltip label="Verified app contract">
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                      </IconTooltip>
                      <a
                        className="group/action relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/15"
                        href={app.runtime.mountPath}
                        aria-label={`Open ${app.displayName}`}
                        title={`Open ${app.displayName}`}
                      >
                        <ArrowUpRight className="h-4 w-4" aria-hidden />
                        <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover/action:block">
                          Launch {app.displayName}
                        </span>
                      </a>
                    </div>
                  </div>

                  <div className="relative mt-6 flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${presentation.badge}`}>
                      {presentation.category}
                    </span>
                  </div>

                  <h2 className="relative mt-5 text-2xl font-semibold text-white">
                    {app.displayName}
                  </h2>
                  <p className="relative mt-3 flex-1 text-sm leading-6 text-slate-300">
                    {app.description}
                  </p>

                  <div className="relative mt-5 flex flex-wrap gap-2">
                    {app.access.tokenScopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full border border-white/10 bg-slate-950/55 px-2.5 py-1 text-[11px] text-slate-400"
                        title={`Token scope: ${scope}`}
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

function IconTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <span
      className="group/tip relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-emerald-100"
      aria-label={label}
      title={label}
    >
      {children}
      <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover/tip:block">
        {label}
      </span>
    </span>
  );
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

function runtimeLabel(kind: AgenticAppManifest["runtime"]["kind"]): string {
  return kind === "in-process" ? "In-process" : "Separate process";
}

function RuntimeInfoTooltip({ app }: { app: AgenticAppManifest }) {
  const activeLabel = runtimeLabel(app.runtime.kind);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
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
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-200 transition hover:border-cyan-200/40 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        aria-label={`Runtime details for ${app.displayName}`}
        title={`Runtime: ${activeLabel} — click for details`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Info className="h-4 w-4" aria-hidden />
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
                  The app runs inside the CAIPE shell as a regular Next.js
                  page. It shares the host&apos;s React tree, design system,
                  and session. Best for first-party features that ship with
                  CAIPE.
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  Separate process
                </dt>
                <dd className="mt-1 text-slate-300">
                  The app runs as its own service (a container or Node
                  process). CAIPE proxies{" "}
                  <code className="text-cyan-200">/apps/&lt;id&gt;</code> to
                  its origin and signs each request with HMAC. Best when
                  teams own and ship their app independently.
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
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

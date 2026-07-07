"use client";

// assisted-by Codex Codex-sonnet-4-6

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "cyan" | "slate" | "emerald" | "amber" | "red";

const toneClasses: Record<Tone, string> = {
  cyan: "border-cyan-300/30 bg-cyan-300/15 text-cyan-100",
  slate: "border-white/10 bg-white/[0.04] text-slate-100",
  emerald: "border-emerald-300/30 bg-emerald-300/15 text-emerald-100",
  amber: "border-amber-300/30 bg-amber-300/15 text-amber-100",
  red: "border-red-300/30 bg-red-300/15 text-red-100",
};

export function AppButton({
  children,
  className = "",
  tone = "cyan",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function AppBadge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-950/60 p-6 md:flex-row md:items-start md:justify-between">
      <div>
        {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">{eyebrow}</p> : null}
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  description,
  tone = "cyan",
}: {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: Tone;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className={`mt-2 text-2xl font-black ${tone === "slate" ? "text-white" : toneClasses[tone].split(" ").at(-1)}`}>
        {value}
      </div>
      {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
    </article>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function AppTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-slate-950/70 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`rounded-full px-3 py-1.5 text-sm transition ${
            tab.id === activeId ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/10"
          }`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Toolbar({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function AssistantTrigger({
  hasContext,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { hasContext?: boolean }) {
  return (
    <AppButton tone={hasContext ? "cyan" : "slate"} {...props}>
      Ask CAIPE{hasContext ? " with context" : ""}
    </AppButton>
  );
}

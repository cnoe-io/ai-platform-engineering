"use client";

// assisted-by Codex Codex-sonnet-4-6

import { Bot, MessageCircle, Sparkles } from "lucide-react";

interface AgenticAppAssistantPanelProps {
  appName: string;
  agentName: string;
  prompt: string;
  accent?: "cyan" | "emerald" | "violet";
}

const accentClasses = {
  cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
  emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
  violet: "border-violet-300/20 bg-violet-400/10 text-violet-100",
};

export function AgenticAppAssistantPanel({
  appName,
  agentName,
  prompt,
  accent = "cyan",
}: AgenticAppAssistantPanelProps) {
  return (
    <aside className="rounded-3xl border border-white/10 bg-slate-900/75 p-6 shadow-2xl shadow-slate-950/30">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Host component
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">App assistant</h2>
        </div>
        <div className={`rounded-2xl border p-3 ${accentClasses[accent]}`}>
          <Bot className="h-5 w-5" aria-hidden />
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">
        Reusable CAIPE chat shell for {appName}. It keeps tokens, thread state, and
        RBAC in the host while routing app-specific questions to{" "}
        <code className="rounded bg-slate-950/70 px-1.5 py-0.5 text-cyan-100">
          {agentName}
        </code>
        .
      </p>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <MessageCircle className="h-4 w-4 text-cyan-200" aria-hidden />
          Suggested opening
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">{prompt}</p>
      </div>

      <button
        type="button"
        className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
      >
        <Sparkles className="h-4 w-4 text-cyan-200" aria-hidden />
        Open app assistant
      </button>
    </aside>
  );
}

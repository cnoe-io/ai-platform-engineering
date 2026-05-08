"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useEffect, useState } from "react";

import { AgenticAppAssistantPanel } from "@/components/agentic-apps/AgenticAppAssistantPanel";

interface FinOpsSummary {
  monthToDateSpend: string;
  forecast: string;
  savingsOpportunity: string;
  anomalyCount: number;
}

const DEFAULT_SUMMARY: FinOpsSummary = {
  monthToDateSpend: "$128.4K",
  forecast: "$173.8K",
  savingsOpportunity: "$31.2K",
  anomalyCount: 3,
};

const COST_SIGNALS = [
  { label: "EKS rightsizing", value: "$12.6K", tone: "from-emerald-300/30" },
  { label: "Idle NAT gateways", value: "$6.8K", tone: "from-cyan-300/30" },
  { label: "Storage lifecycle", value: "$4.1K", tone: "from-violet-300/30" },
];

export function FinOpsIntegratedApp() {
  const [summary, setSummary] = useState<FinOpsSummary>(DEFAULT_SUMMARY);
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        const response = await fetch("/apps/finops/api/summary", {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error("finops_summary_unavailable");
        }
        const body = (await response.json()) as Partial<FinOpsSummary>;
        if (!cancelled) {
          setSummary({
            monthToDateSpend: body.monthToDateSpend ?? DEFAULT_SUMMARY.monthToDateSpend,
            forecast: body.forecast ?? DEFAULT_SUMMARY.forecast,
            savingsOpportunity: body.savingsOpportunity ?? DEFAULT_SUMMARY.savingsOpportunity,
            anomalyCount:
              typeof body.anomalyCount === "number"
                ? body.anomalyCount
                : DEFAULT_SUMMARY.anomalyCount,
          });
          setStatus("Rendered from FinOps runtime response");
        }
      } catch {
        if (!cancelled) {
          setStatus("FinOps runtime unavailable; showing template fallback");
        }
      }
    }

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex-1 overflow-y-auto bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="relative overflow-hidden rounded-3xl border border-emerald-300/20 bg-white/[0.04] p-7 shadow-2xl shadow-emerald-950/30 backdrop-blur">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="absolute -bottom-28 left-24 h-72 w-72 rounded-full bg-cyan-300/15 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
              Integrated app surface
            </p>
            <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-white">
                  FinOps Dashboard
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  CAIPE shell remains in control of navigation, session, RBAC, audit,
                  and launch policy. The FinOps runtime provides data and agent actions
                  while this native viewport renders the integrated experience.
                </p>
              </div>
              <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-200">
                {status}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/15 via-cyan-500/10 to-slate-900 p-6 shadow-2xl shadow-emerald-950/30">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">
              Cloud spend command center
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-4">
              <MetricCard label="Month-to-date" value={summary.monthToDateSpend} />
              <MetricCard label="Forecast" value={summary.forecast} />
              <MetricCard label="Savings" value={summary.savingsOpportunity} />
              <MetricCard label="Anomalies" value={String(summary.anomalyCount)} />
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/45 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">Savings radar</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    CopilotKit can ask the FinOps agent to render these candidates as
                    cards, charts, or approval tasks.
                  </p>
                </div>
                <div className="h-20 w-20 rounded-full border border-emerald-200/30 bg-[radial-gradient(circle,rgba(110,231,183,0.45)_0%,rgba(34,211,238,0.18)_42%,transparent_68%)]" />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {COST_SIGNALS.map((signal) => (
                  <div
                    key={signal.label}
                    className={`rounded-2xl border border-white/10 bg-gradient-to-br ${signal.tone} to-slate-950/80 p-4`}
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      {signal.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">{signal.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <AgenticAppAssistantPanel
            appName="FinOps Dashboard"
            agentName="finops-agent"
            prompt="Find the top three spend anomalies and draft approval-ready savings actions."
            accent="emerald"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <aside className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-xl font-semibold text-white">CopilotKit action panel</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The integrated page uses fixed host components and allows the FinOps agent
              to provide data and layout intent. No external runtime code gets direct
              access to the CAIPE token or React tree.
            </p>
            <pre className="mt-5 overflow-auto rounded-2xl border border-emerald-300/20 bg-slate-950/80 p-4 text-xs leading-5 text-emerald-100">
{`useCopilotAction({
  name: "renderFinOpsPlan",
  render: ({ args }) => <SavingsRadar items={args.items} />,
});`}
            </pre>
          </aside>

          <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6">
            <h2 className="text-xl font-semibold text-white">Agentic workflow preview</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {["Investigate variance", "Draft savings plan", "Create approval tasks"].map(
                (step, index) => (
                  <div
                    key={step}
                    className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                  >
                    <p className="text-sm font-semibold text-emerald-200">0{index + 1}</p>
                    <p className="mt-2 text-sm text-slate-200">{step}</p>
                  </div>
                ),
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-white">{value}</p>
    </article>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  MessageSquare,
  MessagesSquare,
  Plug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * First-run walkthrough for a project's Tome. A small forward/back wizard that
 * builds the mental model step by step: what Tome is, how pages carry a *kind*
 * (stable / dynamic / hidden), how ingest rebuilds the wiki from sources, how
 * you work with it (agent + Talk), and how to wire a coding agent over MCP.
 * Presentational only; the host owns when it shows and persisting dismissal.
 */
export function OnboardingModal({
  open,
  onOpenChange,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <BlinkStyle />
        {/* Radix unmounts the content on close, so the wizard remounts (resets
            to step 0) on each open without a reset effect. */}
        <Wizard projectName={projectName} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Wizard({
  projectName,
  onClose,
}: {
  projectName?: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  // Slide direction for the per-step transition (+1 forward, -1 back).
  const [dir, setDir] = useState(1);

  const steps = buildSteps(projectName);
  const last = steps.length - 1;

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(last, next)));
  };

  const current = steps[step];

  return (
    <div className="flex flex-col">
          {/* Step body, keyed by step so the slide animation replays. */}
          <div className="min-h-[380px] px-6 pb-8 pt-8">
            <div
              key={step}
              className={cn(
                "fill-mode-both animate-in fade-in duration-300",
                dir === 1 ? "slide-in-from-right-8" : "slide-in-from-left-8",
              )}
            >
              {current.node}
            </div>
          </div>

          {/* Footer: progress dots + back / next. */}
          <div className="flex items-center justify-between border-t px-6 py-4">
            <div className="flex items-center gap-1.5">
              {steps.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  onClick={() => go(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={() => go(step - 1)}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
              )}
              {step < last ? (
                <Button size="sm" onClick={() => go(step + 1)}>
                  Next
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" onClick={onClose}>
                  Get started
                </Button>
              )}
            </div>
          </div>
    </div>
  );
}

/* ---------------------------------------------------------------- steps --- */

interface Step {
  node: React.ReactNode;
}

function buildSteps(projectName?: string): Step[] {
  const name = projectName ?? "your project";
  return [
    { node: <WelcomeStep name={name} /> },
    { node: <PagesStep /> },
    { node: <IngestStep /> },
    { node: <AgentStep /> },
    { node: <TalkStep /> },
    { node: <McpStep /> },
  ];
}

function StepHeader({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon?: React.ReactNode;
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {icon && (
        <div className="gradient-primary-br mb-2 flex h-11 w-11 items-center justify-center rounded-xl text-white">
          {icon}
        </div>
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
        {eyebrow}
      </p>
      <h2 className="text-xl font-semibold leading-tight">{title}</h2>
      {children && (
        <div className="pt-1 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

function WelcomeStep({ name }: { name: string }) {
  return (
    <div className="space-y-5">
      <StepHeader
        icon={<BookOpen className="h-5 w-5" />}
        eyebrow="Welcome to Tome"
        title={`A living wiki for ${name}`}
      >
        <p>
          The agent curates the wiki from your sources, so your team and your
          coding agents share one living source of truth about the project.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/80">
          Built for Tiny Teams with Tokens.
        </p>
      </StepHeader>
    </div>
  );
}

function PagesStep() {
  return (
    <div className="space-y-4">
      <StepHeader eyebrow="The wiki" title="Every page has a kind">
        Pages declare a <code className="rounded bg-muted px-1 py-0.5 text-xs">kind</code> in their frontmatter. It
        decides who owns the page: you, or the agent.
      </StepHeader>
      <Terminal>
        <span className="text-muted-foreground/60">---</span>
        {"\n"}
        <span className="text-sky-400">title</span>: Overview
        {"\n"}
        <span className="text-sky-400">kind</span>: <span className="text-amber-300">dynamic</span>
        {"\n"}
        <span className="text-muted-foreground/60">---</span>
      </Terminal>
      <ul className="space-y-2.5">
        <KindRow color="emerald" name="stable" desc="Pinned by you. The agent won't rewrite it; your source of truth." />
        <KindRow color="sky" name="dynamic" desc="Agent-owned. Rewritten on each ingest to stay current." />
        <KindRow color="zinc" name="hidden" desc="The agent's private memory. Not shown in the sidebar." />
      </ul>
    </div>
  );
}

function IngestStep() {
  return (
    <div className="space-y-4">
      <StepHeader eyebrow="Ingest" title="The agent rebuilds the wiki from your sources">
        Run an ingest and the agent pulls from your{" "}
        <span className="font-medium text-foreground">GitHub repos, Confluence spaces, and Webex rooms</span>, then
        synthesizes them into the wiki, rewriting <em>dynamic</em> pages and leaving your <em>stable</em> ones
        untouched.
      </StepHeader>
      <IngestDemo />
    </div>
  );
}

function AgentStep() {
  return (
    <div className="space-y-4">
      <StepHeader
        icon={<MessageSquare className="h-5 w-5" />}
        eyebrow="Agent"
        title="Chat with the editing agent"
      >
        Ask questions about the project, or have it draft, refine, and
        reorganize the wiki pages it reads and writes.
      </StepHeader>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Try asking</p>
        <ul className="space-y-1">
          {[
            "What changed this week?",
            "Draft an architecture overview",
            "Summarize the open decisions",
          ].map((q) => (
            <li key={q} className="flex gap-2 text-sm text-muted-foreground">
              <span className="select-none text-primary/70">›</span>
              <span className="italic">{q}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TalkStep() {
  return (
    <div className="space-y-4">
      <StepHeader
        icon={<MessagesSquare className="h-5 w-5" />}
        eyebrow="Talk"
        title="Bring your agents into the mix"
      >
        Talk is the conversation about the project, powered by Mycelium. People
        post here, and so do agents:{" "}
        <span className="font-medium text-foreground">connect a coding agent over MCP</span>{" "}
        and it can read the wiki, post to Talk, and update pages as it works.
      </StepHeader>
      <TalkDemo />
    </div>
  );
}

/**
 * Auto-looping carousel of "claude doing things in Tome" vignettes, to show
 * what bringing an agent into the project looks like in practice.
 */
type Line =
  | { role: "user"; text: string }
  | { role: "mcp"; text: string }
  | { role: "result"; text: string }
  | { role: "agent"; text: string };

function TalkDemo() {
  const vignettes: Line[][] = [
    [
      { role: "user", text: "What's the status of project X?" },
      { role: "mcp", text: 'tome_get_pages(["standup.md"])' },
      { role: "result", text: "1 page" },
      { role: "agent", text: "On track. Auth refactor shipped; OIDC migration is the open risk." },
    ],
    [
      { role: "user", text: "Update tome to note the auth refactor shipped" },
      { role: "mcp", text: 'tome_edit_page("overview.md")' },
      { role: "result", text: "ok" },
      { role: "agent", text: "Done, overview.md is updated." },
    ],
    [
      { role: "user", text: "Mention in tome that we're blocked on the OIDC migration" },
      { role: "mcp", text: 'tome_talk_send("blocked on OIDC migration")' },
      { role: "result", text: "posted" },
      { role: "agent", text: "Posted to Talk." },
    ],
    [
      { role: "user", text: "How does Atlas relate to Beacon?" },
      { role: "mcp", text: 'tome_ask("Atlas relationship to Beacon")' },
      { role: "result", text: "2 projects" },
      { role: "agent", text: "Atlas issues the tokens Beacon verifies; they share the OIDC contract." },
    ],
    [
      { role: "user", text: "Are we on track for the Q3 timeline?" },
      { role: "mcp", text: 'tome_get_pages(["standup.md","product.md"])' },
      { role: "result", text: "2 pages" },
      { role: "agent", text: "Mostly. Auth slipped a week; OIDC migration is the critical-path risk." },
    ],
  ];
  const [i, setI] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pause auto-advance on hover (ref so we don't tear down the interval).
  const paused = useRef(false);

  useEffect(() => {
    timer.current = setInterval(() => {
      setI((n) => (paused.current ? n : (n + 1) % vignettes.length));
    }, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
    >
      <Terminal>
        <div
          key={i}
          className="flex min-h-[124px] flex-col gap-1 fill-mode-both animate-in fade-in slide-in-from-bottom-2 duration-500"
        >
          {vignettes[i].map((line, n) => (
            <TranscriptLine key={n} line={line} />
          ))}
        </div>
      </Terminal>
      <div className="mt-2 flex justify-center gap-1.5">
        {vignettes.map((_, n) => (
          <span
            key={n}
            className={cn(
              "h-1 rounded-full transition-all",
              n === i ? "w-4 bg-primary" : "w-1 bg-muted-foreground/30",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** One line of the MCP transcript: aligned label, marker, then text. */
function TranscriptLine({ line }: { line: Line }) {
  const meta = {
    user: { label: "you", labelClass: "text-zinc-400", marker: "›", textClass: "text-zinc-100" },
    mcp: { label: "mcp", labelClass: "text-violet-400", marker: "›", textClass: "text-amber-200" },
    result: { label: "", labelClass: "", marker: "←", textClass: "text-zinc-500" },
    agent: { label: "claude", labelClass: "text-emerald-400", marker: "›", textClass: "text-zinc-100" },
  }[line.role];

  return (
    <div className="flex gap-2">
      <span className={cn("w-12 shrink-0 text-right", meta.labelClass)}>
        {meta.label}
      </span>
      <span className="shrink-0 text-muted-foreground/50">{meta.marker}</span>
      <span className={cn("min-w-0 break-words", meta.textClass)}>{line.text}</span>
    </div>
  );
}

function McpStep() {
  return (
    <div className="space-y-4">
      <StepHeader icon={<Plug className="h-5 w-5" />} eyebrow="MCP" title="Bring Tome into your coding agent">
        Connect Claude, Cursor, or Claude Code over MCP so your agent can read
        this project&apos;s wiki and Talk page right where you write code, with
        no copy-paste.
      </StepHeader>
      <Terminal>
        <span className="text-muted-foreground/70">$ </span>
        <span className="text-emerald-400">claude</span> mcp add tome <span className="text-muted-foreground/60">\</span>
        {"\n"}
        {"    "}--transport http <span className="text-amber-300">https://&hellip;/api/tome/mcp</span> <span className="text-muted-foreground/60">\</span>
        {"\n"}
        {"    "}--header <span className="text-sky-400">&quot;Authorization: Bearer $TOME_KEY&quot;</span>
        <Cursor />
      </Terminal>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Your agent gets tools to list projects, read pages, and post to Talk.
        Grab your key and the exact command from{" "}
        <span className="font-medium text-foreground">Connect via MCP</span> in the Tome header.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- pieces --- */

const KIND_COLORS: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  zinc: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
};

function KindRow({
  color,
  name,
  desc,
}: {
  color: keyof typeof KIND_COLORS | string;
  name: string;
  desc: string;
}) {
  return (
    <li className="flex items-baseline gap-3">
      <span
        className={cn(
          "shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium",
          KIND_COLORS[color] ?? KIND_COLORS.zinc,
        )}
      >
        {name}
      </span>
      <span className="text-sm leading-snug text-muted-foreground">{desc}</span>
    </li>
  );
}

/** A small dark "terminal" card for the code aesthetic. */
function Terminal({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-inner">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
      </div>
      <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-[12.5px] leading-relaxed text-zinc-200">
        {children}
      </pre>
    </div>
  );
}

/** Blinking block cursor. */
function Cursor({ className }: { className?: string }) {
  return (
    <span className={cn("tome-cursor ml-0.5 inline-block", className ?? "text-emerald-400")}>
      ▋
    </span>
  );
}

function BlinkStyle() {
  return (
    <style>{`
      @keyframes tome-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
      .tome-cursor { animation: tome-blink 1s steps(1) infinite; }
    `}</style>
  );
}

/** Animated ingest log; reveals lines one at a time when shown. */
function IngestDemo() {
  const lines = [
    { t: "$ tome ingest", c: "text-zinc-400" },
    { t: "→ reading 3 repos, 1 confluence space, 2 webex rooms…", c: "text-zinc-300" },
    { t: "✓ updated  overview.md", c: "text-emerald-400" },
    { t: "✓ updated  architecture.md", c: "text-emerald-400" },
    { t: "✓ wrote    standup.md", c: "text-emerald-400" },
    { t: "• kept     charter.md (stable)", c: "text-sky-400" },
    { t: "done in 18s.", c: "text-zinc-400" },
  ];
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setShown(0);
    timer.current = setInterval(() => {
      setShown((n) => {
        if (n >= lines.length) {
          if (timer.current) clearInterval(timer.current);
          return n;
        }
        return n + 1;
      });
    }, 420);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Terminal>
      {lines.slice(0, shown).map((l, i) => (
        <div key={i} className={l.c}>
          {l.t}
        </div>
      ))}
      {shown < lines.length && <Cursor />}
    </Terminal>
  );
}

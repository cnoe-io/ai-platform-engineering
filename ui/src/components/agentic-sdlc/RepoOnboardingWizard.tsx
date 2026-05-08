"use client";

import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Ship,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface OnboardResponse {
  item?: {
    repo_id: string;
    full_name: string;
    webhook_id: number;
    webhook_url: string;
    github_webhook_settings_url?: string;
    webhook_events: string[];
  };
  error?: string;
  message?: string;
}

const DEFAULT_SANDBOX = "sandbox-eks";
const DEFAULT_GITHUB_WEBHOOK_URL = "https://github-webhook.eticloud.io/github";
const DEFAULT_LOCAL_FORWARD_TARGET =
  "http://localhost:3000/api/agentic-sdlc/webhooks/github";
const LABEL_CONTRACT = [
  "agent:specify",
  "agent:plan",
  "agent:tasks",
  "agent:implement",
  "agent:unit-test",
  "agent:awaiting-review",
  "agent:deploy-sandbox",
  "agent:validate",
  "agent:observe",
  "agent:blocked",
];

export function RepoOnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [repoSlug, setRepoSlug] = useState("");
  const [githubWebhookUrl, setGithubWebhookUrl] = useState(
    DEFAULT_GITHUB_WEBHOOK_URL,
  );
  const [localForwardTarget, setLocalForwardTarget] = useState(
    DEFAULT_LOCAL_FORWARD_TARGET,
  );
  const [webhookSecret, setWebhookSecret] = useState("");
  const [sandboxEnvironment, setSandboxEnvironment] = useState(DEFAULT_SANDBOX);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success"; item: NonNullable<OnboardResponse["item"]> }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const stepLabel = `Step ${step + 1} of 4`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const [owner, repo] = repoSlug.split("/").map((part) => part.trim());
    if (!owner || !repo) {
      setStatus({
        kind: "error",
        message: "Repository must be in owner/repo form.",
      });
      return;
    }

    setStatus({ kind: "submitting" });
    const res = await fetch("/api/agentic-sdlc/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        repo,
        callback_url: githubWebhookUrl,
        webhook_secret: webhookSecret,
        sandbox_environment: sandboxEnvironment || DEFAULT_SANDBOX,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as OnboardResponse;
    if (!res.ok || !body.item) {
      setStatus({
        kind: "error",
        message:
          body.message ?? body.error ?? `Onboarding failed (${res.status})`,
      });
      return;
    }
    setStatus({ kind: "success", item: body.item });
    window.dispatchEvent(new CustomEvent("ship-loop:repo-onboarded"));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/15 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
        >
          <Ship className="h-4 w-4" aria-hidden />
          Open repo onboarding wizard
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-4xl border-border/50 bg-background/95">
        <DialogHeader>
          <DialogTitle>Onboard a repository</DialogTitle>
          <DialogDescription>
            Connect a repo, configure the webhook path, document the label
            contract, then verify the first delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-primary">
            {stepLabel}
          </span>
          <span>{["Repo", "Webhook", "Labels", "Verify"][step]}</span>
        </div>

        <form onSubmit={submit} className="space-y-5">
          {step === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Repository" htmlFor="ship-loop-repo">
                <input
                  id="ship-loop-repo"
                  value={repoSlug}
                  onChange={(e) => setRepoSlug(e.target.value)}
                  placeholder="owner/repo"
                  className="w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </Field>
              <Field label="Sandbox environment" htmlFor="ship-loop-sandbox">
                <input
                  id="ship-loop-sandbox"
                  value={sandboxEnvironment}
                  onChange={(e) => setSandboxEnvironment(e.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </Field>
              <div className="rounded-md border border-border/40 bg-background/40 p-3 text-xs text-muted-foreground">
                Repo tile visibility is governed by Team RBAC. Opening repo
                detail still requires repo access.
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/40 bg-card/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  GitHub webhook payload URL
                </p>
                <p className="mt-2 break-all text-sm text-foreground">
                  {DEFAULT_GITHUB_WEBHOOK_URL}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Configure GitHub to send events to the shared AWS receiver.
                </p>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Local forward target
                </p>
                <p className="mt-2 break-all text-sm text-foreground">
                  {localForwardTarget}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Your SQS poller forwards validated deliveries here.
                </p>
              </div>
              <Field
                label="Local forward target"
                htmlFor="ship-loop-local-forward"
              >
                <input
                  id="ship-loop-local-forward"
                  value={localForwardTarget}
                  onChange={(e) => setLocalForwardTarget(e.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Agentic SDLC derives stages from these labels. Teams can override
                labels later in Settings, but the default contract should work
                out of the box.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {LABEL_CONTRACT.map((label) => (
                  <code
                    key={label}
                    className="rounded-md border border-border/40 bg-background/50 px-2 py-1.5 text-xs text-cyan-100"
                  >
                    {label}
                  </code>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="GitHub webhook payload URL"
                htmlFor="ship-loop-github-webhook-url"
              >
                <input
                  id="ship-loop-github-webhook-url"
                  value={githubWebhookUrl}
                  onChange={(e) => setGithubWebhookUrl(e.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </Field>
              <Field label="Webhook secret" htmlFor="ship-loop-secret">
                <input
                  id="ship-loop-secret"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="must match GITHUB_WEBHOOK_SECRET"
                  className="w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </Field>
              <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-100/80 md:col-span-2">
                <Terminal className="mr-1 inline h-3 w-3" aria-hidden />
                Set <code>GITHUB_WEBHOOK_SECRET</code> to this exact secret and
                restart the UI before testing deliveries.
              </div>
            </div>
          ) : null}

          {status.kind === "success" ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">
              <CheckCircle2 className="mr-2 inline h-4 w-4" aria-hidden />
              Connected {status.item.full_name} with webhook #
              {status.item.webhook_id}.
              <a
                href={
                  status.item.github_webhook_settings_url ??
                  status.item.webhook_url
                }
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-emerald-100 underline"
              >
                View webhook
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Link className="underline" href="/apps/agentic-sdlc?tab=repos">
                  Back to repos
                </Link>
                <Link className="underline" href="/apps/agentic-sdlc?tab=metrics">
                  Metrics
                </Link>
              </div>
            </div>
          ) : null}

          {status.kind === "error" ? (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200"
            >
              {status.message}
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border/40 pt-4">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="rounded-md border border-border/50 px-3 py-2 text-sm text-muted-foreground disabled:opacity-40"
            >
              Back
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(3, s + 1))}
                className="rounded-md border border-primary/30 bg-primary/15 px-4 py-2 text-sm font-medium text-primary"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={status.kind === "submitting"}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/15 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/20",
                  status.kind === "submitting" &&
                    "cursor-not-allowed opacity-70",
                )}
              >
                {status.kind === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Ship className="h-4 w-4" aria-hidden />
                )}
                Connect repo
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RepoOnboardingSettingsCard() {
  return (
    <section className="space-y-3" aria-labelledby="ship-loop-onboarding-title">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id="ship-loop-onboarding-title"
            className="text-sm font-semibold text-foreground"
          >
            Onboard a real repository
          </h3>
          <p className="mt-1 text-xs text-muted-foreground/75">
            Launch a guided setup for repo scope, webhook routing, label
            contract, and verification.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground/70">
          Requires <code>GITHUB_TOKEN</code> on the UI server
        </span>
      </div>
      <RepoOnboardingWizard />
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

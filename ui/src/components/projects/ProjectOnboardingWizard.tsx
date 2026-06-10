"use client";

// assisted-by Cursor Composer

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  FolderKanban,
  Loader2,
  MessageSquare,
  Rocket,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

interface OnboardingStepConfig {
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  gradient?: string;
  checklist?: string[];
}

interface WizardStepMeta {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  gradient: string;
  checklist?: string[];
}

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "book-open": BookOpen,
  video: Video,
  "message-square": MessageSquare,
  bot: Bot,
  "folder-kanban": FolderKanban,
  rocket: Rocket,
};

const DEFAULT_GRADIENT = "from-violet-600 via-indigo-600 to-blue-600";

function resolveIcon(name?: string): LucideIcon {
  if (!name) return Sparkles;
  return ICONS[name] ?? Sparkles;
}

function parseMemberInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim().replace(/^@/, ""))
    .filter(Boolean);
}

function buildWizardSteps(configSteps: OnboardingStepConfig[]): WizardStepMeta[] {
  const create: WizardStepMeta = {
    id: "create",
    title: "Create Project",
    subtitle: "Name your initiative and assign a team",
    icon: FolderKanban,
    gradient: DEFAULT_GRADIENT,
  };
  const provisionSteps: WizardStepMeta[] = configSteps.map((step) => ({
    id: step.id,
    title: step.title,
    subtitle: step.subtitle,
    icon: resolveIcon(step.icon),
    gradient: step.gradient ?? DEFAULT_GRADIENT,
    checklist: step.checklist,
  }));
  const complete: WizardStepMeta = {
    id: "complete",
    title: "All Set",
    subtitle: "Your project is ready",
    icon: Rocket,
    gradient: "from-emerald-600 via-green-600 to-teal-600",
  };
  return [create, ...provisionSteps, complete];
}

interface StepRunState {
  phase: "idle" | "calling" | "done" | "failed";
  statusMessage?: string;
  mockRef?: string;
  error?: string;
}

export function ProjectOnboardingWizard({
  onComplete,
  initialOpen = false,
}: {
  onComplete?: (project: ProjectDocument) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [configSteps, setConfigSteps] = useState<OnboardingStepConfig[]>([]);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  const [membersRaw, setMembersRaw] = useState("");
  const [initiativesRaw, setInitiativesRaw] = useState("");
  const [swimlanesRaw, setSwimlanesRaw] = useState("");
  // User-shared data sources (forwarded to LLM Wiki on onboarding).
  const [githubReposRaw, setGithubReposRaw] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [componentUrlsRaw, setComponentUrlsRaw] = useState("");
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepRuns, setStepRuns] = useState<Record<string, StepRunState>>({});
  const stepRunLock = useRef<string | null>(null);

  const wizardSteps = useMemo(() => buildWizardSteps(configSteps), [configSteps]);
  const phase = wizardSteps[phaseIndex] ?? wizardSteps[0];
  const firstProvisionIndex = 1;
  const completeIndex = wizardSteps.length - 1;
  const hasProvisionSteps = configSteps.length > 0;
  const isProvisionPhase =
    phase.id !== "create" && phase.id !== "complete" && hasProvisionSteps;
  const currentStepRun = isProvisionPhase ? stepRuns[phase.id] : undefined;
  const currentStepDone =
    project?.onboarding?.[phase.id]?.status === "completed" ||
    currentStepRun?.phase === "done";
  const currentStepFailed =
    project?.onboarding?.[phase.id]?.status === "failed" ||
    currentStepRun?.phase === "failed";

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        setConfigSteps((body.data?.config?.steps ?? []) as OnboardingStepConfig[]);
      })
      .catch(() => setConfigSteps([]));

    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data) => {
        const list = (data.data ?? data.teams ?? []) as Array<{
          _id: string;
          name: string;
          slug?: string;
        }>;
        setTeams(
          list.map((t) => ({
            slug: t.slug ?? t._id,
            name: t.name,
            id: t._id,
            _id: t._id,
          })),
        );
      })
      .catch(() => setTeams([]));
  }, [open]);

  const reset = useCallback(() => {
    setPhaseIndex(0);
    setProjectName("");
    setDescription("");
    setTeamId("");
    setMembersRaw("");
    setInitiativesRaw("");
    setSwimlanesRaw("");
    setProject(null);
    setProvisioning(false);
    setError(null);
    setStepRuns({});
    stepRunLock.current = null;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const runSingleStep = useCallback(
    async (stepId: string) => {
      if (!project?._id) return;
      const existing = project.onboarding?.[stepId]?.status;
      if (existing === "completed" || stepRunLock.current === stepId) {
        return;
      }

      stepRunLock.current = stepId;
      setError(null);
      setProvisioning(true);
      setStepRuns((prev) => ({
        ...prev,
        [stepId]: { phase: "calling" },
      }));

      try {
        const res = await fetch("/api/projects/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: project._id, steps: [stepId] }),
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error ?? body.message ?? "Onboarding failed");
        }

        const updated = body.data?.project as ProjectDocument;
        const result = (
          body.data?.results as Array<{
            step: string;
            status: string;
            mock_ref?: string;
            status_message?: string;
            error?: string;
          }>
        )?.find((entry) => entry.step === stepId);

        if (updated) {
          setProject(updated);
        }

        if (result?.status === "failed") {
          setStepRuns((prev) => ({
            ...prev,
            [stepId]: {
              phase: "failed",
              error: result.error ?? "Provisioning failed",
            },
          }));
          return;
        }

        setStepRuns((prev) => ({
          ...prev,
          [stepId]: {
            phase: "done",
            statusMessage: result?.status_message ?? "Provisioned successfully",
            mockRef: result?.mock_ref,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStepRuns((prev) => ({
          ...prev,
          [stepId]: { phase: "failed", error: message },
        }));
      } finally {
        stepRunLock.current = null;
        setProvisioning(false);
      }
    },
    [project],
  );

  useEffect(() => {
    if (!open || !project?._id || !isProvisionPhase || provisioning) return;
    const stepStatus = project.onboarding?.[phase.id]?.status;
    if (stepStatus === "completed" || stepStatus === "failed") return;
    const runState = stepRuns[phase.id]?.phase;
    if (runState === "calling" || runState === "done") return;
    void runSingleStep(phase.id);
  }, [
    open,
    project?._id,
    project?.onboarding,
    phase.id,
    isProvisionPhase,
    provisioning,
    stepRuns,
    runSingleStep,
  ]);

  async function createProject() {
    setError(null);
    setProvisioning(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          description: description.trim() || undefined,
          team_id: teamId,
          member_ids: parseMemberInput(membersRaw),
          initiatives: initiativesRaw.split(",").map((s) => s.trim()).filter(Boolean),
          swimlanes: swimlanesRaw.split(",").map((s) => s.trim()).filter(Boolean),
          github_repos: githubReposRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          confluence_url: confluenceUrl.trim() || undefined,
          component_urls: componentUrlsRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.project) {
        throw new Error(body.error ?? body.message ?? "Failed to create project");
      }
      const created = body.data.project as ProjectDocument;
      setProject(created);
      if (hasProvisionSteps) {
        setPhaseIndex(firstProvisionIndex);
      } else {
        setPhaseIndex(completeIndex);
        onComplete?.(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProvisioning(false);
    }
  }

  function advanceFromCurrentStep() {
    if (phaseIndex >= completeIndex) return;
    const nextIndex = phaseIndex + 1;
    setPhaseIndex(nextIndex);
    if (nextIndex === completeIndex && project) {
      onComplete?.(project);
    }
  }

  async function handlePrimaryAction() {
    if (phase.id === "create") {
      await createProject();
      return;
    }
    if (isProvisionPhase && currentStepFailed) {
      void runSingleStep(phase.id);
      return;
    }
    if (isProvisionPhase && currentStepDone) {
      advanceFromCurrentStep();
      return;
    }
    if (phase.id === "complete") {
      close();
    }
  }

  const primaryLabel =
    phase.id === "create"
      ? provisioning
        ? "Creating…"
        : "Create & Continue"
      : isProvisionPhase
        ? provisioning || currentStepRun?.phase === "calling"
          ? "Provisioning…"
          : currentStepFailed
            ? "Retry"
            : currentStepDone
              ? phaseIndex === completeIndex - 1
                ? "Finish"
                : "Continue"
              : "Provision"
        : phase.id === "complete"
          ? "Close"
          : "";

  const showPrimary =
    phase.id === "create" ||
    isProvisionPhase ||
    phase.id === "complete";

  const primaryDisabled =
    provisioning ||
    (phase.id === "create" && (!projectName.trim() || !teamId)) ||
    (isProvisionPhase &&
      !currentStepDone &&
      !currentStepFailed &&
      (currentStepRun?.phase === "calling" || provisioning));

  const stepSummary =
    configSteps.length > 0
      ? configSteps.map((step) => step.title).join(" · ")
      : "Create project and finish";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-violet-600/20 via-indigo-600/10 to-blue-600/20 px-8 py-5 text-left shadow-lg transition hover:scale-[1.01] hover:shadow-xl"
      >
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg">
            <Rocket className="h-7 w-7" />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">
              Launch project onboarding
            </p>
            <p className="text-sm text-muted-foreground">{stepSummary}</p>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-background shadow-2xl"
      >
        <div
          className={cn(
            "relative overflow-hidden px-8 py-10 text-white",
            "bg-gradient-to-br",
            phase.gradient,
          )}
        >
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                Project Onboarding · Step {phaseIndex + 1} of {wizardSteps.length}
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">{phase.title}</h2>
              <p className="mt-2 max-w-xl text-sm text-white/85">{phase.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 transition hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="relative mt-8 flex gap-2 overflow-x-auto pb-1">
            {wizardSteps.map((step, index) => {
              const Icon = step.icon;
              const done = index < phaseIndex;
              const active = index === phaseIndex;
              return (
                <div
                  key={step.id}
                  className={cn(
                    "flex min-w-[4.5rem] flex-col items-center gap-1.5 rounded-lg px-2 py-2 transition",
                    active && "bg-white/15",
                    done && "opacity-90",
                    !active && !done && "opacity-40",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border",
                      done
                        ? "border-emerald-300 bg-emerald-500/30"
                        : active
                          ? "border-white bg-white/20"
                          : "border-white/30",
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-100" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-center leading-tight text-white/80">
                    {step.id === "create" ? "Create" : step.title.split(" ")[0]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              {phase.id === "create" ? (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Project name</span>
                      <input
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="My Platform Initiative"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Description</span>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="What is this project building?"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <div className="space-y-1.5">
                      <span className="text-sm font-medium">Team</span>
                      <TeamPicker
                        options={teams}
                        value={teamId}
                        onChange={setTeamId}
                        placeholder="Select owning team"
                        hideSlugSuffix
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Team members
                      </span>
                      <textarea
                        value={membersRaw}
                        onChange={(e) => setMembersRaw(e.target.value)}
                        rows={5}
                        placeholder="@alice, @bob"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">BHAG / Initiatives</span>
                      <input
                        value={initiativesRaw}
                        onChange={(e) => setInitiativesRaw(e.target.value)}
                        placeholder="Agentic-2026, Platform Modernization"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Swim Lanes</span>
                      <input
                        value={swimlanesRaw}
                        onChange={(e) => setSwimlanesRaw(e.target.value)}
                        placeholder="Now, Next, Later"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">GitHub repos</span>
                      <textarea
                        value={githubReposRaw}
                        onChange={(e) => setGithubReposRaw(e.target.value)}
                        rows={2}
                        placeholder="https://github.com/org/repo, https://github.com/org/another"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                      <span className="text-xs text-muted-foreground">Comma- or newline-separated. Shared with LLM Wiki to ingest.</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Confluence space URL</span>
                      <input
                        value={confluenceUrl}
                        onChange={(e) => setConfluenceUrl(e.target.value)}
                        placeholder="https://your.atlassian.net/wiki/spaces/PROJ"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Component / software URLs</span>
                      <textarea
                        value={componentUrlsRaw}
                        onChange={(e) => setComponentUrlsRaw(e.target.value)}
                        rows={2}
                        placeholder="https://service-a.example.com, https://docs.example.com/component-b"
                        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                    </label>
                    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
                      Projects belong to teams and can sync to Backstage as{" "}
                      <code className="text-primary">kind: System</code>. Labels (Domain ·
                      BHAG · Swim Lane) power the executive dashboard.
                    </div>
                  </div>
                </div>
              ) : null}

              {isProvisionPhase ? (
                <ProvisioningCard
                  title={phase.title}
                  checklist={phase.checklist ?? ["Provision resources", "Verify access"]}
                  runState={currentStepRun}
                  done={currentStepDone}
                  failed={currentStepFailed}
                  integrationUrl={project?.integrations?.[`${phase.id}_url`]}
                />
              ) : null}

              {phase.id === "complete" ? (
                <div className="space-y-6 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">Project ready</h3>
                    <p className="mt-2 text-muted-foreground">
                      {hasProvisionSteps
                        ? "Configured onboarding steps completed."
                        : "Your project was created. Add onboarding steps via configuration when needed."}
                    </p>
                  </div>
                  {project ? (
                    <div className="mx-auto max-w-md rounded-xl border border-border/50 bg-muted/20 p-4 text-left text-sm">
                      <p className="font-medium">{project.title}</p>
                      <p className="text-muted-foreground">{project.team_name}</p>
                      <Link
                        href={`/projects/${project.slug}`}
                        className="mt-2 inline-block text-primary hover:underline"
                      >
                        Open project →
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end border-t border-border/50 px-8 py-5">
          <div className="flex gap-3">
            {phase.id === "complete" && project ? (
              <Link
                href={`/projects/${project.slug}`}
                onClick={close}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow"
              >
                View project
              </Link>
            ) : null}
            {showPrimary && phase.id !== "complete" ? (
              <button
                type="button"
                disabled={primaryDisabled}
                onClick={() => void handlePrimaryAction()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {(provisioning || currentStepRun?.phase === "calling") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {primaryLabel}
              </button>
            ) : null}
            {phase.id === "complete" ? (
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-border px-5 py-2.5 text-sm"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ProvisioningCard({
  title,
  checklist,
  runState,
  done,
  failed,
  integrationUrl,
}: {
  title: string;
  checklist: string[];
  runState?: StepRunState;
  done: boolean;
  failed: boolean;
  integrationUrl?: string;
}) {
  const running = runState?.phase === "calling";

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ul className="space-y-3">
        {checklist.map((item, index) => {
          const itemDone = done;
          const itemRunning = running && index === 0;
          return (
            <li
              key={item}
              className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/50 px-4 py-3 text-sm"
            >
              {itemDone ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              ) : itemRunning ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />
              )}
              {item}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col justify-center gap-3 rounded-2xl border border-border/50 bg-gradient-to-br from-muted/40 to-muted/10 p-6">
        {running ? (
          <>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Calling {title} API…
            </div>
            <p className="text-center text-xs text-muted-foreground animate-pulse">
              Waiting for mock provider response
            </p>
          </>
        ) : failed ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-red-600">Provisioning failed</p>
            <p className="text-muted-foreground">{runState?.error ?? "Unknown error"}</p>
          </div>
        ) : done ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-emerald-600">Provisioned</p>
            <p className="text-muted-foreground">
              {runState?.statusMessage ?? "Step completed successfully"}
            </p>
            {runState?.mockRef ? (
              <p className="break-all text-xs text-muted-foreground">
                Ref: {runState.mockRef}
              </p>
            ) : null}
            {integrationUrl ? (
              <p className="break-all text-xs text-primary">{integrationUrl}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Starting {title} provisioning…
          </p>
        )}
      </div>
    </div>
  );
}

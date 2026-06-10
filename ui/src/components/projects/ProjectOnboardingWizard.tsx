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
    title: "Review & Create",
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
  // Live source options from the user's provider connections (Connections tab).
  type SourceState = { connected: boolean; options: { value: string; label: string }[] };
  const [ghSources, setGhSources] = useState<SourceState>({ connected: false, options: [] });
  const [cfSources, setCfSources] = useState<SourceState>({ connected: false, options: [] });
  const ghSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Existing label values (for dropdown suggestions on BHAG / Swim Lane).
  const [labelFacets, setLabelFacets] = useState<{ initiatives: string[]; swimlanes: string[] }>({
    initiatives: [],
    swimlanes: [],
  });
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

  // Live source dropdowns from the user's connections (Connections tab).
  const loadSources = useCallback(() => {
    (
      [
        ["github", setGhSources],
        ["atlassian", setCfSources],
      ] as const
    ).forEach(([provider, setter]) => {
      fetch(`/api/projects/source-options?provider=${provider}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          const data = b?.data ?? b;
          if (!data) return;
          setter({
            connected: Boolean(data.connected),
            options: Array.isArray(data.options) ? data.options : [],
          });
        })
        .catch(() => undefined);
    });
  }, []);

  // As the user types a GitHub owner/org (last comma-separated token), re-query
  // that owner's repos so the dropdown reflects what they typed.
  const searchGithubRepos = useCallback((text: string) => {
    if (ghSearchTimer.current) clearTimeout(ghSearchTimer.current);
    const token = (text.split(/[\n,]/).pop() ?? "").trim();
    const owner = token
      .replace(/^https?:\/\/github\.com\//i, "")
      .split("/")[0]
      .trim();
    if (!owner) return;
    ghSearchTimer.current = setTimeout(() => {
      fetch(`/api/projects/source-options?provider=github&q=${encodeURIComponent(owner)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          const d = b?.data ?? b;
          if (d && d.connected) {
            setGhSources({ connected: true, options: Array.isArray(d.options) ? d.options : [] });
          }
        })
        .catch(() => undefined);
    }, 400);
  }, []);

  useEffect(() => {
    if (!open) return;
    loadSources();
    // Re-check after the user authorizes a provider in another tab and returns.
    const onFocus = () => loadSources();
    const onVisible = () => {
      if (document.visibilityState === "visible") loadSources();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, loadSources]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        setConfigSteps((body.data?.config?.steps ?? []) as OnboardingStepConfig[]);
      })
      .catch(() => setConfigSteps([]));

    // Existing label values → datalist suggestions for BHAG / Swim Lane.
    fetch("/api/projects/facets")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const f = body?.data?.facets ?? body?.data ?? body;
        const vals = (arr: unknown): string[] =>
          Array.isArray(arr)
            ? arr
                .map((x) => (typeof x === "string" ? x : (x?.value ?? x?.label)))
                .filter((v): v is string => typeof v === "string" && v.length > 0)
            : [];
        if (f) {
          setLabelFacets({
            initiatives: vals(f.initiatives),
            swimlanes: vals(f.swimlanes),
          });
        }
      })
      .catch(() => undefined);

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
            "relative overflow-hidden px-8 pt-10 pb-14 text-white",
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

          <div className="relative mt-6 flex gap-2 overflow-x-auto pb-2">
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
                  <span className="w-20 text-[10px] font-medium text-center leading-tight text-white/80">
                    {step.title}
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
                      <ComboBox
                        ariaLabel="BHAG / Initiatives"
                        value={initiativesRaw}
                        onChange={setInitiativesRaw}
                        options={labelFacets.initiatives.map((v) => ({ value: v, label: v }))}
                        placeholder="Agentic-2026, Platform Modernization"
                        multi
                      />
                      <span className="text-xs text-muted-foreground">Pick existing or type a new one (comma-separated).</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Swim Lanes</span>
                      <ComboBox
                        ariaLabel="Swim Lanes"
                        value={swimlanesRaw}
                        onChange={setSwimlanesRaw}
                        options={labelFacets.swimlanes.map((v) => ({ value: v, label: v }))}
                        placeholder="Now, Next, Later"
                        multi
                      />
                      <span className="text-xs text-muted-foreground">Pick existing or type a new one (comma-separated).</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">GitHub repos</span>
                      <ComboBox
                        ariaLabel="GitHub repos"
                        value={githubReposRaw}
                        onChange={setGithubReposRaw}
                        onType={searchGithubRepos}
                        options={ghSources.options}
                        placeholder="https://github.com/org/repo, https://github.com/org/another"
                        multi
                      />
                      {ghSources.connected ? (
                        <span className="text-xs text-muted-foreground">
                          Pick from your repos — type an org to search it; select multiple.
                        </span>
                      ) : (
                        <AuthorizePrompt provider="GitHub" onRecheck={loadSources} />
                      )}
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Confluence space URL</span>
                      <ComboBox
                        ariaLabel="Confluence space URL"
                        value={confluenceUrl}
                        onChange={setConfluenceUrl}
                        options={cfSources.options}
                        placeholder="https://your.atlassian.net/wiki/spaces/PROJ"
                      />
                      {!cfSources.connected ? (
                        <AuthorizePrompt provider="Confluence" onRecheck={loadSources} />
                      ) : null}
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
  runState,
  done,
  failed,
  integrationUrl,
}: {
  title: string;
  runState?: StepRunState;
  done: boolean;
  failed: boolean;
  integrationUrl?: string;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-gradient-to-br from-muted/40 to-muted/10 p-8 text-center">
      {failed ? (
        <>
          <p className="font-semibold text-red-600">Provisioning failed</p>
          <p className="text-sm text-muted-foreground">{runState?.error ?? "Unknown error"}</p>
        </>
      ) : done ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="font-semibold text-emerald-600">{title} provisioned</p>
          <p className="text-sm text-muted-foreground">
            {runState?.statusMessage ?? "Completed successfully"}
          </p>
          {integrationUrl ? (
            <p className="break-all text-xs text-primary">{integrationUrl}</p>
          ) : null}
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Provisioning {title}…</p>
          <p className="text-xs text-muted-foreground">This can take a few seconds.</p>
        </>
      )}
    </div>
  );
}

/**
 * Inline prompt shown when the user hasn't connected a provider — links to the
 * Connections tab to authorize, so the source dropdown can populate. The field
 * still accepts free-text in the meantime.
 */
function AuthorizePrompt({
  provider,
  onRecheck,
}: {
  provider: string;
  onRecheck?: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-amber-500">
      <span>Not connected.</span>
      <a
        href="/credentials"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2 hover:text-amber-400"
      >
        Authorize {provider}
      </a>
      <span className="text-muted-foreground">to pick from your account, or paste a URL.</span>
      {onRecheck ? (
        <button
          type="button"
          onClick={onRecheck}
          className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        >
          Recheck
        </button>
      ) : null}
    </span>
  );
}

/** Replace the active token (last comma/newline segment) for multi-value fields. */
function applyComboSelection(current: string, selected: string, multi: boolean): string {
  if (!multi) return selected;
  const lastDelim = Math.max(current.lastIndexOf(","), current.lastIndexOf("\n"));
  const head = lastDelim >= 0 ? current.slice(0, lastDelim + 1) : "";
  return `${head ? head.trimEnd() + " " : ""}${selected}, `;
}

/**
 * Styled, scrollable combobox: a text input with a filtered dropdown of
 * suggestions that stays inside the dialog (unlike the native <datalist>).
 * Free-text is always allowed; `multi` appends comma-separated selections.
 */
function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  multi = false,
  onType,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  multi?: boolean;
  onType?: (v: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const lastToken = (multi ? (value.split(/[\n,]/).pop() ?? "") : value).trim().toLowerCase();
  const filtered = options
    .filter(
      (o) =>
        !lastToken ||
        o.label.toLowerCase().includes(lastToken) ||
        o.value.toLowerCase().includes(lastToken),
    )
    .slice(0, 50);

  return (
    <div ref={ref} className="relative">
      <input
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          onType?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
      />
      {open && filtered.length > 0 ? (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-xl border border-border/60 bg-card shadow-xl">
          {filtered.map((o) => (
            <button
              type="button"
              key={o.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(applyComboSelection(value, o.value, multi));
                onType?.("");
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left transition hover:bg-accent/60"
            >
              <span className="block truncate text-sm">{o.label}</span>
              {o.label !== o.value ? (
                <span className="block truncate text-xs text-muted-foreground">{o.value}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

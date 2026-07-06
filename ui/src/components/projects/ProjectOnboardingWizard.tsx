"use client";

// assisted-by Cursor Composer

import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  ListChecks,
  Loader2,
  Rocket,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { LabelComboBox } from "@/components/projects/LabelComboBox";
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { SourcePicker } from "@/components/projects/source-pickers";
import { cn } from "@/lib/utils";
import { toWebexRoomSource } from "@/lib/projects/webex-room";
import type { ProjectDocument } from "@/types/projects";

type SourceKind = "github" | "confluence" | "webex";

/** Source kind → credentials provider id for the shared `ProviderLogo`. */
const SOURCE_PROVIDER: Record<SourceKind, string> = {
  github: "github",
  confluence: "atlassian",
  webex: "webex",
};

interface OnboardingStepConfig {
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  gradient?: string;
  checklist?: string[];
  provider?: "mock" | "none" | "http" | "link" | "source";
  source?: SourceKind;
  /** Whether this integration starts enabled in the Integrations step. */
  default_enabled?: boolean;
}

/** Sources are pickers; everything else is a provisionable "app" integration. */
function isSourceStep(s: OnboardingStepConfig): boolean {
  return s.provider === "source";
}

interface WizardStepMeta {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  gradient: string;
  checklist?: string[];
  /** create = name/team; integrations = enable + configure apps/sources; review = confirm + commit (terminal — navigates to the project). */
  kind: "create" | "integrations" | "review";
  source?: SourceKind;
}

const DEFAULT_GRADIENT = "from-violet-600 via-indigo-600 to-blue-600";

function buildWizardSteps(
  configSteps: OnboardingStepConfig[],
): WizardStepMeta[] {
  const create: WizardStepMeta = {
    id: "create",
    title: "Create Project",
    subtitle: "Name your initiative and assign a team",
    icon: FolderKanban,
    gradient: DEFAULT_GRADIENT,
    kind: "create",
  };
  // Every configured integration (source or app) lives in one Integrations step
  // where the user enables the ones they want and fills in any details.
  const integrations: WizardStepMeta | null = configSteps.length
    ? {
        id: "integrations",
        title: "Integrations",
        subtitle: "Enable the apps and sources for this project",
        icon: Boxes,
        gradient: DEFAULT_GRADIENT,
        kind: "integrations",
      }
    : null;
  // Review is the terminal step: clicking Create commits the project, provisions
  // the enabled apps in the background, and lands the user on the project page.
  const review: WizardStepMeta = {
    id: "review",
    title: "Review & Create",
    subtitle: "Confirm and create the project",
    icon: ListChecks,
    gradient: DEFAULT_GRADIENT,
    kind: "review",
  };
  return [create, integrations, review].filter(
    (s): s is WizardStepMeta => Boolean(s),
  );
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
  // Which integrations the user has enabled (id → on), seeded from the config's
  // `default_enabled`. Drives the Integrations step + which apps provision.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  const [initiativesRaw, setInitiativesRaw] = useState("");
  const [swimlanesRaw, setSwimlanesRaw] = useState("");
  // User-shared data sources (collected by the configured `source` steps;
  // forwarded to connected external apps on onboarding).
  const [githubReposRaw, setGithubReposRaw] = useState("");
  // Data steward for the source-activity feed: the principal the feed runs as.
  // Blank means the create API assigns the creator (owner) explicitly.
  const [stewardEmail, setStewardEmail] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  // Encoded {room_id, name} blobs from the picker (see lib/projects/webex-room).
  const [webexRooms, setWebexRooms] = useState<string[]>([]);
  // "Look up from Backstage" — pre-fill the create form from an existing System.
  type BackstageResult = {
    slug: string;
    title: string;
    description: string;
    tags: string[];
    repos: string[];
  };
  const [bsConfigured, setBsConfigured] = useState(false);
  const [bsOpen, setBsOpen] = useState(false);
  const [bsQuery, setBsQuery] = useState("");
  const [bsResults, setBsResults] = useState<BackstageResult[]>([]);
  const [bsLoading, setBsLoading] = useState(false);
  const bsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Existing label values (for dropdown suggestions on BHAG / Swim Lane).
  const [labelFacets, setLabelFacets] = useState<{ initiatives: string[]; swimlanes: string[] }>({
    initiatives: [],
    swimlanes: [],
  });
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wizardSteps = useMemo(
    () => buildWizardSteps(configSteps),
    [configSteps],
  );
  const phase = wizardSteps[phaseIndex] ?? wizardSteps[0];
  // Flow: create=0, [integrations], review. Review is terminal — Create commits,
  // provisions enabled apps in the background, and navigates to the project.
  const isIntegrationsPhase = phase.kind === "integrations";
  const isReviewPhase = phase.kind === "review";

  // Backstage lookup: debounced search of existing Systems.
  const lookupBackstage = useCallback((q: string) => {
    if (bsTimer.current) clearTimeout(bsTimer.current);
    setBsLoading(true);
    bsTimer.current = setTimeout(() => {
      fetch(`/api/projects/backstage/lookup?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          const d = b?.data ?? b;
          setBsConfigured(Boolean(d?.configured));
          setBsResults(Array.isArray(d?.results) ? d.results : []);
        })
        .catch(() => setBsResults([]))
        .finally(() => setBsLoading(false));
    }, 300);
  }, []);

  // Apply a chosen Backstage System to the create form. Picking a system always
  // overwrites the prefilled fields so the user can switch selections and the
  // form reflects the latest pick (fields stay hand-editable afterwards).
  const applyBackstageResult = useCallback((r: BackstageResult) => {
    setProjectName(r.title);
    setDescription(r.description);
    setInitiativesRaw(r.tags.join(", "));
    setGithubReposRaw(r.repos.join(", "));
    setBsOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Probe whether Backstage lookup is available (shows the button if so).
    fetch("/api/projects/backstage/lookup")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setBsConfigured(Boolean((b?.data ?? b)?.configured)))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        const steps = (body.data?.config?.steps ?? []) as OnboardingStepConfig[];
        setConfigSteps(steps);
        setEnabled(
          Object.fromEntries(
            steps.map((s) => [s.id, Boolean(s.default_enabled)]),
          ),
        );
      })
      .catch(() => {
        setConfigSteps([]);
        setEnabled({});
      });

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
      .catch(() => setTeams([]))
      .finally(() => setTeamsLoading(false));
  }, [open]);

  const reset = useCallback(() => {
    setPhaseIndex(0);
    setProjectName("");
    setDescription("");
    setTeamId("");
    setInitiativesRaw("");
    setSwimlanesRaw("");
    setGithubReposRaw("");
    setStewardEmail("");
    setConfluenceUrl("");
    setWebexRooms([]);
    setProvisioning(false);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  async function createProject() {
    setError(null);
    setProvisioning(true);
    // Only collect source data for sources the user actually enabled.
    const enabledSourceKinds = new Set(
      configSteps
        .filter((s) => isSourceStep(s) && enabled[s.id])
        .map((s) => s.source),
    );
    const github_repos = enabledSourceKinds.has("github")
      ? githubReposRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      : [];
    const confluence_url = enabledSourceKinds.has("confluence")
      ? confluenceUrl.trim() || undefined
      : undefined;
    const webex_rooms = enabledSourceKinds.has("webex")
      ? webexRooms.map(toWebexRoomSource)
      : [];
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          description: description.trim() || undefined,
          team_id: teamId,
          initiatives: initiativesRaw.split(",").map((s) => s.trim()).filter(Boolean),
          swimlanes: swimlanesRaw.split(",").map((s) => s.trim()).filter(Boolean),
          github_repos,
          confluence_url,
          webex_rooms,
          // Blank → the API assigns the creator explicitly (no runtime fallback).
          data_steward: stewardEmail.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.project) {
        throw new Error(body.error ?? body.message ?? "Failed to create project");
      }
      const created = body.data.project as ProjectDocument;

      // Provision the enabled app integrations (tile links, http apps) in one
      // call — best-effort, so a provider hiccup doesn't block landing on the
      // project. Sources were already written at create.
      const appSteps = configSteps
        .filter((s) => !isSourceStep(s) && enabled[s.id])
        .map((s) => s.id);
      if (appSteps.length > 0) {
        try {
          await fetch("/api/projects/onboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: created._id, steps: appSteps }),
          });
        } catch {
          /* best-effort — the project still exists */
        }
      }

      onComplete?.(created);
      // Land the user on the new project (keep the "Creating…" state until nav).
      window.location.href = `/projects/${created.slug}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProvisioning(false);
    }
  }

  function advanceFromCurrentStep() {
    const lastIndex = wizardSteps.length - 1;
    if (phaseIndex >= lastIndex) return;
    setPhaseIndex(phaseIndex + 1);
  }

  async function handlePrimaryAction() {
    // Create + integrations steps just advance toward the review step.
    if (phase.kind === "create" || phase.kind === "integrations") {
      advanceFromCurrentStep();
      return;
    }
    // Review is terminal: commit, provision enabled apps, navigate to the project.
    if (isReviewPhase) {
      await createProject();
    }
  }

  const isPreCreate = phase.kind === "create" || phase.kind === "integrations";

  const primaryLabel = isPreCreate
    ? "Continue"
    : isReviewPhase
      ? provisioning
        ? "Creating…"
        : "Create project"
      : "";

  const showPrimary = isPreCreate || isReviewPhase;

  const primaryDisabled =
    provisioning ||
    // Name + team are required; enforce on the create step and again at the
    // review/commit step as a guard.
    ((phase.kind === "create" || isReviewPhase) &&
      (!projectName.trim() || !teamId));

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
        className="relative flex max-h-[95vh] w-full max-w-2xl sm:max-w-4xl lg:max-w-5xl flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-background shadow-2xl"
      >
        <div
          className={cn(
            "relative px-4 pt-6 pb-3 sm:px-8 sm:pt-10 sm:pb-6 text-white",
            "bg-gradient-to-br",
            phase.gradient,
          )}
        >
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                Project Onboarding · Step {phaseIndex + 1} of {wizardSteps.length}
              </p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{phase.title}</h2>
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

          <div className="relative mt-3 sm:mt-6 flex gap-2 overflow-x-auto pb-2">
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
            >
              {phase.id === "create" ? (
                <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
                  {bsConfigured ? (
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !bsOpen;
                          setBsOpen(next);
                          if (next) lookupBackstage("");
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:bg-accent/40"
                      >
                        <FolderKanban className="h-4 w-4 text-muted-foreground" />
                        Pick from Backstage
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", bsOpen && "rotate-180")} />
                      </button>
                      {bsOpen ? (
                        <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-3">
                          <p className="px-1 pb-2 text-xs text-muted-foreground">
                            Select a Backstage system to pre-fill this project: name, description,
                            initiatives, and repos (all still editable).
                          </p>
                          {/* Optional filter over the listed systems. */}
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                              value={bsQuery}
                              autoFocus
                              onChange={(e) => {
                                setBsQuery(e.target.value);
                                lookupBackstage(e.target.value);
                              }}
                              placeholder="Filter systems…"
                              className="w-full rounded-lg border border-border/60 bg-muted/30 py-2 pl-9 pr-3 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                            />
                          </div>
                          <ul className="mt-2 max-h-56 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/60">
                            {bsLoading && bsResults.length === 0 ? (
                              <li className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading Backstage systems…
                              </li>
                            ) : bsResults.length === 0 ? (
                              <li className="px-3 py-3 text-xs text-muted-foreground">
                                No Backstage systems found. Check BACKSTAGE_URL and BACKSTAGE_API_TOKEN.
                              </li>
                            ) : (
                              bsResults.map((r) => (
                                <li key={r.slug}>
                                  <button
                                    type="button"
                                    onClick={() => applyBackstageResult(r)}
                                    className="block w-full px-3 py-2.5 text-left transition hover:bg-accent/50"
                                  >
                                    <span className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-foreground">{r.title}</span>
                                      <span className="text-xs text-muted-foreground">{r.slug}</span>
                                    </span>
                                    {r.description ? (
                                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                                        {r.description}
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Project name <span className="text-red-500">*</span></span>
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
                    <div className="space-y-1.5 pt-2">
                      <span className="block text-sm font-medium">Team <span className="text-red-500">*</span></span>
                      <TeamPicker
                        options={teams}
                        value={teamId}
                        onChange={setTeamId}
                        placeholder="Select owning team"
                        hideSlugSuffix
                        triggerClassName="flex"
                      />
                      {!teamsLoading && teams.length === 0 && (
                        <span className="block text-xs text-muted-foreground">
                          No teams available. Ask an admin to add you to one (a
                          project must belong to a team).
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <span className="block text-sm font-medium">Data steward</span>
                      <UserEmailPicker
                        value={stewardEmail}
                        onChange={setStewardEmail}
                        placeholder="Defaults to you (the creator)"
                      />
                      <span className="block text-xs text-muted-foreground">
                        The person (by email) whose GitHub connection powers this
                        project&apos;s source activity feed. Defaults to you. This role will
                        do more later. Changeable in settings.
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">BHAG / Initiatives</span>
                      <LabelComboBox
                        ariaLabel="BHAG / Initiatives"
                        value={initiativesRaw}
                        onChange={setInitiativesRaw}
                        options={labelFacets.initiatives.map((v) => ({ value: v, label: v }))}
                        placeholder="Agentic-2026, Platform Modernization"
                        multi
                        inputClassName="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                      <span className="text-xs text-muted-foreground">Pick existing or type a new one (comma-separated).</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Swim Lanes</span>
                      <LabelComboBox
                        ariaLabel="Swim Lanes"
                        value={swimlanesRaw}
                        onChange={setSwimlanesRaw}
                        options={labelFacets.swimlanes.map((v) => ({ value: v, label: v }))}
                        placeholder="Now, Next, Later"
                        multi
                        inputClassName="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                      />
                      <span className="text-xs text-muted-foreground">Pick existing or type a new one (comma-separated).</span>
                    </label>
                    {/* Sources are strictly YAML-driven: they live in their own
                        `source` wizard steps when the onboarding config defines
                        them, and are not collected on the create step. */}
                    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
                      Projects belong to teams and can sync to Backstage as{" "}
                      <code className="text-primary">kind: System</code>. Labels (Domain ·
                      BHAG · Swim Lane) power the executive dashboard.
                    </div>
                  </div>
                </div>
              ) : null}

              {isIntegrationsPhase ? (
                <div className="space-y-3">
                  {configSteps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No integrations are configured for this deployment.
                    </p>
                  ) : null}
                  {configSteps.map((step) => {
                    const on = Boolean(enabled[step.id]);
                    const isSource = isSourceStep(step);
                    return (
                      <div
                        key={step.id}
                        className="overflow-hidden rounded-xl border border-border/60 bg-card/30"
                      >
                        {/* Enable toggle — checking it progressively discloses
                            the integration's details (a source picker, etc.). */}
                        <button
                          type="button"
                          onClick={() =>
                            setEnabled((prev) => ({ ...prev, [step.id]: !on }))
                          }
                          aria-pressed={on}
                          className="group flex w-full items-center gap-3 p-4 text-left transition hover:bg-accent/30"
                        >
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                          >
                            {on ? <Check className="h-3.5 w-3.5" /> : null}
                          </span>
                          {isSource && step.source ? (
                            <ProviderLogo
                              provider={SOURCE_PROVIDER[step.source]}
                              className="h-5 w-5 shrink-0 object-contain grayscale transition-all group-hover:grayscale-0"
                            />
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">
                              {step.title}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {step.subtitle}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {isSource ? "source" : "app"}
                          </span>
                        </button>

                        {on && isSource ? (
                          <div className="border-t border-border/60 p-4">
                            <SourcePicker
                              source={step.source}
                              selected={
                                step.source === "github"
                                  ? githubReposRaw
                                      .split(/[\n,]/)
                                      .map((s) => s.trim())
                                      .filter(Boolean)
                                  : step.source === "confluence"
                                    ? confluenceUrl.trim()
                                      ? [confluenceUrl.trim()]
                                      : []
                                    : step.source === "webex"
                                      ? webexRooms
                                      : []
                              }
                              onChange={(next) => {
                                if (step.source === "github")
                                  setGithubReposRaw(next.join(", "));
                                else if (step.source === "confluence")
                                  setConfluenceUrl(next[0] ?? "");
                                else if (step.source === "webex")
                                  setWebexRooms(next);
                              }}
                            />
                          </div>
                        ) : null}

                        {on && !isSource ? (
                          <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
                            Enabled. Added to this project when you create it.
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {isReviewPhase
                ? (() => {
                    const repos = githubReposRaw
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const initiatives = initiativesRaw
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const swimlanes = swimlanesRaw
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const team = teams.find(
                      (t) =>
                        t.id === teamId || t._id === teamId || t.slug === teamId,
                    );
                    const teamLabel = team?.name?.trim() || team?.slug || teamId;
                    // Only summarize what the user enabled in the Integrations step.
                    const enabledSourceKinds = new Set(
                      configSteps
                        .filter((s) => isSourceStep(s) && enabled[s.id])
                        .map((s) => s.source),
                    );
                    const enabledIntegrations = configSteps
                      .filter((s) => enabled[s.id])
                      .map((s) => s.title);
                    const showGithub = enabledSourceKinds.has("github");
                    const showConfluence = enabledSourceKinds.has("confluence");
                    const showWebex = enabledSourceKinds.has("webex");
                    const rooms = webexRooms.map(toWebexRoomSource);
                    const SourceLabel = ({
                      provider,
                      name,
                    }: {
                      provider: string;
                      name: string;
                    }) => (
                      <span className="flex items-center gap-1.5 text-foreground">
                        <ProviderLogo
                          provider={provider}
                          className="h-4 w-4 shrink-0 object-contain"
                        />
                        {name}
                      </span>
                    );
                    const Row = ({
                      label,
                      children,
                    }: {
                      label: ReactNode;
                      children: ReactNode;
                    }) => (
                      <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="min-w-0 break-words">{children}</span>
                      </div>
                    );
                    const muted = (
                      <span className="text-muted-foreground">—</span>
                    );
                    return (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Nothing has been created yet. Clicking{" "}
                          <span className="font-medium">Create project</span>{" "}
                          creates it and takes you to the project.
                        </p>
                        <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/10">
                          <Row label="Project">
                            <span className="font-medium">
                              {projectName.trim() || muted}
                            </span>
                          </Row>
                          <Row label="Team">{teamLabel || muted}</Row>
                          {description.trim() ? (
                            <Row label="Description">{description.trim()}</Row>
                          ) : null}
                          <Row label="Integrations">
                            {enabledIntegrations.length
                              ? enabledIntegrations.join(", ")
                              : muted}
                          </Row>
                          {showGithub ? (
                            <Row label={<SourceLabel provider="github" name="GitHub" />}>
                              {repos.length ? (
                                <span className="space-y-1.5">
                                  <span className="block text-xs text-muted-foreground">
                                    {repos.length} repo{repos.length === 1 ? "" : "s"}
                                  </span>
                                  <span className="flex flex-wrap gap-1.5">
                                    {repos.map((r) => (
                                      <span
                                        key={r}
                                        className="rounded-md bg-muted px-2 py-0.5 text-xs"
                                      >
                                        {r.replace(/^https?:\/\/github\.com\//i, "")}
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              ) : (
                                muted
                              )}
                            </Row>
                          ) : null}
                          {showConfluence ? (
                            <Row label={<SourceLabel provider="atlassian" name="Confluence" />}>
                              {confluenceUrl.trim() ? (
                                <span className="space-y-1.5">
                                  <span className="block text-xs text-muted-foreground">1 space</span>
                                  <span className="block break-all text-xs">
                                    {confluenceUrl.trim()}
                                  </span>
                                </span>
                              ) : (
                                muted
                              )}
                            </Row>
                          ) : null}
                          {showWebex ? (
                            <Row label={<SourceLabel provider="webex" name="Webex" />}>
                              {rooms.length ? (
                                <span className="space-y-1.5">
                                  <span className="block text-xs text-muted-foreground">
                                    {rooms.length} room{rooms.length === 1 ? "" : "s"}
                                  </span>
                                  <span className="flex flex-wrap gap-1.5">
                                    {rooms.map((r) => (
                                      <span
                                        key={r.room_id}
                                        className="rounded-md bg-muted px-2 py-0.5 text-xs"
                                      >
                                        {r.name || r.room_id}
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              ) : (
                                muted
                              )}
                            </Row>
                          ) : null}
                          {initiatives.length ? (
                            <Row label="BHAG / Initiatives">
                              {initiatives.join(", ")}
                            </Row>
                          ) : null}
                          {swimlanes.length ? (
                            <Row label="Swim Lanes">{swimlanes.join(", ")}</Row>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()
                : null}
            </motion.div>
          </AnimatePresence>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border/50 px-4 py-3 sm:px-8 sm:py-5">
          <div>
            {phaseIndex > 0 ? (
              <button
                type="button"
                disabled={provisioning}
                onClick={() => setPhaseIndex(phaseIndex - 1)}
                className="rounded-xl border border-border/60 px-5 py-2.5 text-sm font-medium transition hover:bg-accent/40 disabled:opacity-50"
              >
                Back
              </button>
            ) : null}
          </div>
          <div className="flex gap-3">
            {showPrimary ? (
              <button
                type="button"
                disabled={primaryDisabled}
                onClick={() => void handlePrimaryAction()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {provisioning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {primaryLabel}
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}


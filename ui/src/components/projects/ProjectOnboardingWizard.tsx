"use client";

// assisted-by Cursor Composer

import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  FolderKanban,
  Layers,
  ListChecks,
  Loader2,
  Rocket,
  Shield,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { SourcePicker } from "@/components/projects/source-pickers";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { toWebexRoomSource } from "@/lib/projects/webex-room";
import {
  DEFAULT_SCHEDULE,
  describeSchedule,
  scheduleToCron,
} from "@/lib/tome/auto-ingest/schedule-presets";
import type {
  ConfluencePageScope,
  ProjectDocument,
} from "@/types/projects";

const BLAST_RADIUS_OPTIONS = [
  { value: "small", label: "Small and reversible (2-way)", hint: "The team runs on its own" },
  { value: "large", label: "Large or permanent (1-way)", hint: "BHAG/SLT stays in the loop" },
] as const;

const OPTIONALITY_OPTIONS = [
  "Open Source Community / Foundation",
  "Peer-Reviewed Paper Publication",
  "Design Partner Co-Innovation / Marketing",
  "BU Graduation",
  "Free Service with Adoption",
] as const;

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

type EntityType = "project" | "area" | "bhag";

interface WizardStepMeta {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  gradient: string;
  checklist?: string[];
  /** type = pick project/area/bhag; create = general info; slt = SLT governance
   * fields; access = team/steward; integrations = apps/sources; auto-ingest =
   * scheduled ingest opt-in; review = confirm + commit. */
  kind: "type" | "create" | "slt" | "access" | "integrations" | "auto-ingest" | "review";
  source?: SourceKind;
}

const DEFAULT_GRADIENT = "from-primary to-primary/70";

const ENTITY_TYPE_OPTIONS: {
  value: EntityType;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "project",
    label: "Project",
    description: "A project with its own sources",
    icon: FolderKanban,
  },
  {
    value: "area",
    label: "Area",
    description: "A mid-tier grouping with child projects and direct sources",
    icon: Layers,
  },
  {
    value: "bhag",
    label: "BHAG",
    description: "A strategic goal with child projects and direct sources",
    icon: Target,
  },
];

function buildWizardSteps(
  configSteps: OnboardingStepConfig[],
  entityType: EntityType,
): WizardStepMeta[] {
  const type: WizardStepMeta = {
    id: "type",
    title: "Type",
    subtitle: "What are you creating?",
    icon: Boxes,
    gradient: DEFAULT_GRADIENT,
    kind: "type",
  };
  const create: WizardStepMeta = {
    id: "create",
    title: "General",
    subtitle: "Name your initiative and set its scope",
    icon: FolderKanban,
    gradient: DEFAULT_GRADIENT,
    kind: "create",
  };
  const slt: WizardStepMeta = {
    id: "slt",
    title: "SLT Configuration",
    subtitle: "Optional. Editable anytime in Project Settings.",
    icon: Shield,
    gradient: DEFAULT_GRADIENT,
    kind: "slt",
  };
  const access: WizardStepMeta = {
    id: "access",
    title: "Access Control",
    subtitle: "Assign an owning team and a scoped data steward",
    icon: Shield,
    gradient: DEFAULT_GRADIENT,
    kind: "access",
  };
  // BHAGs/Areas can attach the same data sources as projects, but do not
  // provision project-only app integrations.
  const relevantConfigSteps =
    entityType === "project" ? configSteps : configSteps.filter(isSourceStep);
  const integrations: WizardStepMeta | null = relevantConfigSteps.length
    ? {
        id: "integrations",
        title: "Integrations",
        subtitle:
          entityType === "project"
            ? "Enable apps and data sources"
            : "Attach data sources for synthesis",
        icon: Boxes,
        gradient: DEFAULT_GRADIENT,
        kind: "integrations",
      }
    : null;
  const autoIngest: WizardStepMeta | null =
    entityType === "project"
      ? {
          id: "auto-ingest",
          title: "Auto-ingest",
          subtitle: "Optional. Run ingest on a schedule.",
          icon: Clock,
          gradient: DEFAULT_GRADIENT,
          kind: "auto-ingest",
        }
      : null;
  const review: WizardStepMeta = {
    id: "review",
    title: "Review & Create",
    subtitle: "Confirm and create",
    icon: ListChecks,
    gradient: DEFAULT_GRADIENT,
    kind: "review",
  };
  const steps: (WizardStepMeta | null)[] = [type, create];
  if (entityType === "project") steps.push(slt);
  steps.push(access, integrations, autoIngest, review);
  return steps.filter((s): s is WizardStepMeta => Boolean(s));
}

export function ProjectOnboardingWizard({
  onComplete,
  initialOpen = false,
}: {
  onComplete?: (project: ProjectDocument) => void;
  initialOpen?: boolean;
}) {
  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? undefined;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(initialOpen);
  const [configSteps, setConfigSteps] = useState<OnboardingStepConfig[]>([]);
  // Which integrations the user has enabled (id → on), seeded from the config's
  // `default_enabled`. Drives the Integrations step + which apps provision.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [autoIngestOnboardEnabled, setAutoIngestOnboardEnabled] = useState(false);
  const [autoIngestSchedule, setAutoIngestSchedule] = useState(DEFAULT_SCHEDULE);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [entityType, setEntityType] = useState<EntityType>("project");
  // Hierarchy tagging (replaces free-text initiatives/areas): the parent BHAG
  // this project/area is being tagged to, and — for a project with a BHAG
  // selected — either a parent Area under it, or "" for "no area" (skip-level,
  // tag the BHAG directly).
  const [bhagOptions, setBhagOptions] = useState<{ name: string; slug: string }[]>([]);
  const [areaOptions, setAreaOptions] = useState<{ name: string; slug: string }[]>([]);
  const [selectedBhagName, setSelectedBhagName] = useState<string | null>(null);
  const [selectedAreaName, setSelectedAreaName] = useState<string>("");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState("");
  // User-shared data sources (collected by the configured `source` steps;
  // forwarded to connected external apps on onboarding).
  const [githubReposRaw, setGithubReposRaw] = useState("");
  // The scoped OpenFGA writer may be one user or every member of one team.
  const [stewardType, setStewardType] = useState<"user" | "team">("user");
  const [stewardEmail, setStewardEmail] = useState("");
  const [stewardTeamId, setStewardTeamId] = useState("");
  const [blastRadius, setBlastRadius] = useState<"small" | "large" | "">("");
  const [optionality, setOptionality] = useState<string[]>([]);
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [confluencePageScopes, setConfluencePageScopes] = useState<
    ConfluencePageScope[]
  >([]);
  // Encoded {room_id, name} blobs from the picker (see lib/projects/webex-room).
  const [webexRooms, setWebexRooms] = useState<string[]>([]);
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deployment-configured catchall team (e.g. DEFAULT_TEAM_SLUG=outshift-everyone),
  // used both to pre-select on load and to explain the pre-selection in copy.
  const defaultTeam = useMemo(() => {
    const slug = getConfig("defaultTeamSlug");
    return slug ? teams.find((t) => t.slug === slug) ?? null : null;
  }, [teams]);

  const wizardSteps = useMemo(
    () => buildWizardSteps(configSteps, entityType),
    [configSteps, entityType],
  );
  const entityConfigSteps = useMemo(
    () => (entityType === "project" ? configSteps : configSteps.filter(isSourceStep)),
    [configSteps, entityType],
  );
  const phase = wizardSteps[phaseIndex] ?? wizardSteps[0];
  // Flow: type=0, create, [slt], access, [integrations], review. Review is
  // terminal — Create commits, provisions enabled apps in the background, and
  // navigates to the project.
  const isTypePhase = phase.kind === "type";
  const isCreatePhase = phase.kind === "create";
  const isSltPhase = phase.kind === "slt";
  const isAccessPhase = phase.kind === "access";
  const isIntegrationsPhase = phase.kind === "integrations";
  const isAutoIngestPhase = phase.kind === "auto-ingest";
  const isReviewPhase = phase.kind === "review";

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

    // Existing BHAGs, for the Parent BHAG picker (Area/Project flows).
    fetch("/api/projects?type=bhag")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const list = (body?.data?.projects ?? []) as { name: string; slug: string }[];
        setBhagOptions(list.map((b) => ({ name: b.name, slug: b.slug })));
      })
      .catch(() => setBhagOptions([]));

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
        // Deployment-configured catchall (e.g. an everyone-gets-added team) —
        // pre-select it so most users never have to search ~100 teams. Only
        // applies if nothing's picked yet (functional update: doesn't clobber
        // an already-chosen team).
        const defaultSlug = getConfig("defaultTeamSlug");
        if (defaultSlug && list.some((t) => (t.slug ?? t._id) === defaultSlug)) {
          setTeamId((prev) => prev || defaultSlug);
        }
      })
      .catch(() => setTeams([]))
      .finally(() => setTeamsLoading(false));
  }, [open]);

  // Areas tagged to the selected parent BHAG (project's cascading picker, or
  // just to keep the selection meaningful) — cleared when no BHAG is selected.
  useEffect(() => {
    if (!selectedBhagName) {
      setAreaOptions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=area&initiative=${encodeURIComponent(selectedBhagName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const list = (body?.data?.projects ?? []) as { name: string; slug: string }[];
        setAreaOptions(list.map((a) => ({ name: a.name, slug: a.slug })));
      })
      .catch(() => !cancelled && setAreaOptions([]));
    return () => {
      cancelled = true;
    };
  }, [selectedBhagName]);

  const reset = useCallback(() => {
    setPhaseIndex(0);
    setEntityType("project");
    setSelectedBhagName(null);
    setSelectedAreaName("");
    setProjectName("");
    setDescription("");
    setTeamId("");
    setGithubReposRaw("");
    setStewardType("user");
    setStewardEmail("");
    setStewardTeamId("");
    setBlastRadius("");
    setOptionality([]);
    setConfluenceUrl("");
    setConfluencePageScopes([]);
    setWebexRooms([]);
    setProvisioning(false);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
    if (searchParams.get("onboard") === "1") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("onboard");
      const query = params.toString();
      router.replace(query ? `/projects?${query}` : "/projects");
    }
  }, [reset, router, searchParams]);

  async function createProject() {
    setError(null);
    setProvisioning(true);

    // Only collect source data for sources the user actually enabled.
    const enabledSourceKinds = new Set(
      entityConfigSteps
        .filter((s) => isSourceStep(s) && enabled[s.id])
        .map((s) => s.source),
    );
    const github_repos = enabledSourceKinds.has("github")
      ? githubReposRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      : [];
    const confluence_url = enabledSourceKinds.has("confluence")
      ? confluenceUrl.trim() || undefined
      : undefined;
    const confluence_page_scopes = enabledSourceKinds.has("confluence")
      ? confluencePageScopes
      : [];
    const webex_rooms = enabledSourceKinds.has("webex")
      ? webexRooms.map(toWebexRoomSource)
      : [];
    const common = {
      name: projectName.trim(),
      description: description.trim() || undefined,
      team_id: teamId,
      data_steward:
        stewardType === "team"
          ? { type: "team", team_id: stewardTeamId }
          : stewardEmail.trim()
            ? { type: "user", email: stewardEmail.trim() }
            : undefined,
      github_repos,
      confluence_url,
      confluence_page_scopes,
      webex_rooms,
    };

    let payload: Record<string, unknown>;
    if (entityType === "bhag") {
      payload = {
        ...common,
        type: "bhag",
      };
    } else if (entityType === "area") {
      payload = {
        ...common,
        type: "area",
        initiatives: selectedBhagName ? [selectedBhagName] : [],
      };
    } else {
      payload = {
        ...common,
        decision_blast_radius: blastRadius || undefined,
        optionality: optionality.length ? optionality : undefined,
      };
      // Tag both the BHAG and the Area directly on the project — never rely
      // on the Area's own tag to imply the BHAG. An Area isn't guaranteed to
      // tag its parent BHAG in its own labels (a real, non-error state), so
      // dropping `initiatives` here would leave the project's BHAG link
      // undiscoverable whenever that's the case.
      if (selectedBhagName && selectedAreaName) {
        payload.initiatives = [selectedBhagName];
        payload.areas = [selectedAreaName];
      } else if (selectedBhagName && !selectedAreaName) {
        payload.initiatives = [selectedBhagName];
      }
    }

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.project) {
        throw new Error(body.error ?? body.message ?? "Failed to create project");
      }
      const created = body.data.project as ProjectDocument;

      // Provision the enabled app integrations (tile links, http apps) in one
      // call — best-effort, so a provider hiccup doesn't block landing on the
      // project. Sources were already written at create.
      const appSteps = entityConfigSteps
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

      if (autoIngestOnboardEnabled && currentUserEmail) {
        try {
          await fetch(`/api/projects/${created.slug}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              autoIngest: {
                enabled: true,
                cron: scheduleToCron(autoIngestSchedule),
                credentialOwnerEmail: currentUserEmail,
              },
            }),
          });
        } catch {
          /* best-effort — configurable later in Settings */
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
    if (
      phase.kind === "type" ||
      phase.kind === "create" ||
      phase.kind === "slt" ||
      phase.kind === "access" ||
      phase.kind === "integrations" ||
      phase.kind === "auto-ingest"
    ) {
      advanceFromCurrentStep();
      return;
    }
    if (isReviewPhase) {
      await createProject();
    }
  }

  const isPreCreate =
    isTypePhase || isCreatePhase || isSltPhase || isAccessPhase || isIntegrationsPhase ||
    isAutoIngestPhase;

  const primaryLabel = isPreCreate
    ? "Continue"
    : isReviewPhase
      ? provisioning
        ? "Creating…"
        : entityType === "bhag"
          ? "Create BHAG"
          : entityType === "area"
            ? "Create area"
            : "Create project"
      : "";

  const showPrimary = isPreCreate || isReviewPhase;

  const primaryDisabled =
    provisioning ||
    (isCreatePhase && !projectName.trim()) ||
    (isCreatePhase && entityType === "area" && !selectedBhagName) ||
    ((isAccessPhase || isReviewPhase) && (!projectName.trim() || !teamId)) ||
    ((isAccessPhase || isReviewPhase) && stewardType === "team" && !stewardTeamId) ||
    (isReviewPhase && entityType === "area" && !selectedBhagName);

  const stepSummary =
    entityConfigSteps.length > 0
      ? entityConfigSteps.map((step) => step.title).join(" · ")
      : "Create project and finish";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 px-8 py-5 text-left shadow-lg transition hover:scale-[1.01] hover:shadow-xl"
      >
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl gradient-primary-br text-white shadow-lg">
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
        <div className="relative bg-muted px-4 pt-6 pb-3 sm:px-8 sm:pt-10 sm:pb-6 text-foreground">
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Project Onboarding · Step {phaseIndex + 1} of {wizardSteps.length}
              </p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{phase.title}</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">{phase.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-accent"
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
                    active && "bg-accent",
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
                          ? "border-primary bg-primary/20"
                          : "border-border",
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className="w-20 text-[10px] font-medium text-center leading-tight text-muted-foreground">
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
              {isTypePhase ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {ENTITY_TYPE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = entityType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEntityType(opt.value)}
                        className={cn(
                          "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
                          selected
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border/60 bg-muted/30 hover:border-primary/40 hover:bg-accent/30",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-lg border",
                            selected ? "border-primary bg-primary/20" : "border-border",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-sm font-semibold">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {phase.id === "create" ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      General
                    </h3>
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
                      <span className="block text-xs text-muted-foreground">
                        Shows on this project&apos;s card in the projects list, and seeds the
                        opening line of charter.md. It isn&apos;t kept in sync afterward: edit
                        charter.md directly for anything after creation.
                      </span>
                    </label>
                    {entityType === "area" ? (
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium">
                          Parent BHAG <span className="text-red-500">*</span>
                        </span>
                        <select
                          value={selectedBhagName ?? ""}
                          onChange={(e) => setSelectedBhagName(e.target.value || null)}
                          className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                        >
                          <option value="" disabled>
                            Select the BHAG this area belongs to…
                          </option>
                          {bhagOptions.map((b) => (
                            <option key={b.slug} value={b.name}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-muted-foreground">
                          An area always belongs to a BHAG.
                        </span>
                      </label>
                    ) : entityType === "project" ? (
                      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
                        <label className="block space-y-1.5">
                          <span className="text-sm font-medium">Parent BHAG</span>
                          <select
                            value={selectedBhagName ?? ""}
                            onChange={(e) => {
                              setSelectedBhagName(e.target.value || null);
                              setSelectedAreaName("");
                            }}
                            className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                          >
                            <option value="">None</option>
                            {bhagOptions.map((b) => (
                              <option key={b.slug} value={b.name}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-muted-foreground">
                            Optional. Ladders this project up to a strategic goal.
                          </span>
                        </label>
                        {selectedBhagName ? (
                          <label className="block space-y-1.5">
                            <span className="text-sm font-medium">Parent Area</span>
                            <select
                              value={selectedAreaName}
                              onChange={(e) => setSelectedAreaName(e.target.value)}
                              className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-sm outline-none ring-primary/30 focus:border-primary focus:ring-2"
                            >
                              <option value="">No area — tag this BHAG directly</option>
                              {areaOptions.map((a) => (
                                <option key={a.slug} value={a.name}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            <span className="text-xs text-muted-foreground">
                              Optional. Groups this project under a mid-tier area of {selectedBhagName}.
                            </span>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                </div>
              ) : null}

              {isSltPhase ? (
                <div className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    These fields are optional and can be changed anytime in{" "}
                    <span className="font-medium text-foreground">Project Settings</span>.
                  </p>
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Decision Blast Radius
                    </h3>
                    <p className="text-xs text-muted-foreground -mt-2">How reversible are this project&apos;s key decisions?</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {BLAST_RADIUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBlastRadius(blastRadius === opt.value ? "" : opt.value)}
                          className={cn(
                            "rounded-xl border px-4 py-3 text-left transition",
                            blastRadius === opt.value
                              ? "border-primary bg-primary/10 ring-1 ring-primary"
                              : "border-border/60 bg-muted/30 hover:border-primary/40 hover:bg-accent/30",
                          )}
                        >
                          <span className="flex items-start gap-2">
                            <span className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                              blastRadius === opt.value ? "border-primary bg-primary" : "border-border",
                            )}>
                              {blastRadius === opt.value ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                            </span>
                            <span>
                              <span className="block text-sm font-medium">{opt.label}</span>
                              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-border/60 pt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Optionality
                    </h3>
                    <p className="text-xs text-muted-foreground -mt-2">What external paths is this project pursuing? (select all that apply)</p>
                    <div className="flex flex-wrap gap-2">
                      {OPTIONALITY_OPTIONS.map((opt) => {
                        const selected = optionality.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setOptionality(
                                selected ? optionality.filter((o) => o !== opt) : [...optionality, opt],
                              )
                            }
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                              selected
                                ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                                : "border-border/60 bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                            )}
                          >
                            {selected ? <Check className="h-3 w-3" /> : null}
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {isAccessPhase ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <span className="block text-sm font-medium">
                        Shared directly with <span className="text-red-500">*</span>
                      </span>
                      <TeamPicker
                        options={teams}
                        value={teamId}
                        onChange={setTeamId}
                        placeholder="Select a team"
                        ariaLabel="Shared directly with team"
                        hideSlugSuffix
                        triggerClassName="flex"
                      />
                      <span className="block text-xs text-muted-foreground">
                        Members of this team have direct view access. Access can also be inherited
                        through the BHAG and Area hierarchy.
                      </span>
                      {!teamsLoading && teams.length === 0 && (
                        <span className="block text-xs text-muted-foreground">
                          No teams available. Ask an admin to add you to one. Every Tome entity
                          must be shared with a team.
                        </span>
                      )}
                      {defaultTeam && teamId === defaultTeam.slug && (
                        <span className="block text-xs text-muted-foreground">
                          Defaulted to {defaultTeam.name}. Members of this team will have direct
                          view access. Change it if needed.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-border/60 pt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Data steward (data write and project admin access)
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {(["user", "team"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setStewardType(kind)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-sm font-medium capitalize transition",
                            stewardType === kind
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/60 hover:bg-accent/40",
                          )}
                        >
                          {kind}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      {stewardType === "user" ? (
                        <UserEmailPicker
                          value={stewardEmail}
                          onChange={setStewardEmail}
                          placeholder="Leave blank to assign yourself"
                          currentUserEmail={currentUserEmail}
                        />
                      ) : (
                        <TeamPicker
                          options={teams}
                          value={stewardTeamId}
                          onChange={setStewardTeamId}
                          placeholder="Select steward team"
                          hideSlugSuffix
                          triggerClassName="flex"
                        />
                      )}
                      <span className="block text-xs text-muted-foreground">
                        This user, or every member of this team, can edit Tome content,
                        run ingestion or synthesis, and accept or reject draft reviews.
                        The permission applies only to this {entityType}.
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {isIntegrationsPhase ? (
                <div className="space-y-3">
                  {entityConfigSteps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No integrations are configured for this deployment.
                    </p>
                  ) : null}
                  {entityConfigSteps.map((step) => {
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
                              confluencePageScopes={
                                step.source === "confluence"
                                  ? confluencePageScopes
                                  : undefined
                              }
                              onConfluencePageScopesChange={
                                step.source === "confluence"
                                  ? (scopes, sourceUrl) => {
                                      setConfluencePageScopes(scopes);
                                      if (sourceUrl !== undefined)
                                        setConfluenceUrl(sourceUrl);
                                    }
                                  : undefined
                              }
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

              {isAutoIngestPhase ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Run ingest automatically on a schedule, on top of manual runs. Fully
                    optional, and editable anytime in Project Settings.
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border/60 bg-card/30">
                    <button
                      type="button"
                      onClick={() => setAutoIngestOnboardEnabled((prev) => !prev)}
                      aria-pressed={autoIngestOnboardEnabled}
                      className="group flex w-full items-center gap-3 p-4 text-left transition hover:bg-accent/30"
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
                          autoIngestOnboardEnabled
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {autoIngestOnboardEnabled ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">Enable auto-ingest</span>
                      </span>
                    </button>
                    {autoIngestOnboardEnabled ? (
                      <div className="space-y-2 border-t border-border/60 p-4">
                        <div className="grid grid-cols-3 gap-2">
                          {(["daily", "weekly"] as const).map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() =>
                                setAutoIngestSchedule((prev) => ({ ...prev, preset }))
                              }
                              className={cn(
                                "rounded-lg border px-3 py-2 text-sm font-medium capitalize",
                                autoIngestSchedule.preset === preset
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border/60",
                              )}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {describeSchedule(autoIngestSchedule)}. Runs authenticate as{" "}
                          <span className="font-medium">you</span>, using your connected
                          GitHub/Atlassian/Webex accounts. Change who this runs as anytime in
                          Settings.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {isReviewPhase
                ? (() => {
                    const repos = githubReposRaw
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    // Plain-language summary of the resolved hierarchy choice.
                    const hierarchySummary =
                      entityType === "bhag"
                        ? null
                        : entityType === "area"
                          ? selectedBhagName
                            ? `Under BHAG: ${selectedBhagName}`
                            : null
                          : selectedBhagName && selectedAreaName
                            ? `Tagged to Area: ${selectedAreaName} (under BHAG: ${selectedBhagName})`
                            : selectedBhagName
                              ? `Tagged directly to BHAG: ${selectedBhagName} (no area)`
                              : "Not tagged to any BHAG/Area";
                    const team = teams.find(
                      (t) =>
                        t.id === teamId || t._id === teamId || t.slug === teamId,
                    );
                    const teamLabel = team?.name?.trim() || team?.slug || teamId;
                    const stewardTeam = teams.find(
                      (t) =>
                        t.id === stewardTeamId ||
                        t._id === stewardTeamId ||
                        t.slug === stewardTeamId,
                    );
                    const stewardLabel =
                      stewardType === "team"
                        ? stewardTeam?.name?.trim() || stewardTeam?.slug || stewardTeamId
                        : stewardEmail.trim() || currentUserEmail || "Creator";
                    // Only summarize what the user enabled in the Integrations step.
                    const enabledSourceKinds = new Set(
                      entityConfigSteps
                        .filter((s) => isSourceStep(s) && enabled[s.id])
                        .map((s) => s.source),
                    );
                    const enabledIntegrations = entityConfigSteps
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
                          <span className="font-medium">
                            {entityType === "bhag"
                              ? "Create BHAG"
                              : entityType === "area"
                                ? "Create area"
                                : "Create project"}
                          </span>{" "}
                          creates it and takes you there.
                        </p>
                        <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/10">
                          <Row label={entityType === "bhag" ? "BHAG" : entityType === "area" ? "Area" : "Project"}>
                            <span className="font-medium">
                              {projectName.trim() || muted}
                            </span>
                          </Row>
                          <Row label="Shared directly with">{teamLabel || muted}</Row>
                          <Row label="Data steward (data write and project admin access)">
                            {stewardLabel || muted} ({stewardType})
                          </Row>
                          {description.trim() ? (
                            <Row label="Description">{description.trim()}</Row>
                          ) : null}
                          {hierarchySummary ? (
                            <Row label="Hierarchy">{hierarchySummary}</Row>
                          ) : null}
                          {entityType === "project" && enabledIntegrations.length > 0 ? (
                            <Row label="Integrations">{enabledIntegrations.join(", ")}</Row>
                          ) : null}
                          {entityType === "project" && showGithub ? (
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
                                  <span className="block text-xs text-muted-foreground">
                                    {confluencePageScopes.length
                                      ? `${confluencePageScopes.length} page root${confluencePageScopes.length === 1 ? "" : "s"}`
                                      : "1 space"}
                                  </span>
                                  {confluencePageScopes.map((scope) => (
                                    <span
                                      key={scope.page_id}
                                      className="block text-xs font-medium"
                                    >
                                      {scope.page_title}
                                      {scope.include_descendants
                                        ? " and all subpages"
                                        : ""}
                                    </span>
                                  ))}
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
                          {blastRadius ? (
                            <Row label="Blast Radius">
                              {BLAST_RADIUS_OPTIONS.find((o) => o.value === blastRadius)?.label ?? blastRadius}
                            </Row>
                          ) : null}
                          {optionality.length ? (
                            <Row label="Optionality">
                              <span className="flex flex-wrap gap-1.5">
                                {optionality.map((o) => (
                                  <span key={o} className="rounded-md bg-muted px-2 py-0.5 text-xs">{o}</span>
                                ))}
                              </span>
                            </Row>
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

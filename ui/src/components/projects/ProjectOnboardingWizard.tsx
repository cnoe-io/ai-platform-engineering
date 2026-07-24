"use client";

// assisted-by Cursor Composer

import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Layers,
  ListChecks,
  Loader2,
  Rocket,
  Search,
  Shield,
  Target,
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
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { SourcePicker } from "@/components/projects/source-pickers";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { toWebexRoomSource } from "@/lib/projects/webex-room";
import type { ProjectDocument } from "@/types/projects";

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
   * fields; access = team/steward; integrations = apps/sources; review =
   * confirm + commit. */
  kind: "type" | "create" | "slt" | "access" | "integrations" | "review";
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
    description: "A mid-tier grouping under a BHAG",
    icon: Layers,
  },
  {
    value: "bhag",
    label: "BHAG",
    description: "A strategic goal that spans multiple projects",
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
    subtitle: entityType === "project" ? "Assign a team and data steward" : "Assign a team",
    icon: Shield,
    gradient: DEFAULT_GRADIENT,
    kind: "access",
  };
  // BHAG/Area are synthesis-only wikis, not deployable projects — skip the
  // Integrations step entirely (neither sources nor app tiles apply).
  const relevantConfigSteps = entityType === "project" ? configSteps : [];
  const integrations: WizardStepMeta | null = relevantConfigSteps.length
    ? {
        id: "integrations",
        title: "Integrations",
        subtitle: "Enable the apps and sources for this project",
        icon: Boxes,
        gradient: DEFAULT_GRADIENT,
        kind: "integrations",
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
  steps.push(access, integrations, review);
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
  const [open, setOpen] = useState(initialOpen);
  const [configSteps, setConfigSteps] = useState<OnboardingStepConfig[]>([]);
  // Which integrations the user has enabled (id → on), seeded from the config's
  // `default_enabled`. Drives the Integrations step + which apps provision.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
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
  // Data steward for the source-activity feed: the principal the feed runs as.
  // Blank means the create API assigns the creator (owner) explicitly.
  const [stewardEmail, setStewardEmail] = useState("");
  const [blastRadius, setBlastRadius] = useState<"small" | "large" | "">("");
  const [optionality, setOptionality] = useState<string[]>([]);
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
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deployment-configured catchall team (e.g. DEFAULT_TEAM_SLUG=backstage-access),
  // used both to pre-select on load and to explain the pre-selection in copy.
  const defaultTeam = useMemo(() => {
    const slug = getConfig("defaultTeamSlug");
    return slug ? teams.find((t) => t.slug === slug) ?? null : null;
  }, [teams]);

  const wizardSteps = useMemo(
    () => buildWizardSteps(configSteps, entityType),
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
    // Note: Backstage tags aren't mapped into the BHAG/Area hierarchy (they're
    // free-form catalog tags, not necessarily existing BHAG/Area names) — the
    // user picks the parent explicitly below. TODO: best-effort match a tag
    // against an existing BHAG name and pre-select it.
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
        // a Backstage-prefilled or otherwise already-chosen team).
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
    setStewardEmail("");
    setBlastRadius("");
    setOptionality([]);
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

    let payload: Record<string, unknown>;
    if (entityType === "bhag") {
      payload = {
        type: "bhag",
        name: projectName.trim(),
        description: description.trim() || undefined,
        team_id: teamId,
      };
    } else if (entityType === "area") {
      payload = {
        type: "area",
        name: projectName.trim(),
        description: description.trim() || undefined,
        team_id: teamId,
        initiatives: selectedBhagName ? [selectedBhagName] : [],
      };
    } else {
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
      payload = {
        name: projectName.trim(),
        description: description.trim() || undefined,
        team_id: teamId,
        github_repos,
        confluence_url,
        webex_rooms,
        // Blank → the API assigns the creator explicitly (no runtime fallback).
        data_steward: stewardEmail.trim() || undefined,
        decision_blast_radius: blastRadius || undefined,
        optionality: optionality.length ? optionality : undefined,
      };
      // Cascading BHAG → Area tagging. Area implies the chain (don't also send
      // initiatives); no BHAG at all leaves the project untagged.
      if (selectedBhagName && selectedAreaName) {
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
    if (
      phase.kind === "type" ||
      phase.kind === "create" ||
      phase.kind === "slt" ||
      phase.kind === "access" ||
      phase.kind === "integrations"
    ) {
      advanceFromCurrentStep();
      return;
    }
    if (isReviewPhase) {
      await createProject();
    }
  }

  const isPreCreate =
    isTypePhase || isCreatePhase || isSltPhase || isAccessPhase || isIntegrationsPhase;

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
    (isReviewPhase && entityType === "area" && !selectedBhagName);

  const stepSummary =
    configSteps.length > 0
      ? configSteps.map((step) => step.title).join(" · ")
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
                  {entityType === "project" && bsConfigured ? (
                    <div>
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
                      {defaultTeam && teamId === defaultTeam.slug && (
                        <span className="block text-xs text-muted-foreground">
                          Defaulted to {defaultTeam.name}. Most projects belong here. Change it if this one is different.
                        </span>
                      )}
                    </div>
                  </div>

                  {entityType === "project" ? (
                    <div className="space-y-4 border-t border-border/60 pt-6">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Data Steward
                      </h3>
                      <div className="space-y-1.5">
                        <UserEmailPicker
                          value={stewardEmail}
                          onChange={setStewardEmail}
                          placeholder="Optional: leave blank to skip"
                          currentUserEmail={currentUserEmail}
                        />
                        <span className="block text-xs text-muted-foreground">
                          The person (by email) whose GitHub connection powers this
                          project&apos;s source activity feed. Defaults to you. This role will
                          do more later. Changeable in settings.
                        </span>
                      </div>
                    </div>
                  ) : null}
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
                          <Row label="Team">{teamLabel || muted}</Row>
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


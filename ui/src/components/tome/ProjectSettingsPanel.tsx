"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { AutosavingSourcesEditor } from "@/components/projects/source-pickers/AutosavingSourcesEditor";
import { useProjectSourceKinds } from "@/components/projects/source-pickers/useProjectSourceKinds";
import { ChildProjectsPanel } from "@/components/tome/BhagProjectsPanel";
import { PanelHeader } from "@/components/tome/PanelHeader";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import { normLabel } from "@/lib/projects/labels";
import type { ProjectDocument, ProjectSources, ProjectType } from "@/types/projects";
import { dataStewardUserEmail, isSynthesizedType } from "@/types/projects";

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

const TAB_TRIGGER_CLASS =
  "rounded-none border-b-2 border-transparent px-1 pb-2 pt-1 text-sm font-medium data-[state=active]:bg-transparent data-[state=active]:shadow-none";

interface TomeRbacConfiguration {
  object: string;
  directTeam: {
    slug: string;
    name: string;
    subject: string;
    relation: "reader";
  };
  parents: Array<{
    slug: string;
    name: string;
    type: "bhag" | "area";
    object: string;
    team: { slug: string; name: string; subject: string };
  }>;
  inheritance: string;
  dataSteward: {
    type: "user" | "team";
    name: string;
    subject: string;
    relation: "writer";
  } | null;
  tomeAdminOverride: string;
}

/**
 * Project settings, surfaced as a Tome view (nav item under Activity) so a project
 * can be reconfigured without leaving Tome. Edits title, description,
 * organization (team / BHAG / area), and sources, persisting with
 * `PATCH /api/projects/<slug>`. `onSaved` lets the host refresh anything
 * derived from the project (e.g. the breadcrumb title).
 *
 * Layout is tabbed (General / Organization / SLT / Projects / Sources / Feed)
 * with a sticky save bar, so the (now longer) form stays navigable instead of
 * one long scroll of stacked cards.
 */
export function ProjectSettingsPanel({
  slug,
  onSaved,
}: {
  slug: string;
  onSaved?: (project: ProjectDocument) => void;
}) {
  const router = useRouter();
  const { kinds: sourceKinds, loading: sourceKindsLoading } = useProjectSourceKinds();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canManageSteward, setCanManageSteward] = useState(false);
  const [rbac, setRbac] = useState<TomeRbacConfiguration | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Synthesized (BHAG/Area) entities show child projects in addition to the
  // same directly attached sources available to regular projects.
  const [isSynthesized, setIsSynthesized] = useState(false);
  const [projectKind, setProjectKind] = useState<ProjectType>("project");
  const [projectName, setProjectName] = useState("");
  const canDelete = canEdit && (!isSynthesized || canManageSteward);
  const entityLabel =
    projectKind === "bhag" ? "BHAG" : projectKind === "area" ? "Area" : "project";
  const [sources, setSources] = useState<ProjectSources>({
    repos: [],
    confluence_url: "",
  });

  // Scoped OpenFGA writer. A user steward can also lend credentials to the
  // source-activity feed; a team steward authorizes all team members but has no
  // single credential identity for the background feed.
  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? undefined;
  const [feedEnabled, setFeedEnabled] = useState(true);
  const [stewardType, setStewardType] = useState<"user" | "team">("user");
  const [stewardEmail, setStewardEmail] = useState("");
  const [stewardTeamId, setStewardTeamId] = useState("");
  const [feedStatus, setFeedStatus] = useState<{
    assigned: boolean;
    steward: string;
    owner: string;
    github_connected: boolean;
  } | null>(null);

  // SLT governance fields
  const [blastRadius, setBlastRadius] = useState<"small" | "large" | "">("");
  const [optionality, setOptionality] = useState<string[]>([]);

  // Organization
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamSlug, setTeamSlug] = useState("");
  const [initialTeamSlug, setInitialTeamSlug] = useState("");

  // Hierarchy tagging (BHAG → Area → Project). Replaces free-text
  // initiatives/areas tag inputs — a BHAG has no parent, an Area's parent is
  // always a BHAG, and a Project cascades BHAG → Area.
  const [bhagOptions, setBhagOptions] = useState<{ name: string; slug: string }[]>([]);
  const [areaOptions, setAreaOptions] = useState<{ name: string; slug: string }[]>([]);
  const [selectedBhagName, setSelectedBhagName] = useState<string | null>(null);
  const [selectedAreaName, setSelectedAreaName] = useState<string>("");
  // Read-only: entities tagged to *this* BHAG/Area (down-links).
  const [areasUnderBhag, setAreasUnderBhag] = useState<{ slug: string; name: string }[]>([]);

  // Load the project.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project");
        return {
          project: body.data.project as ProjectDocument,
          permissions: body.data.permissions as
            | { can_edit?: boolean; can_manage_steward?: boolean }
            | undefined,
          rbac: body.data.rbac as TomeRbacConfiguration | undefined,
        };
      })
      .then(({ project, permissions, rbac: configuration }) => {
        if (cancelled) return;
        setCanEdit(Boolean(permissions?.can_edit));
        setCanManageSteward(Boolean(permissions?.can_manage_steward));
        setRbac(configuration ?? null);
        setTitle(project.title);
        setDescription(project.description ?? "");
        setIsSynthesized(isSynthesizedType(project.type));
        setProjectKind(project.type ?? "project");
        setProjectName(project.name ?? project.title ?? "");
        setSources({
          repos: project.sources?.repos ?? [],
          confluence_url: project.sources?.confluence_url ?? "",
          ...project.sources,
        });
        setTeamSlug(project.team_slug ?? "");
        setInitialTeamSlug(project.team_slug ?? "");

        const kind = project.type ?? "project";
        const initiatives = project.labels?.initiatives ?? [];
        const areas = project.labels?.areas ?? [];
        if (kind === "area") {
          setSelectedBhagName(initiatives[0] ?? null);
          setSelectedAreaName("");
        } else if (kind === "bhag") {
          setSelectedBhagName(null);
          setSelectedAreaName("");
        } else if (areas[0]) {
          // Project tagged to an Area: the BHAG dropdown should reflect that
          // Area's own parent BHAG too — resolved in the effect below once we
          // know the Area's name.
          setSelectedAreaName(areas[0]);
        } else {
          setSelectedBhagName(initiatives[0] ?? null);
          setSelectedAreaName("");
        }

        setFeedEnabled(project.sources_feed_enabled !== false);
        if (typeof project.data_steward === "object" && project.data_steward.type === "team") {
          setStewardType("team");
          setStewardTeamId(project.data_steward.id);
          setStewardEmail("");
        } else {
          setStewardType("user");
          setStewardEmail(dataStewardUserEmail(project.data_steward));
          setStewardTeamId("");
        }
        setBlastRadius((project.decision_blast_radius as "small" | "large" | "") ?? "");
        setOptionality(project.optionality ?? []);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // A project already tagged to an Area: resolve that Area's own parent BHAG
  // (via its `labels.initiatives`) so the Parent BHAG dropdown pre-selects
  // correctly instead of showing "None" until the user touches it.
  useEffect(() => {
    if (projectKind !== "project" || !selectedAreaName) return;
    let cancelled = false;
    fetch("/api/projects?type=area")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const list = (body?.data?.projects ?? []) as ProjectDocument[];
        const match = list.find((a) => normLabel(a.name ?? "") === normLabel(selectedAreaName));
        setSelectedBhagName(match?.labels?.initiatives?.[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Only re-resolve when the Area tag itself changes post-load, not on
    // every keystroke elsewhere in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKind, slug]);

  // Existing BHAGs, for the Parent BHAG picker (Area/Project). Areas tagged
  // to the currently-selected BHAG, for the Project's cascading Area picker.
  useEffect(() => {
    fetch("/api/projects?type=bhag")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const list = (body?.data?.projects ?? []) as { name: string; slug: string }[];
        setBhagOptions(list.map((b) => ({ name: b.name, slug: b.slug })));
      })
      .catch(() => setBhagOptions([]));
  }, []);

  useEffect(() => {
    if (!selectedBhagName || projectKind !== "project") {
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
  }, [selectedBhagName, projectKind]);

  // Read-only: Areas tagged to this BHAG (down-link list), shown above the
  // existing `ChildProjectsPanel` (skip-level projects).
  useEffect(() => {
    if (projectKind !== "bhag" || !projectName) {
      setAreasUnderBhag([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=area&initiative=${encodeURIComponent(projectName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const list = (body?.data?.projects ?? []) as { name: string; slug: string }[];
        setAreasUnderBhag(list.map((a) => ({ slug: a.slug, name: a.name })));
      })
      .catch(() => !cancelled && setAreasUnderBhag([]));
    return () => {
      cancelled = true;
    };
  }, [projectKind, projectName]);

  // Load assignable teams.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data.data ?? data.teams ?? []) as Array<{
          _id: string;
          name: string;
          slug?: string;
        }>;
        setTeams(
          list.map((t) => ({ slug: t.slug ?? t._id, name: t.name, id: t._id, _id: t._id })),
        );
      })
      .catch(() => !cancelled && setTeams([]))
      .finally(() => !cancelled && setTeamsLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  // Feed status (steward's GitHub-connected badge). Refetched after save so the
  // badge reflects a newly-assigned steward.
  const loadFeedStatus = useCallback(async () => {
    if (isSynthesized) return;
    try {
      const res = await fetch(`/api/tome/projects/${encodeURIComponent(slug)}/feed-status`);
      if (!res.ok) return;
      const body = await res.json();
      setFeedStatus(body.data ?? body);
    } catch {
      /* status is best-effort */
    }
  }, [slug, isSynthesized]);

  useEffect(() => {
    void loadFeedStatus();
  }, [loadFeedStatus]);

  const teamChanged = teamSlug !== initialTeamSlug;
  const selectedTeamId = useMemo(
    () => teams.find((t) => t.slug === teamSlug)?._id,
    [teams, teamSlug],
  );

  const save = useCallback(async () => {
    if (!canEdit) return;

    setSaving(true);
    setSavedAt(false);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title,
        description,
        sources: {
          ...sources,
          repos: (sources.repos ?? []).map((r) => r.trim()).filter(Boolean),
          confluence_url: (sources.confluence_url ?? "").trim(),
          confluence_page_scopes: sources.confluence_page_scopes ?? [],
          confluence_page_scope: sources.confluence_page_scope ?? null,
        },
        decision_blast_radius: blastRadius || null,
        optionality: optionality.length ? optionality : [],
      };
      if (canManageSteward) {
        payload.data_steward =
          stewardType === "team"
            ? { type: "team", team_id: stewardTeamId }
            : { type: "user", email: stewardEmail.trim() };
      }
      if (!isSynthesized) {
        payload.sources_feed_enabled = feedEnabled;
      }

      // Hierarchy tagging, per type. A BHAG has no parent — send nothing.
      if (projectKind === "area") {
        payload.initiatives = selectedBhagName ? [selectedBhagName] : [];
        payload.areas = [];
      } else if (projectKind === "project") {
        if (selectedBhagName && selectedAreaName) {
          payload.areas = [selectedAreaName];
          payload.initiatives = [];
        } else if (selectedBhagName && !selectedAreaName) {
          payload.initiatives = [selectedBhagName];
          payload.areas = [];
        } else {
          payload.initiatives = [];
          payload.areas = [];
        }
      }

      // Only send team_id when the team actually changed — avoids the
      // reassignment permission/sync path on an ordinary save.
      if (teamChanged && selectedTeamId) payload.team_id = selectedTeamId;

      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      const project = body.data.project as ProjectDocument;
      setRbac((body.data.rbac as TomeRbacConfiguration | undefined) ?? rbac);
      setTitle(project.title);
      setDescription(project.description ?? "");
      setTeamSlug(project.team_slug ?? "");
      setInitialTeamSlug(project.team_slug ?? "");
      const initiatives = project.labels?.initiatives ?? [];
      const areas = project.labels?.areas ?? [];
      if (projectKind === "area") {
        setSelectedBhagName(initiatives[0] ?? null);
      } else if (projectKind === "project") {
        setSelectedAreaName(areas[0] ?? "");
        if (!areas[0]) setSelectedBhagName(initiatives[0] ?? null);
      }
      if (typeof project.data_steward === "object" && project.data_steward.type === "team") {
        setStewardType("team");
        setStewardTeamId(project.data_steward.id);
        setStewardEmail("");
      } else {
        setStewardType("user");
        setStewardEmail(dataStewardUserEmail(project.data_steward));
        setStewardTeamId("");
      }
      setFeedEnabled(project.sources_feed_enabled !== false);
      setBlastRadius((project.decision_blast_radius as "small" | "large" | "") ?? "");
      setOptionality(project.optionality ?? []);
      setSavedAt(true);
      onSaved?.(project);
      void loadFeedStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    slug,
    title,
    description,
    projectKind,
    isSynthesized,
    selectedBhagName,
    selectedAreaName,
    sources,
    stewardEmail,
    stewardType,
    stewardTeamId,
    canEdit,
    canManageSteward,
    feedEnabled,
    blastRadius,
    optionality,
    teamChanged,
    selectedTeamId,
    onSaved,
    loadFeedStatus,
    rbac,
  ]);

  const deleteProject = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Delete failed (${res.status})`);
      router.push("/projects");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }, [slug, router]);

  if (loading) {
    return <TomeLoading />;
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          <PanelHeader
            title={`${entityLabel === "project" ? "Project" : entityLabel} settings`}
            description={`Reconfigure this ${projectKind}. Changes apply to future ${
              isSynthesized ? "syntheses" : "ingests"
            }.`}
            titleAccessory={
              rbac ? (
                <RbacPolicyDialog
                  rbac={rbac}
                  showOperatorGuidance={canManageSteward}
                />
              ) : undefined
            }
          />

          {!canEdit && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Read only. Only this {projectKind}&apos;s data steward or a Tome admin can
              save changes.
            </p>
          )}

          <fieldset disabled={!canEdit} className="contents">
            <Tabs value={settingsTab} onValueChange={setSettingsTab}>
              <div className="border-b border-border">
                <TabsList className="h-auto gap-4 bg-transparent p-0" indicator="underline">
                  <TabsTrigger value="general" className={TAB_TRIGGER_CLASS}>
                    General
                  </TabsTrigger>
                  <TabsTrigger value="organization" className={TAB_TRIGGER_CLASS}>
                    Organization
                  </TabsTrigger>
                  <TabsTrigger value="slt" className={TAB_TRIGGER_CLASS}>
                    SLT Configuration
                  </TabsTrigger>
                  {isSynthesized && (
                    <TabsTrigger value="projects" className={TAB_TRIGGER_CLASS}>
                      Projects
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="sources" className={TAB_TRIGGER_CLASS}>
                    Sources
                  </TabsTrigger>
                  {!isSynthesized && (
                    <TabsTrigger value="feed" className={TAB_TRIGGER_CLASS}>
                      Source activity feed
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              <TabsContent value="general" className="space-y-6 pt-6">
                <Section title="General">
                  <Field label="Title">
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </Field>
                </Section>

                {/* Regular projects are steward/admin deletable. BHAGs and
                    Areas are hierarchy-admin-only and hide this surface from
                    data stewards. The DELETE route enforces the same rule. */}
                {canDelete ? <div className="rounded-lg border border-destructive/40">
                  <button
                    type="button"
                    onClick={() => setDangerOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-destructive"
                  >
                    {dangerOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-semibold">Danger zone</span>
                  </button>
                  {dangerOpen && (
                    <div className="space-y-3 border-t border-destructive/40 p-4">
                      <div>
                        <p className="text-sm font-medium">Delete this {entityLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          Permanently removes the wiki, ingest history, and all sources. This cannot be
                          undone.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Type <span className="font-mono font-medium text-foreground">{slug}</span> to
                          confirm.
                        </p>
                        <input
                          type="text"
                          value={deleteConfirm}
                          onChange={(e) => setDeleteConfirm(e.target.value)}
                          placeholder={slug}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/40"
                        />
                        {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deleteConfirm !== slug || deleting}
                          onClick={() => void deleteProject()}
                        >
                          {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          {deleting ? "Deleting…" : `Delete ${entityLabel}`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div> : null}
              </TabsContent>

              <TabsContent value="organization" className="space-y-6 pt-6">
                <Section title="Organization">
                  <Field
                    label="Shared directly with"
                    hint="Members of this team have direct view access. Access can also be inherited through the BHAG and Area hierarchy."
                  >
                    <TeamPicker
                      options={teams}
                      value={teamSlug}
                      onChange={setTeamSlug}
                      placeholder={teamsLoading ? "Loading teams…" : "Select a team"}
                      disabled={teamsLoading}
                      ariaLabel="Shared directly with team"
                    />
                    {teamChanged && (
                      <p className="mt-1 text-xs text-amber-500">
                        Changing this team changes who has direct view access.
                      </p>
                    )}
                  </Field>
                  <Field
                    label="Data steward (data write and project admin access)"
                    hint={`The selected user or every member of the selected team can edit, ingest, synthesize, and review this ${projectKind}. Only Tome admins can change the assignment.`}
                  >
                    <fieldset disabled={!canManageSteward} className="space-y-2 disabled:opacity-60">
                      <div className="grid grid-cols-2 gap-2">
                        {(["user", "team"] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => setStewardType(kind)}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize ${
                              stewardType === kind
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border/60"
                            }`}
                          >
                            {kind}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {stewardType === "user" ? (
                            <UserEmailPicker
                              value={stewardEmail}
                              onChange={setStewardEmail}
                              currentUserEmail={currentUserEmail}
                              disabled={!canManageSteward}
                            />
                          ) : (
                            <TeamPicker
                              options={teams}
                              value={stewardTeamId}
                              onChange={setStewardTeamId}
                              placeholder="Select steward team"
                              disabled={!canManageSteward}
                            />
                          )}
                        </div>
                        {stewardType === "user" &&
                          feedStatus?.owner &&
                          stewardEmail.trim().toLowerCase() !== feedStatus.owner && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setStewardEmail(feedStatus.owner)}
                          >
                            Assign owner
                          </Button>
                        )}
                      </div>
                    </fieldset>
                    {feedStatus && !isSynthesized && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {!feedStatus.assigned ? (
                            <span className="inline-flex items-center gap-1 text-amber-500">
                              <TriangleAlert className="h-3.5 w-3.5" /> no steward assigned
                            </span>
                          ) : feedStatus.github_connected ? (
                            <span className="inline-flex items-center gap-1 text-emerald-500">
                              <Check className="h-3.5 w-3.5" /> {feedStatus.steward}, GitHub connected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-500">
                              <TriangleAlert className="h-3.5 w-3.5" /> {feedStatus.steward}, no GitHub connection, so the feed can&apos;t read sources
                            </span>
                          )}
                        </div>
                    )}
                  </Field>
                  {/* Hierarchy: a BHAG has no parent (nothing shown). An Area's only
                      parent is a BHAG. A Project cascades BHAG → Area. */}
                  {projectKind === "area" && (
                    <Field label="Parent BHAG">
                      <select
                        value={selectedBhagName ?? ""}
                        onChange={(e) => setSelectedBhagName(e.target.value || null)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
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
                    </Field>
                  )}
                  {projectKind === "project" && (
                    <>
                      <Field label="Parent BHAG" hint="Optional. Ladders this project up to a strategic goal.">
                        <select
                          value={selectedBhagName ?? ""}
                          onChange={(e) => {
                            setSelectedBhagName(e.target.value || null);
                            setSelectedAreaName("");
                          }}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <option value="">None</option>
                          {bhagOptions.map((b) => (
                            <option key={b.slug} value={b.name}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {selectedBhagName && (
                        <Field
                          label="Parent Area"
                          hint={`Optional. Groups this project under a mid-tier area of ${selectedBhagName}.`}
                        >
                          <select
                            value={selectedAreaName}
                            onChange={(e) => setSelectedAreaName(e.target.value)}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="">No area — tag this BHAG directly</option>
                            {areaOptions.map((a) => (
                              <option key={a.slug} value={a.name}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                    </>
                  )}
                </Section>
              </TabsContent>

              <TabsContent value="slt" className="space-y-6 pt-6">
                <Section title="SLT Configuration">
                  <Field label="Decision Blast Radius" hint="How reversible are this project's key decisions?">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {BLAST_RADIUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBlastRadius(blastRadius === opt.value ? "" : opt.value)}
                          className={[
                            "rounded-lg border px-3 py-2.5 text-left transition",
                            blastRadius === opt.value
                              ? "border-primary bg-primary/10 ring-1 ring-primary"
                              : "border-border/60 bg-muted/30 hover:border-primary/40 hover:bg-accent/30",
                          ].join(" ")}
                        >
                          <span className="flex items-start gap-2">
                            <span className={[
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                              blastRadius === opt.value ? "border-primary bg-primary" : "border-border",
                            ].join(" ")}>
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
                  </Field>
                  <Field label="Optionality" hint="What external paths is this project pursuing?">
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
                            className={[
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                              selected
                                ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                                : "border-border/60 bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                            ].join(" ")}
                          >
                            {selected ? <Check className="h-3 w-3" /> : null}
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </Section>
              </TabsContent>

              {/* BHAGs and Areas synthesize across their child projects. */}
              {isSynthesized && (
                <TabsContent value="projects" className="space-y-6 pt-6">
                  <Section title="Projects">
                    {projectKind === "bhag" && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Areas tagged to this BHAG. Read-only here — an Area picks its parent BHAG
                          from its own Settings, not the other way around.
                        </p>
                        {areasUnderBhag.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border p-6 text-center">
                            <Layers className="mx-auto h-8 w-8 text-muted-foreground/40" />
                            <p className="mt-2 text-sm font-medium">No areas tagged yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Create an Area and set{" "}
                              <span className="font-medium text-foreground">{projectName}</span> as its
                              parent BHAG, or promote an existing area tag from the Projects hub.
                            </p>
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {areasUnderBhag.map((a) => (
                              <Link
                                key={a.slug}
                                href={`/projects/${a.slug}/tome`}
                                className="group flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 transition hover:border-sky-500/60"
                              >
                                <Layers className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                                <span className="font-medium leading-snug text-sky-700 group-hover:underline dark:text-sky-400">
                                  {a.name}
                                </span>
                                <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-sky-600/60 dark:text-sky-400/60" />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <ChildProjectsPanel
                      bhagName={projectName}
                      entityKind={projectKind === "area" ? "area" : "bhag"}
                      editable
                    />
                  </Section>
                </TabsContent>
              )}

              <TabsContent value="sources" className="space-y-6 pt-6">
                <Section
                  title="Sources"
                  action={
                    <Link
                      href="/credentials"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Manage connections
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  }
                >
                  {isSynthesized && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      These sources enrich the synthesis alongside the tagged project wikis.
                    </p>
                  )}
                  {sourceKindsLoading ? (
                    <div className="space-y-2" aria-hidden>
                      <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
                      <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
                    </div>
                  ) : sourceKinds.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No source connectors are configured for this deployment.
                    </p>
                  ) : (
                    <AutosavingSourcesEditor
                      slug={slug}
                      kinds={sourceKinds}
                      value={sources}
                      onChange={setSources}
                      onSaved={onSaved}
                    />
                  )}
                </Section>
              </TabsContent>

              {/* Source activity feed: a consumer of the data steward's connection
                  (steward is assigned in Organization). Not for synthesized types. */}
              {!isSynthesized && (
                <TabsContent value="feed" className="space-y-6 pt-6">
                  <Section title="Source activity feed">
                    <p className="text-xs text-muted-foreground">
                      Surfaces this project&apos;s live GitHub activity (PRs, issues, releases)
                      in the Feed, read with the{" "}
                      <span className="font-medium">data steward</span>&apos;s connection
                      (set under Organization).
                    </p>
                    <Field label="Enabled">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={feedEnabled}
                          onChange={(e) => setFeedEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                        Show source activity for this project
                      </label>
                    </Field>
                    <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Activity is fetched with the steward&apos;s GitHub visibility and shown to
                      everyone with access to this project.
                    </p>
                  </Section>
                </TabsContent>
              )}
            </Tabs>
          </fieldset>
        </div>
      </ScrollArea>

      {/* Sticky save bar */}
      <div className="flex items-center justify-end gap-3 border-t bg-background px-6 py-3">
        {error && <span className="text-sm text-destructive">{error}</span>}
        {savedAt && !saving && (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-emerald-500" />
            Saved
          </span>
        )}
        <ViewOnlyTooltip viewOnly={!canEdit}>
          <Button onClick={() => void save()} disabled={!canEdit || saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </ViewOnlyTooltip>
      </div>
    </div>
  );
}

/** A titled card section with a proper header (not label-sized). */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function RbacPolicyDialog({
  rbac,
  showOperatorGuidance,
}: {
  rbac: TomeRbacConfiguration;
  showOperatorGuidance: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [modelState, setModelState] = useState<
    "idle" | "checking" | "repair-needed" | "healthy" | "repaired" | "error"
  >("idle");
  const [repairing, setRepairing] = useState(false);

  const inspectModel = useCallback(async () => {
    setModelState("checking");
    try {
      const response = await fetch("/api/tome/admin/openfga-model", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        healthy?: boolean;
      };
      if (!response.ok) throw new Error("model inspection failed");
      setModelState(body.healthy ? "healthy" : "repair-needed");
    } catch {
      setModelState("error");
    }
  }, []);

  const repairModel = useCallback(async () => {
    setRepairing(true);
    try {
      const response = await fetch("/api/tome/admin/openfga-model", {
        method: "POST",
      });
      if (!response.ok) throw new Error("model repair failed");
      setModelState("repaired");
    } catch {
      setModelState("error");
    } finally {
      setRepairing(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && showOperatorGuidance) {
        void inspectModel();
      }
    },
    [inspectModel, showOperatorGuidance],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-primary"
                aria-label="View access policy"
              >
                <ShieldCheck className="h-4 w-4" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p>View access policy</p>
            {showOperatorGuidance && (
              <p className="mt-1 text-xs">
                Admin note: If inherited BHAG or Area access is missing, the active
                OpenFGA model may be outdated. Open this panel to check and repair it.
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Access &amp; RBAC
          </DialogTitle>
          <DialogDescription>
            Effective OpenFGA policy for this {rbac.object.split("/")[1] ?? "Tome entity"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
          <div>
            <p className="text-sm font-medium">OpenFGA policy</p>
            <code className="mt-1 block break-all text-xs text-muted-foreground">
              {rbac.object}
            </code>
          </div>
          <RbacGrant
            label="Direct read"
            value={`${rbac.directTeam.name} members`}
            tuple={`${rbac.directTeam.subject} reader ${rbac.object}`}
          />
          {rbac.parents.map((parent) => (
            <RbacGrant
              key={parent.object}
              label={`Inherited from ${parent.type}`}
              value={`${parent.name} · ${parent.team.name} members`}
              tuple={`${parent.object} parent ${rbac.object}`}
            />
          ))}
          {rbac.dataSteward && (
            <RbacGrant
              label="Write"
              value={`${rbac.dataSteward.name} (${rbac.dataSteward.type})`}
              tuple={`${rbac.dataSteward.subject} writer ${rbac.object}`}
            />
          )}
          <RbacGrant
            label="Admin override"
            value="All Tome administrators"
            tuple={rbac.tomeAdminOverride}
          />
          <p className="text-xs text-muted-foreground">
            {rbac.inheritance}. Child access does not grant access back to its parent.
          </p>
        </div>

        {showOperatorGuidance && (
          <div
            className="rounded-lg border border-border/70 p-4"
            aria-live="polite"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Inherited access model</p>
                {modelState === "checking" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Checking the active OpenFGA model…
                  </p>
                )}
                {modelState === "repair-needed" && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    The model is missing document parent inheritance. Repairing it
                    publishes a corrected model without changing existing access tuples.
                  </p>
                )}
                {modelState === "healthy" && (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    The active model supports BHAG and Area inheritance.
                  </p>
                )}
                {modelState === "repaired" && (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    Model repaired. Save this project again to restore any parent link
                    that previously failed.
                  </p>
                )}
                {modelState === "error" && (
                  <p className="mt-1 text-xs text-destructive">
                    The model could not be checked or repaired. Review Platform Health
                    and try again.
                  </p>
                )}
              </div>
              {modelState === "repair-needed" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void repairModel()}
                  disabled={repairing}
                >
                  {repairing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {repairing ? "Repairing…" : "Repair model"}
                </Button>
              )}
              {modelState === "error" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void inspectModel()}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RbacGrant({
  label,
  value,
  tuple,
}: {
  label: string;
  value: string;
  tuple: string;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0">
        <p className="text-sm">{value}</p>
        <code className="block break-all text-[11px] text-muted-foreground">{tuple}</code>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

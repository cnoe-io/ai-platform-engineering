"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Workflow,
  GitBranch,
  GitPullRequest,
  GitMerge,
  Cloud,
  Rocket,
  Key,
  Users,
  Settings,
  Loader2,
  AlertCircle,
  Edit,
  Eye,
  FolderOpen,
  Trash2,
  Sparkles,
  Zap,
  Server,
  Bug,
  BarChart,
  Shield,
  Database,
  AlertTriangle,
  CheckCircle,
  Container,
  Terminal,
  Network,
  Activity,
  FileCode,
  MonitorCheck,
  RefreshCcw,
  CircleDot,
  Layers,
  PackageCheck,
  Gauge,
  ScrollText,
  Webhook,
  Cpu,
  HardDrive,
  Wrench,
  ArrowRight,
  X,
  MessageSquare,
  Star,
  Lock,
  Globe,
  UsersRound,
  User,
  ChevronsUpDown,
  Check,
  Filter,
  Waypoints,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import { useAgentSkillsStore } from "@/store/agent-skills-store";
import { useChatStore } from "@/store/chat-store";
import { useAdminRole } from "@/hooks/use-admin-role";
import type { AgentSkill } from "@/types/agent-skill";
import { SkillScanStatusIndicator } from "@/components/skills/SkillScanStatusIndicator";
import { SupervisorSyncBadge } from "@/components/skills/SupervisorSyncBadge";
import { SkillFolderViewer } from "@/components/skills/SkillFolderViewer";
import {
  makeConfigFolderAdapter,
  makeHubFolderAdapter,
  makeStaticFolderAdapter,
} from "@/components/skills/skill-folder-adapters";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SkillsGalleryProps {
  onEditConfig?: (config: AgentSkill) => void;
  onCreateNew?: () => void;
}

// ---------------------------------------------------------------------------
// Template variable extraction — parses {{var}} and {{var:default}} from prompt
// ---------------------------------------------------------------------------

interface TemplateVar {
  name: string;
  label: string;
  defaultValue: string;
  required: boolean;
}

function extractTemplateVars(config: AgentSkill): TemplateVar[] {
  // 1. Try extracting from llm_prompt {{var}} / {{var:default}} syntax
  const prompt = config.tasks?.[0]?.llm_prompt || "";
  if (prompt) {
    const seen = new Set<string>();
    const vars: TemplateVar[] = [];
    const re = /\{\{(\w+)(?::([^}]*))?\}\}/g;
    let m;

    while ((m = re.exec(prompt)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const defaultValue = m[2] ?? "";
      vars.push({
        name,
        label: name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        defaultValue,
        required: !defaultValue,
      });
    }
    if (vars.length > 0) return vars;
  }

  // 2. Fallback: use metadata.input_variables (catalog / built-in skills)
  const inputVars = (config.metadata as Record<string, unknown>)?.input_variables;
  if (Array.isArray(inputVars)) {
    return inputVars.map((v: Record<string, unknown>) => ({
      name: String(v.name || ""),
      label: String(v.label || v.name || ""),
      defaultValue: String(v.placeholder || ""),
      required: Boolean(v.required),
    }));
  }

  return [];
}

/** Unified catalog merge entries use synthetic ids; they are not stored in Mongo. */
function isCatalogOnlySkill(config: AgentSkill): boolean {
  return config.id.startsWith("catalog-");
}

/** Hub-crawled rows arrive as "catalog-hub-<hubId>-<skillId>" — read-only. */
function isHubSkill(config: AgentSkill): boolean {
  return config.id.startsWith("catalog-hub-");
}

/**
 * A skill the security scanner has marked unsafe — must not be runnable.
 *
 * The supervisor + dynamic agents enforce the same rule independently
 * (Python ``scan_gate`` module). This helper is the UI mirror so the
 * gallery can render flagged skills as disabled cards (admins still
 * see them, can re-scan, but can't launch / install).
 */
function isFlaggedSkill(config: AgentSkill): boolean {
  return config.scan_status === "flagged";
}

function FlaggedDisabledBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 gap-1 bg-red-500/10 text-red-600 border-red-500/30"
      title="Disabled — security scan flagged this skill. Re-scan after fixing the underlying SKILL.md to restore."
    >
      <Lock className="h-2.5 w-2.5" />
      Disabled — flagged
    </Badge>
  );
}

interface HubSkillRef {
  hubId: string;
  skillId: string;
}

function parseHubId(config: AgentSkill): HubSkillRef | null {
  const match = config.id.match(/^catalog-hub-([^-]+)-(.+)$/);
  if (!match) return null;
  return { hubId: match[1], skillId: match[2] };
}

const VISIBILITY_BADGE_CONFIG: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  team: { icon: UsersRound, label: "Team", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  global: { icon: Globe, label: "Global", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  private: { icon: Lock, label: "Private", className: "bg-muted text-muted-foreground border-border/50" },
};

function VisibilityBadge({ config }: { config: AgentSkill }) {
  /** Built-in / platform rows: source is already shown via CatalogSourceBadge ("Built-in"); omit redundant System shield. */
  if (config.is_system) return null;
  const key = config.visibility || "private";
  const badge = VISIBILITY_BADGE_CONFIG[key];
  if (!badge) return null;
  const VIcon = badge.icon;
  return (
    <Badge variant="outline" className={cn("text-xs px-1.5 py-0 gap-0.5", badge.className)}>
      <VIcon className="h-3 w-3" />
      {badge.label}
    </Badge>
  );
}

type CatalogSource = "default" | "agent_skills" | "hub";

function skillCatalogSource(config: AgentSkill): CatalogSource {
  const raw = (config.metadata as { catalog_source?: string })?.catalog_source;
  if (raw === "hub") return "hub";
  if (raw === "default") return "default";
  if (config.id.startsWith("catalog-")) return "default";
  // Mongo `agent_skills` platform rows (`is_system`) are built-in templates, not user "Custom"
  if (config.is_system) return "default";
  if (raw === "agent_skills") return "agent_skills";
  return "agent_skills";
}

/**
 * Scanner badge: shown on every Mongo-backed row AND hub/GitHub-crawled skills.
 * Now applied to *every* catalog source — built-in templates were never
 * "vetted at chart-build time" in any verifiable way, and we now persist
 * their scan state in `builtin_skill_scans` so the badge has something
 * real to show. Built-ins start as Unscanned (orange shield) until an
 * admin runs Scan now from this card or a bulk sweep.
 */
function shouldShowSkillScanIndicator(config: AgentSkill): boolean {
  if (!config.id.startsWith("catalog-")) return true;
  const src = (config.metadata as { catalog_source?: string } | undefined)?.catalog_source;
  return src === "hub" || src === "agent_skills" || src === "default";
}

const SOURCE_LABELS: Record<CatalogSource, string> = {
  default: "Built-in",
  agent_skills: "Custom",
  hub: "Skill hub",
};

function CatalogSourceBadge({ config }: { config: AgentSkill }) {
  const src = skillCatalogSource(config);
  const meta = config.metadata as { hub_location?: string; hub_type?: string } | undefined;

  if (src === "hub" && meta?.hub_location) {
    // Show GitHub/GitLab icon + short repo path
    const loc = meta.hub_location.replace(/^https?:\/\/github\.com\//, "").replace(/^https?:\/\/gitlab\.com\//, "").replace(/\/+$/, "");
    const isGitHub = !meta.hub_type || meta.hub_type === "github";
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground gap-0.5">
        {isGitHub ? (
          <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        ) : (
          <GitBranch className="h-2.5 w-2.5" />
        )}
        {loc}
      </Badge>
    );
  }

  if (src === "default") {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground gap-0.5">
        <Database className="h-2.5 w-2.5" />
        {SOURCE_LABELS[src]}
      </Badge>
    );
  }

  // Custom / agent_skills
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground gap-0.5">
      <User className="h-2.5 w-2.5" />
      {SOURCE_LABELS[src]}
    </Badge>
  );
}

// Icon mapping for thumbnails
const ICON_MAP: Record<string, React.ElementType> = {
  Zap, GitBranch, GitPullRequest, GitMerge, Server, Cloud, Rocket, Shield,
  Database, BarChart, Users, AlertTriangle, CheckCircle, Settings, Key,
  Workflow, Bug, Container, Terminal, Network, Activity, FileCode,
  MonitorCheck, RefreshCcw, CircleDot, Layers, PackageCheck, Gauge,
  ScrollText, Webhook, Cpu, HardDrive, Wrench,
};

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  "GitHub Operations": "from-gray-500 to-gray-700",
  "AWS Operations": "from-orange-500 to-orange-700",
  "ArgoCD Operations": "from-blue-500 to-blue-700",
  "AI Gateway Operations": "from-purple-500 to-purple-700",
  "Group Management": "from-green-500 to-green-700",
  "DevOps": "from-indigo-500 to-indigo-700",
  "Development": "from-cyan-500 to-cyan-700",
  "Operations": "from-red-500 to-red-700",
  "Cloud": "from-orange-500 to-orange-700",
  "Project Management": "from-teal-500 to-teal-700",
  "Security": "from-rose-500 to-rose-700",
  "Infrastructure": "from-amber-500 to-amber-700",
  "Knowledge": "from-violet-500 to-violet-700",
  "Custom": "from-pink-500 to-pink-700",
};

/** Preset categories (shown in picker + merged with categories from loaded skills). */
const PRESET_CATEGORIES: string[] = [
  "DevOps",
  "Development",
  "Operations",
  "Cloud",
  "Project Management",
  "Security",
  "Infrastructure",
  "Knowledge",
  "Custom",
];

/**
 * Supervisor sync badge — sourced from `@/components/skills/SupervisorSyncBadge`.
 *
 * The local definition that previously lived here was a silent
 * `<Link>`-based variant. We've consolidated to the shared component
 * which opens a confirmation modal explaining that the supervisor
 * refresh briefly recompiles the multi-agent graph (and that dynamic
 * custom agents are unaffected). Importing the shared one means card,
 * row, and workspace renderings stay in lockstep.
 */

export function SkillsGallery({
  onEditConfig,
  onCreateNew,
}: SkillsGalleryProps) {
  const {
    configs,
    isLoading,
    error,
    loadSkills,
    deleteSkill,
    toggleFavorite,
    isFavorite,
    getFavoriteSkills
  } = useAgentSkillsStore();
  const { isAdmin } = useAdminRole();
  const { data: session } = useSession();
  const router = useRouter();
  const { createConversation, setPendingMessage } = useChatStore();
  const workflowRunnerEnabled = getConfig('workflowRunnerEnabled');
  // Built-in mutation lock — when false (default) the gallery
  // disables Edit / Delete on `is_system: true` rows and surfaces
  // a "Clone" action instead. The server enforces the same policy
  // independently via `lib/builtin-skill-policy.ts` so a stale
  // config can't make the UI offer an action the API will reject.
  const allowBuiltinSkillMutation = getConfig('allowBuiltinSkillMutation');

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentSkill | null>(null);
  const [viewerTarget, setViewerTarget] = useState<AgentSkill | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "my-skills" | "team" | "global">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | CatalogSource>("all");

  const { toast } = useToast();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [diskTemplates, setDiskTemplates] = useState<{ id: string; label: string }[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importTemplatesLoading, setImportTemplatesLoading] = useState(false);

  const openImportModal = useCallback(() => {
    setImportModalOpen(true);
    setSelectedImportIds(new Set());
    setImportTemplatesLoading(true);
    fetch("/api/skill-templates", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { id: string; name?: string; title?: string }[]) => {
        const arr = Array.isArray(data) ? data : [];
        setDiskTemplates(
          arr.map((t) => ({
            id: t.id,
            label: (t.title || t.name || t.id).trim() || t.id,
          })),
        );
      })
      .catch(() => {
        setDiskTemplates([]);
        toast("Could not load packaged templates from disk", "error");
      })
      .finally(() => setImportTemplatesLoading(false));
  }, [toast]);

  const toggleImportId = useCallback((id: string) => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllImport = useCallback(() => {
    setSelectedImportIds(new Set(diskTemplates.map((t) => t.id)));
  }, [diskTemplates]);

  const clearImportSelection = useCallback(() => {
    setSelectedImportIds(new Set());
  }, []);

  const submitTemplateImport = useCallback(async () => {
    if (selectedImportIds.size === 0) {
      toast("Select at least one template", "warning");
      return;
    }
    setImportSubmitting(true);
    try {
      const res = await fetch("/api/skills/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_ids: Array.from(selectedImportIds) }),
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { imported?: unknown[]; skipped?: unknown[]; errors?: { error?: string }[] };
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(json?.error || json?.message || "Import failed");
      }
      const imported = json.data?.imported ?? [];
      const skipped = json.data?.skipped ?? [];
      const errors = json.data?.errors ?? [];
      const errMsg = errors.length
        ? ` Errors: ${errors.map((e) => e.error).filter(Boolean).join("; ")}`
        : "";
      toast(
        `Imported ${imported.length}, skipped ${skipped.length}.${errMsg}`,
        errors.length ? "warning" : "success",
        errors.length ? 8000 : 4000,
      );
      setImportModalOpen(false);
      await loadSkills();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "error");
    } finally {
      setImportSubmitting(false);
    }
  }, [selectedImportIds, toast, loadSkills]);

  // Skill run modal state
  const [activeFormConfig, setActiveFormConfig] = useState<AgentSkill | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Supervisor sync state
  const [supervisorSynced, setSupervisorSynced] = useState(false);
  const [supervisorLoading, setSupervisorLoading] = useState(true);
  // ISO timestamp of the supervisor's last `_build_graph()` merge. We compare
  // each skill's `updated_at` against this to flag per-skill drift; if a skill
  // was edited *after* the supervisor merged, the running graph is stale.
  const [supervisorMergedAt, setSupervisorMergedAt] = useState<Date | null>(null);
  const [supervisorReachable, setSupervisorReachable] = useState(false);

  useEffect(() => {
    fetch("/api/skills/supervisor-status")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const reachable = data && typeof data === "object" && !data.message;
        setSupervisorReachable(Boolean(reachable));
        setSupervisorSynced(data?.mas_registered === true && (data?.skills_loaded_count ?? 0) > 0);
        const merged = typeof data?.skills_merged_at === "string" ? new Date(data.skills_merged_at) : null;
        setSupervisorMergedAt(merged && !Number.isNaN(merged.getTime()) ? merged : null);
      })
      .catch(() => {
        setSupervisorSynced(false);
        setSupervisorReachable(false);
      })
      .finally(() => setSupervisorLoading(false));
  }, []);

  /**
   * Per-skill supervisor sync state.
   * - `synced`: edited at-or-before the supervisor's last graph merge.
   * - `stale`: edited after the supervisor's last merge — graph is running an older copy.
   * - `unknown`: supervisor unreachable or hasn't reported a merge yet.
   */
  const skillSyncState = useCallback(
    (cfg: AgentSkill): "synced" | "stale" | "unknown" => {
      if (!supervisorReachable || supervisorLoading) return "unknown";
      if (!supervisorMergedAt) return "unknown";
      const updated = cfg.updated_at instanceof Date ? cfg.updated_at : new Date(cfg.updated_at);
      if (Number.isNaN(updated.getTime())) return "unknown";
      return updated.getTime() <= supervisorMergedAt.getTime() ? "synced" : "stale";
    },
    [supervisorReachable, supervisorLoading, supervisorMergedAt],
  );

  /**
   * A built-in (`is_system: true`) Mongo-backed skill that the lock
   * policy currently treats as read-only. We split this out so the
   * Edit/Delete buttons can render a *disabled* affordance with a
   * tooltip explaining why, rather than vanishing silently — admins
   * need the discoverability ("ah, I need to clone this") more than
   * they need a clean grid.
   */
  const isLockedBuiltin = (config: AgentSkill): boolean => {
    return Boolean(config.is_system) && !allowBuiltinSkillMutation && !isCatalogOnlySkill(config);
  };

  const canEditConfig = (config: AgentSkill) => {
    if (isCatalogOnlySkill(config)) return false;
    if (isLockedBuiltin(config)) return false;
    return true;
  };

  const canDeleteConfig = (config: AgentSkill) => {
    if (isCatalogOnlySkill(config)) return false;
    if (isLockedBuiltin(config)) return false;
    return true;
  };

  /**
   * Clone is the escape hatch for the built-in lock + a general
   * convenience for any visible skill (custom, hub, built-in). We
   * surface it on every Mongo-or-cloneable row; catalog-only skills
   * (default templates not yet seeded into Mongo) still aren't
   * cloneable from the UI today — they have no source row to copy.
   */
  const canCloneConfig = (config: AgentSkill): boolean => {
    if (isCatalogOnlySkill(config)) return false;
    return true;
  };

  const [cloningId, setCloningId] = useState<string | null>(null);

  const handleClone = async (config: AgentSkill, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (cloningId) return;
    setCloningId(config.id);
    try {
      const res = await fetch(
        `/api/skills/configs/${encodeURIComponent(config.id)}/clone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Clone failed (${res.status})`);
      }
      const data = await res.json();
      await loadSkills();
      toast(`Cloned to "${data.name}"`, "success");
      // Drop the user straight into the new skill's workspace —
      // they almost certainly want to start editing immediately.
      router.push(`/skills/workspace/${encodeURIComponent(data.id)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Clone failed", "error");
    } finally {
      setCloningId(null);
    }
  };

  // Catalog skills from GET /api/skills (unified source of truth)
  const [catalogSkills, setCatalogSkills] = useState<AgentSkill[]>([]);

  // Load configs and catalog skills on mount
  useEffect(() => {
    loadSkills();

    // Unified catalog: default, agent_skills, and hub entries (FR-021).
    //
    // We request `include_content=true` so the SKILL.md body is available
    // for the static folder adapter (Files-tab "peek" on default skills)
    // and so the workspace fallback fetch isn't strictly required when the
    // user clicks Edit/View on a built-in chart template.
    fetch("/api/skills?include_content=true", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.skills) return;
        const mapped: AgentSkill[] = data.skills.map(
          (s: {
            id: string;
            name: string;
            source: string;
            source_id?: string | null;
            description?: string;
            metadata?: Record<string, unknown>;
            visibility?: string;
            content?: string | null;
            scan_status?: "passed" | "flagged" | "unscanned";
            scan_summary?: string;
            scan_updated_at?: string;
          }) => ({
            id: `catalog-${s.id}`,
            name: s.name,
            description: s.description || "",
            category: (s.metadata?.category as string) || "Custom",
            tasks: [],
            owner_id: "",
            is_system: true,
            is_quick_start: true,
            created_at: new Date(),
            updated_at: new Date(),
            thumbnail: (s.metadata?.icon as string) || "Zap",
            skill_content: s.content ?? undefined,
            metadata: {
              tags: (s.metadata?.tags as string[]) || [],
              catalog_source: s.source,
              catalog_source_id: s.source_id ?? null,
              catalog_visibility: s.visibility,
              hub_location: (s.metadata?.hub_location as string) || "",
              hub_type: (s.metadata?.hub_type as string) || "",
              hub_path: (s.metadata?.path as string) || "",
            },
            scan_status: s.scan_status,
            scan_summary: s.scan_summary,
            scan_updated_at: s.scan_updated_at ? new Date(s.scan_updated_at) : undefined,
          } as AgentSkill),
        );
        setCatalogSkills(mapped);
      })
      .catch(() => {});
  }, [loadSkills]);

  // Merge agent configs (store) with catalog-only skills, deduplicating by name
  const allConfigs = useMemo(() => {
    const seen = new Set<string>();
    const merged: AgentSkill[] = [];
    // Agent configs take priority (richer data, editable)
    for (const config of configs) {
      if (!seen.has(config.id)) {
        seen.add(config.id);
        seen.add(config.name); // track by name too for catalog dedup
        merged.push(config);
      }
    }
    // Add catalog-only skills not already present by name
    for (const skill of catalogSkills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        merged.push(skill);
      }
    }
    return merged;
  }, [configs, catalogSkills]);

  const currentUserEmail = session?.user?.email ?? "";

  // Filter configs based on search, category, and view mode
  const filteredConfigs = useMemo(() => {
    return allConfigs.filter((config) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        searchQuery === "" ||
        config.name.toLowerCase().includes(q) ||
        config.description?.toLowerCase().includes(q) ||
        config.category?.toLowerCase().includes(q) ||
        config.metadata?.tags?.some(tag => tag.toLowerCase().includes(q));

      const matchesCategory =
        selectedCategory === "All" || config.category === selectedCategory;

      const matchesViewMode =
        viewMode === "all" ||
        (viewMode === "my-skills" && !config.is_system && config.owner_id === currentUserEmail) ||
        (viewMode === "team" && config.visibility === "team") ||
        (viewMode === "global" && (config.visibility === "global" || config.is_system));

      const matchesSource =
        sourceFilter === "all" || skillCatalogSource(config) === sourceFilter;

      return matchesSearch && matchesCategory && matchesViewMode && matchesSource;
    });
  }, [allConfigs, searchQuery, selectedCategory, viewMode, currentUserEmail, sourceFilter]);

  const skillConfigs = filteredConfigs;

  const categoryPickerOptions = useMemo(() => {
    const merged = new Set<string>(PRESET_CATEGORIES);
    for (const c of allConfigs) {
      const cat = String(c.category ?? "").trim();
      if (cat) merged.add(cat);
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [allConfigs]);

  const filteredCategoryOptions = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categoryPickerOptions;
    return categoryPickerOptions.filter((c) => c.toLowerCase().includes(q));
  }, [categoryPickerOptions, categoryQuery]);

  useEffect(() => {
    if (!categoryPopoverOpen) setCategoryQuery("");
  }, [categoryPopoverOpen]);

  const mySkillsCount = useMemo(() =>
    allConfigs.filter(c => !c.is_system && c.owner_id === currentUserEmail).length,
    [allConfigs, currentUserEmail]
  );

  const isFilteredView = viewMode === "my-skills" || viewMode === "team" || viewMode === "global";

  const handleDelete = (config: AgentSkill, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCatalogOnlySkill(config)) return;
    setDeleteTarget(config);
  };

  const confirmDelete = async () => {
    const config = deleteTarget;
    if (!config) return;
    setDeletingId(config.id);
    try {
      await deleteSkill(config.id);
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete config:", error);
      const msg = error instanceof Error ? error.message : "Failed to delete configuration";
      toast(msg, "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfigClick = (config: AgentSkill) => {
    if (isFlaggedSkill(config)) {
      // Hard stop: a flagged skill must not be runnable from the UI.
      // Leave the card visible so admins can still open the file
      // viewer + re-scan — only the launch path is blocked.
      toast(
        `"${config.name}" was flagged by the security scanner and is disabled. Re-scan after fixing SKILL.md to restore.`,
        "error",
      );
      return;
    }
    setActiveFormConfig(config);
    // Pre-fill parameter values from defaults
    const vars = extractTemplateVars(config);
    const defaults: Record<string, string> = {};
    for (const v of vars) {
      defaults[v.name] = v.defaultValue;
    }
    setParamValues(defaults);
  };

  const handleTrySkill = async () => {
    if (!activeFormConfig) return;
    const vars = extractTemplateVars(activeFormConfig);
    // Check required fields
    const missing = vars.filter(v => v.required && !paramValues[v.name]?.trim());
    if (missing.length > 0) return; // validation errors shown inline

    const skillId = activeFormConfig.id || activeFormConfig.name;
    let message = `Execute skill: ${skillId}\n\nRead and follow the instructions in the SKILL.md file for the "${skillId}" skill.`;
    // Append parameters if any variables have values
    const filledParams = vars.filter(v => paramValues[v.name]?.trim());
    if (filledParams.length > 0) {
      message += "\n\nParameters:";
      for (const v of filledParams) {
        message += `\n- ${v.name}: ${paramValues[v.name].trim()}`;
      }
    }

    const conversationId = await createConversation();
    setPendingMessage(message);
    setActiveFormConfig(null);
    router.push(`/chat/${conversationId}`);
  };

  /**
   * Per-card edit/view/delete affordances.
   * - Hub-crawled skills are read-only: Eye opens the file viewer; trash is
   *   disabled with a tooltip that explains why.
   * - Mongo-backed (custom/built-in) skills get the existing Edit pencil plus
   *   a Files (FolderOpen) button that opens the editable folder viewer.
   */
  const renderRowActions = (config: AgentSkill) => {
    if (isHubSkill(config)) {
      return (
        <>
          <div className="h-4 w-px bg-border/50" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setViewerTarget(config);
            }}
            title="View files (read-only — crawled from GitHub)"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
            disabled
            title="Crawled from GitHub — manage upstream and re-sync the hub to remove."
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      );
    }
    const locked = isLockedBuiltin(config);
    return (
      <>
        <div className="h-4 w-px bg-border/50" />
        {locked ? (
          // Render the Edit button as a *visible disabled* control
          // rather than hiding it — discoverability matters here.
          // Admins arriving with the legacy mental model ("I just
          // edit built-ins") need the tooltip to learn about the
          // Clone path.
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
            disabled
            title="Built-in skill is read-only. Use Clone to edit a copy, or set ALLOW_BUILTIN_SKILL_MUTATION=true."
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
        ) : canEditConfig(config) ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onEditConfig?.(config);
            }}
            title="Edit"
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {!isCatalogOnlySkill(config) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setViewerTarget(config);
            }}
            title={locked ? "Browse files (read-only)" : "Browse files"}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        {canCloneConfig(config) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => handleClone(config, e)}
            disabled={cloningId === config.id}
            title={
              locked
                ? "Clone to an editable copy (built-in is read-only)"
                : "Clone to a new editable copy"
            }
          >
            {cloningId === config.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {locked ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
            disabled
            title="Built-in skill cannot be deleted. Set ALLOW_BUILTIN_SKILL_MUTATION=true to allow."
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : canDeleteConfig(config) ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-400 hover:text-red-500"
            onClick={(e) => handleDelete(config, e)}
            disabled={deletingId === config.id}
            title="Delete"
          >
            {deletingId === config.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
            disabled
            title="Catalog-only entry — remove the MongoDB copy to hide, or use hub settings"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </>
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => loadSkills()}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header + filter panel — z-40 + overflow-visible so category popover stacks above skill cards */}
      <div className="relative z-40 overflow-visible border-b border-border/60 mb-5 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-0 pb-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2.5 rounded-xl gradient-primary-br shadow-md shadow-primary/20 shrink-0">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl font-semibold gradient-text leading-tight">Skills</h1>
                  {!isLoading && (
                    <Badge variant="secondary" className="tabular-nums text-sm font-normal px-2 py-0.5">
                      {skillConfigs.length}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-snug">
                  Catalog skills and templates — repo hubs in{" "}
                  <Link href="/admin?tab=skills" className="text-primary hover:underline">
                    Admin
                  </Link>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0 lg:pt-0.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => router.push("/skills/scan-history")}
                aria-label="Open skill scanner audit log"
                title="Audit log of every skill scanner run"
                className="gap-2 h-9 text-sm px-3 font-medium"
              >
                <ScrollText className="h-4 w-4 opacity-90" strokeWidth={2.25} />
                <span className="hidden md:inline">Scan history</span>
              </Button>
              {/* "Skills API Gateway" launcher — original prominent
                  gradient pill that opens the dedicated Gateway page
                  (`/skills/gateway`). We tried a Browse / Gateway
                  segmented toggle here briefly, but the launcher
                  button reads better in the gallery toolbar and matches
                  the "preview" UX the rest of the catalog uses. */}
              <Button
                type="button"
                size="sm"
                onClick={() => router.push("/skills/gateway")}
                aria-label="Open Skills API Gateway — OpenAPI, auth, and agent integration"
                title="Skills API Gateway: OpenAPI, API keys, and coding-agent setup"
                className={cn(
                  "gap-2 h-9 text-sm px-4 font-medium border border-sky-500/20",
                  "text-sky-50/95 shadow-md shadow-black/25",
                  "bg-gradient-to-r from-slate-800 via-cyan-950/85 to-teal-950",
                  "hover:border-sky-400/30 hover:brightness-[1.04]",
                  "focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 ring-offset-background",
                  "transition-all duration-200",
                )}
              >
                <Waypoints className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2.25} />
                <span className="hidden sm:inline">Skills API Gateway</span>
                <span className="sm:hidden font-semibold">API Gateway</span>
              </Button>
              {isAdmin && (
                <Button
                  type="button"
                  size="sm"
                  onClick={openImportModal}
                  title="Import packaged disk templates into MongoDB as system skills"
                  className={cn(
                    "gap-2 h-9 text-sm px-4 font-medium border border-violet-500/20",
                    "text-violet-50/95 shadow-md shadow-black/25",
                    "bg-gradient-to-r from-slate-800 via-violet-950/90 to-purple-950",
                    "hover:border-violet-400/30 hover:brightness-[1.04]",
                    "focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 ring-offset-background",
                    "transition-all duration-200",
                  )}
                >
                  <PackageCheck className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2.25} />
                  <span className="hidden sm:inline">Import templates</span>
                  <span className="sm:hidden font-semibold">Import</span>
                </Button>
              )}
              <Button
                size="sm"
                onClick={onCreateNew}
                className={cn(
                  "gap-2 h-9 text-sm px-4 font-medium",
                  "border border-primary/35 bg-primary/12 text-primary",
                  "shadow-sm shadow-black/10 hover:bg-primary/18 hover:border-primary/45",
                  "focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 ring-offset-background",
                )}
                aria-label="Skill Builder"
              >
                <Plus className="h-4 w-4 opacity-90" />
                Skill Builder
              </Button>
            </div>
          </div>

          {/* Single-row filter bar.
              Previously this was split across two rows ("Search + Source"
              on top; "Scope + Category" below) which made the two pill
              groups look like duplicate filter widgets and pushed
              Category off-screen at first glance. The new layout
              packs everything onto one wrapping row in a deliberate
              left-to-right reading order:
                Search → Scope (who owns it) → Source (where it lives)
                → Category (what it's about)
              All four controls share the same pill / outline styling
              so they read as a coherent filter set rather than two
              separate concepts.
              On narrow viewports the row wraps naturally; the search
              input keeps `flex-1` so it always claims the leftover
              width when groups wrap. */}
          <div className="rounded-xl border border-border/50 bg-muted/25 p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="relative flex-1 min-w-[12rem]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search name, tag, category…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9 text-sm bg-background/80"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  Scope
                </span>
                <div className="flex items-center rounded-full border border-border/60 bg-background/90 p-0.5 shadow-sm ring-1 ring-border/40">
                  {(["all", "my-skills", "team", "global"] as const).map(mode => {
                    const label =
                      mode === "all" ? "All"
                      : mode === "my-skills" ? `My Skills${mySkillsCount > 0 ? ` (${mySkillsCount})` : ""}`
                      : mode === "team" ? "Team"
                      : "Global";
                    const icon =
                      mode === "my-skills" ? <User className="h-3.5 w-3.5" />
                      : mode === "team" ? <UsersRound className="h-3.5 w-3.5" />
                      : mode === "global" ? <Globe className="h-3.5 w-3.5" />
                      : null;
                    return (
                      <Button
                        key={mode}
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode(mode)}
                        className={cn(
                          "rounded-full text-xs h-7 px-2.5 gap-1 border border-transparent",
                          viewMode === mode
                            ? "bg-muted/80 text-foreground border-primary/25 shadow-sm ring-1 ring-primary/10"
                            : "text-foreground/80 hover:bg-muted/70 hover:border-border/60",
                        )}
                      >
                        {icon}
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  <Filter className="h-3 w-3 shrink-0 text-foreground/55" aria-hidden />
                  Source
                </span>
                <div
                  className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background/90 p-0.5 shadow-sm ring-1 ring-border/40"
                  role="group"
                  aria-label="Filter by skill source"
                >
                  {(
                    [
                      ["all", "All"],
                      ["default", "Built-in"],
                      ["agent_skills", "Custom"],
                      ["hub", "Hub"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSourceFilter(key)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors border border-transparent",
                        sourceFilter === key
                          ? "bg-muted/80 text-foreground border-primary/25 shadow-sm ring-1 ring-primary/10"
                          : "text-foreground/80 hover:bg-muted/70 hover:text-foreground hover:border-border/60",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  Category
                </span>
                <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="Category filter"
                      aria-expanded={categoryPopoverOpen}
                      // Compact inline pill — sized to fit the
                      // single-row filter bar instead of the
                      // previous full-width treatment that consumed
                      // half the screen on its own row.
                      className="h-8 min-w-[10rem] max-w-[16rem] justify-between gap-2 font-normal text-xs bg-background/80 rounded-full"
                    >
                      <span className="truncate text-left">
                        {selectedCategory === "All" ? "All categories" : selectedCategory}
                      </span>
                      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="bottom"
                    align="start"
                    className="w-[min(17rem,calc(100vw-2rem))] p-0 overflow-hidden z-[200] shadow-xl"
                  >
                    <div className="border-b border-border/50 p-2">
                      <Input
                        placeholder="Search categories…"
                        value={categoryQuery}
                        onChange={(e) => setCategoryQuery(e.target.value)}
                        className="h-9 text-sm"
                        autoComplete="off"
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    <ScrollArea className="h-[min(240px,40vh)]">
                      <div className="p-1">
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                            selectedCategory === "All"
                              ? "bg-muted text-foreground"
                              : "hover:bg-muted/70",
                          )}
                          onClick={() => {
                            setSelectedCategory("All");
                            setCategoryPopoverOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "h-4 w-4 shrink-0",
                              selectedCategory === "All" ? "opacity-100" : "opacity-0",
                            )}
                          />
                          All categories
                        </button>
                        {filteredCategoryOptions.length === 0 ? (
                          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                            No matching categories
                          </p>
                        ) : (
                          filteredCategoryOptions.map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                                selectedCategory === cat
                                  ? "bg-muted text-foreground"
                                  : "hover:bg-muted/70",
                              )}
                              onClick={() => {
                                setSelectedCategory(cat);
                                setCategoryPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4 shrink-0",
                                  selectedCategory === cat ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="truncate">{cat}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <CAIPESpinner size="lg" message="Loading skills..." />
        </div>
      )}

      {/* Content */}
      {!isLoading && (
        <div className="relative z-0 flex-1 overflow-y-auto min-h-0">
          {/* Favorites Section */}
          {getFavoriteSkills().length > 0 && searchQuery === "" && selectedCategory === "All" && !isFilteredView && (
            <div className="mb-8 p-4 bg-gradient-to-br from-yellow-500/10 to-amber-500/10 rounded-xl border border-yellow-500/30">
              <div className="flex items-center gap-2 mb-4">
                <Star className="h-5 w-5 text-yellow-500 fill-current" />
                <h2 className="text-lg font-medium">Favorites</h2>
                <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600">{getFavoriteSkills().length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {getFavoriteSkills().map((config, index) => {
                  const Icon = ICON_MAP[config.thumbnail || (config.is_quick_start ? "Zap" : "Workflow")] || Zap;
                  const gradientClass = CATEGORY_COLORS[config.category] || CATEGORY_COLORS["Custom"];

                  return (
                    <motion.div
                      key={`fav-${config.id}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleConfigClick(config)}
                      className="relative flex items-center gap-3 p-4 rounded-xl bg-card border border-border/50 hover:border-yellow-500 hover:shadow-lg transition-all text-left group cursor-pointer"
                    >
                      <div className={cn("p-2 rounded-lg bg-gradient-to-br shrink-0", gradientClass)}>
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate pr-8">{config.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                          <div className="flex shrink-0 items-center gap-2" aria-label="Skill status icons">
                            {shouldShowSkillScanIndicator(config) && (
                              <SkillScanStatusIndicator config={config} onScanComplete={loadSkills} />
                            )}
                            <SupervisorSyncBadge state={skillSyncState(config)} />
                            {isFlaggedSkill(config) && <FlaggedDisabledBadge />}
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {!workflowRunnerEnabled ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                            ) : config.is_quick_start ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{config.tasks.length} steps</Badge>
                            )}
                            <CatalogSourceBadge config={config} />
                            <VisibilityBadge config={config} />
                          </div>
                        </div>
                      </div>

                      {/* Arrow - hidden on hover when buttons appear */}
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:opacity-0 transition-all shrink-0" />

                      {/* Action buttons grouped - bottom-right on hover, replaces arrow */}
                      <div className="absolute bottom-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card/95 backdrop-blur-sm rounded-lg p-0.5 border border-border/30 shadow-sm">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-yellow-500 hover:text-yellow-600"
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(config.id); }}
                          title="Remove from favorites"
                        >
                          <Star className="h-4 w-4 fill-current" />
                        </Button>
                        {renderRowActions(config)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filtered view section — shown for my-skills, team, global */}
          {isFilteredView && filteredConfigs.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                {viewMode === "my-skills" && <User className="h-5 w-5 text-primary" />}
                {viewMode === "team" && <UsersRound className="h-5 w-5 text-blue-500" />}
                {viewMode === "global" && <Globe className="h-5 w-5 text-green-500" />}
                <h2 className="text-lg font-medium">
                  {viewMode === "my-skills" ? "My Skills" : viewMode === "team" ? "Team Skills" : "Global Skills"}
                </h2>
                <Badge variant="secondary">{filteredConfigs.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredConfigs.map((config, index) => {
                  const Icon = ICON_MAP[config.thumbnail || (config.is_quick_start ? "Zap" : "Workflow")] || Zap;
                  const gradientClass = CATEGORY_COLORS[config.category] || CATEGORY_COLORS["Custom"];

                  return (
                    <motion.div
                      key={config.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      whileHover={{ y: -4 }}
                      onClick={() => handleConfigClick(config)}
                      className="group relative cursor-pointer p-4 rounded-xl border border-border/50 bg-card/50 hover:border-primary/30 hover:shadow-lg transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={cn("p-2.5 rounded-xl bg-gradient-to-br", gradientClass)}>
                          <Icon className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
                          <div className="flex shrink-0 items-center gap-2" aria-label="Skill status icons">
                            {shouldShowSkillScanIndicator(config) && (
                              <SkillScanStatusIndicator config={config} onScanComplete={loadSkills} />
                            )}
                            <SupervisorSyncBadge state={skillSyncState(config)} />
                            {isFlaggedSkill(config) && <FlaggedDisabledBadge />}
                          </div>
                          <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
                            <CatalogSourceBadge config={config} />
                            <VisibilityBadge config={config} />
                          </div>
                        </div>
                      </div>
                      <h3 className="font-medium mb-1 group-hover:text-primary transition-colors">{config.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{config.description}</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {config.metadata?.tags?.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-border/50">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {!workflowRunnerEnabled
                            ? <Badge variant="outline" className="text-xs"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                            : config.is_quick_start
                              ? <Badge variant="outline" className="text-xs"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                              : <Badge variant="outline" className="text-xs"><Workflow className="h-2.5 w-2.5 mr-0.5" />{config.tasks.length} steps</Badge>
                          }
                        </div>
                      </div>

                      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card/95 backdrop-blur-sm rounded-lg p-0.5 border border-border/30 shadow-sm">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7",
                            isFavorite(config.id) ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(config.id); }}
                          title={isFavorite(config.id) ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className={cn("h-4 w-4", isFavorite(config.id) && "fill-current")} />
                        </Button>
                        {renderRowActions(config)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filtered view empty state */}
          {isFilteredView && filteredConfigs.length === 0 && searchQuery === "" && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="p-4 rounded-full bg-primary/10">
                {viewMode === "my-skills" && <User className="h-8 w-8 text-primary" />}
                {viewMode === "team" && <UsersRound className="h-8 w-8 text-blue-500" />}
                {viewMode === "global" && <Globe className="h-8 w-8 text-green-500" />}
              </div>
              <div className="text-center">
                <p className="text-lg font-medium mb-1">
                  {viewMode === "my-skills" ? "No skills yet" : viewMode === "team" ? "No team skills" : "No global skills"}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {viewMode === "my-skills"
                    ? "Create your first skill to see it here"
                    : viewMode === "team"
                    ? "Skills shared with your teams will appear here"
                    : "Globally shared skills will appear here"}
                </p>
                {viewMode === "my-skills" && (
                  <Button onClick={onCreateNew} className="gap-2 gradient-primary text-white">
                    <Plus className="h-4 w-4" />
                    Skills Builder
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Skills */}
          {!isFilteredView && skillConfigs.length > 0 && (
            <div className="mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {skillConfigs.map((config, index) => {
                  const Icon = ICON_MAP[config.thumbnail || "Zap"] || Zap;
                  const gradientClass = CATEGORY_COLORS[config.category] || CATEGORY_COLORS["Custom"];

                  return (
                    <motion.div
                      key={config.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      whileHover={{ y: -4 }}
                      onClick={() => handleConfigClick(config)}
                      className="group relative cursor-pointer p-4 rounded-xl border border-border/50 bg-card/50 hover:border-primary/30 hover:shadow-lg transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={cn("p-2.5 rounded-xl bg-gradient-to-br", gradientClass)}>
                          <Icon className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
                          <div className="flex shrink-0 items-center gap-2" aria-label="Skill status icons">
                            {shouldShowSkillScanIndicator(config) && (
                              <SkillScanStatusIndicator config={config} onScanComplete={loadSkills} />
                            )}
                            <SupervisorSyncBadge state={skillSyncState(config)} />
                            {isFlaggedSkill(config) && <FlaggedDisabledBadge />}
                          </div>
                          <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
                            <CatalogSourceBadge config={config} />
                            <VisibilityBadge config={config} />
                          </div>
                        </div>
                      </div>
                      <h3 className="font-medium mb-1 group-hover:text-primary transition-colors">{config.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{config.description}</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {config.metadata?.tags?.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-border/50">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {config.metadata?.expected_agents?.slice(0, 2).map(agent => (
                            <Badge key={agent} variant="outline" className="text-xs">{agent}</Badge>
                          ))}
                        </div>
                      </div>

                      {/* Action buttons grouped together - bottom-right on hover */}
                      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card/95 backdrop-blur-sm rounded-lg p-0.5 border border-border/30 shadow-sm">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7",
                            isFavorite(config.id) ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(config.id); }}
                          title={isFavorite(config.id) ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className={cn("h-4 w-4", isFavorite(config.id) && "fill-current")} />
                        </Button>
                        {renderRowActions(config)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State (generic — for search with no results) */}
          {filteredConfigs.length === 0 && !(isFilteredView && searchQuery === "") && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Sparkles className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground text-center max-w-md">
                No skills match your search or filters. Try another source filter, or add repo-backed skills via{" "}
                <Link href="/admin?tab=skills" className="text-primary font-medium hover:underline">
                  Admin → Skill Hubs
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      )}

      {/* Skill Run Modal */}
      <AnimatePresence>
        {activeFormConfig && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setActiveFormConfig(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl mx-4 bg-card border rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="h-1.5 w-full gradient-primary shrink-0" />
              <div className="p-6 overflow-y-auto flex-1">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl gradient-primary-br shadow-lg">
                      <Zap className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{activeFormConfig.name}</h2>
                      {activeFormConfig.description && (
                        <p className="text-sm text-muted-foreground">{activeFormConfig.description}</p>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setActiveFormConfig(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Description preview */}
                {activeFormConfig.description && (
                  <p className="text-sm text-muted-foreground">{activeFormConfig.description}</p>
                )}
                {/* Tags */}
                {activeFormConfig.metadata?.tags && Array.isArray(activeFormConfig.metadata.tags) && (activeFormConfig.metadata.tags as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(activeFormConfig.metadata.tags as string[]).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                )}

                {/* Template variable parameters */}
                {(() => {
                  const vars = extractTemplateVars(activeFormConfig);
                  if (vars.length === 0) return null;
                  return (
                    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Parameters</p>
                      {vars.map((v) => (
                        <div key={v.name}>
                          <label className="text-sm font-medium text-foreground">
                            {v.label}
                            {v.required && <span className="text-destructive ml-0.5">*</span>}
                          </label>
                          <Input
                            type="text"
                            value={paramValues[v.name] ?? v.defaultValue}
                            onChange={(e) => setParamValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                            placeholder={v.defaultValue ? `Default: ${v.defaultValue}` : `Enter ${v.label.toLowerCase()}`}
                            className={cn(
                              "mt-1 h-9 text-sm",
                              v.required && !paramValues[v.name]?.trim() && paramValues[v.name] !== undefined && paramValues[v.name] !== v.defaultValue
                                ? "border-destructive"
                                : "",
                            )}
                          />
                          {v.defaultValue && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">Default: {v.defaultValue}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 p-4 border-t bg-muted/30 shrink-0">
                <div>
                  {isHubSkill(activeFormConfig) ? (
                    /*
                     * Crawled-from-GitHub skills aren't editable in-place; the
                     * footer offers a read-only viewer instead so users can
                     * still inspect SKILL.md and ancillary files.
                     */
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const target = activeFormConfig;
                        setActiveFormConfig(null);
                        setViewerTarget(target);
                      }}
                      title="Crawled from GitHub — read-only"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" /> View files
                    </Button>
                  ) : (
                    onEditConfig && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveFormConfig(null);
                            onEditConfig(activeFormConfig);
                          }}
                        >
                          <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const target = activeFormConfig;
                            setActiveFormConfig(null);
                            setViewerTarget(target);
                          }}
                          title="Browse skill files"
                        >
                          <FolderOpen className="h-3.5 w-3.5 mr-1" /> Files
                        </Button>
                      </div>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setActiveFormConfig(null)}>Cancel</Button>
                  {!supervisorSynced && !supervisorLoading && (
                    <span title="Skills must be synced with the supervisor first"><AlertTriangle className="h-4 w-4 text-amber-500" /></span>
                  )}
                  <Button
                    onClick={handleTrySkill}
                    className={supervisorSynced ? "gradient-primary text-white gap-2" : "gap-2"}
                    variant={supervisorSynced ? "default" : "secondary"}
                    disabled={!supervisorSynced || supervisorLoading || extractTemplateVars(activeFormConfig).some(v => v.required && !paramValues[v.name]?.trim())}
                  >
                    {supervisorLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                    Try Skill
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {viewerTarget &&
        (() => {
          const ref = parseHubId(viewerTarget);
          const meta = (viewerTarget.metadata ?? {}) as {
            upstream_url?: string;
            catalog_source?: string;
            catalog_source_id?: string | null;
          };
          // `metadata.upstream_url` (when present) lets us deep-link to the
          // crawled folder on GitHub/GitLab; otherwise we just show the name.
          const upstream = meta.upstream_url;
          // For unified-catalog rows the gallery prefixes the id with
          // "catalog-"; the real `agent_skills._id` (when this row is backed by
          // Mongo) lives in `metadata.catalog_source_id`. Fall back to the
          // stripped prefix for non-catalog (direct configs) skills.
          const configId =
            meta.catalog_source === "agent_skills" && meta.catalog_source_id
              ? meta.catalog_source_id
              : viewerTarget.id.startsWith("catalog-")
                ? viewerTarget.id.replace(/^catalog-/, "")
                : viewerTarget.id;
          const adapter = ref
            ? makeHubFolderAdapter({
                hubId: ref.hubId,
                skillId: ref.skillId,
                label: viewerTarget.name,
                externalUrl: upstream,
              })
            : meta.catalog_source === "default"
              ? makeStaticFolderAdapter({
                  label: viewerTarget.name,
                  skillContent: viewerTarget.skill_content ?? "",
                })
              : makeConfigFolderAdapter({
                  configId,
                  label: viewerTarget.name,
                  editable: canEditConfig(viewerTarget),
                });
          return (
            <SkillFolderViewer
              open={viewerTarget !== null}
              onOpenChange={(open) => {
                if (!open) setViewerTarget(null);
              }}
              title={viewerTarget.name}
              subtitle={
                ref
                  ? upstream
                    ? `Crawled from ${upstream}`
                    : "Crawled from upstream repository"
                  : viewerTarget.description
              }
              adapter={adapter}
              editHref={
                // Hub-backed and user-owned skills both have a stable
                // workspace route; route the "Open in editor" link
                // there so the dialog can stay strictly read-only.
                ref
                  ? undefined
                  : `/skills/workspace/${encodeURIComponent(viewerTarget.id)}`
              }
            />
          );
        })()}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.is_system ? "Remove built-in template" : "Delete skill"}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {deleteTarget?.is_system ? (
                <>
                  Remove built-in template{" "}
                  <span className="font-medium text-foreground">&ldquo;{deleteTarget?.name}&rdquo;</span>{" "}
                  from this environment? You can restore it later via{" "}
                  <span className="font-medium text-foreground">Import templates</span> or workspace seed.
                </>
              ) : (
                <>
                  Permanently delete{" "}
                  <span className="font-medium text-foreground">&ldquo;{deleteTarget?.name}&rdquo;</span>?
                  This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingId !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deletingId !== null}
            >
              {deletingId !== null && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {deleteTarget?.is_system ? "Remove" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import packaged templates</DialogTitle>
            <DialogDescription>
              Copies skills from the server&apos;s packaged template directory into shared storage as system skills.
              Already-imported templates are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2">
            {importTemplatesLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading templates…
              </div>
            ) : diskTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No packaged templates found. Set <code className="text-xs bg-muted px-1 rounded">SKILLS_DIR</code> or
                ensure chart data skills exist.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={selectAllImport}>
                    Select all
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearImportSelection}>
                    Clear
                  </Button>
                </div>
                <ul className="space-y-2 border rounded-md p-2 max-h-64 overflow-y-auto">
                  {diskTemplates.map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-border"
                        checked={selectedImportIds.has(t.id)}
                        onChange={() => toggleImportId(t.id)}
                        id={`import-tpl-${t.id}`}
                      />
                      <label htmlFor={`import-tpl-${t.id}`} className="cursor-pointer leading-snug">
                        <span className="font-medium">{t.label}</span>
                        <span className="block text-xs text-muted-foreground font-mono">{t.id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setImportModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitTemplateImport()}
              disabled={importSubmitting || diskTemplates.length === 0}
            >
              {importSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Import selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

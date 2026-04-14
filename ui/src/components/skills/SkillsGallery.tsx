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
  Trash2,
  ChevronRight,
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
  History,
  Lock,
  Globe,
  UsersRound,
  User,
  HelpCircle,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import { useAgentSkillsStore } from "@/store/agent-skills-store";
import { useChatStore } from "@/store/chat-store";
import { useAdminRole } from "@/hooks/use-admin-role";
import type { AgentSkill, AgentSkillCategory, WorkflowDifficulty } from "@/types/agent-skill";

interface SkillsGalleryProps {
  onSelectConfig?: (config: AgentSkill, fromHistory?: boolean) => void;
  onRunQuickStart?: (prompt: string, configName?: string) => void;
  onEditConfig?: (config: AgentSkill) => void;
  onCreateNew?: () => void;
}

const VISIBILITY_BADGE_CONFIG: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  system: { icon: Shield, label: "System", className: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  team: { icon: UsersRound, label: "Team", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  global: { icon: Globe, label: "Global", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  private: { icon: Lock, label: "Private", className: "bg-muted text-muted-foreground border-border/50" },
};

function VisibilityBadge({ config }: { config: AgentSkill }) {
  const key = config.is_system ? "system" : (config.visibility || "private");
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

function SyncDot({ synced, loading }: { synced: boolean; loading: boolean }) {
  if (loading) {
    return <span className="h-2 w-2 rounded-full bg-gray-400 animate-pulse" title="Checking sync status..." />;
  }
  return (
    <span
      className={cn("h-2 w-2 rounded-full", synced ? "bg-green-500" : "bg-gray-400")}
      title={synced ? "Synced with supervisor" : "Not synced with supervisor"}
    />
  );
}

type CatalogSource = "default" | "agent_skills" | "hub";

function skillCatalogSource(config: AgentSkill): CatalogSource {
  const raw = (config.metadata as { catalog_source?: string })?.catalog_source;
  if (raw === "hub" || raw === "agent_skills" || raw === "default") return raw;
  if (config.id.startsWith("catalog-")) return "default";
  return "agent_skills";
}

const SOURCE_LABELS: Record<CatalogSource, string> = {
  default: "Built-in",
  agent_skills: "Custom",
  hub: "Skill hub",
};

function CatalogSourceBadge({ config }: { config: AgentSkill }) {
  const src = skillCatalogSource(config);
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
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

const ALL_CATEGORIES: string[] = [
  "All",
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

const getDifficultyColor = (difficulty?: WorkflowDifficulty) => {
  switch (difficulty) {
    case "beginner":
      return "bg-green-500/20 text-green-400";
    case "intermediate":
      return "bg-yellow-500/20 text-yellow-400";
    case "advanced":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

export function SkillsGallery({
  onSelectConfig,
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

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "workflows" | "my-skills" | "team" | "global">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | CatalogSource>("all");

  // API help dialog state
  const [showApiHelp, setShowApiHelp] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  // API token generation state
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenDurationDays, setTokenDurationDays] = useState(90);

  // Supervisor sync status — gates "Try Skill" button
  const [supervisorSynced, setSupervisorSynced] = useState(false);
  const [supervisorLoading, setSupervisorLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills/supervisor-status", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setSupervisorSynced(data?.mas_registered === true && (data?.skills_loaded_count ?? 0) > 0);
      })
      .catch(() => setSupervisorSynced(false))
      .finally(() => setSupervisorLoading(false));
  }, []);

  const closeApiHelp = useCallback(() => {
    setShowApiHelp(false);
    setGeneratedToken(null);
    setCopiedToken(false);
    setTokenError(null);
    setIsGeneratingToken(false);
    setTokenDurationDays(90);
  }, []);

  const handleGenerateToken = useCallback(async () => {
    setIsGeneratingToken(true);
    setTokenError(null);
    setGeneratedToken(null);
    setCopiedToken(false);
    try {
      const res = await fetch("/api/skills/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expires_in_days: tokenDurationDays }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to generate token (${res.status})`);
      }
      const data = await res.json();
      setGeneratedToken(data.token);
    } catch (err: any) {
      setTokenError(err.message || "Failed to generate token");
    } finally {
      setIsGeneratingToken(false);
    }
  }, [tokenDurationDays]);

  // Skill run modal state
  const [activeFormConfig, setActiveFormConfig] = useState<AgentSkill | null>(null);

  // Check if user can edit a config (admins can edit system configs)
  const canEditConfig = (config: AgentSkill) => {
    if (config.is_system) return isAdmin;
    return true;
  };

  // Check if user can delete a config (system configs are never deletable)
  const canDeleteConfig = (config: AgentSkill) => {
    return !config.is_system;
  };

  // Catalog skills from GET /api/skills (unified source of truth)
  const [catalogSkills, setCatalogSkills] = useState<AgentSkill[]>([]);

  // Load configs and catalog skills on mount
  useEffect(() => {
    loadSkills();

    // Unified catalog: default, agent_skills, and hub entries (FR-021)
    fetch("/api/skills", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.skills) return;
        const mapped: AgentSkill[] = data.skills.map(
          (s: {
            id: string;
            name: string;
            source: string;
            description?: string;
            metadata?: Record<string, unknown>;
            visibility?: string;
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
            metadata: {
              tags: (s.metadata?.tags as string[]) || [],
              catalog_source: s.source,
              catalog_visibility: s.visibility,
            },
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
        (viewMode === "workflows" && !config.is_quick_start) ||
        (viewMode === "my-skills" && !config.is_system && config.owner_id === currentUserEmail) ||
        (viewMode === "team" && config.visibility === "team") ||
        (viewMode === "global" && (config.visibility === "global" || config.is_system));

      const matchesSource =
        sourceFilter === "all" || skillCatalogSource(config) === sourceFilter;

      return matchesSearch && matchesCategory && matchesViewMode && matchesSource;
    });
  }, [allConfigs, searchQuery, selectedCategory, viewMode, currentUserEmail, sourceFilter]);

  const workflowConfigs = filteredConfigs.filter(c => !c.is_quick_start);
  const skillConfigs = filteredConfigs;

  const mySkillsCount = useMemo(() =>
    allConfigs.filter(c => !c.is_system && c.owner_id === currentUserEmail).length,
    [allConfigs, currentUserEmail]
  );

  const isFilteredView = viewMode === "my-skills" || viewMode === "team" || viewMode === "global";

  const handleDelete = async (config: AgentSkill, e: React.MouseEvent) => {
    e.stopPropagation();

    if (config.is_system) return;

    if (!confirm(`Are you sure you want to delete "${config.name}"?`)) return;

    setDeletingId(config.id);
    try {
      await deleteSkill(config.id);
    } catch (error: any) {
      console.error("Failed to delete config:", error);
      alert(error.message || "Failed to delete configuration");
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfigClick = (config: AgentSkill) => {
    // Open the "Try Skill" modal for any skill
    setActiveFormConfig(config);
  };

  const handleTrySkill = () => {
    if (!activeFormConfig) return;
    const conversationId = createConversation();
    setPendingMessage(activeFormConfig.name);
    setActiveFormConfig(null);
    router.push(`/chat/${conversationId}`);
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
      {/* Header */}
      <div className="relative overflow-hidden border-b border-border mb-6 -mx-6 -mt-6 px-6 pt-6 pb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl gradient-primary-br shadow-lg shadow-primary/30">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold gradient-text">Skills</h1>
                <p className="text-sm text-muted-foreground">
                  Quick-start templates and multi-step workflows
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Add repo-backed skills in{" "}
                  <Link href="/admin" className="text-primary font-medium hover:underline">
                    Admin → Skill Hubs
                  </Link>
                  . Catalog sources: <strong>built-in</strong>, <strong>custom</strong>,{" "}
                  <strong>skill hub</strong> (FR-021).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowApiHelp(true)}
                className="gap-1.5"
                title="How to access Skills via API"
              >
                <HelpCircle className="h-4 w-4" />
                API
              </Button>
              <Button size="sm" onClick={onCreateNew} className="gap-2 gradient-primary text-white">
                <Plus className="h-4 w-4" />
                Skills Builder
              </Button>
            </div>
          </div>

            <div className="relative max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by name, tag, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-12 text-base bg-card/80 backdrop-blur-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-xs text-muted-foreground mr-1">Source:</span>
            {(
              [
                ["all", "All sources"],
                ["default", "Built-in"],
                ["agent_skills", "Custom"],
                ["hub", "Skill hub"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant={sourceFilter === key ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSourceFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* View Mode & Categories */}
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center bg-muted/50 rounded-full p-1">
              {(["all", "my-skills", "team", "global", ...(workflowRunnerEnabled ? ["workflows" as const] : [])] as const).map(mode => {
                const label =
                  mode === "all" ? "All"
                  : mode === "my-skills" ? `My Skills${mySkillsCount > 0 ? ` (${mySkillsCount})` : ""}`
                  : mode === "team" ? "Team"
                  : mode === "global" ? "Global"
                  : "Multi-Step";
                const icon =
                  mode === "my-skills" ? <User className="h-3 w-3" />
                  : mode === "team" ? <UsersRound className="h-3 w-3" />
                  : mode === "global" ? <Globe className="h-3 w-3" />
                  : null;
                return (
                  <Button
                    key={mode}
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "rounded-full text-xs gap-1",
                      viewMode === mode && "bg-primary text-primary-foreground"
                    )}
                  >
                    {icon}
                    {label}
                  </Button>
                );
              })}
              {/* History button - only shown when workflow runner is enabled */}
              {workflowRunnerEnabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/skills/history')}
                  className="rounded-full text-xs gap-1"
                >
                  <History className="h-3 w-3" />
                  History
                </Button>
              )}
            </div>

            <div className="flex gap-2 flex-wrap">
              {ALL_CATEGORIES.map(cat => (
                <Button
                  key={cat}
                  variant={selectedCategory === cat ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedCategory(cat)}
                  className={cn("rounded-full text-xs", selectedCategory === cat && "bg-primary")}
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <CAIPESpinner size="lg" message="Loading workflows..." />
        </div>
      )}

      {/* Content */}
      {!isLoading && (
        <div className="flex-1 overflow-y-auto">
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
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                          <CatalogSourceBadge config={config} />
                          <VisibilityBadge config={config} />
                          <SyncDot synced={supervisorSynced} loading={supervisorLoading} />
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
                        {canEditConfig(config) && (
                          <>
                            <div className="h-4 w-px bg-border/50" />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => { e.stopPropagation(); onEditConfig?.(config); }}
                              title="Edit"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {canDeleteConfig(config) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-400 hover:text-red-500"
                            onClick={(e) => handleDelete(config, e)}
                            disabled={deletingId === config.id}
                            title="Delete"
                          >
                            {deletingId === config.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
                            disabled
                            title="Built-in skills cannot be deleted"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
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
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          <CatalogSourceBadge config={config} />
                          <VisibilityBadge config={config} />
                          <Badge variant="outline" className={cn("text-xs", getDifficultyColor(config.difficulty))}>
                            {config.difficulty || "beginner"}
                          </Badge>
                          <SyncDot synced={supervisorSynced} loading={supervisorLoading} />
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
                          <Badge variant="outline" className="text-xs"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
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
                        {canEditConfig(config) && (
                          <>
                            <div className="h-4 w-px bg-border/50" />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEditConfig?.(config); }} title="Edit">
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {canDeleteConfig(config) ? (
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-500"
                            onClick={(e) => handleDelete(config, e)} disabled={deletingId === config.id} title="Delete"
                          >
                            {deletingId === config.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
                            disabled title="Built-in skills cannot be deleted"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
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
          {viewMode !== "workflows" && !isFilteredView && skillConfigs.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-medium">Skills</h2>
                <Badge variant="secondary">{skillConfigs.length}</Badge>
              </div>
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
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          <CatalogSourceBadge config={config} />
                          <VisibilityBadge config={config} />
                          <Badge variant="outline" className={cn("text-xs", getDifficultyColor(config.difficulty))}>
                            {config.difficulty || "beginner"}
                          </Badge>
                          <SyncDot synced={supervisorSynced} loading={supervisorLoading} />
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
                        {canEditConfig(config) && (
                          <>
                            <div className="h-4 w-px bg-border/50" />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => { e.stopPropagation(); onEditConfig?.(config); }}
                              title="Edit template"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {canDeleteConfig(config) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-400 hover:text-red-500"
                            onClick={(e) => handleDelete(config, e)}
                            disabled={deletingId === config.id}
                            title="Delete template"
                          >
                            {deletingId === config.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/40 cursor-not-allowed"
                            disabled
                            title="Built-in skills cannot be deleted"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Multi-Step Workflows — only shown when workflow runner is enabled */}
          {workflowRunnerEnabled && !isFilteredView && workflowConfigs.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Workflow className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-medium">Multi-Step Workflows</h2>
                <Badge variant="secondary">{workflowConfigs.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workflowConfigs.map((config, index) => {
                  const Icon = ICON_MAP[config.thumbnail || "Workflow"] || Workflow;
                  const gradientClass = CATEGORY_COLORS[config.category] || CATEGORY_COLORS["Custom"];

                  return (
                    <motion.div
                      key={config.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="group relative p-4 rounded-xl border border-border/50 bg-card/50 hover:border-primary/30 hover:shadow-lg transition-all cursor-pointer"
                      onClick={() => handleConfigClick(config)}
                    >
                      <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center mb-3", gradientClass)}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <h3 className="font-medium mb-1 pr-16">{config.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{config.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>Skill</span>
                        <CatalogSourceBadge config={config} />
                        <VisibilityBadge config={config} />
                        <SyncDot synced={supervisorSynced} loading={supervisorLoading} />
                      </div>

                      {/* Action buttons grouped together - bottom-right on hover */}
                      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card/95 backdrop-blur-sm rounded-lg p-0.5 border border-border/30 shadow-sm">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-8 w-8",
                            isFavorite(config.id) ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(config.id); }}
                          title={isFavorite(config.id) ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className={cn("h-4 w-4", isFavorite(config.id) && "fill-current")} />
                        </Button>
                        <div className="h-5 w-px bg-border/50" />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleConfigClick(config); }} title="Try Skill">
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        {canEditConfig(config) && (
                          <>
                            <div className="h-5 w-px bg-border/50" />
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onEditConfig?.(config); }}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {canDeleteConfig(config) ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-500" onClick={(e) => handleDelete(config, e)} disabled={deletingId === config.id}>
                            {deletingId === config.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground/40 cursor-not-allowed" disabled title="Built-in skills cannot be deleted">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
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
                <Link href="/admin" className="text-primary font-medium hover:underline">
                  Admin → Skill Hubs
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      )}

      {/* API Help Modal */}
      <AnimatePresence>
        {showApiHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={closeApiHelp}
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
                      <Terminal className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">Skills API Access</h2>
                      <p className="text-sm text-muted-foreground">
                        Retrieve skills from external clients like Claude Code, Cursor, or any HTTP client
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setShowApiHelp(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* API Endpoint */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">API Endpoint</h3>
                    <div className="px-4 py-3 rounded-lg bg-muted/50 border border-border/50 font-mono text-sm">
                      GET /api/skills
                    </div>
                  </div>

                  {/* Query Parameters */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Query Parameters</h3>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">q</code> — Search by name or description</p>
                      <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">source</code> — Filter: <code className="bg-muted px-1 py-0.5 rounded text-xs">default</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">agent_skills</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">hub</code></p>
                      <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">tags</code> — Comma-separated tag filter</p>
                      <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">include_content</code> — Include full SKILL.md content (<code className="bg-muted px-1 py-0.5 rounded text-xs">true</code>/<code className="bg-muted px-1 py-0.5 rounded text-xs">false</code>)</p>
                      <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">visibility</code> — Optional: <code className="bg-muted px-1 py-0.5 rounded text-xs">global</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">team</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">personal</code></p>
                      <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">page</code> / <code className="bg-muted px-1.5 py-0.5 rounded text-xs">page_size</code> — Pagination (1–100 per page)</p>
                    </div>
                  </div>

                  {/* Generate API Key */}
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 mb-3">
                      <Key className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Generate API Key</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Generate a personal API key for programmatic access to the Skills API from CLI tools, scripts, or AI assistants.
                    </p>

                    {!generatedToken && (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground whitespace-nowrap">Expires in:</label>
                          <select
                            value={tokenDurationDays}
                            onChange={(e) => setTokenDurationDays(Number(e.target.value))}
                            className="h-8 px-2 text-xs rounded-md border border-input bg-background"
                          >
                            <option value={30}>30 days</option>
                            <option value={60}>60 days</option>
                            <option value={90}>90 days</option>
                          </select>
                        </div>
                        <Button
                          size="sm"
                          onClick={handleGenerateToken}
                          disabled={isGeneratingToken}
                          className="gap-1.5"
                        >
                          {isGeneratingToken ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Key className="h-3 w-3" />
                          )}
                          {isGeneratingToken ? "Generating..." : "Generate API Key"}
                        </Button>
                      </div>
                    )}

                    {tokenError && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-red-500">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {tokenError}
                      </div>
                    )}

                    {generatedToken && (
                      <div className="mt-3 space-y-3">
                        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Copy this token now — it won&apos;t be shown again.
                          </p>
                        </div>
                        <div className="relative">
                          <pre className="p-3 pr-12 rounded-lg bg-[#1e1e2e] border border-border/30 text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all">
                            {generatedToken}
                          </pre>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-7 w-7"
                            onClick={() => {
                              navigator.clipboard.writeText(generatedToken);
                              setCopiedToken(true);
                              setTimeout(() => setCopiedToken(false), 2000);
                            }}
                          >
                            {copiedToken ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* curl Example */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold">Example Request</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          const token = generatedToken || (session as any)?.accessToken || "YOUR_API_TOKEN";
                          const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-instance.example.com";
                          const curl = `curl -s "${baseUrl}/api/skills" \\\n  -H "Authorization: Bearer ${token}" | jq .`;
                          navigator.clipboard.writeText(curl);
                          setCopiedCurl(true);
                          setTimeout(() => setCopiedCurl(false), 2000);
                        }}
                      >
                        {copiedCurl ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        {copiedCurl ? "Copied!" : "Copy"}
                      </Button>
                    </div>
                    <div className="rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e]">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-[#181825]">
                        <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide">bash</span>
                      </div>
                      <pre className="p-4 text-[13px] leading-relaxed font-mono text-zinc-300 overflow-x-auto">
{`curl -s "${typeof window !== "undefined" ? window.location.origin : "https://your-instance.example.com"}/api/skills" \\
  -H "Authorization: Bearer ${generatedToken ? generatedToken.slice(0, 20) + "..." : (session as any)?.accessToken ? (session as any).accessToken.slice(0, 20) + "..." : "$CAIPE_TOKEN"}" | jq .`}
                      </pre>
                    </div>
                  </div>

                  {/* Token Warning */}
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                    <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-500">Do not share your API token</p>
                      <p className="text-xs text-red-400/80 mt-1">
                        Your API token is scoped to your identity and grants access to the Skills API.
                        Never share it in public repositories, Slack messages, screenshots, or documentation.
                        Treat it like a password.
                      </p>
                    </div>
                  </div>

                  {/* Usage with Claude Code / Cursor */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Using with Claude Code or Cursor</h3>
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        You can use the Skills API to list available skills from any client.
                        Pass the skill name to your AI assistant as context:
                      </p>
                      <div className="rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e]">
                        <div className="flex items-center px-4 py-2 border-b border-border/20 bg-[#181825]">
                          <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide">bash</span>
                        </div>
                        <pre className="p-4 text-[13px] leading-relaxed font-mono text-zinc-300 overflow-x-auto">
{`# List all skills
curl -s "${typeof window !== "undefined" ? window.location.origin : "https://your-instance.example.com"}/api/skills" \\
  -H "Authorization: Bearer $CAIPE_TOKEN" | jq '.skills[].name'

# Get a specific skill with full content
curl -s "${typeof window !== "undefined" ? window.location.origin : "https://your-instance.example.com"}/api/skills?q=aws-cost&include_content=true" \\
  -H "Authorization: Bearer $CAIPE_TOKEN" | jq .`}
                        </pre>
                      </div>
                      <p className="text-xs text-muted-foreground/80 mt-2">
                        Store your token in an environment variable (<code className="bg-muted px-1 py-0.5 rounded text-xs">CAIPE_TOKEN</code>) instead of
                        hardcoding it. This makes it easy to use across tools without exposing the value.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 p-4 border-t bg-muted/30 shrink-0">
                <Button variant="ghost" onClick={() => setShowApiHelp(false)}>Close</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl gradient-primary-br shadow-lg">
                      {(() => { const I = ICON_MAP[activeFormConfig.thumbnail || "Zap"] || Zap; return <I className="h-5 w-5 text-white" />; })()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{activeFormConfig.name}</h2>
                      {activeFormConfig.category && (
                        <span className="text-xs text-muted-foreground">{activeFormConfig.category}</span>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setActiveFormConfig(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Description */}
                {activeFormConfig.description && (
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{activeFormConfig.description}</p>
                )}

                {/* Tags */}
                {activeFormConfig.metadata?.tags && activeFormConfig.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {activeFormConfig.metadata.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                )}

                {/* Badges row */}
                <div className="flex flex-wrap items-center gap-2">
                  <CatalogSourceBadge config={activeFormConfig} />
                  <VisibilityBadge config={activeFormConfig} />
                  {activeFormConfig.difficulty && (
                    <Badge variant="outline" className={cn("text-xs", getDifficultyColor(activeFormConfig.difficulty))}>
                      {activeFormConfig.difficulty}
                    </Badge>
                  )}
                  {activeFormConfig.metadata?.expected_agents?.slice(0, 3).map(agent => (
                    <Badge key={agent} variant="outline" className="text-xs">{agent}</Badge>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 p-4 border-t bg-muted/30 shrink-0">
                <div>
                  {onEditConfig && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => { setActiveFormConfig(null); onEditConfig(activeFormConfig); }}
                    >
                      <Edit className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="ghost" onClick={() => setActiveFormConfig(null)}>Cancel</Button>
                  <div className="flex items-center gap-1.5">
                    {!supervisorSynced && !supervisorLoading && (
                      <span title="Skills are not synced with the supervisor. Rebuild from Admin → Supervisor Skills to enable.">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                      </span>
                    )}
                    <Button
                      onClick={handleTrySkill}
                      className={cn(
                        "gap-2",
                        supervisorSynced && !supervisorLoading
                          ? "gradient-primary text-white"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                      )}
                      disabled={!supervisorSynced || supervisorLoading}
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
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

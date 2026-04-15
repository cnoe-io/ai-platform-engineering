"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Workflow,
  GitBranch,
  Cloud,
  Rocket,
  Key,
  Users,
  Settings,
  Loader2,
  AlertCircle,
  Edit,
  Trash2,
  Upload,
  Sparkles,
  Zap,
  Server,
  Bug,
  BarChart,
  Shield,
  Database,
  Clock,
  AlertTriangle,
  CheckCircle,
  GitPullRequest,
  ArrowRight,
  X,
  MessageSquare,
  Star,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";
import { useAgentSkillsStore } from "@/store/agent-skills-store";
import { useChatStore } from "@/store/chat-store";
import { useAdminRole } from "@/hooks/use-admin-role";
import type { AgentSkill, WorkflowDifficulty } from "@/types/agent-skill";

interface AgentBuilderGalleryProps {
  onEditConfig?: (config: AgentSkill) => void;
  onCreateNew?: () => void;
  onImportYaml?: () => void;
}

// Icon mapping for thumbnails
const ICON_MAP: Record<string, React.ElementType> = {
  GitBranch,
  GitPullRequest,
  Server,
  Bug,
  BarChart,
  Shield,
  Cloud,
  Rocket,
  Zap,
  Database,
  Settings,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  Key,
  Workflow,
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

export function AgentBuilderGallery({
  onEditConfig,
  onCreateNew,
  onImportYaml,
}: AgentBuilderGalleryProps) {
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
  const router = useRouter();
  const { createConversation, setPendingMessage } = useChatStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "quick-start" | "workflows">("all");

  // Skill run modal state
  const [activeFormConfig, setActiveFormConfig] = useState<AgentSkill | null>(null);

  // Supervisor sync state
  const [supervisorSynced, setSupervisorSynced] = useState(false);
  const [supervisorLoading, setSupervisorLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills/supervisor-status")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setSupervisorSynced(data?.mas_registered === true && (data?.skills_loaded_count ?? 0) > 0);
      })
      .catch(() => setSupervisorSynced(false))
      .finally(() => setSupervisorLoading(false));
  }, []);

  // Check if user can edit/delete a config
  const canModifyConfig = (config: AgentSkill) => {
    // Admins can modify system configs
    if (config.is_system) {
      console.log(`[canModifyConfig] System config ${config.id}, isAdmin: ${isAdmin}`);
      return isAdmin;
    }
    // Users can modify their own configs
    return true;
  };

  // Load configs on mount
  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // Use configs directly from store (MongoDB configs + fallback to built-in)
  // Deduplicate by id to prevent duplicate key errors
  const allConfigs = useMemo(() => {
    const seen = new Set<string>();
    return configs.filter(config => {
      if (seen.has(config.id)) {
        return false;
      }
      seen.add(config.id);
      return true;
    });
  }, [configs]);

  // Filter configs based on search, category, and view mode
  const filteredConfigs = useMemo(() => {
    return allConfigs.filter((config) => {
      const matchesSearch =
        searchQuery === "" ||
        config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        config.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        config.metadata?.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCategory =
        selectedCategory === "All" || config.category === selectedCategory;

      const matchesViewMode =
        viewMode === "all" ||
        (viewMode === "quick-start" && config.is_quick_start) ||
        (viewMode === "workflows" && !config.is_quick_start);

      return matchesSearch && matchesCategory && matchesViewMode;
    });
  }, [allConfigs, searchQuery, selectedCategory, viewMode]);

  // Separate quick-start and multi-step workflows
  const quickStartConfigs = filteredConfigs.filter(c => c.is_quick_start);
  const workflowConfigs = filteredConfigs.filter(c => !c.is_quick_start);

  // Featured quick-starts (shown in a separate section)
  const featuredIds = ["qs-deploy-status", "qs-incident-analysis", "qs-release-readiness"];
  const featuredConfigs = quickStartConfigs.filter(c => featuredIds.includes(c.id));

  // Non-featured quick-starts (exclude featured ones to avoid duplicate keys)
  const nonFeaturedQuickStartConfigs = quickStartConfigs.filter(c => !featuredIds.includes(c.id));

  const handleDelete = async (config: AgentSkill, e: React.MouseEvent) => {
    e.stopPropagation();

    // Confirm deletion
    const confirmMessage = config.is_system
      ? `Are you sure you want to delete the system template "${config.name}"? This action requires admin privileges.`
      : `Are you sure you want to delete "${config.name}"?`;

    if (!confirm(confirmMessage)) return;

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
    setActiveFormConfig(config);
  };

  const handleTrySkill = () => {
    if (!activeFormConfig) return;
    const conversationId = createConversation();
    const skillId = activeFormConfig.id || activeFormConfig.name;
    setPendingMessage(`Execute skill: ${skillId}\n\nRead and follow the instructions in the SKILL.md file for the "${skillId}" skill.`);
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
                <h1 className="text-2xl font-bold gradient-text">Agentic Workflows</h1>
                <p className="text-sm text-muted-foreground">
                  Quick-start templates and multi-step agent workflows
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onImportYaml} className="gap-2">
                <Upload className="h-4 w-4" />
                Import YAML
              </Button>
              <Button size="sm" onClick={onCreateNew} className="gap-2 gradient-primary text-white">
                <Plus className="h-4 w-4" />
                Agentic Workflow Builder
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

          {/* View Mode & Categories */}
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center bg-muted/50 rounded-full p-1">
              {(["all", "quick-start", "workflows"] as const).map(mode => (
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
                  {mode === "all" ? "All" : mode === "quick-start" ? "Quick Start" : "Multi-Step"}
                </Button>
              ))}
              {/* History button - navigates to dedicated page */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/agent-builder/history')}
                className="rounded-full text-xs gap-1"
              >
                <History className="h-3 w-3" />
                History
              </Button>
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
          {getFavoriteSkills().length > 0 && searchQuery === "" && selectedCategory === "All" && (
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
                          {config.is_quick_start ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Quick Start</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{config.tasks.length} steps</Badge>
                          )}
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
                        {canModifyConfig(config) && (
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
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Featured Section */}
          {viewMode !== "workflows" && searchQuery === "" && selectedCategory === "All" && featuredConfigs.length > 0 && (
            <div className="mb-8 p-4 bg-muted/30 rounded-xl border border-border/50">
              <div className="flex items-center gap-2 mb-4">
                <Rocket className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-sm">Featured Quick Starts</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {featuredConfigs.map(config => {
                  const Icon = ICON_MAP[config.thumbnail || "Zap"] || Zap;
                  return (
                    <motion.div
                      key={config.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleConfigClick(config)}
                      className="relative flex items-center gap-3 p-4 rounded-xl bg-card border border-border/50 hover:border-primary hover:shadow-lg transition-all text-left group cursor-pointer"
                    >
                      <div className="p-2 rounded-lg gradient-primary-br shrink-0 group-hover:scale-110 transition-transform">
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate pr-8">{config.name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {config.metadata?.expected_agents?.slice(0, 2).map(agent => (
                            <Badge key={agent} variant="secondary" className="text-[10px] px-1.5 py-0">{agent}</Badge>
                          ))}
                        </div>
                      </div>

                      {/* Arrow - hidden on hover */}
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:opacity-0 transition-all shrink-0" />

                      {/* Action buttons grouped - bottom-right on hover, replaces arrow */}
                      <div className="absolute bottom-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card/95 backdrop-blur-sm rounded-lg p-0.5 border border-border/30 shadow-sm">
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
                        {canModifyConfig(config) && (
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
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Start Templates */}
          {viewMode !== "workflows" && nonFeaturedQuickStartConfigs.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-medium">Quick Start Templates</h2>
                <Badge variant="secondary">{nonFeaturedQuickStartConfigs.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {nonFeaturedQuickStartConfigs.map((config, index) => {
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
                        <Badge variant="outline" className={cn("text-xs", getDifficultyColor(config.difficulty))}>
                          {config.difficulty || "beginner"}
                        </Badge>
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
                        {canModifyConfig(config) && (
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
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Multi-Step Workflows */}
          {viewMode !== "quick-start" && workflowConfigs.length > 0 && (
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
                        <Workflow className="h-3.5 w-3.5" />
                        <span>{config.tasks.length} steps</span>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleConfigClick(config); }}>
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        {canModifyConfig(config) && (
                          <>
                            <div className="h-5 w-px bg-border/50" />
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onEditConfig?.(config); }}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-500" onClick={(e) => handleDelete(config, e)} disabled={deletingId === config.id}>
                              {deletingId === config.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {filteredConfigs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Sparkles className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No templates match your search</p>
            </div>
          )}
        </div>
      )}

      {/* Quick Start Workflow Modal */}
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
                  <div className="flex flex-wrap gap-1.5">
                    {(activeFormConfig.metadata.tags as string[]).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 p-4 border-t bg-muted/30 shrink-0">
                <div>
                  {onEditConfig && (
                    <Button variant="ghost" size="sm" onClick={() => { setActiveFormConfig(null); onEditConfig(activeFormConfig); }}>
                      <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

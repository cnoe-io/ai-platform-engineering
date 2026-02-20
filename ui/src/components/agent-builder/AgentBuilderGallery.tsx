"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
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
  Play,
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
  ExternalLink,
  MessageSquare,
  Star,
  History,
  Lock,
  Globe,
  UsersRound,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import { useAgentConfigStore } from "@/store/agent-config-store";
import { useChatStore } from "@/store/chat-store";
import { useAdminRole } from "@/hooks/use-admin-role";
import type { AgentConfig, AgentConfigCategory, WorkflowDifficulty } from "@/types/agent-config";
import { generateInputFormFromPrompt } from "@/types/agent-config";

interface AgentBuilderGalleryProps {
  onSelectConfig?: (config: AgentConfig, fromHistory?: boolean) => void;
  onRunQuickStart?: (prompt: string, configName?: string) => void;
  onEditConfig?: (config: AgentConfig) => void;
  onCreateNew?: () => void;
}

const VISIBILITY_BADGE_CONFIG: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  system: { icon: Shield, label: "System", className: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  team: { icon: UsersRound, label: "Team", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  global: { icon: Globe, label: "Global", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  private: { icon: Lock, label: "Private", className: "bg-muted text-muted-foreground border-border/50" },
};

function VisibilityBadge({ config }: { config: AgentConfig }) {
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

export function AgentBuilderGallery({
  onSelectConfig,
  onRunQuickStart,
  onEditConfig,
  onCreateNew,
}: AgentBuilderGalleryProps) {
  const {
    configs,
    isLoading,
    error,
    loadConfigs,
    deleteConfig,
    toggleFavorite,
    isFavorite,
    getFavoriteConfigs
  } = useAgentConfigStore();
  const { isAdmin } = useAdminRole();
  const { data: session } = useSession();
  const router = useRouter();
  const { createConversation, setPendingMessage } = useChatStore();
  const workflowRunnerEnabled = getConfig('workflowRunnerEnabled');

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "workflows" | "my-skills" | "team" | "global">("all");

  // Input form state for skill run modal
  const [activeFormConfig, setActiveFormConfig] = useState<AgentConfig | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editablePrompt, setEditablePrompt] = useState<string>("");

  // Keep activeFormConfig in sync with store updates (e.g., after editing)
  useEffect(() => {
    if (activeFormConfig) {
      // Find the latest version of this config in the store
      const latestConfig = configs.find(c => c.id === activeFormConfig.id);
      if (latestConfig) {
        const latestPrompt = latestConfig.tasks[0]?.llm_prompt || "";
        const currentPrompt = activeFormConfig.tasks[0]?.llm_prompt || "";

        // Only update if the prompt has changed (to avoid infinite loop)
        if (latestPrompt !== currentPrompt) {
          console.log(`[AgentBuilderGallery] Config updated in store, refreshing dialog:`, latestConfig.id);
          console.log(`[AgentBuilderGallery] Old prompt:`, currentPrompt);
          console.log(`[AgentBuilderGallery] New prompt:`, latestPrompt);

          // Update activeFormConfig with latest data
          setActiveFormConfig({ ...latestConfig, input_form: activeFormConfig.input_form });
          // Update editablePrompt with latest llm_prompt
          setEditablePrompt(latestPrompt);
        }
      }
    }
  }, [configs, activeFormConfig]); // Re-run when configs change or activeFormConfig changes

  // Check if user can edit/delete a config
  const canModifyConfig = (config: AgentConfig) => {
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
    loadConfigs();
  }, [loadConfigs]);

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

      return matchesSearch && matchesCategory && matchesViewMode;
    });
  }, [allConfigs, searchQuery, selectedCategory, viewMode, currentUserEmail]);

  const workflowConfigs = filteredConfigs.filter(c => !c.is_quick_start);
  const skillConfigs = filteredConfigs;

  const mySkillsCount = useMemo(() =>
    allConfigs.filter(c => !c.is_system && c.owner_id === currentUserEmail).length,
    [allConfigs, currentUserEmail]
  );

  const isFilteredView = viewMode === "my-skills" || viewMode === "team" || viewMode === "global";

  const handleDelete = async (config: AgentConfig, e: React.MouseEvent) => {
    e.stopPropagation();

    // Confirm deletion
    const confirmMessage = config.is_system
      ? `Are you sure you want to delete the system template "${config.name}"? This action requires admin privileges.`
      : `Are you sure you want to delete "${config.name}"?`;

    if (!confirm(confirmMessage)) return;

    setDeletingId(config.id);
    try {
      await deleteConfig(config.id);
    } catch (error: any) {
      console.error("Failed to delete config:", error);
      alert(error.message || "Failed to delete configuration");
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfigClick = (config: AgentConfig) => {
    if (config.is_quick_start || !workflowRunnerEnabled) {
      const inputForm = config.input_form || generateInputFormFromPrompt(config.tasks[0]?.llm_prompt || "", config.name);
      const basePrompt = config.tasks[0]?.llm_prompt || "";

      setActiveFormConfig({ ...config, input_form: inputForm || undefined });

      if (inputForm && inputForm.fields.length > 0) {
        const initialValues: Record<string, string> = {};
        inputForm.fields.forEach(f => { initialValues[f.name] = f.defaultValue || ""; });
        setFormValues(initialValues);

        // Pre-substitute defaults into the prompt
        let promptWithDefaults = basePrompt;
        Object.entries(initialValues).forEach(([key, value]) => {
          if (value.trim()) {
            const ek = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            promptWithDefaults = promptWithDefaults.replace(new RegExp(`\\{\\{\\s*${ek}\\s*:[^}]*\\}\\}`, "g"), value.trim());
            promptWithDefaults = promptWithDefaults.replace(new RegExp(`\\{\\{\\s*${ek}\\s*\\}\\}`, "g"), value.trim());
            promptWithDefaults = promptWithDefaults.replace(new RegExp(`\\{${ek}\\}`, "g"), value.trim());
          }
        });
        setEditablePrompt(promptWithDefaults);
      } else {
        setFormValues({});
        setEditablePrompt(basePrompt);
      }
      setFormErrors({});
    } else {
      onSelectConfig?.(config);
    }
  };

  // Update editable prompt when form values change
  const updateEditablePrompt = (newFormValues: Record<string, string>) => {
    if (!activeFormConfig) return;

    let prompt = activeFormConfig.tasks[0]?.llm_prompt || "";
    Object.entries(newFormValues).forEach(([key, value]) => {
      if (value.trim()) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match {{key:default}}, {{key}}, and {key}
        prompt = prompt.replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*:[^}]*\\}\\}`, "g"), value.trim());
        prompt = prompt.replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g"), value.trim());
        prompt = prompt.replace(new RegExp(`\\{${escapedKey}\\}`, "g"), value.trim());
      }
    });
    setEditablePrompt(prompt);
  };

  const handleFormSubmit = () => {
    if (!activeFormConfig) return;

    // Validate required fields if there are any
    if (activeFormConfig.input_form && activeFormConfig.input_form.fields.length > 0) {
      const errors: Record<string, string> = {};
      activeFormConfig.input_form.fields.forEach(field => {
        if (field.required && !formValues[field.name]?.trim()) {
          errors[field.name] = `${field.label} is required`;
        }
      });

      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        return;
      }
    }

    // Use the editable prompt (which may have been modified by the user)
    setActiveFormConfig(null);
    onRunQuickStart?.(editablePrompt, activeFormConfig.name);
  };

  const handleRunInChat = () => {
    if (!activeFormConfig) return;

    // Validate required fields if there are any
    if (activeFormConfig.input_form && activeFormConfig.input_form.fields.length > 0) {
      const errors: Record<string, string> = {};
      activeFormConfig.input_form.fields.forEach(field => {
        if (field.required && !formValues[field.name]?.trim()) {
          errors[field.name] = `${field.label} is required`;
        }
      });

      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        return;
      }
    }

    // Create a new conversation
    const conversationId = createConversation();

    // Set the pending message to be auto-submitted when the chat loads
    setPendingMessage(editablePrompt);

    // Close the modal
    setActiveFormConfig(null);

    // Navigate to the chat page
    router.push(`/chat/${conversationId}`);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => loadConfigs()}>Try Again</Button>
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
              </div>
            </div>

            <div className="flex items-center gap-2">
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
          {getFavoriteConfigs().length > 0 && searchQuery === "" && selectedCategory === "All" && !isFilteredView && (
            <div className="mb-8 p-4 bg-gradient-to-br from-yellow-500/10 to-amber-500/10 rounded-xl border border-yellow-500/30">
              <div className="flex items-center gap-2 mb-4">
                <Star className="h-5 w-5 text-yellow-500 fill-current" />
                <h2 className="text-lg font-medium">Favorites</h2>
                <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600">{getFavoriteConfigs().length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {getFavoriteConfigs().map((config, index) => {
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
                      onClick={() => config.is_quick_start ? handleConfigClick(config) : onSelectConfig?.(config)}
                      className="relative flex items-center gap-3 p-4 rounded-xl bg-card border border-border/50 hover:border-yellow-500 hover:shadow-lg transition-all text-left group cursor-pointer"
                    >
                      <div className={cn("p-2 rounded-lg bg-gradient-to-br shrink-0", gradientClass)}>
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate pr-8">{config.name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {!workflowRunnerEnabled ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                          ) : config.is_quick_start ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Skill</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{config.tasks.length} steps</Badge>
                          )}
                          <VisibilityBadge config={config} />
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
                        <div className="flex items-center gap-1">
                          <VisibilityBadge config={config} />
                          <Badge variant="outline" className={cn("text-xs", getDifficultyColor(config.difficulty))}>
                            {config.difficulty || "beginner"}
                          </Badge>
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
                        {canModifyConfig(config) && (
                          <>
                            <div className="h-4 w-px bg-border/50" />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEditConfig?.(config); }} title="Edit">
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-500"
                              onClick={(e) => handleDelete(config, e)} disabled={deletingId === config.id} title="Delete"
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
                        <div className="flex items-center gap-1">
                          <VisibilityBadge config={config} />
                          <Badge variant="outline" className={cn("text-xs", getDifficultyColor(config.difficulty))}>
                            {config.difficulty || "beginner"}
                          </Badge>
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
                      onClick={() => onSelectConfig?.(config)}
                    >
                      <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center mb-3", gradientClass)}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <h3 className="font-medium mb-1 pr-16">{config.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{config.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {workflowRunnerEnabled ? (
                          <>
                            <Workflow className="h-3.5 w-3.5" />
                            <span>{config.tasks.length} steps</span>
                          </>
                        ) : (
                          <>
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span>Skill</span>
                          </>
                        )}
                        <VisibilityBadge config={config} />
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
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onSelectConfig?.(config); }}>
                          <Play className="h-4 w-4" />
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

          {/* Empty State (generic — for search with no results) */}
          {filteredConfigs.length === 0 && !(isFilteredView && searchQuery === "") && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Sparkles className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No skills match your search</p>
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

                {/* Input fields for placeholders (if any) */}
                {activeFormConfig.input_form && activeFormConfig.input_form.fields.length > 0 && (
                  <div className="space-y-4 mb-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Settings className="h-4 w-4" />
                      Fill in the details
                    </div>
                    {activeFormConfig.input_form.fields.map(field => (
                      <div key={field.name} className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-1">
                          {field.label}
                          {field.required && <span className="text-red-400">*</span>}
                        </label>
                        <Input
                          type={field.type}
                          placeholder={field.placeholder}
                          value={formValues[field.name] || ""}
                          onChange={e => {
                            const newValues = { ...formValues, [field.name]: e.target.value };
                            setFormValues(newValues);
                            updateEditablePrompt(newValues);
                            if (formErrors[field.name]) setFormErrors(prev => ({ ...prev, [field.name]: "" }));
                          }}
                          className={cn("h-11", formErrors[field.name] && "border-red-500")}
                        />
                        {field.helperText && !formErrors[field.name] && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />{field.helperText}
                          </p>
                        )}
                        {formErrors[field.name] && <p className="text-xs text-red-400">{formErrors[field.name]}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Editable Prompt */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Edit className="h-4 w-4 text-muted-foreground" />
                      Prompt (editable)
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {editablePrompt.length} characters
                    </span>
                  </div>
                  <textarea
                    value={editablePrompt}
                    onChange={e => setEditablePrompt(e.target.value)}
                    rows={6}
                    className="w-full px-4 py-3 text-sm rounded-lg border border-input bg-background resize-none font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="Enter your prompt..."
                  />
                  <p className="text-xs text-muted-foreground">
                    You can edit the prompt before running the workflow
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 p-4 border-t bg-muted/30 shrink-0">
                <Button variant="ghost" onClick={() => setActiveFormConfig(null)}>Cancel</Button>
                <Button
                  onClick={handleRunInChat}
                  variant={workflowRunnerEnabled ? "outline" : "default"}
                  className={cn("gap-2", !workflowRunnerEnabled && "gradient-primary text-white")}
                  disabled={!editablePrompt.trim()}
                >
                  <MessageSquare className="h-4 w-4" />
                  Run in Chat
                </Button>
                {workflowRunnerEnabled && (
                  <Button
                    onClick={handleFormSubmit}
                    className="gradient-primary text-white gap-2"
                    disabled={!editablePrompt.trim()}
                  >
                    <Play className="h-4 w-4" />
                    Run Workflow
                  </Button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

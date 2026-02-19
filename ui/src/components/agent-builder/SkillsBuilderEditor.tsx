"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Upload,
  FileCode,
  ChevronRight,
  ChevronLeft,
  Eye,
  EyeOff,
  BookOpen,
  Sparkles,
  Zap,
  GitBranch,
  GitPullRequest,
  Server,
  Cloud,
  Rocket,
  Shield,
  Database,
  BarChart,
  Users,
  AlertTriangle,
  Settings,
  Key,
  Workflow,
  Bug,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  Import,
  Lock,
  Globe,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useAgentConfigStore } from "@/store/agent-config-store";
import { useAdminRole } from "@/hooks/use-admin-role";
import { parseSkillMd, createBlankSkillMd } from "@/lib/skill-md-parser";
import { fetchSkillTemplates, getAllTemplateTags } from "@/skills";
import type {
  AgentConfig,
  AgentConfigCategory,
  CreateAgentConfigInput,
  WorkflowDifficulty,
  SkillVisibility,
} from "@/types/agent-config";
import type { Team } from "@/types/teams";
import type { SkillTemplate } from "@/skills";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES: (AgentConfigCategory | string)[] = [
  "DevOps", "Development", "Operations", "Cloud", "Project Management",
  "Security", "Infrastructure", "Knowledge", "GitHub Operations",
  "AWS Operations", "ArgoCD Operations", "AI Gateway Operations",
  "Group Management", "Custom",
];

const DIFFICULTIES: { id: WorkflowDifficulty; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

const THUMBNAIL_OPTIONS = [
  "Zap", "GitBranch", "GitPullRequest", "Server", "Cloud", "Rocket",
  "Shield", "Database", "BarChart", "Users", "AlertTriangle", "CheckCircle",
  "Settings", "Key", "Workflow", "Bug", "Clock",
];

const ICON_MAP: Record<string, React.ElementType> = {
  Zap, GitBranch, GitPullRequest, Server, Cloud, Rocket, Shield, Database,
  BarChart, Users, AlertTriangle, CheckCircle, Settings, Key, Workflow, Bug, Clock,
};

const ICON_LABELS: Record<string, string> = {
  Zap: "Lightning", GitBranch: "Git Branch", GitPullRequest: "Pull Request",
  Server: "Server", Cloud: "Cloud", Rocket: "Rocket", Shield: "Security",
  Database: "Database", BarChart: "Analytics", Users: "Team",
  AlertTriangle: "Warning", CheckCircle: "Success", Settings: "Settings",
  Key: "Access Key", Workflow: "Workflow", Bug: "Bug Fix", Clock: "Scheduled",
};

const VISIBILITY_OPTIONS: { id: SkillVisibility; label: string; icon: React.ElementType; description: string }[] = [
  { id: "private", label: "Private", icon: Lock, description: "Only you can see this skill" },
  { id: "team", label: "Team", icon: UsersRound, description: "Share with specific teams" },
  { id: "global", label: "Global", icon: Globe, description: "Everyone in your organization" },
];

const CATEGORY_TAG_SUGGESTIONS: Record<string, string[]> = {
  DevOps: ["ArgoCD", "Kubernetes", "CI/CD", "Monitoring"],
  Development: ["GitHub", "Code Review", "Testing"],
  Operations: ["PagerDuty", "Jira", "Incident", "Multi-Agent"],
  Cloud: ["AWS", "Cost", "Optimization", "EKS"],
  "Project Management": ["Jira", "Agile", "Reporting"],
  Security: ["GitHub", "Security", "Dependabot", "Vulnerability"],
  Infrastructure: ["AWS", "Kubernetes", "Monitoring", "EKS"],
  Knowledge: ["RAG", "Documentation"],
  "GitHub Operations": ["GitHub", "PR", "Repository"],
  "AWS Operations": ["AWS", "EC2", "S3", "Lambda"],
  "ArgoCD Operations": ["ArgoCD", "Deployment", "Sync"],
  "AI Gateway Operations": ["LLM", "API Key", "Gateway"],
  "Group Management": ["Groups", "Users", "Permissions"],
  Custom: [],
};

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}

function TagInput({ tags, onChange, suggestions = [] }: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = useMemo(() => {
    if (!inputValue.trim()) return suggestions.filter(s => !tags.includes(s));
    const lower = inputValue.toLowerCase();
    return suggestions
      .filter(s => s.toLowerCase().includes(lower) && !tags.includes(s));
  }, [inputValue, suggestions, tags]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (inputValue.trim()) addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 p-2 min-h-[38px] rounded-md border border-input bg-background">
        {tags.map(tag => (
          <Badge key={tag} variant="secondary" className="gap-1 text-xs">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-0.5 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? "Add tags..." : ""}
          className="flex-1 min-w-[100px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {filteredSuggestions.slice(0, 8).map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
              className="text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import SKILL.md Dialog (inline within the overlay)
// ---------------------------------------------------------------------------

interface ImportSkillMdPanelProps {
  onImport: (content: string) => void;
  onClose: () => void;
}

function ImportSkillMdPanel({ onImport, onClose }: ImportSkillMdPanelProps) {
  const [content, setContent] = useState("");

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setContent(text);
    };
    reader.readAsText(file);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="absolute inset-x-0 top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border p-6 shadow-lg"
    >
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
              <Import className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Import SKILL.md</h3>
              <p className="text-xs text-muted-foreground">Upload or paste a SKILL.md file to populate the editor</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <label className="text-xs font-medium mb-1.5 block">Upload File</label>
          <Input type="file" accept=".md,.markdown" onChange={handleFileUpload} className="cursor-pointer h-9 text-sm" />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">Or paste content</span>
          </div>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={"---\nname: my-skill\ndescription: ...\n---\n\n# My Skill\n\n## Instructions\n..."}
          rows={8}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none font-mono",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        />

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!content.trim()}
            onClick={() => { onImport(content); onClose(); }}
            className="gap-1.5 gradient-primary text-white"
          >
            <Import className="h-3.5 w-3.5" />
            Import
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface SkillsBuilderEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  existingConfig?: AgentConfig;
}

export function SkillsBuilderEditor({
  open,
  onOpenChange,
  onSuccess,
  existingConfig,
}: SkillsBuilderEditorProps) {
  const isEditMode = !!existingConfig;
  const { createConfig, updateConfig } = useAgentConfigStore();
  const { isAdmin } = useAdminRole();
  const { toast } = useToast();

  // Skill templates loaded from API (filesystem-backed)
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Panel visibility
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [showImportPanel, setShowImportPanel] = useState(false);

  // Template reference in sidebar
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: existingConfig?.name || "",
    description: existingConfig?.description || "",
    category: existingConfig?.category || "Custom",
    difficulty: existingConfig?.difficulty || "beginner" as WorkflowDifficulty,
    thumbnail: existingConfig?.thumbnail || "Zap",
  });
  const [tags, setTags] = useState<string[]>(existingConfig?.metadata?.tags || []);
  const [skillContent, setSkillContent] = useState(
    existingConfig?.skill_content || createBlankSkillMd()
  );

  // Visibility / sharing state
  const [visibility, setVisibility] = useState<SkillVisibility>(
    existingConfig?.visibility || "private"
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(
    existingConfig?.shared_with_teams || []
  );
  const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load templates from API when editor opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplatesLoading(true);
    fetchSkillTemplates()
      .then((templates) => {
        if (!cancelled) setSkillTemplates(templates);
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  // Fetch teams when visibility is set to "team"
  useEffect(() => {
    if (visibility !== "team" || availableTeams.length > 0) return;
    let cancelled = false;
    setTeamsLoading(true);
    fetch("/api/admin/teams")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAvailableTeams(data.data?.teams || []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTeamsLoading(false); });
    return () => { cancelled = true; };
  }, [visibility, availableTeams.length]);

  // Computed tag suggestions
  const allExistingTags = useMemo(() => getAllTemplateTags(), [skillTemplates]);
  const categorySuggestions = useMemo(() => {
    const catTags = CATEGORY_TAG_SUGGESTIONS[formData.category] || [];
    return [...new Set([...catTags, ...allExistingTags])];
  }, [formData.category, allExistingTags]);

  // Reset state when opening/closing or switching configs
  useEffect(() => {
    if (open) {
      setFormData({
        name: existingConfig?.name || "",
        description: existingConfig?.description || "",
        category: existingConfig?.category || "Custom",
        difficulty: existingConfig?.difficulty || "beginner" as WorkflowDifficulty,
        thumbnail: existingConfig?.thumbnail || "Zap",
      });
      setTags(existingConfig?.metadata?.tags || []);
      setSkillContent(existingConfig?.skill_content || createBlankSkillMd());
      setVisibility(existingConfig?.visibility || "private");
      setSelectedTeamIds(existingConfig?.shared_with_teams || []);
      setSubmitStatus("idle");
      setErrors({});
      setShowImportPanel(false);
    }
  }, [open, existingConfig]);

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    }
  };

  // Load a template into the editor
  const handleLoadTemplate = (template: SkillTemplate) => {
    setSkillContent(template.content);
    setFormData(prev => ({
      ...prev,
      name: template.title,
      description: template.description,
      category: template.category,
      thumbnail: template.icon,
    }));
    setTags(template.tags);
  };

  // Import from SKILL.md content
  const handleImportSkillMd = (content: string) => {
    try {
      const parsed = parseSkillMd(content);
      setSkillContent(content);
      if (parsed.name) {
        setFormData(prev => ({
          ...prev,
          name: parsed.title || parsed.name,
          description: parsed.description,
        }));
      }
      toast("SKILL.md imported successfully", "success");
    } catch (err: any) {
      toast(`Failed to parse SKILL.md: ${err.message}`, "error");
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Skill name is required";
    if (!formData.category) newErrors.category = "Category is required";
    if (!skillContent.trim()) newErrors.skillContent = "Skill content is required";
    if (visibility === "team" && selectedTeamIds.length === 0) {
      newErrors.teams = "Select at least one team to share with";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (isEditMode && existingConfig?.is_system && !isAdmin) {
      toast("Only administrators can edit system templates.", "warning", 5000);
      return;
    }
    if (!validateForm()) {
      const msgs = Object.values(errors).map(m => `• ${m}`).join("\n");
      if (msgs) toast(`Please fix:\n\n${msgs}`, "error", 5000);
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const parsed = parseSkillMd(skillContent);

      const configData: CreateAgentConfigInput = {
        name: formData.name.trim(),
        description: formData.description.trim() || parsed.description || undefined,
        category: formData.category,
        tasks: [{
          display_text: formData.name.trim(),
          llm_prompt: parsed.body || skillContent,
          subagent: "caipe",
        }],
        is_quick_start: true,
        difficulty: formData.difficulty,
        thumbnail: formData.thumbnail,
        skill_content: skillContent,
        metadata: {
          tags: tags.length > 0 ? tags : undefined,
        },
        visibility,
        shared_with_teams: visibility === "team" ? selectedTeamIds : undefined,
      };

      if (isEditMode && existingConfig) {
        await updateConfig(existingConfig.id, configData);
      } else {
        await createConfig(configData);
      }

      setSubmitStatus("success");
      toast(isEditMode ? "Skill updated successfully!" : "Skill created successfully!", "success");

      if (onSuccess) {
        setTimeout(() => { onSuccess(); onOpenChange(false); }, 1200);
      }
    } catch (error: any) {
      console.error("Error saving skill:", error);
      setSubmitStatus("error");
      toast(`Error: ${error.message || "Failed to save skill"}`, "error", 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Live preview of parsed SKILL.md
  const parsedPreview = useMemo(() => {
    try {
      return parseSkillMd(skillContent);
    } catch {
      return null;
    }
  }, [skillContent]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;

  const selectedTemplate = selectedTemplateId
    ? skillTemplates.find(t => t.id === selectedTemplateId)
    : null;

  const overlay = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background flex flex-col"
    >
      {/* ─── Top Bar ──────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/20">
            <Sparkles className="h-4.5 w-4.5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold gradient-text truncate">
              {isEditMode ? "Edit Skill" : "Skills Builder"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isEditMode ? "Update your skill definition" : "Create a new skill from a SKILL.md template"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Template Picker */}
          <div className="relative group">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
              Templates
            </Button>
          </div>

          {/* Import SKILL.md */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowImportPanel(!showImportPanel)}
          >
            <Upload className="h-3.5 w-3.5" />
            Import SKILL.md
          </Button>

          {/* Preview toggle */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setPreviewOpen(!previewOpen)}
          >
            {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            Preview
          </Button>

          {/* Close */}
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ─── Import Panel (slides down) ──────────────────────────── */}
      <div className="relative">
        <AnimatePresence>
          {showImportPanel && (
            <ImportSkillMdPanel
              onImport={handleImportSkillMd}
              onClose={() => setShowImportPanel(false)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ─── Body: 3-panel layout ────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Left Sidebar: Template Browser ──────────────────────── */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 border-r border-border/50 flex flex-col overflow-hidden"
            >
              <div className="px-3 py-2.5 border-b border-border/50">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Skill Templates
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Click to use as starting point</p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {/* Blank Template */}
                  <button
                    type="button"
                    onClick={() => {
                      setSkillContent(createBlankSkillMd());
                      setFormData(prev => ({ ...prev, name: "", description: "" }));
                      setTags([]);
                      setSelectedTemplateId(null);
                    }}
                    className={cn(
                      "w-full text-left p-2.5 rounded-lg transition-colors",
                      "hover:bg-muted/50 border border-transparent",
                      !selectedTemplateId && "bg-muted/30 border-border/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">Blank Skill</p>
                        <p className="text-xs text-muted-foreground truncate">Start from scratch</p>
                      </div>
                    </div>
                  </button>

                  {/* Built-in Templates (loaded from filesystem via API) */}
                  {templatesLoading && (
                    <div className="flex items-center gap-2 p-2.5 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Loading templates...</span>
                    </div>
                  )}
                  {skillTemplates.map(template => {
                    const TemplateIcon = ICON_MAP[template.icon] || Zap;
                    const isSelected = selectedTemplateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(template.id);
                          handleLoadTemplate(template);
                        }}
                        className={cn(
                          "w-full text-left p-2.5 rounded-lg transition-colors",
                          "hover:bg-muted/50 border border-transparent",
                          isSelected && "bg-primary/10 border-primary/30"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <TemplateIcon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{template.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {template.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>

              {/* Sidebar reference panel: show selected template content */}
              {selectedTemplate && (
                <div className="border-t border-border/50 max-h-[200px]">
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Reference</h3>
                        <Badge variant="outline" className="text-[10px]">{selectedTemplate.category}</Badge>
                      </div>
                      <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed break-words">
                        {selectedTemplate.content.slice(0, 500)}
                        {selectedTemplate.content.length > 500 && "..."}
                      </pre>
                    </div>
                  </ScrollArea>
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── Main Editor ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-6 max-w-4xl mx-auto space-y-6">

              {/* System config warning */}
              {existingConfig?.is_system && !isAdmin && (
                <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-500">System Template - Read Only</p>
                    <p className="text-amber-600/80 text-xs mt-1">Only administrators can edit system templates.</p>
                  </div>
                </div>
              )}

              {/* ── Metadata Section ──────────────────────────────── */}
              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Skill Details
                </h2>

                {/* Name */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">
                    Skill Name <span className="text-red-400">*</span>
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    placeholder="e.g., Review a Specific PR"
                    className={cn("h-9 text-sm", errors.name && "border-red-500")}
                  />
                  {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => handleInputChange("description", e.target.value)}
                    placeholder="Brief description of what this skill does and when to use it..."
                    rows={2}
                    className={cn(
                      "w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Tags</label>
                  <TagInput tags={tags} onChange={setTags} suggestions={categorySuggestions} />
                </div>

                {/* Visibility */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Visibility</label>
                  <div className="flex gap-2">
                    {VISIBILITY_OPTIONS.map(opt => {
                      const VIcon = opt.icon;
                      const isActive = visibility === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setVisibility(opt.id);
                            if (opt.id !== "team") setSelectedTeamIds([]);
                          }}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-md border transition-colors text-xs",
                            isActive
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-muted/30 border-border/50 hover:bg-muted/50 text-muted-foreground"
                          )}
                        >
                          <VIcon className="h-3.5 w-3.5" />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {VISIBILITY_OPTIONS.find(o => o.id === visibility)?.description}
                  </p>

                  {/* Team selector (shown when visibility is "team") */}
                  {visibility === "team" && (
                    <div className="mt-3 space-y-2">
                      <label className="text-xs font-medium text-foreground block">Share with teams</label>
                      {teamsLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading teams...
                        </div>
                      ) : availableTeams.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">
                          No teams available. Ask an admin to create teams first.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {availableTeams.map(team => {
                            const isSelected = selectedTeamIds.includes(team._id);
                            return (
                              <button
                                key={team._id}
                                type="button"
                                onClick={() => {
                                  setSelectedTeamIds(prev =>
                                    isSelected
                                      ? prev.filter(id => id !== team._id)
                                      : [...prev, team._id]
                                  );
                                }}
                                className={cn(
                                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border transition-colors text-xs",
                                  isSelected
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-muted/30 border-border/50 hover:bg-muted/50 text-muted-foreground"
                                )}
                              >
                                <UsersRound className="h-3 w-3" />
                                {team.name}
                                {isSelected && <X className="h-3 w-3 ml-0.5" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {errors.teams && <p className="text-xs text-red-400">{errors.teams}</p>}
                    </div>
                  )}
                </div>

                {/* Category + Difficulty (side by side) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Category */}
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1.5 block">
                      Category <span className="text-red-400">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                      {CATEGORIES.map(cat => (
                        <label
                          key={cat}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs",
                            formData.category === cat
                              ? "bg-primary/10 border-primary/30"
                              : "bg-muted/30 border-border/50 hover:bg-muted/50"
                          )}
                        >
                          <input
                            type="radio"
                            name="category"
                            value={cat}
                            checked={formData.category === cat}
                            onChange={(e) => handleInputChange("category", e.target.value)}
                            className="h-3 w-3"
                          />
                          <span>{cat}</span>
                        </label>
                      ))}
                    </div>
                    {errors.category && <p className="text-xs text-red-400 mt-1">{errors.category}</p>}
                  </div>

                  {/* Difficulty + Icon */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">Difficulty</label>
                      <div className="flex gap-2">
                        {DIFFICULTIES.map(diff => (
                          <label
                            key={diff.id}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors",
                              formData.difficulty === diff.id
                                ? "bg-primary/10 border-primary/30"
                                : "bg-muted/30 border-border/50 hover:bg-muted/50"
                            )}
                          >
                            <input
                              type="radio"
                              name="difficulty"
                              value={diff.id}
                              checked={formData.difficulty === diff.id}
                              onChange={(e) => handleInputChange("difficulty", e.target.value)}
                              className="h-3 w-3"
                            />
                            <span className="text-xs">{diff.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Icon */}
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">Icon</label>
                      <div className="flex flex-wrap gap-2">
                        {THUMBNAIL_OPTIONS.map(iconName => {
                          const IconComponent = ICON_MAP[iconName];
                          return (
                            <label
                              key={iconName}
                              className={cn(
                                "flex flex-col items-center gap-1 p-2 rounded-lg border cursor-pointer transition-all hover:scale-105",
                                formData.thumbnail === iconName
                                  ? "bg-primary/10 border-primary shadow-sm"
                                  : "bg-muted/30 border-border/50 hover:bg-muted/50"
                              )}
                              title={ICON_LABELS[iconName]}
                            >
                              <input
                                type="radio"
                                name="thumbnail"
                                value={iconName}
                                checked={formData.thumbnail === iconName}
                                onChange={(e) => handleInputChange("thumbnail", e.target.value)}
                                className="sr-only"
                              />
                              {IconComponent && (
                                <IconComponent className={cn(
                                  "h-4 w-4",
                                  formData.thumbnail === iconName ? "text-primary" : "text-muted-foreground"
                                )} />
                              )}
                              <span className="text-[9px] text-muted-foreground leading-none text-center max-w-[50px]">
                                {ICON_LABELS[iconName]}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Skill Content Editor ──────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-primary" />
                    Skill Content (SKILL.md) <span className="text-red-400">*</span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Use {"{{variable}}"} for user inputs
                  </p>
                </div>

                <textarea
                  value={skillContent}
                  onChange={(e) => setSkillContent(e.target.value)}
                  rows={24}
                  spellCheck={false}
                  className={cn(
                    "w-full px-4 py-3 text-sm rounded-lg border bg-background resize-y font-mono leading-relaxed",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    errors.skillContent ? "border-red-500" : "border-input"
                  )}
                />
                {errors.skillContent && (
                  <p className="text-xs text-red-400">{errors.skillContent}</p>
                )}
              </section>
            </div>
          </ScrollArea>
        </div>

        {/* ── Right Panel: Live Preview ───────────────────────────── */}
        <AnimatePresence>
          {previewOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 border-l border-border/50 flex flex-col overflow-hidden"
            >
              <div className="px-3 py-2.5 border-b border-border/50">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Live Preview
                </h2>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {parsedPreview ? (
                    <>
                      {/* Frontmatter */}
                      <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                        <p className="text-xs font-mono text-muted-foreground mb-1">name: {parsedPreview.name || "—"}</p>
                        <p className="text-xs font-mono text-muted-foreground line-clamp-3">
                          description: {parsedPreview.description || "—"}
                        </p>
                      </div>

                      {/* Title */}
                      <h3 className="text-lg font-bold text-foreground">{parsedPreview.title}</h3>

                      {/* Sections from body */}
                      {Array.from(parsedPreview.sections.entries()).map(([heading, sectionContent]) => (
                        <div key={heading}>
                          <h4 className="text-xs font-semibold text-primary uppercase mb-1">{heading}</h4>
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                            {sectionContent.slice(0, 600)}
                            {sectionContent.length > 600 && "\n..."}
                          </pre>
                        </div>
                      ))}

                      {parsedPreview.sections.size === 0 && parsedPreview.body && (
                        <div>
                          <h4 className="text-xs font-semibold text-primary uppercase mb-1">Body</h4>
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                            {parsedPreview.body.slice(0, 1000)}
                            {parsedPreview.body.length > 1000 && "\n..."}
                          </pre>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Eye className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Start typing to see a preview</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Bottom Bar ──────────────────────────────────────────── */}
      <footer className="shrink-0 flex items-center justify-between px-6 py-3 border-t border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {submitStatus === "success" && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1.5 text-sm text-green-400"
            >
              <CheckCircle className="h-4 w-4" />
              Saved!
            </motion.div>
          )}
          {submitStatus === "error" && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1.5 text-sm text-red-400"
            >
              <AlertCircle className="h-4 w-4" />
              Save failed
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || (existingConfig?.is_system && !isAdmin)}
            className="gap-2 gradient-primary hover:opacity-90 text-white min-w-[140px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEditMode ? "Updating..." : "Saving..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {isEditMode ? "Update Skill" : "Save Skill"}
              </>
            )}
          </Button>
        </div>
      </footer>
    </motion.div>
  );

  return createPortal(
    <AnimatePresence>{open && overlay}</AnimatePresence>,
    document.body
  );
}

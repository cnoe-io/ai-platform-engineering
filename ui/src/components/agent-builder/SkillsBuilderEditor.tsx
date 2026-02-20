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
  Eye,
  EyeOff,
  BookOpen,
  Sparkles,
  Zap,
  GitBranch,
  GitPullRequest,
  GitMerge,
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
  Container,
  Terminal,
  Network,
  Activity,
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
  ExternalLink,
  Import,
  Lock,
  Globe,
  UsersRound,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Check,
  ChevronsUpDown,
  Plus,
  Braces,
  Variable,
  WandSparkles,
  Square,
  Undo2,
  Redo2,
  Download,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useAgentConfigStore } from "@/store/agent-config-store";
import { useAdminRole } from "@/hooks/use-admin-role";
import { getConfig } from "@/lib/config";
import { A2ASDKClient } from "@/lib/a2a-sdk-client";
import { parseSkillMd, createBlankSkillMd } from "@/lib/skill-md-parser";
import { fetchSkillTemplates, getAllTemplateTags } from "@/skills";
import { Panel, Group as PanelGroup, Separator } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  extractPromptVariables,
  type AgentConfig,
  type AgentConfigCategory,
  type CreateAgentConfigInput,
  type WorkflowDifficulty,
  type SkillVisibility,
} from "@/types/agent-config";
import type { Team } from "@/types/teams";
import type { SkillTemplate } from "@/skills";

// Lazy-load CodeMirror to avoid SSR issues
const CodeMirrorEditor = React.lazy(() => import("@uiw/react-codemirror"));

// Dynamically build the {{variable}} highlighting extension
async function createVariableHighlightExtension() {
  const { ViewPlugin, Decoration, MatchDecorator } = await import("@codemirror/view");
  const deco = Decoration.mark({ class: "cm-template-variable" });
  const decorator = new MatchDecorator({
    regexp: /\{\{[^}]+\}\}/g,
    decoration: () => deco,
  });
  return ViewPlugin.fromClass(
    class {
      decorations: any;
      constructor(view: any) { this.decorations = decorator.createDeco(view); }
      update(update: any) { this.decorations = decorator.updateDeco(update, this.decorations); }
    },
    { decorations: (v: any) => v.decorations }
  );
}

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

const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "DevOps & CI/CD",
    icons: ["Container", "Rocket", "Workflow", "PackageCheck", "RefreshCcw", "Layers"],
  },
  {
    label: "Infrastructure",
    icons: ["Server", "Cloud", "Database", "Network", "HardDrive", "Cpu"],
  },
  {
    label: "Monitoring & Ops",
    icons: ["Activity", "MonitorCheck", "Gauge", "AlertTriangle", "Bug", "ScrollText"],
  },
  {
    label: "Git & Code",
    icons: ["GitBranch", "GitPullRequest", "GitMerge", "FileCode", "Terminal", "Webhook"],
  },
  {
    label: "General",
    icons: ["Zap", "Shield", "BarChart", "Users", "Settings", "Key", "CheckCircle", "Wrench", "CircleDot"],
  },
];

const THUMBNAIL_OPTIONS = ICON_CATEGORIES.flatMap(cat => cat.icons);

const ICON_MAP: Record<string, React.ElementType> = {
  Zap, GitBranch, GitPullRequest, GitMerge, Server, Cloud, Rocket, Shield,
  Database, BarChart, Users, AlertTriangle, CheckCircle, Settings, Key,
  Workflow, Bug, Container, Terminal, Network, Activity, FileCode,
  MonitorCheck, RefreshCcw, CircleDot, Layers, PackageCheck, Gauge,
  ScrollText, Webhook, Cpu, HardDrive, Wrench,
};

const ICON_LABELS: Record<string, string> = {
  Container: "Kubernetes", Rocket: "Deploy", Workflow: "Pipeline",
  PackageCheck: "Helm", RefreshCcw: "ArgoCD", Layers: "Stack",
  Server: "Server", Cloud: "Cloud", Database: "Database",
  Network: "Network", HardDrive: "Storage", Cpu: "Compute",
  Activity: "Monitoring", MonitorCheck: "Health", Gauge: "Metrics",
  AlertTriangle: "Alert", Bug: "Debug", ScrollText: "Logs",
  GitBranch: "Git Branch", GitPullRequest: "Pull Request", GitMerge: "Merge",
  FileCode: "Code", Terminal: "CLI", Webhook: "Webhook",
  Zap: "Lightning", Shield: "Security", BarChart: "Analytics",
  Users: "Team", Settings: "Config", Key: "Access Key",
  CheckCircle: "Success", Wrench: "Tools", CircleDot: "Target",
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

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      const portal = document.getElementById("icon-picker-portal");
      if (portal?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const IconComp = ICON_MAP[value];

  const popover = (
    <div
      id="icon-picker-portal"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
      className="w-[340px] rounded-lg border border-border bg-popover shadow-lg p-2 animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <div className="max-h-[280px] overflow-y-auto space-y-2 pr-1">
        {ICON_CATEGORIES.map(cat => (
          <div key={cat.label}>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-0.5">{cat.label}</span>
            <div className="grid grid-cols-6 gap-1 mt-1">
              {cat.icons.map(iconName => {
                const IC = ICON_MAP[iconName];
                const isSelected = value === iconName;
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => { onChange(iconName); setOpen(false); }}
                    title={ICON_LABELS[iconName]}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 p-1.5 rounded-md border transition-all",
                      isSelected
                        ? "bg-primary/15 border-primary/40 text-primary ring-1 ring-primary/20"
                        : "bg-transparent border-transparent hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {IC && <IC className="h-4 w-4" />}
                    <span className="text-[9px] leading-none truncate w-full text-center">{ICON_LABELS[iconName]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        {IconComp && <IconComp className="h-4 w-4 text-primary" />}
        <span className="text-xs text-muted-foreground">{ICON_LABELS[value]}</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && createPortal(popover, document.body)}
    </div>
  );
}

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
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1 min-h-[32px] rounded-md border border-input bg-background">
        {tags.map(tag => (
          <Badge key={tag} variant="secondary" className="gap-0.5 text-xs h-5 px-1.5">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? "Add tags..." : ""}
          className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-10 mt-1 flex flex-wrap gap-1 p-1.5 bg-popover border border-border rounded-md shadow-md max-w-full">
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
// Category Picker (custom dropdown)
// ---------------------------------------------------------------------------

interface CategoryPickerProps {
  value: string;
  onChange: (value: string) => void;
}

function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; maxH?: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const MAX_MENU_H = 280;

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < MAX_MENU_H && spaceAbove > spaceBelow;
      const top = openAbove ? Math.max(8, rect.top - Math.min(MAX_MENU_H, spaceAbove)) : rect.bottom + 4;
      const maxH = openAbove ? Math.min(MAX_MENU_H, spaceAbove) : Math.min(MAX_MENU_H, spaceBelow);
      setMenuPos({ top, left: rect.left, maxH });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex items-center justify-between gap-2 h-7 px-2.5 min-w-[160px] text-xs rounded-md border transition-colors",
          "bg-background text-foreground hover:bg-muted/50",
          isOpen ? "border-primary/50 ring-1 ring-primary/20" : "border-input"
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed w-[200px] py-1 rounded-lg border border-border bg-popover shadow-xl shadow-black/20 animate-in fade-in-0 zoom-in-95 duration-100 overflow-y-auto"
          style={{ top: menuPos.top, left: menuPos.left, maxHeight: menuPos.maxH ?? MAX_MENU_H, zIndex: 9999 }}
        >
          {CATEGORIES.map(cat => {
            const isSelected = value === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => { onChange(cat); setIsOpen(false); }}
                className={cn(
                  "flex items-center gap-2 w-full px-2.5 py-1.5 text-xs transition-colors text-left",
                  isSelected
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted/50"
                )}
              >
                <Check className={cn("h-3 w-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                <span>{cat}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Insert Variable Popover
// ---------------------------------------------------------------------------

interface InsertVariablePopoverProps {
  onInsert: (varName: string) => void;
}

function InsertVariablePopover({ onInsert }: InsertVariablePopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [varName, setVarName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  const handleInsert = () => {
    const name = varName.trim().replace(/\s+/g, "_");
    if (!name) return;
    onInsert(name);
    setVarName("");
    setIsOpen(false);
  };

  const COMMON_VARS = [
    "pr_url", "repo_name", "branch_name", "app_name",
    "cluster_name", "namespace", "time_range", "jira_project",
  ];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1 h-6 px-2 text-xs rounded border transition-colors",
          isOpen
            ? "bg-primary/10 border-primary/30 text-primary"
            : "bg-muted/30 border-border/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
        )}
      >
        <Braces className="h-2.5 w-2.5" />
        <Plus className="h-2.5 w-2.5" />
        Variable
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 mt-1 right-0 w-[240px] p-2.5 rounded-lg border border-border bg-popover shadow-xl shadow-black/20 space-y-2"
          >
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Variable name
              </label>
              <div className="flex gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleInsert(); }}
                  placeholder="e.g. repo_name"
                  className="flex-1 h-6 px-2 text-xs rounded border border-input bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/30 font-mono"
                />
                <button
                  type="button"
                  onClick={handleInsert}
                  disabled={!varName.trim()}
                  className="h-6 px-2 text-xs rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  Insert
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Inserts <code className="text-primary/80">{`{{${varName.trim().replace(/\s+/g, "_") || "name"}}}`}</code> at cursor
              </p>
            </div>

            <div className="border-t border-border/50 pt-1.5">
              <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                Common
              </label>
              <div className="flex flex-wrap gap-1">
                {COMMON_VARS.map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => { onInsert(v); setIsOpen(false); }}
                    className="text-xs px-1.5 py-0.5 rounded bg-muted/40 border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors font-mono"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import SKILL.md Panel
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
              <p className="text-xs text-muted-foreground">Upload or paste a SKILL.md file</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">Upload File</label>
          <Input type="file" accept=".md,.markdown" onChange={handleFileUpload} className="cursor-pointer h-8 text-xs" />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">Or paste</span>
          </div>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={"---\nname: my-skill\ndescription: ...\n---\n\n# My Skill\n..."}
          rows={6}
          className={cn(
            "w-full px-3 py-2 text-xs rounded-md border border-input bg-background resize-none font-mono",
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
// Rich Markdown Preview
// ---------------------------------------------------------------------------

function MarkdownPreview({ content }: { content: string }) {
  const body = useMemo(() => {
    const match = content.match(/^---[\s\S]*?---\s*/);
    return match ? content.slice(match[0].length) : content;
  }, [content]);

  return (
    <div className="max-w-none space-y-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-foreground border-b border-border/40 pb-2 mb-4 mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-foreground mt-6 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-primary/60 shrink-0" />
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-foreground mt-5 mb-2">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-medium text-foreground mt-4 mb-1.5">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="text-[15px] text-muted-foreground leading-relaxed mb-3">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-muted-foreground">{children}</em>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          ul: ({ children }) => (
            <ul className="space-y-1.5 mb-4 ml-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="space-y-1.5 mb-4 ml-1 list-decimal list-inside">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-[15px] text-muted-foreground leading-relaxed flex items-start gap-2">
              <span className="mt-2.5 w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
              <span className="flex-1">{children}</span>
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/30 pl-4 my-4 text-[15px] text-muted-foreground italic">{children}</blockquote>
          ),
          hr: () => <hr className="border-border/40 my-5" />,
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4 rounded-md border border-border/40">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/30 border-b border-border/40">{children}</thead>
          ),
          tbody: ({ children }) => <tbody className="divide-y divide-border/30">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-muted/10 transition-colors">{children}</tr>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-sm font-medium text-foreground">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm text-muted-foreground">{children}</td>
          ),
          pre: ({ children }) => (
            <div className="mb-4 rounded-lg overflow-hidden">{children}</div>
          ),
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");
            if (match) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{ borderRadius: "0.5rem", fontSize: "0.8125rem", margin: 0, padding: "0.75rem" }}
                >
                  {codeString}
                </SyntaxHighlighter>
              );
            }
            return (
              <code className="text-primary bg-muted/50 px-1.5 py-0.5 rounded text-sm font-mono" {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resize Handle
// ---------------------------------------------------------------------------

function ResizeHandle({ className }: { className?: string }) {
  return (
    <Separator
      className={cn(
        "group relative flex items-center justify-center w-2 hover:w-3 transition-all",
        "before:absolute before:inset-y-0 before:w-px before:bg-border/50 group-hover:before:bg-primary/30 before:transition-colors",
        className
      )}
    >
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
      </div>
    </Separator>
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
  /** Render inline within the page instead of as a full-screen portal overlay */
  inline?: boolean;
}

export function SkillsBuilderEditor({
  open,
  onOpenChange,
  onSuccess,
  existingConfig,
  inline = false,
}: SkillsBuilderEditorProps) {
  const isEditMode = !!existingConfig;
  const { createConfig, updateConfig } = useAgentConfigStore();
  const { isAdmin } = useAdminRole();
  const { toast } = useToast();

  // Auth for A2A calls (same pattern as AgentBuilderRunner)
  const { data: session } = useSession();
  const ssoEnabled = getConfig("ssoEnabled");
  const accessToken = ssoEnabled ? session?.accessToken : undefined;
  const caipeEndpoint = getConfig("caipeUrl");

  // Skill templates loaded from API
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Panel visibility
  const [previewOpen, setPreviewOpen] = useState(true);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(true);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Template reference
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

  // Visibility / sharing
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

  // Editor undo/redo history
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);

  const pushUndoSnapshot = useCallback((content: string) => {
    const stack = undoStackRef.current;
    if (stack[stack.length - 1] === content) return;
    stack.push(content);
    if (stack.length > 50) stack.shift();
    setUndoAvailable(stack.length > 0);
    redoStackRef.current = [];
    setRedoAvailable(false);
  }, []);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack.pop()!;
    redoStackRef.current.push(skillContent);
    setSkillContent(prev);
    setUndoAvailable(stack.length > 0);
    setRedoAvailable(true);
  }, [skillContent]);

  const handleRedo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack.pop()!;
    undoStackRef.current.push(skillContent);
    setSkillContent(next);
    setUndoAvailable(true);
    setRedoAvailable(stack.length > 0);
  }, [skillContent]);

  const handleDownloadSkillMd = useCallback(() => {
    const fileName = formData.name
      ? `${formData.name.toLowerCase().replace(/\s+/g, "-")}-SKILL.md`
      : "SKILL.md";
    const blob = new Blob([skillContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [skillContent, formData.name]);

  // AI skill generation state
  const [aiStatus, setAiStatus] = useState<"idle" | "generating" | "enhancing">("idle");
  const [aiGenerateInput, setAiGenerateInput] = useState("");
  const [showAiGenerateInput, setShowAiGenerateInput] = useState(false);
  const [aiEnhanceInput, setAiEnhanceInput] = useState("");
  const [showAiEnhanceInput, setShowAiEnhanceInput] = useState(false);
  const [showAiDebug, setShowAiDebug] = useState(false);
  const [aiDebugLog, setAiDebugLog] = useState<string[]>([]);
  const aiDebugEndRef = useRef<HTMLDivElement | null>(null);
  const aiClientRef = useRef<A2ASDKClient | null>(null);
  const aiContentSnapshotRef = useRef<string>("");

  // CodeMirror extensions (lazily loaded) and editor ref
  const [cmExtensions, setCmExtensions] = useState<any[]>([]);
  const cmRef = useRef<any>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      import("@codemirror/lang-markdown"),
      import("@codemirror/language-data"),
      createVariableHighlightExtension(),
    ]).then(([mdMod, langDataMod, varHighlight]) => {
      if (!cancelled) {
        setCmExtensions([
          mdMod.markdown({ codeLanguages: langDataMod.languages }),
          varHighlight,
        ]);
      }
    });
    return () => { cancelled = true; };
  }, [open]);

  // Auto-scroll debug console to bottom on new entries
  useEffect(() => {
    aiDebugEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiDebugLog]);

  // Detected {{variables}} from editor content
  const detectedVariables = useMemo(() => {
    return extractPromptVariables(skillContent);
  }, [skillContent]);

  // Insert text at cursor position in CodeMirror
  const insertAtCursor = useCallback((text: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, insert: text } });
    view.focus();
  }, []);

  // Load templates
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplatesLoading(true);
    fetchSkillTemplates()
      .then((templates) => { if (!cancelled) setSkillTemplates(templates); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Fetch teams when visibility = "team"
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

  const allExistingTags = useMemo(() => getAllTemplateTags(), [skillTemplates]);
  const categorySuggestions = useMemo(() => {
    const catTags = CATEGORY_TAG_SUGGESTIONS[formData.category] || [];
    return [...new Set([...catTags, ...allExistingTags])];
  }, [formData.category, allExistingTags]);

  // Reset state
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

  useEffect(() => {
    if (inline) return;
    if (open) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open, inline]);

  useEffect(() => {
    if (!showTemplateMenu) return;
    const handler = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplateMenu]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    }
  };

  const handleLoadTemplate = (template: SkillTemplate) => {
    pushUndoSnapshot(skillContent);
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

  const handleImportSkillMd = (content: string) => {
    try {
      pushUndoSnapshot(skillContent);
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

  // ---------------------------------------------------------------------------
  // AI Skill Generation / Enhancement via CAIPE A2A backend
  // ---------------------------------------------------------------------------

  const SKILL_FORMAT_SPEC = `IMPORTANT: This is a CREATIVE WRITING task. Do NOT use any tools, do NOT call any agents, do NOT write files, do NOT create TODO lists. Simply respond with plain text directly.

You are a SKILL.md author. Output ONLY a valid SKILL.md file with no preamble, no explanation, and no markdown code fences wrapping the entire output. Do NOT ask clarifying questions. Do NOT request additional information. Just generate the best SKILL.md you can from the given description.

The SKILL.md format follows the Anthropic skills specification:
- Starts with YAML frontmatter delimited by --- lines
- frontmatter MUST contain "name" (kebab-case) and "description" (one-line summary)
- After frontmatter: a markdown body with H1 title matching the skill name
- Must include ## Instructions section with step-by-step phases
- Should include ## Output Format, ## Examples, and ## Guidelines sections
- May use {{variable_name}} placeholders for user-provided values

Example SKILL.md structure:
---
name: example-skill
description: Brief description of what this skill does
---

# Example Skill

Brief introduction paragraph.

## Instructions

### Phase 1: First Step
1. Do something
2. Do something else

### Phase 2: Second Step
1. Another step

## Output Format
Describe the expected output format here.

## Examples
- "Example query 1"
- "Example query 2"

## Guidelines
- Guideline 1
- Guideline 2
`;

  const extractSkillMdFromResponse = (response: string): string => {
    const fmMatch = response.match(/(---\s*\n[\s\S]*?\n---[\s\S]*)/);
    if (fmMatch) return fmMatch[1].trim();
    return response.trim();
  };

  const appendDebugLog = (line: string) => {
    setAiDebugLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

  const MAX_INPUT_REQUIRED_RETRIES = 3;

  const sendAiRequest = async (prompt: string): Promise<string> => {
    if (!caipeEndpoint) {
      throw new Error("CAIPE backend URL is not configured");
    }

    appendDebugLog(`Connecting to ${caipeEndpoint}...`);

    const client = new A2ASDKClient({
      endpoint: caipeEndpoint,
      accessToken: accessToken as string | undefined,
      userEmail: session?.user?.email ?? undefined,
    });
    aiClientRef.current = client;

    let finalContent = "";
    let contextId: string | undefined;
    let currentPrompt = prompt;
    let retries = 0;

    while (retries <= MAX_INPUT_REQUIRED_RETRIES) {
      const stream = client.sendMessageStream(currentPrompt, contextId);
      if (retries === 0) {
        appendDebugLog("Stream opened, waiting for events...");
      } else {
        appendDebugLog(`Auto-replying to input-required (attempt ${retries})...`);
      }

      let gotInputRequired = false;
      let streamingAccum = "";

      for await (const event of stream) {
        const label = event.artifactName || event.type || "event";
        const preview = event.displayContent
          ? event.displayContent.slice(0, 120).replace(/\n/g, "\\n")
          : "(no content)";
        appendDebugLog(`← ${label}${event.isFinal ? " [final]" : ""}${event.requireUserInput ? " [input-required]" : ""}: ${preview}`);

        if (event.contextId) contextId = event.contextId;

        if (event.requireUserInput) {
          gotInputRequired = true;
          appendDebugLog("Backend requested user input — auto-responding to continue...");
        }

        const name = event.artifactName || "";

        if (name === "final_result" || name === "complete_result") {
          if (event.displayContent) finalContent = event.displayContent;
        } else if (name === "streaming_result" && event.type === "artifact") {
          if (event.displayContent) {
            if (event.shouldAppend) {
              streamingAccum += event.displayContent;
            } else {
              streamingAccum = event.displayContent;
            }
          }
        }
      }

      if (!finalContent && streamingAccum) {
        finalContent = streamingAccum;
      }

      if (!gotInputRequired) break;

      retries++;
      if (retries > MAX_INPUT_REQUIRED_RETRIES) {
        appendDebugLog("Max auto-reply retries reached. Using best content so far.");
        break;
      }

      currentPrompt = "Please proceed with the task. Do not ask any questions. Generate the SKILL.md content now.";
    }

    appendDebugLog("Stream complete.");
    aiClientRef.current = null;
    return finalContent;
  };

  const handleAiGenerate = async () => {
    const description = aiGenerateInput.trim();
    if (!description) return;

    pushUndoSnapshot(skillContent);
    aiContentSnapshotRef.current = skillContent;
    setAiStatus("generating");
    setShowAiGenerateInput(false);
    setAiDebugLog([]);
    setShowAiDebug(false);

    try {
      const formContext = [
        formData.name.trim() && `Skill name: ${formData.name.trim()}`,
        formData.description.trim() && `Skill description: ${formData.description.trim()}`,
      ].filter(Boolean).join("\n");

      const prompt = `${SKILL_FORMAT_SPEC}

Now create a SKILL.md for the following skill. Remember: respond with ONLY the SKILL.md text. No tools, no file writes, no TODO lists.

${formContext ? `${formContext}\n` : ""}User request: ${description}`;

      const result = await sendAiRequest(prompt);
      if (!result) throw new Error("Empty response from AI");

      const extracted = extractSkillMdFromResponse(result);
      setSkillContent(extracted);

      try {
        const parsed = parseSkillMd(extracted);
        if (parsed.name) {
          setFormData(prev => ({
            ...prev,
            name: parsed.title || parsed.name,
            description: parsed.description || prev.description,
          }));
        }
      } catch {
        // frontmatter parse failed, content still set
      }

      setAiGenerateInput("");
      toast("Skill generated by AI", "success");
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setSkillContent(aiContentSnapshotRef.current);
        toast("AI generation cancelled", "info");
      } else {
        toast(`Failed to generate skill: ${error.message || "Unknown error"}`, "error", 5000);
      }
    } finally {
      setAiStatus("idle");
    }
  };

  const ENHANCE_PRESETS = [
    { label: "Rewrite", instruction: "Rewrite this SKILL.md from scratch while preserving the same purpose and intent. Improve structure, clarity, and completeness." },
    { label: "Make Concise", instruction: "Make this SKILL.md more concise. Remove redundancy, tighten language, and keep only essential details while preserving all key information." },
    { label: "Add Examples", instruction: "Add more practical, real-world examples to this SKILL.md. Include diverse use cases and edge cases." },
    { label: "Clarify", instruction: "Improve the clarity of this SKILL.md. Simplify complex instructions, fix ambiguous wording, and ensure each step is easy to follow." },
    { label: "Add Detail", instruction: "Add more detail to the instructions, guidelines, and output format sections. Make each phase more comprehensive." },
  ];

  const handleAiEnhance = async (instruction?: string) => {
    if (!skillContent.trim()) return;

    pushUndoSnapshot(skillContent);
    aiContentSnapshotRef.current = skillContent;
    setAiStatus("enhancing");
    setShowAiEnhanceInput(false);
    setAiDebugLog([]);
    setShowAiDebug(false);

    const enhanceDirective = instruction?.trim()
      || "Improve and enhance this SKILL.md. Make the instructions more detailed and structured, add better examples, improve the guidelines, and ensure it follows best practices.";

    try {
      const formContext = [
        formData.name.trim() && `Skill name: ${formData.name.trim()}`,
        formData.description.trim() && `Skill description: ${formData.description.trim()}`,
      ].filter(Boolean).join("\n");

      const prompt = `${SKILL_FORMAT_SPEC}

${enhanceDirective}

Keep the same intent and core purpose. Remember: respond with ONLY the improved SKILL.md text. No tools, no file writes, no TODO lists.

${formContext ? `Context from form:\n${formContext}\n\n` : ""}Current SKILL.md:
${skillContent}`;

      const result = await sendAiRequest(prompt);
      if (!result) throw new Error("Empty response from AI");

      const extracted = extractSkillMdFromResponse(result);
      setSkillContent(extracted);

      try {
        const parsed = parseSkillMd(extracted);
        if (parsed.name) {
          setFormData(prev => ({
            ...prev,
            name: parsed.title || parsed.name,
            description: parsed.description || prev.description,
          }));
        }
      } catch {
        // frontmatter parse failed, content still set
      }

      setAiEnhanceInput("");
      toast("Skill enhanced by AI", "success");
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setSkillContent(aiContentSnapshotRef.current);
        toast("AI enhancement cancelled", "info");
      } else {
        toast(`Failed to enhance skill: ${error.message || "Unknown error"}`, "error", 5000);
      }
    } finally {
      setAiStatus("idle");
    }
  };

  const handleAiCancel = () => {
    aiClientRef.current = null;
    setSkillContent(aiContentSnapshotRef.current);
    setAiStatus("idle");
    toast("AI operation cancelled", "info");
  };

  const handleSubmit = async () => {
    if (isEditMode && existingConfig?.is_system && !isAdmin) {
      toast("Only administrators can edit system templates.", "warning", 5000);
      return;
    }
    if (!validateForm()) return;

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
      toast(isEditMode ? "Skill updated!" : "Skill created!", "success");

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

  // Parsed preview for frontmatter display
  const parsedPreview = useMemo(() => {
    try { return parseSkillMd(skillContent); } catch { return null; }
  }, [skillContent]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;


  const overlay = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={inline ? "h-full bg-background flex flex-col" : "fixed inset-0 z-50 bg-background flex flex-col"}
    >
      {/* ─── Top Bar ──────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold gradient-text truncate">
              {isEditMode ? "Edit Skill" : "Skills Builder"}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative" ref={templateMenuRef}>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-7 px-2"
              onClick={() => setShowTemplateMenu(!showTemplateMenu)}
            >
              <BookOpen className="h-3 w-3" />
              Load Template
              <ChevronDown className={cn("h-3 w-3 transition-transform", showTemplateMenu && "rotate-180")} />
            </Button>
            <AnimatePresence>
              {showTemplateMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-xl shadow-black/20 z-[9999]"
                >
                  <div className="p-1.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSkillContent(createBlankSkillMd());
                        setFormData(prev => ({ ...prev, name: "", description: "" }));
                        setTags([]);
                        setSelectedTemplateId(null);
                        setShowTemplateMenu(false);
                      }}
                      className={cn(
                        "w-full text-left p-2 rounded-md transition-colors hover:bg-muted/50 border border-transparent",
                        !selectedTemplateId && "bg-muted/30 border-border/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">Blank Skill</p>
                          <p className="text-xs text-muted-foreground truncate">Start from scratch</p>
                        </div>
                      </div>
                    </button>

                    {templatesLoading && (
                      <div className="flex items-center gap-2 p-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
                            setShowTemplateMenu(false);
                          }}
                          className={cn(
                            "w-full text-left p-2 rounded-md transition-colors hover:bg-muted/50 border border-transparent",
                            isSelected && "bg-primary/10 border-primary/30"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <TemplateIcon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{template.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1">{template.description}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => setShowImportPanel(!showImportPanel)}>
            <Upload className="h-3 w-3" />
            Import
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => setPreviewOpen(!previewOpen)}>
            {previewOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            Preview
          </Button>
          <div className="w-px h-5 bg-border/50 mx-1" />
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ─── Import Panel ─────────────────────────────────────────── */}
      <div className="relative">
        <AnimatePresence>
          {showImportPanel && (
            <ImportSkillMdPanel onImport={handleImportSkillMd} onClose={() => setShowImportPanel(false)} />
          )}
        </AnimatePresence>
      </div>

      {/* ─── Collapsible Metadata Strip ───────────────────────────── */}
      <div className="shrink-0 border-b border-border/30 bg-muted/20">
        <button
          type="button"
          onClick={() => setMetadataExpanded(!metadataExpanded)}
          className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-muted/30 transition-colors"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3 w-3" />
            Skill Details
            {formData.name && (
              <Badge variant="outline" className="text-xs h-5 ml-2">{formData.name}</Badge>
            )}
          </span>
          {metadataExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </button>

        <AnimatePresence>
          {metadataExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-2.5">
                {/* System warning */}
                {existingConfig?.is_system && !isAdmin && (
                  <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="text-amber-500 font-medium">System Template - Read Only</span>
                  </div>
                )}

                {/* Row 1: Name + Description + Tags */}
                <div className="grid grid-cols-[1fr_1.5fr_1fr] gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                      Name <span className="text-red-400">*</span>
                    </label>
                    <Input
                      value={formData.name}
                      onChange={(e) => handleInputChange("name", e.target.value)}
                      placeholder="e.g., Review a Specific PR"
                      className={cn("h-8 text-sm", errors.name && "border-red-500")}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                      Description
                    </label>
                    <Input
                      value={formData.description}
                      onChange={(e) => handleInputChange("description", e.target.value)}
                      placeholder="Brief description of what this skill does..."
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                      Tags
                    </label>
                    <TagInput tags={tags} onChange={setTags} suggestions={categorySuggestions} />
                  </div>
                </div>

                {/* Row 2: Visibility + Category + Difficulty + Icon (compact) */}
                <div className="flex items-end gap-4">
                  {/* Visibility */}
                  <div className="shrink-0">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                      Visibility
                    </label>
                    <div className="flex gap-1">
                      {VISIBILITY_OPTIONS.map(opt => {
                        const VIcon = opt.icon;
                        const isActive = visibility === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => { setVisibility(opt.id); if (opt.id !== "team") setSelectedTeamIds([]); }}
                            className={cn(
                              "flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors text-xs",
                              isActive
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-muted/30 border-border/50 hover:bg-muted/50 text-muted-foreground"
                            )}
                          >
                            <VIcon className="h-3 w-3" />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {visibility === "team" && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {teamsLoading ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                          </span>
                        ) : availableTeams.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No teams available</span>
                        ) : (
                          availableTeams.map(team => {
                            const isSelected = selectedTeamIds.includes(team._id);
                            return (
                              <button
                                key={team._id}
                                type="button"
                                onClick={() => {
                                  setSelectedTeamIds(prev =>
                                    isSelected ? prev.filter(id => id !== team._id) : [...prev, team._id]
                                  );
                                }}
                                className={cn(
                                  "flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-colors text-xs",
                                  isSelected
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-muted/30 border-border/50 hover:bg-muted/50 text-muted-foreground"
                                )}
                              >
                                <UsersRound className="h-2.5 w-2.5" />
                                {team.name}
                              </button>
                            );
                          })
                        )}
                        {errors.teams && <span className="text-xs text-red-400 block w-full">{errors.teams}</span>}
                      </div>
                    )}
                  </div>

                  {/* Category */}
                  <div className="shrink-0">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                      Category <span className="text-red-400">*</span>
                    </label>
                    <CategoryPicker
                      value={formData.category}
                      onChange={(cat) => handleInputChange("category", cat)}
                    />
                  </div>

                  {/* Complexity */}
                  <div className="shrink-0">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block uppercase tracking-wider">
                      Complexity
                    </label>
                    <div className="flex gap-1">
                      {DIFFICULTIES.map(diff => (
                        <button
                          key={diff.id}
                          type="button"
                          onClick={() => handleInputChange("difficulty", diff.id)}
                          className={cn(
                            "px-2 py-1 rounded-md border transition-colors text-xs",
                            formData.difficulty === diff.id
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-muted/30 border-border/50 hover:bg-muted/50 text-muted-foreground"
                          )}
                        >
                          {diff.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Icon picker (portal popover) */}
                  <IconPicker
                    value={formData.thumbnail}
                    onChange={(iconName) => handleInputChange("thumbnail", iconName)}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Main Content: Editor | Preview ──────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Editor + Preview (resizable panels) */}
        <PanelGroup orientation="horizontal" className="flex-1">
          {/* Editor Panel */}
          <Panel defaultSize={previewOpen ? 55 : 100} minSize={30}>
            <div className="h-full flex flex-col">
              {/* Editor toolbar */}
              <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/10">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <FileCode className="h-3 w-3" />
                  SKILL.md Editor
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    disabled={!undoAvailable || aiStatus !== "idle"}
                    onClick={handleUndo}
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    disabled={!redoAvailable || aiStatus !== "idle"}
                    onClick={handleRedo}
                    title="Redo (Ctrl+Y)"
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={handleDownloadSkillMd}
                    disabled={!skillContent.trim()}
                    title="Download SKILL.md"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <div className="w-px h-4 bg-border/50 mx-0.5" />
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                      disabled={aiStatus !== "idle"}
                      onClick={() => { setShowAiGenerateInput(!showAiGenerateInput); setShowAiEnhanceInput(false); }}
                    >
                      <Sparkles className="h-3 w-3" />
                      AI Generate
                    </Button>
                    <AnimatePresence>
                      {showAiGenerateInput && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-full right-0 mt-1 z-50 w-80 p-3 rounded-lg border border-border/50 bg-background shadow-xl"
                        >
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Describe the skill you want to create
                          </label>
                          <Input
                            autoFocus
                            value={aiGenerateInput}
                            onChange={(e) => setAiGenerateInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && aiGenerateInput.trim()) handleAiGenerate(); if (e.key === "Escape") setShowAiGenerateInput(false); }}
                            placeholder="e.g., Investigate PagerDuty incidents and correlate with ArgoCD deployments"
                            className="h-8 text-sm mb-2"
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAiGenerateInput(false)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1 gradient-primary text-white"
                              disabled={!aiGenerateInput.trim()}
                              onClick={handleAiGenerate}
                            >
                              <Sparkles className="h-3 w-3" />
                              Generate
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                      disabled={aiStatus !== "idle" || !skillContent.trim()}
                      onClick={() => { setShowAiEnhanceInput(!showAiEnhanceInput); setShowAiGenerateInput(false); }}
                      title="Enhance the current skill with AI"
                    >
                      <WandSparkles className="h-3 w-3" />
                      AI Enhance
                    </Button>
                    <AnimatePresence>
                      {showAiEnhanceInput && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-full right-0 mt-1 z-50 w-80 p-3 rounded-lg border border-border/50 bg-background shadow-xl"
                        >
                          <label className="text-xs font-medium text-muted-foreground mb-2 block">
                            How should the skill be enhanced?
                          </label>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {ENHANCE_PRESETS.map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                className="px-2 py-0.5 text-xs rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/15 transition-colors"
                                onClick={() => { handleAiEnhance(preset.instruction); }}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                          <Input
                            autoFocus
                            value={aiEnhanceInput}
                            onChange={(e) => setAiEnhanceInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && aiEnhanceInput.trim()) handleAiEnhance(aiEnhanceInput); if (e.key === "Escape") setShowAiEnhanceInput(false); }}
                            placeholder="Or describe your own enhancement..."
                            className="h-8 text-sm mb-2"
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAiEnhanceInput(false)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1 gradient-primary text-white"
                              disabled={!aiEnhanceInput.trim()}
                              onClick={() => handleAiEnhance(aiEnhanceInput)}
                            >
                              <WandSparkles className="h-3 w-3" />
                              Enhance
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <span className="text-border">|</span>
                  <a
                    href="https://github.com/anthropics/skills"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-primary transition-colors"
                  >
                    Anthropic SKILL.md Format
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="text-border">|</span>
                  <InsertVariablePopover onInsert={(name) => insertAtCursor(`{{${name}}}`)} />
                </div>
              </div>

              {/* Detected variables strip */}
              {detectedVariables.length > 0 && (
                <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-b border-border/20 bg-primary/[0.03]">
                  <Variable className="h-3 w-3 text-primary/60 shrink-0" />
                  <span className="text-xs text-muted-foreground shrink-0">
                    {detectedVariables.length} variable{detectedVariables.length !== 1 ? "s" : ""} detected:
                  </span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {detectedVariables.map(v => (
                      <span
                        key={v.name}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-xs font-mono text-primary"
                      >
                        <Braces className="h-2.5 w-2.5 opacity-60" />
                        {v.name}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground/60 ml-auto shrink-0">
                    Users will be prompted to fill these
                  </span>
                </div>
              )}

              {/* CodeMirror editor with AI overlay */}
              <div className="flex-1 min-h-0 overflow-hidden relative">
                <React.Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      <span className="text-sm">Loading editor...</span>
                    </div>
                  }
                >
                  <CodeMirrorEditor
                    ref={cmRef}
                    value={skillContent}
                    onChange={(val: string) => setSkillContent(val)}
                    extensions={cmExtensions}
                    theme="dark"
                    height="100%"
                    style={{ height: "100%", fontSize: "15px" }}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                      highlightActiveLine: true,
                      bracketMatching: true,
                      autocompletion: false,
                      indentOnInput: true,
                    }}
                  />
                </React.Suspense>

                {/* AI progress overlay */}
                <AnimatePresence>
                  {aiStatus !== "idle" && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm"
                    >
                      <div className={cn("space-y-4 text-center transition-all duration-200", showAiDebug ? "w-[480px]" : "w-64")}>
                        <div className="relative mx-auto w-10 h-10 rounded-full gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/30">
                          {aiStatus === "generating" ? (
                            <Sparkles className="h-5 w-5 text-white animate-pulse" />
                          ) : (
                            <WandSparkles className="h-5 w-5 text-white animate-pulse" />
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {aiStatus === "generating" ? "AI is writing your skill..." : "AI is enhancing your skill..."}
                        </p>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-primary via-primary/60 to-primary rounded-full"
                            initial={{ x: "-100%" }}
                            animate={{ x: "100%" }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                            style={{ width: "50%" }}
                          />
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs h-7"
                            onClick={handleAiCancel}
                          >
                            <Square className="h-3 w-3" />
                            Cancel
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-xs h-7 text-muted-foreground"
                            onClick={() => setShowAiDebug(!showAiDebug)}
                          >
                            <Terminal className="h-3 w-3" />
                            {showAiDebug ? "Hide" : "Show"} Details
                            {showAiDebug ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </Button>
                        </div>

                        {/* Collapsible A2A debug console */}
                        <AnimatePresence>
                          {showAiDebug && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div
                                data-testid="ai-debug-console"
                                className="mt-2 rounded-lg border border-border/50 bg-zinc-950 text-left overflow-hidden"
                              >
                                <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 bg-zinc-900">
                                  <Terminal className="h-3 w-3 text-green-400" />
                                  <span className="text-xs font-mono text-green-400">A2A Stream</span>
                                  <span className="ml-auto text-xs font-mono text-muted-foreground">
                                    {aiDebugLog.length} event{aiDebugLog.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="max-h-48 overflow-y-auto p-2 font-mono text-xs leading-relaxed">
                                  {aiDebugLog.length === 0 ? (
                                    <p className="text-muted-foreground/50 italic">Waiting for events...</p>
                                  ) : (
                                    aiDebugLog.map((line, i) => (
                                      <p key={i} className="text-green-300/80 break-all">
                                        {line}
                                      </p>
                                    ))
                                  )}
                                  <div ref={aiDebugEndRef} />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {errors.skillContent && (
                <div className="shrink-0 px-3 py-1 bg-red-500/10 border-t border-red-500/30">
                  <p className="text-xs text-red-400">{errors.skillContent}</p>
                </div>
              )}
            </div>
          </Panel>

          {/* Preview Panel */}
          {previewOpen && (
            <>
              <ResizeHandle />
              <Panel defaultSize={45} minSize={20}>
                <div className="h-full flex flex-col">
                  <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/10">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <Eye className="h-3 w-3" />
                      Live Preview
                    </span>
                    {parsedPreview?.name && (
                      <Badge variant="outline" className="text-xs h-5">{parsedPreview.name}</Badge>
                    )}
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4">
                      {parsedPreview ? (
                        <div className="space-y-4">
                          {/* Frontmatter badge strip */}
                          {(parsedPreview.name || parsedPreview.description) && (
                            <div className="p-3 rounded-lg bg-muted/20 border border-border/40 space-y-1.5">
                              {parsedPreview.name && (
                                <p className="text-xs font-mono text-muted-foreground">
                                  <span className="text-primary/60">name:</span> {parsedPreview.name}
                                </p>
                              )}
                              {parsedPreview.description && (
                                <p className="text-xs font-mono text-muted-foreground line-clamp-2">
                                  <span className="text-primary/60">description:</span> {parsedPreview.description}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Rich markdown rendering */}
                          <MarkdownPreview content={skillContent} />
                        </div>
                      ) : (
                        <div className="text-center py-12 text-muted-foreground">
                          <Eye className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">Start typing to see a preview</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* ─── Bottom Bar ──────────────────────────────────────────── */}
      <footer className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {submitStatus === "success" && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle className="h-3.5 w-3.5" /> Saved!
            </motion.div>
          )}
          {submitStatus === "error" && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5" /> Save failed
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isSubmitting || (existingConfig?.is_system && !isAdmin)}
            className="gap-1.5 gradient-primary hover:opacity-90 text-white min-w-[120px] h-8"
          >
            {isSubmitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {isEditMode ? "Updating..." : "Saving..."}</>
            ) : (
              <><Save className="h-3.5 w-3.5" /> {isEditMode ? "Update Skill" : "Save Skill"}</>
            )}
          </Button>
        </div>
      </footer>
    </motion.div>
  );

  if (inline) {
    return <AnimatePresence>{open && overlay}</AnimatePresence>;
  }

  return createPortal(
    <AnimatePresence>{open && overlay}</AnimatePresence>,
    document.body
  );
}


"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, LogOut, ChevronDown, Shield, Users, Hash, Code, ChevronRight, Layers, ExternalLink, Clock, RefreshCw, Bug, Settings, Copy, Check, KeyRound, Lightbulb, FileText, Tag, Wrench, Sparkles, ChevronUp, Search, X, SlidersHorizontal } from "lucide-react";
import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { PreferencesModal } from "@/components/preferences-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";
import type { ChangelogRelease, ChangelogItem } from "@/app/api/changelog/route";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Tech Stack Data
interface TechItem {
  name: string;
  description: string;
  url: string;
  category: "platform" | "protocol" | "frontend" | "backend" | "community";
}

// Helper to get platform name dynamically — uses config.appName
// since techStack is defined at module level (outside component scope).
function getPlatformName(): string {
  return config.appName;
}

// Helper to get platform description dynamically — uses hardcoded defaults
// since techStack is defined at module level (outside component scope).
// The actual values shown in the dialog will come from the config module.
function getPlatformDescription(): string {
  return "Multi-Agent Workflow Automation - Where Humans and AI agents collaborate to deliver high quality outcomes.";
}

const techStack: TechItem[] = [
  { get name() { return getPlatformName(); }, get description() { return getPlatformDescription(); }, url: "https://caipe.io", category: "platform" },
  { name: "A2A Protocol", description: "Agent-to-Agent protocol for inter-agent communication (by Google)", url: "https://google.github.io/A2A/", category: "protocol" },
  { name: "A2UI", description: "Agent-to-User Interface specification for declarative UI widgets", url: "https://a2ui.org/", category: "protocol" },
  { name: "MCP", description: "Model Context Protocol for AI tool integration (by Anthropic)", url: "https://modelcontextprotocol.io/", category: "protocol" },
  { name: "Next.js 15", description: "React framework with App Router and Server Components", url: "https://nextjs.org/", category: "frontend" },
  { name: "React 19", description: "JavaScript library for building user interfaces", url: "https://react.dev/", category: "frontend" },
  { name: "TypeScript", description: "Typed superset of JavaScript for better developer experience", url: "https://www.typescriptlang.org/", category: "frontend" },
  { name: "Tailwind CSS", description: "Utility-first CSS framework for rapid UI development", url: "https://tailwindcss.com/", category: "frontend" },
  { name: "Radix UI", description: "Unstyled, accessible UI components for React", url: "https://www.radix-ui.com/", category: "frontend" },
  { name: "Zustand", description: "Lightweight state management for React applications", url: "https://zustand-demo.pmnd.rs/", category: "frontend" },
  { name: "Framer Motion", description: "Production-ready animation library for React", url: "https://www.framer.com/motion/", category: "frontend" },
  { name: "Sigma.js", description: "JavaScript library for graph visualization and analysis", url: "https://www.sigmajs.org/", category: "frontend" },
  { name: "NextAuth.js", description: "Authentication for Next.js applications with OAuth 2.0 support", url: "https://next-auth.js.org/", category: "frontend" },
  { name: "LangGraph", description: "Framework for building stateful, multi-actor applications with LLMs", url: "https://langchain-ai.github.io/langgraph/", category: "backend" },
  { name: "Python 3.11+", description: "Backend agent implementation with asyncio support", url: "https://www.python.org/", category: "backend" },
  { name: "CNOE", description: "Cloud Native Operational Excellence - Open source IDP reference implementations", url: "https://cnoe.io/", category: "community" },
];

const categoryLabels: Record<TechItem["category"], string> = {
  platform: "Platform",
  protocol: "Protocols",
  frontend: "Frontend",
  backend: "Backend",
  community: "Community",
};

const categoryColors: Record<TechItem["category"], string> = {
  platform: "gradient-primary-br",
  protocol: "bg-gradient-to-br from-purple-500 to-purple-600",
  frontend: "bg-gradient-to-br from-blue-500 to-blue-600",
  backend: "bg-gradient-to-br from-orange-500 to-orange-600",
  community: "bg-gradient-to-br from-green-500 to-green-600",
};

/**
 * Config debug display: render a key-value row for the debug tab.
 */
function ConfigRow({ label, value }: { label: string; value: string | boolean | null | undefined }) {
  const display = value === null || value === undefined
    ? "—"
    : typeof value === "boolean"
      ? value ? "true" : "false"
      : String(value);

  const isBool = typeof value === "boolean";

  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn(
        "text-xs font-mono text-right break-all",
        isBool && value && "text-green-600 dark:text-green-500",
        isBool && !value && "text-muted-foreground",
        !isBool && "text-foreground",
      )}>
        {display}
      </span>
    </div>
  );
}

const GITHUB_REPO_URL = "https://github.com/cnoe-io/ai-platform-engineering";

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);
    const prMatch = remaining.match(/#(\d+)/);

    type Hit = { index: number; length: number; node: React.ReactNode };
    let earliest: Hit | null = null;

    const consider = (h: Hit) => {
      if (!earliest || h.index < earliest.index) earliest = h;
    };

    if (boldMatch?.index !== undefined) {
      consider({
        index: boldMatch.index,
        length: boldMatch[0].length,
        node: <strong key={key++} className="font-semibold text-foreground">{boldMatch[1]}</strong>,
      });
    }

    if (codeMatch?.index !== undefined) {
      consider({
        index: codeMatch.index,
        length: codeMatch[0].length,
        node: <code key={key++} className="px-1 py-0.5 rounded bg-muted text-[11px] font-mono">{codeMatch[1]}</code>,
      });
    }

    if (prMatch?.index !== undefined) {
      consider({
        index: prMatch.index,
        length: prMatch[0].length,
        node: (
          <a
            key={key++}
            href={`${GITHUB_REPO_URL}/pull/${prMatch[1]}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-medium"
          >
            #{prMatch[1]}
          </a>
        ),
      });
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index));
    }
    parts.push(earliest.node);
    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return <>{parts}</>;
}

const sectionIcons: Record<string, React.ReactNode> = {
  Feat: <Sparkles className="h-3.5 w-3.5 text-green-500" />,
  Fix: <Wrench className="h-3.5 w-3.5 text-amber-500" />,
  Refactor: <Code className="h-3.5 w-3.5 text-blue-500" />,
  Perf: <Tag className="h-3.5 w-3.5 text-purple-500" />,
  "BREAKING CHANGE": <Shield className="h-3.5 w-3.5 text-red-500" />,
};

const sectionColors: Record<string, string> = {
  Feat: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  Fix: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  Refactor: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  Perf: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  "BREAKING CHANGE": "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

function filterReleaseByScope(release: ChangelogRelease, scope: string | null): ChangelogRelease | null {
  if (!scope) return release;
  const filteredSections = release.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.scope === scope),
    }))
    .filter((section) => section.items.length > 0);

  if (filteredSections.length === 0) return null;
  return { ...release, sections: filteredSections };
}

function ChangelogSection({ release, defaultOpen, onScopeClick }: {
  release: ChangelogRelease;
  defaultOpen: boolean;
  onScopeClick: (scope: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);

  const totalItems = release.sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">v{release.version}</span>
          </div>
          <span className="text-xs text-muted-foreground">{release.date}</span>
          <span className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
            {totalItems} change{totalItems !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {release.sections.map((section, sIdx) => (
            <div key={sIdx}>
              <div className="flex items-center gap-2 mb-2">
                {sectionIcons[section.type] || <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={cn(
                  "text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border",
                  sectionColors[section.type] || "bg-muted text-muted-foreground border-border"
                )}>
                  {section.type}
                </span>
                <span className="text-[10px] text-muted-foreground">({section.items.length})</span>
              </div>
              <ul className="space-y-1.5 ml-5">
                {section.items.map((item, iIdx) => (
                  <li key={iIdx} className="text-xs text-foreground/80 leading-relaxed flex items-start gap-1.5">
                    <span className="text-muted-foreground mt-1.5 shrink-0">•</span>
                    <span>
                      {item.scope && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onScopeClick(item.scope!); }}
                          className="inline-flex items-center px-1.5 py-0.5 mr-1 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
                          title={`Filter by ${item.scope}`}
                        >
                          {item.scope}
                        </button>
                      )}
                      {renderInlineMarkdown(item.scope ? item.text.replace(/^\*\*[^*]+\*\*:\s*/, "") : item.text)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserMenu() {
  const { data: session, status, update } = useSession();
  const { initialize } = useFeatureFlagStore();
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [systemTab, setSystemTab] = useState("oidc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<'success' | 'error' | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [changelogReleases, setChangelogReleases] = useState<ChangelogRelease[]>([]);
  const [changelogScopes, setChangelogScopes] = useState<string[]>([]);
  const [changelogScopeFilter, setChangelogScopeFilter] = useState<string | null>(null);
  const [changelogScopeSearch, setChangelogScopeSearch] = useState("");
  const [changelogLoading, setChangelogLoading] = useState(false);
  const [changelogError, setChangelogError] = useState<string | null>(null);
  const changelogFetched = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rbacPosture, setRbacPosture] = useState<{
    realm_roles: string[];
    per_kb_roles: string[];
    per_agent_roles: string[];
    teams: Array<{ _id: string; name: string; role?: string }>;
    idp_source: string;
    slack_linked: boolean;
    role: string;
  } | null>(null);
  const [rbacLoading, setRbacLoading] = useState(false);
  const rbacFetched = useRef(false);

  const fetchChangelog = useCallback(async () => {
    if (changelogFetched.current) return;
    changelogFetched.current = true;
    setChangelogLoading(true);
    setChangelogError(null);
    try {
      const res = await fetch("/api/changelog");
      if (!res.ok) throw new Error("Failed to fetch changelog");
      const data = await res.json();
      setChangelogReleases(data.releases || []);
      setChangelogScopes(data.scopes || []);
    } catch (err) {
      console.error("[UserMenu] Changelog fetch failed:", err);
      setChangelogError("Unable to load changelog");
    } finally {
      setChangelogLoading(false);
    }
  }, []);

  const fetchRbacPosture = useCallback(async () => {
    if (rbacFetched.current) return;
    rbacFetched.current = true;
    setRbacLoading(true);
    try {
      const res = await fetch("/api/auth/my-roles");
      if (!res.ok) throw new Error("Failed to fetch RBAC posture");
      const data = await res.json();
      setRbacPosture(data);
    } catch (err) {
      console.error("[UserMenu] RBAC posture fetch failed:", err);
    } finally {
      setRbacLoading(false);
    }
  }, []);

  useEffect(() => { initialize(); }, [initialize]);

  // Close on outside click - MUST be called before any returns (Rules of Hooks)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    function handleOpenChangelog() {
      setSystemTab("changelog");
      setSystemOpen(true);
      setOpen(false);
      fetchChangelog();
    }
    window.addEventListener("open-changelog", handleOpenChangelog);
    return () => window.removeEventListener("open-changelog", handleOpenChangelog);
  }, [fetchChangelog]);

  // Don't render if SSO is not enabled
  if (!config.ssoEnabled) {
    return null;
  }

  // Loading state
  if (status === "loading") {
    return (
      <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
    );
  }

  // Not authenticated
  if (status === "unauthenticated") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signIn("oidc")}
        className="gap-1.5 text-xs"
      >
        <LogIn className="h-3.5 w-3.5" />
        Sign In
      </Button>
    );
  }

  // Decode JWT token for advanced view
  const decodeJWT = (token: string | undefined) => {
    if (!token) return null;
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  };

  const decodedToken = session?.accessToken ? decodeJWT(session.accessToken) : null;

  // Handle manual token refresh
  const handleRefreshToken = async () => {
    setIsRefreshing(true);
    setRefreshResult(null);
    try {
      const updatedSession = await update();
      if (updatedSession) {
        setRefreshResult('success');
        setTimeout(() => setRefreshResult(null), 3000);
      } else {
        setRefreshResult('error');
        setTimeout(() => setRefreshResult(null), 3000);
      }
    } catch (error) {
      console.error('[UserMenu] Token refresh failed:', error);
      setRefreshResult('error');
      setTimeout(() => setRefreshResult(null), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle copy access token to clipboard
  const handleCopyAccessToken = async () => {
    if (!session?.accessToken) return;
    try {
      await navigator.clipboard.writeText(session.accessToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch (err) {
      console.error('[UserMenu] Failed to copy access token:', err);
    }
  };

  // Authenticated - show user menu
  const userInitials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  // Get display name (first name or full name)
  const displayName = session?.user?.name || "User";
  const firstName = displayName.split(" ")[0];

  // Role display
  const userRole = session?.role || 'user';
  const isAdmin = userRole === 'admin';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-2 py-1 rounded-full transition-colors",
          open
            ? "bg-primary/10"
            : "hover:bg-muted"
        )}
      >
        {session?.user?.image ? (
          <img
            src={session.user.image}
            alt={displayName}
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <div className="h-6 w-6 rounded-full gradient-primary-br flex items-center justify-center">
            <span className="text-[10px] font-medium text-white">{userInitials}</span>
          </div>
        )}
        <span className="text-xs font-medium max-w-[100px] truncate">{firstName}</span>
        <ChevronDown className={cn(
          "h-3 w-3 text-muted-foreground transition-transform",
          open && "rotate-180"
        )} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-card border border-border shadow-xl z-50 overflow-hidden"
          >
            {/* User Info */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-3">
                {session?.user?.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user.name || "User"}
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full gradient-primary-br flex items-center justify-center">
                    <span className="text-sm font-medium text-white">{userInitials}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {session?.user?.name || "User"}
                    </p>
                    {/* Role Badge */}
                    <span className={cn(
                      "px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded shrink-0",
                      isAdmin
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-muted text-muted-foreground border border-border"
                    )}>
                      {isAdmin ? "Admin" : "User"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {session?.user?.email || ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Session Info */}
            <div className="p-2 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Shield className="h-3 w-3 flex-shrink-0" />
                <span>Authenticated via SSO</span>
                <span className="text-muted-foreground/50 mx-1">|</span>
                <span className={cn(
                  "font-medium",
                  isAdmin ? "text-primary" : "text-muted-foreground"
                )}>
                  Role: {isAdmin ? "Admin" : "User"}
                </span>
              </div>
            </div>

            {/* System Section — single menu item for all system info */}
            <div className="border-b border-border">
              <button
                onClick={() => {
                  setSystemOpen(true);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-3.5 w-3.5" />
                  <span>System</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Insights */}
            {config.mongodbEnabled && (
              <div className="border-b border-border">
                <a
                  href="/insights"
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5" />
                    <span>Personal Insights</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            {/* Preferences */}
            <div className="border-b border-border">
              <button
                onClick={() => {
                  setPrefsOpen(true);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Preferences</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Actions */}
            <div className="p-1.5">
              <button
                onClick={() => {
                  setOpen(false);
                  signOut({ callbackUrl: '/login' });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preferences Modal */}
      <PreferencesModal open={prefsOpen} onOpenChange={setPrefsOpen} />

      {/* System Dialog — tabbed: OIDC Token, Debug, Built With */}
      <Dialog open={systemOpen} onOpenChange={(open) => { setSystemOpen(open); if (!open) setSystemTab("oidc"); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] p-0">
          <DialogHeader className="p-6 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl gradient-primary-br">
                <Settings className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle>System — {config.appName}</DialogTitle>
                <DialogDescription>
                  {config.tagline}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Tabs value={systemTab} className="w-full" onValueChange={(val) => { setSystemTab(val); if (val === "changelog") fetchChangelog(); if (val === "rbac") fetchRbacPosture(); }}>
            <div className="px-6 pt-2 border-b border-border">
              <TabsList className="bg-transparent h-auto p-0 gap-4">
                <TabsTrigger
                  value="rbac"
                  className="px-1 pb-2 pt-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium"
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                  My RBAC
                </TabsTrigger>
                <TabsTrigger
                  value="oidc"
                  className="px-1 pb-2 pt-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium"
                >
                  <Code className="h-3.5 w-3.5 mr-1.5" />
                  OIDC Token
                </TabsTrigger>
                <TabsTrigger
                  value="debug"
                  className="px-1 pb-2 pt-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium"
                >
                  <Bug className="h-3.5 w-3.5 mr-1.5" />
                  Debug
                </TabsTrigger>
                <TabsTrigger
                  value="built-with"
                  className="px-1 pb-2 pt-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium"
                >
                  <Layers className="h-3.5 w-3.5 mr-1.5" />
                  Built With
                </TabsTrigger>
                <TabsTrigger
                  value="changelog"
                  className="px-1 pb-2 pt-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Changelog
                </TabsTrigger>
              </TabsList>
            </div>

            {/* My RBAC Tab */}
            <TabsContent value="rbac" className="mt-0">
              <div className="p-6 overflow-y-auto max-h-[50vh] space-y-6">
                {rbacLoading && (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!rbacLoading && rbacPosture && (
                  <>
                    {/* Platform Role */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">Platform Role</span>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-4 border border-border">
                        <span className={cn(
                          "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                          rbacPosture.role === "admin"
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "bg-muted text-muted-foreground border border-border"
                        )}>
                          {rbacPosture.role === "admin" ? "Admin" : "User"}
                        </span>
                        <div className="mt-2 text-xs text-muted-foreground">
                          IdP: <span className="font-mono">{rbacPosture.idp_source}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Slack: {rbacPosture.slack_linked ? (
                            <span className="text-green-600 dark:text-green-500 font-medium">Linked</span>
                          ) : (
                            <span className="text-muted-foreground">Not linked</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Realm Roles */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <KeyRound className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">Realm Roles</span>
                        <span className="text-xs text-muted-foreground/70">({rbacPosture.realm_roles.length})</span>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-4 border border-border">
                        {rbacPosture.realm_roles.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {rbacPosture.realm_roles.map((role) => (
                              <span key={role} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                {role}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No realm roles assigned</span>
                        )}
                      </div>
                    </div>

                    {/* Teams */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">Teams</span>
                        <span className="text-xs text-muted-foreground/70">({rbacPosture.teams.length})</span>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-4 border border-border">
                        {rbacPosture.teams.length > 0 ? (
                          <div className="space-y-2">
                            {rbacPosture.teams.map((team) => (
                              <div key={team._id} className="flex items-center justify-between">
                                <span className="text-sm font-medium">{team.name}</span>
                                {team.role && (
                                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                    {team.role}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not a member of any team</span>
                        )}
                      </div>
                    </div>

                    {/* Per-KB Roles */}
                    {rbacPosture.per_kb_roles.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Layers className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Knowledge Base Access</span>
                          <span className="text-xs text-muted-foreground/70">({rbacPosture.per_kb_roles.length})</span>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-4 border border-border">
                          <div className="space-y-1.5">
                            {rbacPosture.per_kb_roles.map((role) => {
                              const [type, id] = role.split(":");
                              return (
                                <div key={role} className="flex items-center justify-between text-xs">
                                  <span className="font-mono text-foreground/80">{id}</span>
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                    type === "kb_admin"
                                      ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                                      : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                  )}>
                                    {type === "kb_admin" ? "admin" : "reader"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Per-Agent Roles */}
                    {rbacPosture.per_agent_roles.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Code className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Agent Access</span>
                          <span className="text-xs text-muted-foreground/70">({rbacPosture.per_agent_roles.length})</span>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-4 border border-border">
                          <div className="space-y-1.5">
                            {rbacPosture.per_agent_roles.map((role) => {
                              const [type, id] = role.split(":");
                              return (
                                <div key={role} className="flex items-center justify-between text-xs">
                                  <span className="font-mono text-foreground/80">{id}</span>
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                    type === "agent_admin"
                                      ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                                      : "bg-green-500/10 text-green-600 dark:text-green-400"
                                  )}>
                                    {type === "agent_admin" ? "admin" : "user"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {!rbacLoading && !rbacPosture && (
                  <div className="text-center py-12">
                    <span className="text-xs text-muted-foreground">Unable to load RBAC posture</span>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* OIDC Token Tab */}
            <TabsContent value="oidc" className="mt-0">
              <div className="p-6 overflow-y-auto max-h-[50vh] space-y-6">
                {/* Token Expiry Information */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Token Information</span>
                  </div>
                  <div className="space-y-3">
                    {/* Access Token Expiry */}
                    {session?.expiresAt && (
                      <div className="bg-muted/30 rounded-lg p-3 border border-border">
                        <div className="flex items-start gap-2">
                          <Code className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-xs font-medium">Access Token</div>
                              {session?.accessToken && (
                                <button
                                  onClick={handleCopyAccessToken}
                                  className={cn(
                                    "flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md transition-all",
                                    tokenCopied
                                      ? "bg-green-500/10 text-green-600 dark:text-green-500 border border-green-500/30"
                                      : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border"
                                  )}
                                  title="Copy access token to clipboard"
                                >
                                  {tokenCopied ? (
                                    <>
                                      <Check className="h-3 w-3" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy Token
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Expires: {new Date(session.expiresAt * 1000).toLocaleString()}
                            </div>
                            <div className="text-xs text-muted-foreground/70 mt-1">
                              {(() => {
                                const now = Math.floor(Date.now() / 1000);
                                const remaining = session.expiresAt - now;
                                const hours = Math.floor(remaining / 3600);
                                const minutes = Math.floor((remaining % 3600) / 60);
                                return remaining > 0
                                  ? `${hours}h ${minutes}m remaining`
                                  : 'Expired';
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Refresh Token Info */}
                    <div className="bg-muted/30 rounded-lg p-3 border border-border">
                      <div className="flex items-start gap-2">
                        <RefreshCw className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="text-xs font-medium mb-1">Refresh Token</div>
                          {session?.hasRefreshToken ? (
                            <>
                              <div className="text-xs text-green-600 dark:text-green-500 font-medium mb-1">
                                ✓ Available - Auto-renewal enabled
                              </div>
                              {session.refreshTokenExpiresAt ? (
                                <>
                                  <div className="text-xs text-muted-foreground">
                                    Expires: {new Date(session.refreshTokenExpiresAt * 1000).toLocaleString()}
                                  </div>
                                  <div className="text-xs text-muted-foreground/70 mt-1">
                                    {(() => {
                                      const now = Math.floor(Date.now() / 1000);
                                      const remaining = session.refreshTokenExpiresAt - now;
                                      const days = Math.floor(remaining / 86400);
                                      const hours = Math.floor((remaining % 86400) / 3600);
                                      return remaining > 0
                                        ? `${days}d ${hours}h remaining`
                                        : 'Expired';
                                    })()}
                                  </div>
                                </>
                              ) : (
                                <div className="text-xs text-muted-foreground/70">
                                  Expiry information not provided by OIDC provider
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-xs text-yellow-600 dark:text-yellow-500">
                              Not available - Token will expire without renewal
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Manual Refresh Button */}
                    {session?.hasRefreshToken && (
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={handleRefreshToken}
                          disabled={isRefreshing}
                          className={cn(
                            "flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg transition-all",
                            "bg-primary text-primary-foreground hover:bg-primary/90",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                          )}
                        >
                          <RefreshCw className={cn(
                            "h-4 w-4",
                            isRefreshing && "animate-spin"
                          )} />
                          {isRefreshing ? "Refreshing..." : "Refresh Access Token"}
                        </button>
                        {refreshResult === 'success' && (
                          <div className="text-xs text-green-600 dark:text-green-500 text-center font-medium">
                            ✓ Token refreshed successfully
                          </div>
                        )}
                        {refreshResult === 'error' && (
                          <div className="text-xs text-red-600 dark:text-red-500 text-center font-medium">
                            ✗ Token refresh failed
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Group Memberships from decoded access token */}
                {(() => {
                  const groups: string[] = [];
                  if (decodedToken) {
                    const groupClaims = ['members', 'memberOf', 'groups', 'group', 'roles', 'cognito:groups'];
                    for (const claim of groupClaims) {
                      const value = decodedToken[claim];
                      if (Array.isArray(value)) {
                        groups.push(...value.map(String));
                      } else if (typeof value === 'string') {
                        groups.push(...value.split(/[,\s]+/).filter(Boolean));
                      }
                    }
                  }

                  if (groups.length === 0) return null;

                  return (
                    <div>
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Group Memberships</span>
                          <span className="text-xs text-muted-foreground/70">
                            ({groups.length})
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground/70 ml-6">
                          OIDC groups from access token claims
                        </p>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-4 border border-border">
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {groups.map((group, index) => (
                            <div
                              key={index}
                              className="text-sm font-mono text-foreground/80 break-all"
                              title={group}
                            >
                              • {group}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </TabsContent>

            {/* Debug Tab */}
            <TabsContent value="debug" className="mt-0">
              <div className="p-6 overflow-y-auto max-h-[50vh] space-y-6">
                {/* Auth Status */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Auth Status</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-4 border border-border space-y-0">
                    <ConfigRow label="Email" value={session?.user?.email} />
                    <ConfigRow label="Name" value={session?.user?.name} />
                    <ConfigRow label="Role" value={userRole} />
                    <ConfigRow label="Authorized" value={session?.isAuthorized} />
                    <ConfigRow label="Has Refresh Token" value={session?.hasRefreshToken} />
                    <ConfigRow label="Session Error" value={session?.error || "none"} />
                    {session?.expiresAt && (
                      <ConfigRow
                        label="Token Expires"
                        value={new Date(session.expiresAt * 1000).toLocaleString()}
                      />
                    )}
                  </div>
                </div>

                {/* Runtime Config */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Runtime Config</span>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">window.__APP_CONFIG__</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-4 border border-border space-y-0">
                    <ConfigRow label="App Name" value={config.appName} />
                    <ConfigRow label="Tagline" value={config.tagline} />
                    <ConfigRow label="Description" value={config.description} />
                    <ConfigRow label="Logo URL" value={config.logoUrl} />
                    <ConfigRow label="Logo Style" value={config.logoStyle} />
                    <ConfigRow label="Env Badge" value={config.envBadge || '(hidden)'} />
                    <ConfigRow label="Show Powered By" value={config.showPoweredBy} />
                    <ConfigRow label="Support Email" value={config.supportEmail} />
                  </div>
                </div>

                {/* Feature Flags */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Feature Flags</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-4 border border-border space-y-0">
                    <ConfigRow label="SSO Enabled" value={config.ssoEnabled} />
                    <ConfigRow label="RAG Enabled" value={config.ragEnabled} />
                    <ConfigRow label="MongoDB Enabled" value={config.mongodbEnabled} />
                    <ConfigRow label="Allow Dev Admin (no SSO)" value={config.allowDevAdminWhenSsoDisabled} />
                    <ConfigRow label="Storage Mode" value={config.storageMode} />
                  </div>
                </div>

                {/* URLs / Services */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Services</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-4 border border-border space-y-0">
                    <ConfigRow label={`${config.appName} URL`} value={config.caipeUrl} />
                    <ConfigRow label="RAG URL" value={config.ragUrl} />
                    <ConfigRow label="Environment" value={config.isDev ? "development" : config.isProd ? "production" : "unknown"} />
                  </div>
                </div>

                {/* Theme / Branding */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Theme</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-4 border border-border space-y-0">
                    <ConfigRow label="Gradient From" value={config.gradientFrom} />
                    <ConfigRow label="Gradient To" value={config.gradientTo} />
                    <ConfigRow label="Spinner Color" value={config.spinnerColor} />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Built With Tab */}
            <TabsContent value="built-with" className="mt-0">
              <div className="p-6 overflow-y-auto max-h-[50vh]">
                {(["platform", "protocol", "frontend", "backend", "community"] as const).map((category) => {
                  const items = techStack.filter(item => item.category === category);
                  if (items.length === 0) return null;

                  return (
                    <div key={category} className="mb-6 last:mb-0">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        {categoryLabels[category]}
                      </h3>
                      <div className="space-y-2">
                        {items.map((tech) => (
                          <a
                            key={tech.name}
                            href={tech.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group border border-transparent hover:border-border"
                          >
                            <div className={cn(
                              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold",
                              categoryColors[tech.category]
                            )}>
                              {tech.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm group-hover:text-primary transition-colors">
                                  {tech.name}
                                </span>
                                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {tech.description}
                              </p>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {/* Changelog Tab */}
            <TabsContent value="changelog" className="mt-0">
              <div className="flex flex-col max-h-[60vh]">
                {changelogLoading && (
                  <div className="flex items-center justify-center py-12 px-6">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading changelog...</span>
                    </div>
                  </div>
                )}

                {changelogError && (
                  <div className="flex flex-col items-center gap-3 py-12 px-6">
                    <p className="text-sm text-muted-foreground">{changelogError}</p>
                    <button
                      onClick={() => { changelogFetched.current = false; fetchChangelog(); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {!changelogLoading && !changelogError && changelogReleases.length === 0 && (
                  <div className="flex items-center justify-center py-12 px-6">
                    <span className="text-xs text-muted-foreground">No releases found</span>
                  </div>
                )}

                {!changelogLoading && !changelogError && changelogReleases.length > 0 && (
                  <>
                    {/* Sticky scope filter bar */}
                    <div className="px-6 pt-4 pb-3 border-b border-border bg-card sticky top-0 z-10 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {changelogScopeFilter ? (
                            <>
                              Filtered by{" "}
                              <button
                                onClick={() => setChangelogScopeFilter(null)}
                                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                              >
                                {changelogScopeFilter}
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <>
                              {changelogReleases.length} stable release{changelogReleases.length !== 1 ? "s" : ""}
                            </>
                          )}
                        </p>
                        <a
                          href="https://github.com/cnoe-io/ai-platform-engineering/blob/main/CHANGELOG.md"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                        >
                          View on GitHub
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      {changelogScopes.length > 0 && (
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <input
                              type="text"
                              placeholder="Search components..."
                              value={changelogScopeSearch}
                              onChange={(e) => setChangelogScopeSearch(e.target.value)}
                              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-muted/30 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                            />
                            {changelogScopeSearch && (
                              <button
                                onClick={() => setChangelogScopeSearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {!changelogScopeSearch && (
                              <button
                                onClick={() => { setChangelogScopeFilter(null); setChangelogScopeSearch(""); }}
                                className={cn(
                                  "px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                                  !changelogScopeFilter
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                                )}
                              >
                                All
                              </button>
                            )}
                            {changelogScopes
                              .filter((s) => !changelogScopeSearch || s.includes(changelogScopeSearch.toLowerCase()))
                              .map((scope) => (
                                <button
                                  key={scope}
                                  onClick={() => { setChangelogScopeFilter(changelogScopeFilter === scope ? null : scope); setChangelogScopeSearch(""); }}
                                  className={cn(
                                    "px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                                    changelogScopeFilter === scope
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                                  )}
                                >
                                  {scope}
                                </button>
                              ))}
                            {changelogScopeSearch && changelogScopes.filter((s) => s.includes(changelogScopeSearch.toLowerCase())).length === 0 && (
                              <span className="text-[11px] text-muted-foreground py-1">No matching components</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Scrollable release list */}
                    <div className="p-6 overflow-y-auto flex-1 space-y-3">
                      {(() => {
                        const filtered = changelogReleases
                          .map((r) => filterReleaseByScope(r, changelogScopeFilter))
                          .filter((r): r is ChangelogRelease => r !== null);

                        if (filtered.length === 0) {
                          return (
                            <div className="flex flex-col items-center gap-2 py-12">
                              <span className="text-sm text-muted-foreground">
                                No changes found for <span className="font-semibold text-primary">{changelogScopeFilter}</span>
                              </span>
                              <button
                                onClick={() => setChangelogScopeFilter(null)}
                                className="text-xs text-primary hover:underline"
                              >
                                Clear filter
                              </button>
                            </div>
                          );
                        }

                        return filtered.map((release, idx) => (
                          <ChangelogSection
                            key={release.version}
                            release={release}
                            defaultOpen={idx === 0}
                            onScopeClick={(scope) => setChangelogScopeFilter(scope)}
                          />
                        ));
                      })()}
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <div className="p-4 border-t border-border bg-muted/20">
            <p className="text-xs text-center text-muted-foreground">
              Built with ❤️ by the{" "}
              <a
                href="https://caipe.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                caipe.io
              </a>{" "}
              OSS community
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

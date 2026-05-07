"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useAdminRole } from "@/hooks/use-admin-role";
import {
  BookOpen,
  Zap,
  Loader2,
  Database,
  Shield,
  FileText,
  Workflow,
  Home,
  Bot,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { GithubIcon as Github } from "@/components/ui/icons";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";
import { config, getLogoFilterClass } from "@/lib/config";
import { useChatStore } from "@/store/chat-store";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { UnsavedChangesDialog } from "@/components/task-builder/UnsavedChangesDialog";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { useAgentRuntimeHealth } from "@/hooks/use-agent-runtime-health";
import { useVersion } from "@/hooks/use-version";
import { ReportProblemDialog } from "@/components/ticket/ReportProblemDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Format seconds into a human-readable interval (e.g., "3h", "30m", "45s") */
function formatInterval(seconds: number): string {
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function GuardedLink({
  href,
  children,
  className,
  prefetch,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  prefetch?: boolean;
}) {
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChangesStore();
  const pathname = usePathname();

  const isOnTaskBuilderEditor =
    pathname?.startsWith("/task-builder") && hasUnsavedChanges;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isOnTaskBuilderEditor && href !== pathname) {
      e.preventDefault();
      requestNavigation(href);
    }
  };

  return (
    <Link href={href} prefetch={prefetch} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isAdmin, canViewAdmin, canAccessDynamicAgents } = useAdminRole();
  const { isStreaming, streamingConversations, unviewedConversations, inputRequiredConversations } = useChatStore();
  const {
    hasUnsavedChanges,
    pendingNavigationHref,
    cancelNavigation,
    confirmNavigation,
    setUnsaved,
  } = useUnsavedChangesStore();

  const isOnTaskBuilderEditor =
    pathname?.startsWith("/task-builder") && hasUnsavedChanges;

  const handleDiscard = React.useCallback(() => {
    const href = confirmNavigation();
    if (href) {
      setUnsaved(false);
      window.location.href = href;
    }
  }, [confirmNavigation, setUnsaved]);

  const handleCancel = React.useCallback(() => {
    cancelNavigation();
  }, [cancelNavigation]);

  const [reportDialogOpen, setReportDialogOpen] = React.useState(false);

  // Debug logging for admin tab
  React.useEffect(() => {
    if (session) {
      console.log('[AppHeader] Session role:', session.role);
      // Note: groups removed from session to prevent oversized cookies
      console.log('[AppHeader] Is admin (with MongoDB check)?', isAdmin);
    }
  }, [session, isAdmin]);

  // Health check for CAIPE supervisor (polls every 30 seconds)
  const {
    status: caipeStatus,
    url: caipeUrl,
    secondsUntilNextCheck: caipeNextCheck,
    agents,
    tags,
    mongoDBStatus,
    storageMode
  } = useCAIPEHealth();

  // Health check for RAG server (polls every 30 seconds)
  const {
    status: ragStatus,
    url: ragUrl,
    secondsUntilNextCheck: ragNextCheck,
    graphRagEnabled,
    cleanupConfig
  } = useRAGHealth();

  // Health check for Agent Runtime (polls every 30 seconds)
  const { status: agentRuntimeStatus } = useAgentRuntimeHealth();

  // Check if RAG is enabled in config
  const ragEnabled = config.ragEnabled;

  // Fetch version info
  const { versionInfo } = useVersion();

  // Combined status: if either is checking -> checking, if supervisor is disconnected -> disconnected,
  // if only RAG is disconnected (supervisor connected) -> rag-disconnected (amber warning), else connected
  // Note: Only include RAG in status if it's enabled
  const getCombinedStatus = () => {
    if (caipeStatus === "checking") return "checking";
    if (ragEnabled && ragStatus === "checking") return "checking";
    if (caipeStatus === "disconnected") return "disconnected";
    if (ragEnabled && ragStatus === "disconnected") return "rag-disconnected";
    return "connected";
  };

  const combinedStatus = getCombinedStatus();
  const autonomousAgentsEnabled = config.autonomousAgentsEnabled;

  const getActiveTab = () => {
    if (pathname === "/") return "home";
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    if (pathname?.startsWith("/task-builder")) return "task-builder";
    if (pathname?.startsWith("/autonomous")) return "autonomous";
    if (pathname?.startsWith("/skills") || pathname?.startsWith("/use-cases")) return "skills";
    if (pathname?.startsWith("/dynamic-agents")) return "dynamic-agents";
    if (pathname?.startsWith("/admin")) return "admin";
    return "home";
  };

  const activeTab = getActiveTab();

  return (
    <>
    <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between px-4 shrink-0 z-50">
      <div className="flex items-center gap-4 min-w-0">
        {/* Logo - clickable to home */}
        <GuardedLink
          href="/"
          className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity shrink-0"
        >
          <img
            src={config.logoUrl}
            alt={`${config.appName} Logo`}
            className={`h-8 w-auto ${getLogoFilterClass(config.logoStyle)}`}
          />
          <span className="font-bold text-base gradient-text">{config.appName}</span>
          {config.envBadge && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded">
              {config.envBadge}
            </span>
          )}
        </GuardedLink>

        {/* Navigation Pills */}
        <div className="flex items-center flex-nowrap min-w-0 bg-muted/50 rounded-full p-1">
          <GuardedLink
            href="/"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
              activeTab === "home"
                ? "gradient-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Home className="h-3.5 w-3.5 shrink-0" />
            Home
          </GuardedLink>
          <GuardedLink
            href="/chat"
            prefetch={true}
            className={cn(
              "relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
              activeTab === "chat"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            💬 Chat
            {streamingConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-emerald-500 text-[9px] font-bold text-white">
                  {streamingConversations.size}
                </span>
              </span>
            )}
            {streamingConversations.size === 0 && inputRequiredConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-amber-500 text-[9px] font-bold text-white">
                  {inputRequiredConversations.size}
                </span>
              </span>
            )}
            {streamingConversations.size === 0 && inputRequiredConversations.size === 0 && unviewedConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-blue-500 text-[9px] font-bold text-white">
                  {unviewedConversations.size}
                </span>
              </span>
            )}
          </GuardedLink>
          <GuardedLink
            href="/skills"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
              activeTab === "skills"
                ? "gradient-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5 shrink-0" />
            Skills
          </GuardedLink>
          <GuardedLink
            href="/task-builder"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
              activeTab === "task-builder"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Workflow className="h-3.5 w-3.5 shrink-0" />
            Task Builder
          </GuardedLink>
          {autonomousAgentsEnabled && (
            <GuardedLink
              href="/autonomous"
              prefetch={true}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
                activeTab === "autonomous"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Autonomous
            </GuardedLink>
          )}
          {/* Knowledge Bases tab - only show if RAG is enabled */}
          {ragEnabled && (
            <GuardedLink
              href="/knowledge-bases"
              prefetch={true}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
                activeTab === "knowledge"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Database className="h-3.5 w-3.5 shrink-0" />
               Knowledge Bases
            </GuardedLink>
          )}
          {/* Dynamic Agents tab - gated by OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP (falls back to admin) */}
          {canAccessDynamicAgents && storageMode === 'mongodb' && config.dynamicAgentsEnabled && (
            <GuardedLink
              href="/dynamic-agents"
              prefetch={true}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
                activeTab === "dynamic-agents"
                  ? "bg-purple-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Bot className="h-3.5 w-3.5 shrink-0" />
              Agents
            </GuardedLink>
          )}
          {/* Admin tab - visible to all authenticated users (readonly), admins get full access */}
          {canViewAdmin && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {storageMode === 'mongodb' ? (
                    <GuardedLink
                      href="/admin"
                      prefetch={true}
                      className={cn(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
                        activeTab === "admin" && isAdmin
                          ? "bg-red-500 text-white shadow-sm"
                          : activeTab === "admin"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Shield className="h-3.5 w-3.5 shrink-0" />
                      Admin
                    </GuardedLink>
                  ) : (
                    <div
                      className={cn(
                        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all cursor-not-allowed",
                        "text-muted-foreground/50 opacity-50"
                      )}
                    >
                      <Shield className="h-3.5 w-3.5 shrink-0" />
                      Admin
                    </div>
                  )}
                </TooltipTrigger>
                {storageMode !== 'mongodb' && (
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs">
                      Admin dashboard requires MongoDB to be configured. Please set up MongoDB to enable user and team management.
                    </p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Status & Actions */}
      <div className="flex items-center gap-3">
        {/* Combined Connection Status */}
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:scale-105",
                  combinedStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/20",
                  combinedStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  combinedStatus === "rag-disconnected" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  combinedStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                )}
              >
                {combinedStatus === "checking" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    combinedStatus === "connected" && "bg-green-400",
                    combinedStatus === "rag-disconnected" && "bg-amber-400",
                    combinedStatus === "disconnected" && "bg-red-400",
                    isStreaming && "animate-pulse"
                  )} />
                )}
                {combinedStatus === "connected" ? "Connected" :
                 combinedStatus === "checking" ? "Checking" :
                 combinedStatus === "rag-disconnected" ? "RAG Disconnected" :
                 "Disconnected"}
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-[600px] p-0 overflow-hidden border-2">
              <div className="bg-gradient-to-br from-card via-card to-card/95">
                {/* Header with gradient */}
                <div className="gradient-primary-br p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-base font-bold text-white mb-1">System Status</div>
                      <div className="text-xs text-white/80">{config.appName} Supervisor & RAG Server</div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full",
                        combinedStatus === "connected" ? "bg-green-400 animate-pulse" :
                        combinedStatus === "checking" ? "bg-amber-400 animate-pulse" :
                        combinedStatus === "rag-disconnected" ? "bg-amber-400" : "bg-red-400"
                      )} />
                      <span className="text-xs font-medium text-white">
                        {combinedStatus === "connected" ? "All Systems Live" :
                         combinedStatus === "checking" ? "Checking" :
                         combinedStatus === "rag-disconnected" ? "RAG Offline" :
                         "Issues Detected"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* CAIPE Supervisor Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-foreground">{config.appName} Supervisor</div>
                        <div className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold",
                          caipeStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                          caipeStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                          caipeStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
                        )}>
                          {caipeStatus === "connected" ? "ONLINE" : caipeStatus === "checking" ? "CHECKING" : "OFFLINE"}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        Next check: {caipeNextCheck}s
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono break-all bg-muted/30 rounded px-2 py-1">
                      {caipeUrl}
                    </div>

                    {/* Agent Info */}
                    {agents.length > 0 && (
                      <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg gradient-primary-br flex items-center justify-center shrink-0">
                            <span className="text-lg font-bold text-white">AI</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm text-foreground mb-1">
                              {agents[0].name}
                            </div>
                            {agents[0].description && (
                              <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                {agents[0].description}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Storage Status */}
                    <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Storage Backend
                        </div>
                        <div className={cn(
                          "flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
                          mongoDBStatus === 'connected' && "bg-green-500/10 border-green-500/20",
                          mongoDBStatus === 'disconnected' && "bg-amber-500/10 border-amber-500/20",
                          mongoDBStatus === 'checking' && "bg-muted/50 border-border"
                        )}>
                          {mongoDBStatus === 'checking' ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          ) : (
                            <span className={cn(
                              "inline-block w-1.5 h-1.5 rounded-full",
                              mongoDBStatus === 'connected' && "bg-green-400",
                              mongoDBStatus === 'disconnected' && "bg-amber-400"
                            )} />
                          )}
                          <span className={cn(
                            "text-[10px] font-bold",
                            mongoDBStatus === 'connected' && "text-green-600 dark:text-green-400",
                            mongoDBStatus === 'disconnected' && "text-amber-600 dark:text-amber-400",
                            mongoDBStatus === 'checking' && "text-muted-foreground"
                          )}>
                            {mongoDBStatus === 'checking' ? 'Checking' : mongoDBStatus === 'connected' ? 'MongoDB' : 'localStorage'}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {mongoDBStatus === 'connected' && (
                          <span>✓ Persistent storage with cross-device sync</span>
                        )}
                        {mongoDBStatus === 'disconnected' && (
                          <span>Local browser storage (no sync)</span>
                        )}
                        {mongoDBStatus === 'checking' && (
                          <span>Checking backend availability...</span>
                        )}
                      </div>
                    </div>

                    {/* Integrations */}
                    {tags.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Connected Integrations
                          </div>
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                            <span className="text-[10px] font-bold text-primary">{tags.length}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                          {tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-gradient-to-br from-primary/10 to-primary/5 text-primary border border-primary/20 hover:border-primary/40 hover:bg-primary/15 transition-all"
                            >
                              <span className="inline-block w-1 h-1 rounded-full bg-green-400" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* RAG Server Section - only show if RAG is enabled */}
                  {ragEnabled && (
                    <>
                      {/* Divider */}
                      <div className="border-t border-border/50" />

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-foreground">RAG Server</div>
                            <div className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold",
                              ragStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                              ragStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                              ragStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
                            )}>
                              {ragStatus === "connected" ? "ONLINE" : ragStatus === "checking" ? "CHECKING" : "OFFLINE"}
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            Next check: {ragNextCheck}s
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono break-all bg-muted/30 rounded px-2 py-1">
                          {ragUrl}
                        </div>

                        {/* Graph RAG Status */}
                        <div className="flex items-center justify-between bg-muted/20 rounded px-2 py-1.5">
                          <div className="text-xs text-muted-foreground">Knowledge Graph</div>
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold",
                            graphRagEnabled
                              ? "bg-green-500/15 text-green-400 border border-green-500/30"
                              : "bg-gray-500/15 text-gray-400 border border-gray-500/30"
                          )}>
                            {graphRagEnabled ? "ON" : "OFF"}
                          </div>
                        </div>

                        {/* Auto-Cleanup Status */}
                        {cleanupConfig && (
                          <div className="bg-muted/20 rounded px-2 py-1.5 space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-muted-foreground">Auto-Cleanup</div>
                              <div className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-bold",
                                cleanupConfig.enabled
                                  ? "bg-green-500/15 text-green-400 border border-green-500/30"
                                  : "bg-gray-500/15 text-gray-400 border border-gray-500/30"
                              )}>
                                {cleanupConfig.enabled ? formatInterval(cleanupConfig.interval_seconds) : "OFF"}
                              </div>
                            </div>
                            {cleanupConfig.enabled && (
                              <div className="text-[10px] text-muted-foreground">
                                {cleanupConfig.last_cleanup ? (
                                  <>
                                    <div>Last: {formatRelativeTime(cleanupConfig.last_cleanup)}</div>
                                    <div>Next: {formatRelativeTime(cleanupConfig.last_cleanup + cleanupConfig.interval_seconds)}</div>
                                  </>
                                ) : (
                                  <>Waiting for first cleanup...</>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Agent Runtime Section */}
                  <>
                    {/* Divider */}
                    <div className="border-t border-border/50" />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-bold text-foreground">Agent Runtime</div>
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold",
                            agentRuntimeStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                            agentRuntimeStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                            agentRuntimeStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
                          )}>
                            {agentRuntimeStatus === "connected" ? "ONLINE" : agentRuntimeStatus === "checking" ? "CHECKING" : "OFFLINE"}
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Agents sub-item */}
                      <div className="flex items-center justify-between bg-muted/20 rounded px-2 py-1.5">
                        <div className="text-xs text-muted-foreground">CAIPE Dynamic Agents</div>
                        <div className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold",
                          agentRuntimeStatus === "connected"
                            ? "bg-green-500/15 text-green-400 border border-green-500/30"
                            : agentRuntimeStatus === "checking"
                            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                            : "bg-red-500/15 text-red-400 border border-red-500/30"
                        )}>
                          {agentRuntimeStatus === "connected" ? "ON" : agentRuntimeStatus === "checking" ? "..." : "OFF"}
                        </div>
                      </div>
                    </div>
                  </>
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span>Health checks active (30s interval)</span>
                    </div>
                    <div className="text-muted-foreground">
                      {combinedStatus === "connected" ? "All systems operational" :
                       combinedStatus === "checking" ? "Checking status..." :
                       combinedStatus === "rag-disconnected" ? "RAG server unavailable" :
                       "Check logs for details"}
                    </div>
                  </div>
                  {versionInfo && (
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">UI Version:</span>
                        <span>{versionInfo.version}</span>
                        {versionInfo.gitCommit !== "unknown" && (
                          <span className="text-muted-foreground/60">
                            ({versionInfo.gitCommit.substring(0, 7)})
                          </span>
                        )}
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent("open-changelog"))}
                          className="inline-flex items-center gap-1 text-primary hover:underline font-sans font-medium cursor-pointer"
                        >
                          <FileText className="h-3 w-3" />
                          Changelog
                        </button>
                      </div>
                      {versionInfo.buildDate && (
                        <span className="text-muted-foreground/60">
                          Built: {new Date(versionInfo.buildDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Personalization, Links & User */}
        <div className="flex items-center gap-1 border-l border-border pl-3">
          {config.reportProblemEnabled && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setReportDialogOpen(true)}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Report a Problem
              </Button>
              <ReportProblemDialog
                open={reportDialogOpen}
                onOpenChange={setReportDialogOpen}
              />
            </>
          )}
          <SettingsPanel />
          {config.docsUrl && (
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a
                href={config.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Documentation"
              >
                <BookOpen className="h-4 w-4" />
              </a>
            </Button>
          )}
          {config.sourceUrl && (
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a
                href={config.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Source Code"
              >
                <Github className="h-4 w-4" />
              </a>
            </Button>
          )}
          {/* User Menu - Only shown when SSO is enabled */}
          <UserMenu />
        </div>
      </div>
    </header>

    {isOnTaskBuilderEditor && pendingNavigationHref && (
      <UnsavedChangesDialog
        open={!!pendingNavigationHref}
        onDiscard={handleDiscard}
        onCancel={handleCancel}
      />
    )}
    </>
  );
}

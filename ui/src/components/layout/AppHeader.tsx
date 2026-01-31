"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useAdminRole } from "@/hooks/use-admin-role";
import {
  Github,
  BookOpen,
  Zap,
  Loader2,
  Database,
  Shield,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import { useChatStore } from "@/store/chat-store";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import { useRAGHealth } from "@/hooks/use-rag-health";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function AppHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isAdmin } = useAdminRole();
  const { isStreaming } = useChatStore();

  // Debug logging for admin tab
  React.useEffect(() => {
    if (session) {
      console.log('[AppHeader] Session role:', session.role);
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
    graphRagEnabled
  } = useRAGHealth();

  // Combined status: if either is checking -> checking, if either is disconnected -> disconnected, else connected
  const getCombinedStatus = () => {
    if (caipeStatus === "checking" || ragStatus === "checking") return "checking";
    if (caipeStatus === "disconnected" || ragStatus === "disconnected") return "disconnected";
    return "connected";
  };

  const combinedStatus = getCombinedStatus();

  const getActiveTab = () => {
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    if (pathname?.startsWith("/agent-builder") || pathname?.startsWith("/use-cases")) return "agent-builder";
    if (pathname?.startsWith("/admin")) return "admin";
    return "agent-builder"; // Default to agent-builder (formerly use-cases)
  };

  const activeTab = getActiveTab();

  return (
    <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between px-4 shrink-0 z-50">
      <div className="flex items-center gap-4">
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 cursor-default"
          title={getConfig('tagline')}
        >
          <img
            src={getConfig('logoUrl')}
            alt={`${getConfig('appName')} Logo`}
            className="h-8 w-auto"
          />
          <span className="font-bold text-base gradient-text">{getConfig('appName')}</span>
          {getConfig('previewMode') && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded">
              Preview
            </span>
          )}
        </div>

        {/* Navigation Pills - Agent Builder first for prominence */}
        <div className="flex items-center bg-muted/50 rounded-full p-1">
          <Link
            href="/agent-builder"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
              activeTab === "agent-builder"
                ? "gradient-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            Agent Builder
          </Link>
          <Link
            href="/chat"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
              activeTab === "chat"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            💬 Chat
          </Link>
          <Link
            href="/knowledge-bases"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
              activeTab === "knowledge"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Database className="h-3.5 w-3.5" />
            Knowledge Bases
          </Link>
          {/* Admin tab - only visible to admin users */}
          {isAdmin && (
            <Link
              href="/admin"
              prefetch={true}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                activeTab === "admin"
                  ? "bg-red-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Shield className="h-3.5 w-3.5" />
              Admin
            </Link>
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
                  combinedStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                )}
              >
                {combinedStatus === "checking" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    combinedStatus === "connected" && "bg-green-400",
                    combinedStatus === "disconnected" && "bg-red-400",
                    isStreaming && "animate-pulse"
                  )} />
                )}
                {combinedStatus === "connected" ? "Connected" : combinedStatus === "checking" ? "Checking" : "Disconnected"}
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-[600px] p-0 overflow-hidden border-2">
              <div className="bg-gradient-to-br from-card via-card to-card/95">
                {/* Header with gradient */}
                <div className="gradient-primary-br p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-base font-bold text-white mb-1">System Status</div>
                      <div className="text-xs text-white/80">CAIPE Supervisor & RAG Server</div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full",
                        combinedStatus === "connected" ? "bg-green-400 animate-pulse" : 
                        combinedStatus === "checking" ? "bg-amber-400 animate-pulse" : "bg-red-400"
                      )} />
                      <span className="text-xs font-medium text-white">
                        {combinedStatus === "connected" ? "All Systems Live" : 
                         combinedStatus === "checking" ? "Checking" : "Issues Detected"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* CAIPE Supervisor Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-foreground">CAIPE Supervisor</div>
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

                  {/* Divider */}
                  <div className="border-t border-border/50" />

                  {/* RAG Server Section */}
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
                  </div>
                </div>
                
                {/* Footer */}
                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span>Health checks active (30s interval)</span>
                  </div>
                  <div className="text-muted-foreground">
                    {combinedStatus === "connected" ? "All systems operational" : 
                     combinedStatus === "checking" ? "Checking status..." : 
                     "Check logs for details"}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Settings, Theme, Links & User */}
        <div className="flex items-center gap-1 border-l border-border pl-3">
          <SettingsPanel />
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a
              href="https://cnoe-io.github.io/ai-platform-engineering/ui/"
              target="_blank"
              rel="noopener noreferrer"
              title="Documentation"
            >
              <BookOpen className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a
              href="https://github.com/cnoe-io/ai-platform-engineering"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </Button>
          {/* User Menu - Only shown when SSO is enabled */}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

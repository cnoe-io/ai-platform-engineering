"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Github,
  BookOpen,
  Zap,
  Loader2,
  Database
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function AppHeader() {
  const pathname = usePathname();
  const { isStreaming } = useChatStore();

  // Health check for CAIPE supervisor (polls every 30 seconds)
  const { status: healthStatus, url: healthUrl, secondsUntilNextCheck, agents, tags } = useCAIPEHealth();

  const getActiveTab = () => {
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    return "gallery";
  };

  const activeTab = getActiveTab();

  return (
    <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between px-4 shrink-0 z-50">
      <div className="flex items-center gap-4">
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 cursor-default"
          title="Multi-Agent Collaboration & Workflow Automation"
        >
          <img
            src="/logo.svg"
            alt="CAIPE Logo"
            className="h-8 w-auto"
          />
          <span className="font-bold text-base gradient-text">CAIPE</span>
        </div>

        {/* Navigation Pills - Use Cases first for prominence */}
        <div className="flex items-center bg-muted/50 rounded-full p-1">
          <Link
            href="/use-cases"
            prefetch={true}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
              activeTab === "gallery"
                ? "gradient-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            Use Cases
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
        </div>
      </div>

      {/* Status & Actions */}
      <div className="flex items-center gap-3">
        {/* Connection Status */}
        <div className="flex items-center gap-2">
          {/* Connection Status - shows health status with URL and countdown on hover */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:scale-105",
                  healthStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/20",
                  healthStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  healthStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                )}
              >
                {healthStatus === "checking" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    healthStatus === "connected" && "bg-green-400",
                    healthStatus === "disconnected" && "bg-red-400",
                    isStreaming && "animate-pulse"
                  )} />
                )}
                {healthStatus === "connected" ? "Connected" : healthStatus === "checking" ? "Checking" : "Disconnected"}
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-[600px] p-0 overflow-hidden border-2">
                <div className="bg-gradient-to-br from-card via-card to-card/95">
                  {/* Header with gradient */}
                  <div className="gradient-primary-br p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="text-base font-bold text-white mb-1">CAIPE Supervisor</div>
                        <div className="text-xs text-white/80 font-mono break-all">{healthUrl}</div>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-xs font-medium text-white">Live</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-4">
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
                    
                    {/* Integrations */}
                    {tags.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Connected Integrations
                          </div>
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                            <span className="text-[10px] font-bold text-primary">{tags.length}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
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
                  
                  {/* Footer */}
                  <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span>Health check active</span>
                    </div>
                    <div className="text-muted-foreground">
                      Next in <span className="font-medium text-foreground">{secondsUntilNextCheck}s</span>
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

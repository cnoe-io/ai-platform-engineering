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
import { TechStackButton } from "@/components/tech-stack";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AppHeader() {
  const pathname = usePathname();
  const { isStreaming } = useChatStore();

  // Health check for CAIPE supervisor (polls every 30 seconds)
  const { status: healthStatus, url: healthUrl, secondsUntilNextCheck } = useCAIPEHealth();

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
          title="Community AI Platform Engineering"
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
                ? "bg-gradient-to-r from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] text-white shadow-sm"
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
        {/* Powered By + Connection Status */}
        <div className="flex items-center gap-2">
          {/* Powered By */}
          <TechStackButton variant="compact" />

          {/* Connection Status - shows health status with URL and countdown on hover */}
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-help",
                    healthStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                    healthStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                    healthStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
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
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm p-4">
                <div className="space-y-2">
                  <div className="text-base font-semibold text-foreground">CAIPE Supervisor</div>
                  <div className="text-sm text-foreground/80 break-all font-mono">{healthUrl}</div>
                  <div className="text-sm text-foreground/70 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Next check in {secondsUntilNextCheck}s
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Settings, Theme, Links & User */}
        <div className="flex items-center gap-1 border-l border-border pl-3">
          <SettingsPanel />
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a
              href="https://caipe.io"
              target="_blank"
              rel="noopener noreferrer"
              title="caipe.io"
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

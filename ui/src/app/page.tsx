"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Github,
  BookOpen,
  Zap,
  Loader2,
  Database
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";
import { UseCasesGallery } from "@/components/gallery/UseCasesGallery";
import { KnowledgePanel } from "@/components/rag/KnowledgePanel";
import { ThemeToggle } from "@/components/theme-toggle";
import { TechStackButton } from "@/components/tech-stack";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { AuthGuard } from "@/components/auth-guard";
import { useChatStore } from "@/store/chat-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { config, getConfig } from "@/lib/config";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function HomePage() {
  // Default to Use Cases gallery to showcase capabilities
  const [activeTab, setActiveTab] = useState<"chat" | "gallery" | "knowledge">("gallery");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [useCasesRefreshTrigger, setUseCasesRefreshTrigger] = useState(0);
  const { createConversation, setActiveConversation, setPendingMessage, isStreaming } = useChatStore();

  // Use centralized configuration for CAIPE URL (use dynamic config for runtime injection)
  const caipeUrl = getConfig('caipeUrl');

  // Health check for CAIPE supervisor (polls every 30 seconds)
  const { status: healthStatus, url: healthUrl, secondsUntilNextCheck } = useCAIPEHealth();

  const handleSelectUseCase = useCallback(
    (prompt: string) => {
      const convId = createConversation();
      setActiveConversation(convId);
      // Set pending message - ChatPanel will auto-submit it
      setPendingMessage(prompt);
      setActiveTab("chat");
    },
    [createConversation, setActiveConversation, setPendingMessage]
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background noise-overlay">
      {/* Modern Header - AG-UI Dojo inspired */}
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
            <button
              onClick={() => setActiveTab("gallery")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                activeTab === "gallery"
                  ? "bg-gradient-to-r from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              Use Cases
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                activeTab === "chat"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              💬 Chat
            </button>
            <button
              onClick={() => setActiveTab("knowledge")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                activeTab === "knowledge"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Database className="h-3.5 w-3.5" />
              Knowledge Bases
            </button>
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === "chat" ? (
          <>
            {/* Sidebar - Fixed width, no resizable */}
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              collapsed={sidebarCollapsed}
              onCollapse={setSidebarCollapsed}
            />

            {/* Chat Panel */}
            <div className="flex-1 min-w-0">
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full"
              >
                <ChatPanel endpoint={caipeUrl} />
              </motion.div>
            </div>

            {/* Context/Output Panel - Fixed width, collapsible */}
            {contextPanelVisible && (
              <ContextPanel
                debugMode={debugMode}
                onDebugModeChange={setDebugMode}
                collapsed={contextPanelCollapsed}
                onCollapse={setContextPanelCollapsed}
              />
            )}
          </>
        ) : activeTab === "knowledge" ? (
          /* Knowledge Mode - RAG Interface */
          <motion.div
            key="knowledge"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 overflow-hidden"
          >
            <KnowledgePanel />
          </motion.div>
        ) : (
          /* Gallery Mode - Simple Layout without resizing */
          <>
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              collapsed={sidebarCollapsed}
              onCollapse={setSidebarCollapsed}
              onUseCaseSaved={() => setUseCasesRefreshTrigger(prev => prev + 1)}
            />
            <motion.div
              key="gallery"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 overflow-hidden"
            >
              <UseCasesGallery
                onSelectUseCase={handleSelectUseCase}
                refreshTrigger={useCasesRefreshTrigger}
              />
            </motion.div>
          </>
        )}
      </div>

    </div>
  );
}

// Wrap with AuthGuard when SSO is enabled
export default function Home() {
  // Always wrap with AuthGuard - it will handle SSO check internally
  // This prevents hydration mismatches
  return (
    <AuthGuard>
      <HomePage />
    </AuthGuard>
  );
}

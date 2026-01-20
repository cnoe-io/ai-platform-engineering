"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Github,
  BookOpen,
  Zap,
  PanelRightClose,
  PanelRightOpen,
  Bug,
  Loader2
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";
import { UseCasesGallery } from "@/components/gallery/UseCasesGallery";
import { ThemeToggle } from "@/components/theme-toggle";
import { TechStackButton } from "@/components/tech-stack";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { AuthGuard } from "@/components/auth-guard";
import { useChatStore } from "@/store/chat-store";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function HomePage() {
  // Default to Use Cases gallery to showcase capabilities
  const [activeTab, setActiveTab] = useState<"chat" | "gallery">("gallery");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const { createConversation, setActiveConversation, setPendingMessage, isStreaming } = useChatStore();

  // Use centralized configuration for CAIPE URL
  const caipeUrl = config.caipeUrl;

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
                "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                activeTab === "chat"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Chat
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
                    {isStreaming ? "Streaming" : healthStatus === "connected" ? "Connected" : healthStatus === "checking" ? "Checking" : "Disconnected"}
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

          {/* Context Panel Toggle */}
          {activeTab === "chat" && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setContextPanelVisible(!contextPanelVisible)}
                className={cn(
                  "gap-1.5 text-xs",
                  contextPanelVisible && "bg-primary/10 text-primary"
                )}
              >
                {contextPanelVisible ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                Output
              </Button>

              {/* Debug Toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDebugMode(!debugMode)}
                className={cn(
                  "gap-1.5 text-xs",
                  debugMode && "bg-amber-500/15 text-amber-400"
                )}
                title="Toggle Debug A2A Stream view"
              >
                <Bug className="h-3.5 w-3.5" />
                Debug
              </Button>
            </div>
          )}

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
          /* Chat Mode - Resizable Panels */
          <ResizablePanelGroup direction="horizontal" className="flex-1">
            {/* Sidebar Panel */}
            <ResizablePanel
              defaultSize={sidebarCollapsed ? "64px" : "280px"}
              minSize="64px"
              maxSize="400px"
              collapsible
              collapsedSize="64px"
              onResize={(size) => {
                const isCollapsed = size.asPercentage <= 5;
                if (isCollapsed !== sidebarCollapsed) {
                  setSidebarCollapsed(isCollapsed);
                }
              }}
            >
              <Sidebar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                collapsed={sidebarCollapsed}
                onCollapse={setSidebarCollapsed}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Chat Panel */}
            <ResizablePanel minSize="300px">
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full"
              >
                <ChatPanel endpoint={caipeUrl} />
              </motion.div>
            </ResizablePanel>

            {/* Context/Output Panel */}
            {contextPanelVisible && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="380px" minSize="200px" maxSize="600px">
                  <ContextPanel
                    debugMode={debugMode}
                    onDebugModeChange={setDebugMode}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        ) : (
          /* Gallery Mode - Simple Layout without resizing */
          <>
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              collapsed={sidebarCollapsed}
              onCollapse={setSidebarCollapsed}
            />
            <motion.div
              key="gallery"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 overflow-hidden"
            >
              <UseCasesGallery onSelectUseCase={handleSelectUseCase} />
            </motion.div>
          </>
        )}
      </div>

    </div>
  );
}

// Wrap with AuthGuard when SSO is enabled
export default function Home() {
  if (config.ssoEnabled) {
    return (
      <AuthGuard>
        <HomePage />
      </AuthGuard>
    );
  }
  return <HomePage />;
}

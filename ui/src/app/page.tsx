"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Github,
  BookOpen,
  Zap,
  PanelRightClose,
  PanelRightOpen,
  Bug
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";

function HomePage() {
  // Default to Use Cases gallery to showcase capabilities
  const [activeTab, setActiveTab] = useState<"chat" | "gallery">("gallery");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const { createConversation, setActiveConversation, addMessage, isStreaming } = useChatStore();

  // Use centralized configuration for CAIPE URL
  const caipeUrl = config.caipeUrl;

  const handleSelectUseCase = useCallback(
    (prompt: string) => {
      const convId = createConversation();
      setActiveConversation(convId);
      addMessage(convId, { role: "user", content: prompt });
      setActiveTab("chat");
    },
    [createConversation, setActiveConversation, addMessage]
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
          {/* Powered By + Status */}
          <div className="flex items-center gap-2">
            {/* Powered By */}
            <TechStackButton variant="compact" />

            {/* Streaming Status */}
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
              isStreaming
                ? "bg-green-500/15 text-green-400 border border-green-500/30"
                : "bg-muted text-muted-foreground"
            )}>
              <Radio className={cn("h-3 w-3", isStreaming && "animate-pulse")} />
              {isStreaming ? "Streaming" : "Ready"}
            </div>
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
                href="https://cnoe-io.github.io/ai-platform-engineering/"
                target="_blank"
                rel="noopener noreferrer"
                title="CAIPE Docs"
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
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === "chat" ? (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex overflow-hidden"
              >
                {/* Chat Panel */}
                <div className={cn("flex-1 min-w-0")}>
                  <ChatPanel endpoint={caipeUrl} />
                </div>

                {/* Context/Output Panel */}
                <AnimatePresence>
                  {contextPanelVisible && (
                    <motion.div
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 420, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="shrink-0 border-l border-border/50"
                    >
                      <ContextPanel
                        debugMode={debugMode}
                        onDebugModeChange={setDebugMode}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div
                key="gallery"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 overflow-hidden"
              >
                <UseCasesGallery onSelectUseCase={handleSelectUseCase} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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

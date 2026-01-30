"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  History,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Zap,
  Database,
  HardDrive,
  Users2,
  Shield,
  Users,
  TrendingUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { cn, formatDate, truncateText } from "@/lib/utils";
import { UseCaseBuilderDialog } from "@/components/gallery/UseCaseBuilder";
import { ShareButton } from "@/components/chat/ShareButton";
import { getStorageMode, getStorageModeDisplay } from "@/lib/storage-config";
import type { Conversation } from "@/types/a2a";

interface SidebarProps {
  activeTab: "chat" | "gallery" | "knowledge" | "admin";
  onTabChange: (tab: "chat" | "gallery" | "knowledge" | "admin") => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onUseCaseSaved?: () => void;
}

export function Sidebar({ activeTab, onTabChange, collapsed, onCollapse, onUseCaseSaved }: SidebarProps) {
  const router = useRouter();
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createConversation,
    deleteConversation,
    loadConversationsFromServer
  } = useChatStore();
  const [useCaseBuilderOpen, setUseCaseBuilderOpen] = useState(false);
  const storageMode = getStorageMode(); // Exclusive storage mode
  const [isPending, startTransition] = useTransition();

  // Load conversations from server when sidebar mounts (MongoDB mode only)
  // Always load from server to sync with database, but preserve local messages
  useEffect(() => {
    if (activeTab === "chat" && storageMode === 'mongodb') {
      // Always load from server - the loadConversationsFromServer function
      // will merge server data with local cache intelligently
      loadConversationsFromServer().catch((error) => {
        console.error('[Sidebar] Failed to load conversations:', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, storageMode]); // Intentionally exclude loadConversationsFromServer to prevent re-runs

  const handleNewChat = async () => {
    try {
      if (storageMode === 'mongodb') {
        // MongoDB mode: Create conversation on server
        const { apiClient } = await import('@/lib/api-client');
        const conversation = await apiClient.createConversation({
          title: "New Conversation",
        });

        // Add to local store immediately
        const newConversation: Conversation = {
          id: conversation._id,
          title: conversation.title,
          createdAt: new Date(conversation.created_at),
          updatedAt: new Date(conversation.updated_at),
          messages: [],
          a2aEvents: [],
        };
        
        // Update store and wait for it to propagate
        useChatStore.setState((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: conversation._id,
        }));

        // Small delay to ensure store update propagates before navigation
        await new Promise(resolve => setTimeout(resolve, 0));

        // Use React transition for smooth navigation
        startTransition(() => {
          router.push(`/chat/${conversation._id}`);
        });
      } else {
        // Create conversation in localStorage
        const conversationId = createConversation();
        
        // Use React transition for smooth navigation
        startTransition(() => {
          router.push(`/chat/${conversationId}`);
        });
      }
    } catch (error) {
      console.error('[Sidebar] Failed to create conversation:', error);
      
      // Fallback to localStorage
      const conversationId = createConversation();
      startTransition(() => {
        router.push(`/chat/${conversationId}`);
      });
    }
  };

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 320 }}
      transition={{ duration: 0.2 }}
      className="relative flex flex-col h-full bg-card/50 backdrop-blur-sm border-r border-border/50 shrink-0 overflow-hidden"
      style={{ overflow: 'visible' }}
    >
      {/* Collapse Toggle */}
      <div className="flex items-center justify-end p-2 h-12 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapse(!collapsed)}
          className="h-8 w-8 hover:bg-muted shrink-0"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* New Chat Button */}
      {activeTab === "chat" && (
        <div className="px-2 pb-2 shrink-0">
          <Button
            onClick={handleNewChat}
            className={cn(
              "w-full gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover-glow",
              collapsed && "px-2"
            )}
            variant="ghost"
            size={collapsed ? "icon" : "default"}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">New Chat</span>}
          </Button>
        </div>
      )}

      {/* Storage Mode Indicator - Subtle icon with tooltip */}
      {activeTab === "chat" && !collapsed && (
        <div className="absolute bottom-2 right-2 z-10 overflow-visible">
          <TooltipProvider delayDuration={200}>
            {storageMode === 'localStorage' ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-help">
                    <HardDrive className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} className="bg-amber-600 dark:bg-amber-500 text-white border-amber-700">
                  <p className="font-medium">Local Storage Mode</p>
                  <p className="text-amber-100 text-[10px] mt-0.5">Browser-only • Not shareable</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1.5 rounded-md bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors cursor-help">
                    <Database className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} className="bg-green-600 dark:bg-green-500 text-white border-green-700">
                  <p className="font-medium">MongoDB Mode</p>
                  <p className="text-green-100 text-[10px] mt-0.5">Persistent • Shareable • Teams</p>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      )}

      {/* Chat History */}
      {activeTab === "chat" && (
        <div className="flex-1 overflow-hidden flex flex-col min-w-0">
          <ScrollArea className="flex-1 min-w-0">
            <div className="px-2 space-y-1 pb-4">
              <AnimatePresence mode="popLayout">
                {conversations.map((conv, index) => {
                  // Check if conversation is shared
                  const isShared = conv.sharing && (
                    conv.sharing.is_public || 
                    (conv.sharing.shared_with && conv.sharing.shared_with.length > 0) ||
                    (conv.sharing.shared_with_teams && conv.sharing.shared_with_teams.length > 0) ||
                    conv.sharing.share_link_enabled
                  );
                  
                  return (
                  <motion.div
                    key={conv.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ delay: index * 0.02 }}
                    className={cn(
                      "group relative flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all min-w-0 overflow-hidden",
                      activeConversationId === conv.id
                        ? "bg-primary/10 border border-primary/30"
                        : isShared
                          ? "hover:bg-muted/50 border border-blue-500/20"
                          : "hover:bg-muted/50 border border-transparent"
                    )}
                    onClick={() => {
                      setActiveConversation(conv.id);
                      startTransition(() => {
                        router.push(`/chat/${conv.id}`);
                      });
                    }}
                  >
                    <div className={cn(
                      "shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
                      activeConversationId === conv.id
                        ? "bg-primary/20"
                        : "bg-muted"
                    )}>
                      <MessageSquare className={cn(
                        "h-4 w-4",
                        activeConversationId === conv.id
                          ? "text-primary"
                          : "text-muted-foreground"
                      )} />
                    </div>

                    {!collapsed && (
                      <>
                        <div className="flex-1 min-w-0 pr-2 relative">
                          <div className="flex items-center gap-1.5 min-w-0 pr-4">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p 
                                    className="text-sm font-medium truncate min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                                  >
                                    {conv.title}
                                  </p>
                                </TooltipTrigger>
                                {conv.title.length > 25 && (
                                  <TooltipContent side="right" className="max-w-xs">
                                    <p className="text-xs break-words">{conv.title}</p>
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          {isShared && (
                            <div className="absolute top-0 right-2">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Users2 className="h-3 w-3 text-blue-500 shrink-0" />
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    <p className="text-xs">Shared conversation</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {formatDate(conv.updatedAt)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pr-1">
                          {/* Only show share button for conversations created after MongoDB integration (after Jan 28, 2026) */}
                          {new Date(conv.createdAt) > new Date('2026-01-28') && (
                            <ShareButton 
                              conversationId={conv.id}
                              conversationTitle={conv.title}
                              isOwner={true}
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await deleteConversation(conv.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </motion.div>
                  );
                })}
              </AnimatePresence>

              {conversations.length === 0 && !collapsed && (
                <div className="text-center py-8 px-4">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-muted flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    No conversations yet
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Start a new chat to begin
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Gallery mode - Use Cases info */}
      {activeTab === "gallery" && (
        <>
          {collapsed ? (
            /* Collapsed state - Show icon buttons */
            <div className="flex-1 flex flex-col items-center gap-2 px-2 py-4">
              {/* Use Case Builder Button */}
              <Button
                onClick={() => setUseCaseBuilderOpen(true)}
                variant="ghost"
                size="icon"
                className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
                title="Create Use Case"
              >
                <Sparkles className="h-5 w-5" />
              </Button>
            </div>
          ) : (
            /* Expanded state - Full content */
            <div className="flex-1 flex flex-col p-4">
              {/* Prominent Use Cases info */}
              <div 
                className="relative overflow-hidden rounded-xl border border-primary/20 p-4 mb-4"
                style={{
                  background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 20%, transparent), color-mix(in srgb, var(--gradient-to) 15%, transparent), transparent)`
                }}
              >
                <div className="relative">
                  <div className="w-10 h-10 mb-3 rounded-xl gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/30">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-sm font-semibold gradient-text">Explore Use Cases</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    Pre-built platform engineering scenarios. Click any card to start a chat.
                  </p>
                </div>
              </div>

              {/* Use Case Builder Button */}
              <Button
                onClick={() => setUseCaseBuilderOpen(true)}
                variant="outline"
                className="w-full gap-2 border-dashed border-primary/30 hover:border-primary hover:bg-primary/5"
              >
                <Sparkles className="h-4 w-4" />
                <span>Create Use Case</span>
              </Button>

              {/* Categories Legend */}
              <div className="mt-6">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Categories</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-muted-foreground">DevOps & Operations</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    <span className="text-muted-foreground">Development</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-muted-foreground">Cloud & Security</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-orange-500" />
                    <span className="text-muted-foreground">Project Management</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Admin mode - Dashboard info */}
      {activeTab === "admin" && (
        <div className="flex-1 flex flex-col p-4">
          {!collapsed && (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-red-500" />
                  <p className="text-sm font-semibold">Admin Dashboard</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use tabs to navigate between Users, Teams, Statistics, and System Health
                </p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-2 rounded bg-muted/50 border border-primary/20">
                  <p className="text-muted-foreground mb-2">Features</p>
                  <div className="space-y-1 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Users className="h-3 w-3" />
                      <span>User & Role Management</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-3 w-3" />
                      <span>Team Collaboration</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-3 w-3" />
                      <span>Usage Analytics</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Database className="h-3 w-3" />
                      <span>System Monitoring</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Use Case Builder Dialog */}
      <UseCaseBuilderDialog
        open={useCaseBuilderOpen}
        onOpenChange={setUseCaseBuilderOpen}
        onSuccess={() => {
          console.log("Use case saved successfully");
          // Trigger refresh of use cases gallery
          if (onUseCaseSaved) {
            onUseCaseSaved();
          }
        }}
      />

    </motion.div>
  );
}

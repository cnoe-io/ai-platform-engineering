"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  MessageCircleQuestion,
  Radio,
  History,
  Plus,
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Zap,
  Database,
  HardDrive,
  Users2,
  Shield,
  Users,
  TrendingUp,
  RefreshCw,
  Globe,
  Bot
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { cn, formatDate, truncateText } from "@/lib/utils";
import { UseCaseBuilderDialog } from "@/components/gallery/UseCaseBuilder";
import { RecycleBinDialog } from "@/components/chat/RecycleBinDialog";
import { ShareButton } from "@/components/chat/ShareButton";
import { NewChatButton } from "@/components/chat/NewChatButton";
import { useToast } from "@/components/ui/toast";
import { useSession } from "next-auth/react";
import { getStorageMode, getStorageModeDisplay } from "@/lib/storage-config";
import { getConfig } from "@/lib/config";
import type { Conversation } from "@/types/a2a";
import { getAgentId, isDynamicAgentConversation, buildParticipants } from "@/types/a2a";

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
    loadConversationsFromServer,
    loadAutonomousConversationsFromService,
    loadMessagesFromServer,
    loadTurnsFromServer,
    isConversationStreaming,
    hasUnviewedMessages,
    isConversationInputRequired,
  } = useChatStore();
  const { data: session } = useSession();
  const [useCaseBuilderOpen, setUseCaseBuilderOpen] = useState(false);
  const storageMode = getStorageMode(); // Exclusive storage mode
  const autonomousAgentsEnabled = getConfig('autonomousAgentsEnabled');
  const [isPending, startTransition] = useTransition();
  const [sidebarWidth, setSidebarWidth] = useState(320); // Track sidebar width
  const [isResizing, setIsResizing] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  // Sidebar filter view. 'all' = default human/web conversations,
  // 'autonomous' = surface only autonomous_agents runs (source === 'autonomous').
  // The autonomous list is fetched server-side via ?source=autonomous so the
  // operator can pivot between "my chats" and "what did the autonomous agent
  // do today?" without leaving the sidebar.
  const [conversationView, setConversationView] = useState<'all' | 'autonomous'>('all');
  const { toast } = useToast();

  // Agent name lookup for dynamic agent conversations
  const [agentNameMap, setAgentNameMap] = useState<Record<string, string>>({});

  // Load conversations from server when sidebar mounts.
  // Two sources:
  //   1. MongoDB (regular human-typed chats) — only in MongoDB storage mode.
  //   2. autonomous-agents service — always available; spec #099 Story 2
  //      makes the Autonomous tab work without Mongo by synthesising
  //      conversations from the live task list + run history.
  // Also re-sync when tab becomes visible (user switches back from another browser/tab)
  useEffect(() => {
    if (activeTab !== "chat") return;

    const loadAll = async () => {
      // Mongo source — kept gated on storageMode because that's where
      // human-typed conversations actually live. Autonomous Conversations
      // are written to Mongo too (when CHAT_HISTORY_PUBLISH_ENABLED is on)
      // but we synthesise them from the autonomous-agents service below
      // so the Autonomous tab works in localStorage mode AND in Mongo
      // mode without the publisher.
      if (storageMode === 'mongodb') {
        try {
          await loadConversationsFromServer(
            conversationView === 'autonomous' ? { source: 'autonomous' } : undefined
          );
        } catch (error) {
          console.error('[Sidebar] Failed to load conversations:', error);
        }
      }
      // Always (re)load the autonomous task list — even on the "All"
      // chip — so freshly-created tasks and new runs/acks land in the
      // sidebar without forcing the operator to switch tabs first.
      // Cheap: the autonomous-agents service is local and the synthesis
      // is in-memory only (no Mongo writes). Pre-fix this only ran on
      // ``conversationView === 'autonomous'``, which meant synthesised-
      // only autonomous threads were missing from "All" until you
      // visited the other chip.
      if (autonomousAgentsEnabled) {
        try {
          await loadAutonomousConversationsFromService();
        } catch (error) {
          console.error('[Sidebar] Failed to sync autonomous tasks:', error);
        }
      }
    };

    loadAll();

    // Re-sync when user returns to this tab (catches cross-browser deletes
    // for Mongo conversations, and new runs/acks for autonomous tasks).
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && activeTab === "chat") {
        loadAll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, storageMode, conversationView, autonomousAgentsEnabled]); // Intentionally exclude loaders to prevent re-runs

  useEffect(() => {
    if (!autonomousAgentsEnabled && conversationView === 'autonomous') {
      setConversationView('all');
    }
  }, [autonomousAgentsEnabled, conversationView]);

  // Deselect the active conversation if the current filter would
  // hide it. Without this the right-pane stays parked on whatever
  // chat was open even after the operator switches the chip, which
  // looked "stuck" / desynced -- the list said "no conversations"
  // but the main area was still rendering one. Only fires for the
  // Autonomous chip in practice (the "All" branch is always true).
  useEffect(() => {
    if (!activeConversationId) return;
    const active = conversations.find((c) => c.id === activeConversationId);
    if (!active) return;
    const stillVisible =
      !autonomousAgentsEnabled && active.source === 'autonomous'
        ? false
        : conversationView === 'autonomous'
          ? active.source === 'autonomous'
          : true;
    if (!stillVisible) {
      const firstAutonomous = autonomousAgentsEnabled
        ? conversations.find((c) => c.source === 'autonomous')
        : null;
      if (firstAutonomous) {
        setActiveConversation(firstAutonomous.id);
        router.push(`/chat/${firstAutonomous.id}`);
      } else {
        setActiveConversation(null);
        router.push('/chat?source=autonomous');
      }
    }
    // We intentionally depend on conversationView (the user gesture)
    // and the active id; ``conversations`` is included so a late
    // server load that drops the active row also triggers the cleanup.
  }, [conversationView, activeConversationId, conversations, autonomousAgentsEnabled, router, setActiveConversation]);

  // Fetch dynamic agents for name lookup in conversation list
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await fetch("/api/dynamic-agents/available");
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          const map: Record<string, string> = {};
          data.data.forEach((agent: { _id: string; name: string }) => {
            map[agent._id] = agent.name;
          });
          setAgentNameMap(map);
        }
      } catch (err) {
        console.error('[Sidebar] Failed to fetch agents for name lookup:', err);
      }
    };
    fetchAgents();
  }, []);

  // Handle mouse move for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = Math.max(320, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing]);

  const handleReloadConversations = async () => {
    if (isReloading) return;
    setIsReloading(true);
    try {
      console.log('[Sidebar] Manual reload triggered');
      await loadConversationsFromServer(
        conversationView === 'autonomous' ? { source: 'autonomous' } : undefined
      );
      // Also force-reload the active conversation's messages to pick up
      // follow-up messages from other devices and refresh A2A events
      if (activeConversationId) {
        const activeConv = useChatStore.getState().conversations.find(c => c.id === activeConversationId);
        if (activeConv && isDynamicAgentConversation(activeConv)) {
          // Dynamic Agent — use old messages path
          await loadMessagesFromServer(activeConversationId, { force: true });
        } else {
          // Platform Engineer — use turns path
          await loadTurnsFromServer(activeConversationId);
        }
      }
    } catch (error) {
      console.error('[Sidebar] Failed to reload conversations:', error);
    } finally {
      setIsReloading(false);
    }
  };

  const handleNewChat = async (agentId?: string) => {
    // Spec #099 Phase 3 — when the operator clicks "+ New Chat" while
    // the Autonomous chip is active, open a regular chat with the
    // textbox pre-filled with a task-creation starter. The supervisor
    // now has create_autonomous_task / list_autonomous_tasks /
    // validate_cron_expression tools (commit e6a84220), so the operator
    // can describe what they want, the supervisor walks them through
    // any clarifying questions, and the task gets persisted on
    // confirmation — no form required. The chat itself is a regular
    // chat (not an autonomous-task thread) because we're CREATING a
    // task, not running one. Once it exists, switching to the
    // Autonomous chip surfaces the new task as its own thread.
    if (autonomousAgentsEnabled && conversationView === 'autonomous') {
      useChatStore.getState().setInputDraft(
        "I'd like to set up an autonomous task. " +
        "Help me describe it — what should it do, when should it run, " +
        "and which sub-agent (if any) should handle it. " +
        "Once we have the details, please create the task."
      );
      // Fall through to the regular create-conversation path below.
    }

    try {
      if (storageMode === 'mongodb') {
        // MongoDB mode: Create conversation on server
        const { apiClient } = await import('@/lib/api-client');
        const result = await apiClient.createConversation({
          title: "New Conversation",
          client_type: 'webui',
          agent_id: agentId,
        });
        const conversation = result.conversation;

        // Add to local store immediately
        const newConversation: Conversation = {
          id: conversation._id,
          title: conversation.title,
          createdAt: new Date(conversation.created_at),
          updatedAt: new Date(conversation.updated_at),
          messages: [],
          streamEvents: [], // Stream events for Dynamic Agents
          a2aEvents: [], // A2A events for supervisor
          participants: conversation.participants || [],
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
        const conversationId = await createConversation(agentId);

        // Use React transition for smooth navigation
        startTransition(() => {
          router.push(`/chat/${conversationId}`);
        });
      }
    } catch (error) {
      console.error('[Sidebar] Failed to create conversation:', error);

      // Fallback to localStorage
      const conversationId = await createConversation(agentId);
      startTransition(() => {
        router.push(`/chat/${conversationId}`);
      });
    }
  };

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : sidebarWidth }}
      transition={{ duration: 0.2 }}
      className="relative flex flex-col h-full bg-card/50 backdrop-blur-sm border-r border-border/50 shrink-0 z-10"
    >
      {/* Resize Handle */}
      {!collapsed && (
        <div
          onMouseDown={() => setIsResizing(true)}
          className="absolute right-0 top-0 h-full w-1 hover:w-1.5 bg-transparent hover:bg-primary/50 cursor-col-resize transition-all z-20"
          title="Drag to resize sidebar"
        />
      )}
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
          <NewChatButton
            collapsed={collapsed}
            onNewChat={handleNewChat}
          />
        </div>
      )}

      {/* Bottom-right indicators: Archive + Storage Mode */}
      {activeTab === "chat" && !collapsed && (
        <div className="absolute bottom-2 right-2 z-10 overflow-visible flex items-center gap-1.5">
          {/* Archive button — only in MongoDB mode */}
          {storageMode === 'mongodb' && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setRecycleBinOpen(true)}
                    className="p-1.5 rounded-md bg-muted/50 border border-border/50 hover:bg-muted transition-colors cursor-pointer"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <p className="font-medium text-xs">Archive</p>
                  <p className="text-[10px] mt-0.5 opacity-70">Restore deleted conversations</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Storage Mode Indicator */}
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
          {!collapsed && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider shrink-0">
              <History className="h-3 w-3" />
              <span className="flex-1">History</span>
              {storageMode === 'mongodb' && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 hover:bg-muted"
                        onClick={handleReloadConversations}
                        disabled={isReloading}
                      >
                        <RefreshCw className={cn("h-3 w-3", isReloading && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={4}>
                      <p className="text-xs">Reload conversations</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}

          {/*
            Autonomous-runs filter chip. Spec #099 Story 2: the Autonomous
            tab now sources its conversations from the autonomous-agents
            service via ``loadAutonomousConversationsFromService`` so the
            chip works in localStorage mode too (no Mongo required). Mongo
            is still the source of truth when CHAT_HISTORY_PUBLISH_ENABLED
            is on; in that case both sources merge and the synthesis just
            keeps the sidebar fresh between Mongo writes.
          */}
          {!collapsed && autonomousAgentsEnabled && (
            <div className="px-3 pb-2 flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setConversationView('all')}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border transition-colors",
                  conversationView === 'all'
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-muted/40 border-border/50 text-muted-foreground hover:bg-muted"
                )}
                aria-pressed={conversationView === 'all'}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setConversationView('autonomous')}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border transition-colors flex items-center gap-1",
                  conversationView === 'autonomous'
                    ? "bg-purple-500/15 border-purple-500/40 text-purple-600 dark:text-purple-400"
                    : "bg-muted/40 border-border/50 text-muted-foreground hover:bg-muted"
                )}
                aria-pressed={conversationView === 'autonomous'}
                title="Show autonomous-agent runs"
              >
                <Bot className="h-2.5 w-2.5" />
                Autonomous
              </button>
            </div>
          )}

          <ScrollArea className="flex-1 min-w-0">
            <div className="px-2 space-y-1 pb-4">
              <AnimatePresence mode="popLayout">
                {conversations
                  // Spec #099 — visibility model:
                  //   "All" view shows EVERYTHING (regular human chats AND
                  //     autonomous task threads). Autonomous rows are
                  //     differentiated by the purple Bot icon + AUTO badge
                  //     (see ``isAutonomous`` block below).
                  //   "Autonomous" view filters down to source === 'autonomous'.
                  // Pre-Spec-099 behaviour hid autonomous from "All" entirely
                  // which made operator-created tasks invisible from the
                  // default sidebar view; explicitly restored here.
                  .filter((conv) => {
                    if (!autonomousAgentsEnabled && conv.source === 'autonomous') {
                      return false;
                    }
                    if (conversationView === 'autonomous') {
                      return conv.source === 'autonomous';
                    }
                    return true;
                  })
                  .map((conv, index) => {
                  // Check if conversation is shared
                  const isShared = conv.sharing && (
                    conv.sharing.is_public ||
                    (conv.sharing.shared_with && conv.sharing.shared_with.length > 0) ||
                    (conv.sharing.shared_with_teams && conv.sharing.shared_with_teams.length > 0) ||
                    conv.sharing.share_link_enabled
                  );

                  const isAutonomous = conv.source === 'autonomous';
                  const isLive = isConversationStreaming(conv.id);
                  const isInputRequired = !isLive && isConversationInputRequired(conv.id);
                  const isUnviewed = !isLive && !isInputRequired && hasUnviewedMessages(conv.id);

                  return (
                  <div
                    key={conv.id}
                    className="group/conv"
                  >
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ delay: index * 0.02 }}
                      className={cn(
                        "group relative flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all min-w-0",
                        isLive
                          ? "bg-emerald-500/10 border border-emerald-500/30"
                          : isInputRequired
                            ? "bg-amber-500/10 border border-amber-500/30"
                            : isUnviewed
                              ? "bg-blue-500/5 border border-blue-500/25"
                              : activeConversationId === conv.id
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
                      "shrink-0 w-8 h-8 rounded-md flex items-center justify-center relative",
                      isLive
                        ? "bg-emerald-500/20"
                        : isInputRequired
                          ? "bg-amber-500/20"
                          : isUnviewed
                            ? "bg-blue-500/15"
                            : isAutonomous
                              ? "bg-purple-500/15"
                              : activeConversationId === conv.id
                                ? "bg-primary/20"
                                : "bg-muted"
                    )}>
                      {isLive ? (
                        <>
                          <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />
                          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                          </span>
                        </>
                      ) : isInputRequired ? (
                        <>
                          <MessageCircleQuestion className="h-4 w-4 text-amber-500 animate-pulse" />
                          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                          </span>
                        </>
                      ) : isAutonomous ? (
                        <Bot className={cn(
                          "h-4 w-4",
                          activeConversationId === conv.id
                            ? "text-purple-600 dark:text-purple-400"
                            : "text-purple-500/80 dark:text-purple-400/80"
                        )} />
                      ) : (
                        <>
                          <MessageSquare className={cn(
                            "h-4 w-4",
                            isUnviewed
                              ? "text-blue-500"
                              : activeConversationId === conv.id
                                ? "text-primary"
                                : "text-muted-foreground"
                          )} />
                          {isUnviewed && (
                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {!collapsed && (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <p className="text-sm font-medium truncate flex-1" title={conv.title}>
                              {truncateText(conv.title, sidebarWidth > 350 ? 40 : sidebarWidth > 320 ? 25 : 20)}
                            </p>
                            {/* Spec #099 Story 2 — explicit AUTO badge so
                                autonomous-task threads are unmistakable in
                                the All view (purple Bot icon alone is easy
                                to miss when scanning a long sidebar). */}
                            {isAutonomous && (
                              <span
                                className="shrink-0 px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30"
                                title="This is an autonomous task with a schedule. Typing here sends to the supervisor on the same context the cron uses."
                              >
                                auto trigger
                              </span>
                            )}
                            {isShared && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    {conv.sharing?.is_public ? (
                                      <Globe className="h-3 w-3 text-green-500 shrink-0" />
                                    ) : (
                                      <Users2 className="h-3 w-3 text-blue-500 shrink-0" />
                                    )}
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    <p className="text-xs">
                                      {conv.sharing?.is_public
                                        ? 'Shared with everyone'
                                        : 'Shared conversation'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          <p className={cn(
                            "text-xs truncate",
                            isLive
                              ? "text-emerald-600 dark:text-emerald-400 font-medium"
                              : isInputRequired
                                ? "text-amber-600 dark:text-amber-400 font-medium"
                                : isUnviewed
                                  ? "text-blue-600 dark:text-blue-400 font-medium"
                                  : "text-muted-foreground"
                          )}>
                            {isLive ? "Live" : isInputRequired ? "Input needed" : isUnviewed ? "New response" : formatDate(conv.updatedAt)}
                            {/* Dynamic Agent indicator */}
                            {(() => {
                              const agId = getAgentId(conv);
                              if (!agId) return null;
                              return (
                                <span className="ml-1.5 text-[10px] text-purple-500 dark:text-purple-400" title={agentNameMap[agId] || 'Unknown Agent'}>
                                  • {truncateText(agentNameMap[agId] || 'Unknown', 20)}
                                </span>
                              );
                            })()}
                          </p>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ShareButton
                              conversationId={conv.id}
                              conversationTitle={conv.title}
                              isOwner={!conv.owner_id || conv.owner_id === session?.user?.email}
                            />
                          </div>
                          <TooltipProvider delayDuration={200}>
                          <Tooltip>
                          <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={async (e) => {
                              console.log('[Sidebar] Archive clicked for:', conv.id);
                              e.stopPropagation();
                              
                              // Capture state BEFORE any async work
                              const conversationsBeforeArchive = useChatStore.getState().conversations;
                              const isLastConversation = conversationsBeforeArchive.length === 1;
                              const archivedTitle = conv.title || 'Untitled';
                              
                              console.log('[Sidebar] Before archive:', {
                                count: conversationsBeforeArchive.length,
                                isLast: isLastConversation,
                              });

                              // If this is the last conversation, create a new one FIRST
                              // so the user always has somewhere to land
                              let navigateToId: string | null = null;
                              if (isLastConversation) {
                                navigateToId = await createConversation();
                                console.log('[Sidebar] Created replacement conversation:', navigateToId);
                              }

                              // Archive the conversation (updates store + server)
                              await deleteConversation(conv.id);

                              // Show toast
                              if (storageMode === 'mongodb') {
                                toast(`"${archivedTitle}" moved to Archive`, "success", 4000);
                              } else {
                                toast(`"${archivedTitle}" deleted`, "success", 3000);
                              }

                              // Navigate
                              if (navigateToId) {
                                // Last conversation case — go to the fresh conversation
                                router.replace(`/chat/${navigateToId}`);
                              } else {
                                // Multiple conversations — store already picked the next active
                                const storeState = useChatStore.getState();
                                const newActiveId = storeState.activeConversationId;
                                if (newActiveId) {
                                  router.replace(`/chat/${newActiveId}`);
                                }
                              }
                            }}
                          >
                            <Archive className="h-3 w-3" />
                          </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={4}>
                            <p className="text-xs">Archive conversation</p>
                          </TooltipContent>
                          </Tooltip>
                          </TooltipProvider>
                        </div>
                      </>
                    )}
                  </motion.div>
                  </div>
                  );
                })}
              </AnimatePresence>

              {conversations.filter((c) =>
                // Mirror the visible-list predicate above: in "All" we
                // show everything (so the empty state must also count
                // every conversation), in "Autonomous" we show only
                // ``source === 'autonomous'``. Pre-fix this predicate
                // used ``c.source !== 'autonomous'`` for "All", which
                // wrongly rendered "No conversations yet" alongside
                // visible autonomous rows.
                !autonomousAgentsEnabled && c.source === 'autonomous'
                  ? false
                  : conversationView === 'autonomous'
                    ? c.source === 'autonomous'
                    : true
              ).length === 0 && !collapsed && (
                <div className="text-center py-8 px-4">
                  <div className={cn(
                    "w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center",
                    conversationView === 'autonomous' ? "bg-purple-500/10" : "bg-muted"
                  )}>
                    {conversationView === 'autonomous' ? (
                      <Bot className="h-5 w-5 text-purple-500" />
                    ) : (
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {conversationView === 'autonomous'
                      ? 'No autonomous runs yet'
                      : 'No conversations yet'}
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {conversationView === 'autonomous'
                      ? 'Schedule an autonomous task to see runs here'
                      : 'Start a new chat to begin'}
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

              {/* Custom Query Button */}
              <Button
                onClick={() => handleNewChat()}
                variant="ghost"
                size="icon"
                className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
                title="Custom Query"
              >
                <MessageSquare className="h-5 w-5" />
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
                className="w-full gap-2 border-dashed border-primary/30 hover:border-primary hover:bg-primary/5 mb-4"
              >
                <Sparkles className="h-4 w-4" />
                <span>Create Use Case</span>
              </Button>

              {/* Quick Start Button */}
              <Button
                onClick={() => handleNewChat()}
                variant="outline"
                className="w-full gap-2 border-dashed border-primary/30 hover:border-primary hover:bg-primary/5"
              >
                <Plus className="h-4 w-4" />
                <span>Custom Query</span>
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

      {/* Archive Dialog */}
      <RecycleBinDialog
        open={recycleBinOpen}
        onOpenChange={setRecycleBinOpen}
      />

    </motion.div>
  );
}

"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  History,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore } from "@/store/chat-store";
import { cn, formatDate, truncateText } from "@/lib/utils";
import { config } from "@/lib/config";

interface SidebarProps {
  activeTab: "chat" | "gallery";
  onTabChange: (tab: "chat" | "gallery") => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

export function Sidebar({ activeTab, onTabChange, collapsed, onCollapse }: SidebarProps) {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createConversation,
    deleteConversation
  } = useChatStore();

  const handleNewChat = () => {
    const id = createConversation();
    setActiveConversation(id);
    onTabChange("chat");
  };

  return (
    <div
      className="flex flex-col h-full w-full bg-card/50 backdrop-blur-sm overflow-hidden"
    >
      {/* Collapse Toggle */}
      <div className="flex items-center justify-end p-2 h-12">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapse(!collapsed)}
          className="h-8 w-8 hover:bg-muted"
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
        <div className="px-2 pb-2">
          <Button
            onClick={handleNewChat}
            className={cn(
              "w-full gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover-glow",
              collapsed && "px-0"
            )}
            variant="ghost"
          >
            <Plus className="h-4 w-4" />
            {!collapsed && <span>New Chat</span>}
          </Button>
        </div>
      )}

      {/* Chat History */}
      {activeTab === "chat" && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {!collapsed && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
              <History className="h-3 w-3" />
              <span>History</span>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="px-2 space-y-1 pb-4">
              <AnimatePresence mode="popLayout">
                {conversations.map((conv, index) => (
                  <motion.div
                    key={conv.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ delay: index * 0.02 }}
                    className={cn(
                      "group relative flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all",
                      activeConversationId === conv.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/50 border border-transparent"
                    )}
                    onClick={() => setActiveConversation(conv.id)}
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
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {truncateText(conv.title, 20)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(conv.updatedAt)}
                          </p>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(conv.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </motion.div>
                ))}
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

      {/* Gallery mode - prominent info */}
      {activeTab === "gallery" && !collapsed && (
        <div className="flex-1 flex flex-col p-4">
          {/* Prominent Use Cases info */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(173,80%,40%)]/20 via-[hsl(270,75%,60%)]/15 to-transparent border border-primary/20 p-4 mb-4">
            <div className="relative">
              <div className="w-10 h-10 mb-3 rounded-xl bg-gradient-to-br from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] flex items-center justify-center shadow-lg shadow-primary/30">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <p className="text-sm font-semibold gradient-text">Explore Use Cases</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Pre-built platform engineering scenarios. Click any card to start a chat.
              </p>
            </div>
          </div>

          {/* Quick Start Button */}
          <Button
            onClick={handleNewChat}
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

      {/* Footer - Connection Status */}
      <div className="p-2 border-t border-border/50">
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground cursor-help",
            collapsed && "justify-center"
          )}
          title={`CAIPE URL: ${config.caipeUrl}`}
        >
          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <span className="block truncate">
                {config.caipeUrl.replace(/^https?:\/\//, '')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

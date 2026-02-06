"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import { useChatStore } from "@/store/chat-store";
import { getStorageMode } from "@/lib/storage-config";
import { Loader2 } from "lucide-react";
import type { Conversation } from "@/types/mongodb";
import type { Conversation as LocalConversation } from "@/types/a2a";

function ChatUUIDPage() {
  const params = useParams();
  const router = useRouter();
  const uuid = params.uuid as string;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const { conversations: localConversations, setActiveConversation } = useChatStore();
  const caipeUrl = getConfig('caipeUrl');

  // Check store immediately (synchronous, no loading state!)
  const existingConv = localConversations.find((c) => c.id === uuid);

  const [conversation, setConversation] = useState<Conversation | LocalConversation | null>(existingConv || null);
  const [loading, setLoading] = useState(!existingConv); // Only show spinner if NOT in store
  const [error, setError] = useState<string | null>(null);
  const storageMode = getStorageMode(); // Synchronous storage mode

  // Load conversation from MongoDB or localStorage
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') {
      return;
    }

    async function loadConversation() {
      // Validate UUID format before making request
      if (!uuid || typeof uuid !== 'string') {
        setError("Invalid conversation ID");
        setLoading(false);
        return;
      }

      // Check Zustand store first (instant, no loading spinner!)
      const localConv = localConversations.find((c) => c.id === uuid);
      if (localConv) {
        console.log("[ChatUUID] Found conversation in store, loading instantly");
        setConversation(localConv);
        setActiveConversation(uuid);
        setLoading(false);
        return;
      }

      console.log("[ChatUUID] Conversation not in store, loading from backend...");

      try {
        if (storageMode === 'mongodb') {
          // Try to load from MongoDB
          console.log("[ChatUUID] Loading from MongoDB...");
          try {
            const conv = await apiClient.getConversation(uuid);
            setConversation(conv);
          } catch (apiErr: any) {
            // Conversation doesn't exist in MongoDB (404) - treat as new conversation
            if (apiErr.message?.includes('not found') || apiErr.message?.includes('404')) {
              console.log("[ChatUUID] Conversation not found in MongoDB, creating new empty conversation");
            } else {
              console.warn("[ChatUUID] Failed to load from MongoDB:", apiErr.message);
            }
            // Create empty conversation for both cases
            setConversation({
              id: uuid,
              title: "New Conversation",
              createdAt: new Date(),
              updatedAt: new Date(),
              messages: [],
              a2aEvents: [],
            });
          }
        } else {
          // MongoDB not available, show empty conversation
          console.log("[ChatUUID] MongoDB unavailable, showing empty conversation");
          setConversation({
            id: uuid,
            title: "New Conversation",
            createdAt: new Date(),
            updatedAt: new Date(),
            messages: [],
            a2aEvents: [],
          });
        }
      } catch (err) {
        console.error("[ChatUUID] Unexpected error:", err);
        // Fallback to empty conversation
        setConversation({
          id: uuid,
          title: "New Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          a2aEvents: [],
        });
        setStorageMode('localStorage');
      } finally {
        setLoading(false);
      }
    }

    loadConversation();
  }, [uuid, localConversations, setActiveConversation]);

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/agent-builder");
    } else {
      router.push("/knowledge-bases");
    }
  };

  // Show loading spinner only when actually fetching from MongoDB
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => router.push("/chat")}
            className="text-sm text-primary hover:underline"
          >
            Go to new conversation
          </button>
        </div>
      </div>
    );
  }

  const conversationTitle = conversation
    ? ('_id' in conversation ? conversation.title : conversation.title)
    : undefined;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activeTab="chat"
        onTabChange={handleTabChange}
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
      />

      {/* Chat Panel with conversation ID */}
      <div className="flex-1 min-w-0">
        <motion.div
          key="chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          <ChatPanel
            endpoint={caipeUrl}
            conversationId={uuid}
            conversationTitle={conversationTitle}
          />

          {/* Optional: Storage mode indicator */}
          {storageMode === 'localStorage' && (
            <div className="absolute bottom-4 right-4 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-xs text-amber-600 dark:text-amber-400">
              📦 Local storage mode
            </div>
          )}
        </motion.div>
      </div>

      {/* Context/Output Panel */}
      {contextPanelVisible && (
        <ContextPanel
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
          collapsed={contextPanelCollapsed}
          onCollapse={setContextPanelCollapsed}
        />
      )}
    </div>
  );
}

export default function ChatUUID() {
  return (
    <AuthGuard>
      <ChatUUIDPage />
    </AuthGuard>
  );
}

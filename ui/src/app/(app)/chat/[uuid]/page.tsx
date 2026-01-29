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
import { Loader2 } from "lucide-react";
import type { Conversation } from "@/types/mongodb";

function ChatUUIDPage() {
  const params = useParams();
  const router = useRouter();
  const uuid = params.uuid as string;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const caipeUrl = getConfig('caipeUrl');

  // Load conversation from MongoDB
  useEffect(() => {
    async function loadConversation() {
      try {
        const conv = await apiClient.getConversation(uuid);
        setConversation(conv);
      } catch (err) {
        console.error("Failed to load conversation:", err);
        setError(err instanceof Error ? err.message : "Failed to load conversation");
      } finally {
        setLoading(false);
      }
    }

    loadConversation();
  }, [uuid]);

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/use-cases");
    } else {
      router.push("/knowledge-bases");
    }
  };

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
          className="h-full"
        >
          <ChatPanel 
            endpoint={caipeUrl} 
            conversationId={uuid}
            conversationTitle={conversation?.title}
          />
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

"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import { useChatStore } from "@/store/chat-store";
import { getChatAPI } from "@/lib/chat-api";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";

function ChatUUIDPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const conversationUUID = params.uuid as string;
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    setActiveConversation,
    loadConversationFromMongoDB,
  } = useChatStore();

  // Use centralized configuration for CAIPE URL
  const caipeUrl = getConfig('caipeUrl');

  useEffect(() => {
    async function loadConversation() {
      try {
        setLoading(true);
        setError(null);

        // Get access token if SSO is enabled
        const ssoEnabled = getConfig('ssoEnabled');
        const accessToken = ssoEnabled ? session?.accessToken as string | undefined : undefined;
        
        const chatAPI = getChatAPI(accessToken);
        
        // Fetch conversation from MongoDB
        const conversation = await chatAPI.getConversation(conversationUUID);
        
        // Load into store
        await loadConversationFromMongoDB(conversation);
        
        // Set as active
        setActiveConversation(conversationUUID);
        
        setLoading(false);
      } catch (err) {
        console.error("Failed to load conversation:", err);
        setError(err instanceof Error ? err.message : "Failed to load conversation");
        setLoading(false);
      }
    }

    if (conversationUUID && session) {
      loadConversation();
    }
  }, [conversationUUID, session, setActiveConversation, loadConversationFromMongoDB]);

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
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="text-red-500 text-4xl">⚠️</div>
          <h2 className="text-xl font-semibold">Failed to Load Conversation</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => router.push("/chat")}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Return to Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar - Fixed width, no resizable */}
      <Sidebar
        activeTab="chat"
        onTabChange={handleTabChange}
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
          <ChatPanel 
            endpoint={caipeUrl} 
            conversationId={conversationUUID}
          />
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

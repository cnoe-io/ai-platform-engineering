"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import { getChatAPI } from "@/lib/chat-api";
import { Loader2 } from "lucide-react";

function ChatPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(true);

  // Use centralized configuration for CAIPE URL (use dynamic config for runtime injection)
  const caipeUrl = getConfig('caipeUrl');

  // Automatically create a new conversation and redirect to UUID-based URL
  useEffect(() => {
    async function createNewConversation() {
      if (!session) return;

      try {
        const ssoEnabled = getConfig('ssoEnabled');
        const accessToken = ssoEnabled ? session?.accessToken as string | undefined : undefined;
        const chatAPI = getChatAPI(accessToken);

        // Create new conversation in MongoDB with initial placeholder message
        const conversation = await chatAPI.createConversation({
          title: "New Conversation",
          message: "", // Empty initial message
        });

        // Redirect to the UUID-based URL
        router.push(`/chat/${conversation._id}`);
      } catch (error) {
        console.error("Failed to create conversation:", error);
        setCreatingConversation(false);
      }
    }

    createNewConversation();
  }, [session, router]);

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/use-cases");
    } else {
      router.push("/knowledge-bases");
    }
  };

  // Show loading state while creating conversation
  if (creatingConversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Creating new conversation...</p>
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
    </div>
  );
}

export default function Chat() {
  return (
    <AuthGuard>
      <ChatPage />
    </AuthGuard>
  );
}

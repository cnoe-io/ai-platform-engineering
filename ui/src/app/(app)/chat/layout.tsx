"use client";

import React, { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatContainer } from "@/components/chat/ChatContainer";

/**
 * Chat layout — renders the Sidebar and ChatContainer once and persists them
 * across route changes. This prevents visual flicker when navigating between
 * conversations.
 * 
 * The ChatContainer handles rendering the appropriate chat view (Dynamic Agent
 * or Platform Engineer) based on the current conversation. It reads the uuid
 * from useParams() and manages all chat state internally.
 * 
 * The children (page.tsx content) is only used for the /chat redirect page.
 * For /chat/[uuid] routes, children is null and ChatContainer renders the chat.
 */
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useParams();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Check if we're on a specific conversation route
  const hasUuid = !!params?.uuid;

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge" | "admin") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/use-cases");
    } else if (tab === "admin") {
      router.push("/admin");
    } else {
      router.push("/knowledge-bases");
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar - persists across conversation changes */}
      <Sidebar
        activeTab="chat"
        onTabChange={handleTabChange}
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
      />

      {/* Chat content - ChatContainer persists, children used only for /chat redirect */}
      {hasUuid ? <ChatContainer /> : children}
    </div>
  );
}

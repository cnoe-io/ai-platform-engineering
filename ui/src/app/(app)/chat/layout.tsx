"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";

/**
 * Chat layout — renders the Sidebar once and persists it across route changes.
 * This prevents the Sidebar from remounting when navigating between conversations,
 * eliminating the visual flicker.
 */
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

      {/* Chat content - changes per conversation */}
      {children}
    </div>
  );
}

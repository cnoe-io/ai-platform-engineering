"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import { useUserInit } from "@/hooks/use-user-init";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize user in MongoDB on first login
  useUserInit();
  
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Determine active tab based on pathname
  const getActiveTab = (): "chat" | "gallery" | "knowledge" | "admin" => {
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/agent-builder") || pathname?.startsWith("/use-cases")) return "gallery";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    if (pathname?.startsWith("/admin")) return "admin";
    return "gallery"; // Default
  };
  
  const activeTab = getActiveTab();
  
  // Handle tab changes via navigation
  const handleTabChange = (tab: "chat" | "gallery" | "knowledge" | "admin") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/agent-builder");
    } else if (tab === "knowledge") {
      router.push("/knowledge-bases");
    } else if (tab === "admin") {
      router.push("/admin");
    }
  };
  
  // Determine if sidebar should be visible
  // Show sidebar on chat and admin pages
  const showSidebar = activeTab === "chat" || activeTab === "admin";

  return (
    <div className="h-screen flex flex-col bg-background noise-overlay">
      <AppHeader />
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar - always rendered to preserve scroll position, visibility controlled internally */}
        {showSidebar && (
          <div className="relative z-20">
            <Sidebar
              activeTab={activeTab}
              onTabChange={handleTabChange}
              collapsed={sidebarCollapsed}
              onCollapse={setSidebarCollapsed}
            />
          </div>
        )}
        <div className="flex-1 overflow-hidden relative z-0">
          {children}
        </div>
      </div>
    </div>
  );
}

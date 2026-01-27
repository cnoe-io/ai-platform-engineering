"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { UseCasesGallery } from "@/components/gallery/UseCasesGallery";
import { AuthGuard } from "@/components/auth-guard";
import { useChatStore } from "@/store/chat-store";

function UseCasesPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [useCasesRefreshTrigger, setUseCasesRefreshTrigger] = useState(0);
  const { createConversation, setActiveConversation, setPendingMessage } = useChatStore();

  const handleSelectUseCase = useCallback(
    (prompt: string) => {
      const convId = createConversation();
      setActiveConversation(convId);
      // Set pending message - ChatPanel will auto-submit it
      setPendingMessage(prompt);
      router.push("/chat");
    },
    [createConversation, setActiveConversation, setPendingMessage, router]
  );

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "knowledge") {
      router.push("/knowledge-bases");
    } else {
      router.push("/use-cases");
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <Sidebar
        activeTab="gallery"
        onTabChange={handleTabChange}
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        onUseCaseSaved={() => setUseCasesRefreshTrigger(prev => prev + 1)}
      />
      <motion.div
        key="gallery"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-hidden"
      >
        <UseCasesGallery 
          onSelectUseCase={handleSelectUseCase}
          refreshTrigger={useCasesRefreshTrigger}
        />
      </motion.div>
    </div>
  );
}

export default function UseCases() {
  return (
    <AuthGuard>
      <UseCasesPage />
    </AuthGuard>
  );
}

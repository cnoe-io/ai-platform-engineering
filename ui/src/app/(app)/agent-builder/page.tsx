"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AgentBuilderGallery,
  AgentBuilderEditorDialog,
  AgentBuilderRunner,
  YamlImportDialog,
} from "@/components/agent-builder";
import type { AgentConfig } from "@/types/agent-config";
import { useChatStore } from "@/store/chat-store";

type ViewMode = "gallery" | "runner";

export default function AgentBuilderPage() {
  const router = useRouter();
  const { createConversation, setActiveConversation, setPendingMessage } = useChatStore();

  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  const [selectedConfig, setSelectedConfig] = useState<AgentConfig | null>(null);
  const [editingConfig, setEditingConfig] = useState<AgentConfig | undefined>(undefined);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isYamlImportOpen, setIsYamlImportOpen] = useState(false);

  const handleSelectConfig = (config: AgentConfig) => {
    setSelectedConfig(config);
    setViewMode("runner");
  };

  // Handle quick-start execution - send prompt to chat
  const handleRunQuickStart = useCallback((prompt: string) => {
    const convId = createConversation();
    setActiveConversation(convId);
    setPendingMessage(prompt);
    router.push("/chat");
  }, [createConversation, setActiveConversation, setPendingMessage, router]);

  const handleEditConfig = (config: AgentConfig) => {
    setEditingConfig(config);
    setIsEditorOpen(true);
  };

  const handleCreateNew = () => {
    setEditingConfig(undefined);
    setIsEditorOpen(true);
  };

  const handleImportYaml = () => {
    setIsYamlImportOpen(true);
  };

  const handleBackToGallery = () => {
    setViewMode("gallery");
    setSelectedConfig(null);
  };

  const handleEditorSuccess = () => {
    setIsEditorOpen(false);
    setEditingConfig(undefined);
  };

  const handleYamlImportSuccess = () => {
    setIsYamlImportOpen(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          {viewMode === "gallery" && (
            <motion.div
              key="gallery"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full"
            >
              <AgentBuilderGallery
                onSelectConfig={handleSelectConfig}
                onRunQuickStart={handleRunQuickStart}
                onEditConfig={handleEditConfig}
                onCreateNew={handleCreateNew}
                onImportYaml={handleImportYaml}
              />
            </motion.div>
          )}

          {viewMode === "runner" && selectedConfig && (
            <motion.div
              key="runner"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full"
            >
              <AgentBuilderRunner
                config={selectedConfig}
                onBack={handleBackToGallery}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Editor Dialog */}
      <AgentBuilderEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onSuccess={handleEditorSuccess}
        existingConfig={editingConfig}
      />

      {/* YAML Import Dialog */}
      <YamlImportDialog
        open={isYamlImportOpen}
        onOpenChange={setIsYamlImportOpen}
        onSuccess={handleYamlImportSuccess}
      />
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AgentBuilderGallery,
  AgentBuilderEditorDialog,
  YamlImportDialog,
} from "@/components/agent-builder";
import { AuthGuard } from "@/components/auth-guard";
import type { AgentSkill } from "@/types/agent-skill";

export default function AgentBuilderPage() {
  const [editingConfig, setEditingConfig] = useState<AgentSkill | undefined>(undefined);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isYamlImportOpen, setIsYamlImportOpen] = useState(false);

  const handleEditConfig = (config: AgentSkill) => {
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

  const handleEditorSuccess = () => {
    setIsEditorOpen(false);
    setEditingConfig(undefined);
  };

  const handleYamlImportSuccess = () => {
    setIsYamlImportOpen(false);
  };

  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key="gallery"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full"
            >
              <AgentBuilderGallery
                onEditConfig={handleEditConfig}
                onCreateNew={handleCreateNew}
                onImportYaml={handleImportYaml}
              />
            </motion.div>
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
    </AuthGuard>
  );
}

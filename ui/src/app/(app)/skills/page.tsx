"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AgentBuilderGallery,
  AgentBuilderRunner,
} from "@/components/agent-builder";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import type { AgentConfig } from "@/types/agent-config";

type ViewMode = "gallery" | "runner";

export default function AgentBuilderPage() {
  const router = useRouter();
  const workflowRunnerEnabled = getConfig('workflowRunnerEnabled');
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  const [selectedConfig, setSelectedConfig] = useState<AgentConfig | null>(null);
  const [cameFromHistory, setCameFromHistory] = useState(false);

  const handleSelectConfig = (config: AgentConfig, fromHistory: boolean = false) => {
    setSelectedConfig(config);
    setViewMode("runner");
    setCameFromHistory(fromHistory);
  };

  const handleRunSkill = useCallback((prompt: string, configName?: string) => {
    const tempConfig: AgentConfig = {
      id: `skill-run-${Date.now()}`,
      name: configName || "Skill",
      description: prompt.length > 100 ? prompt.substring(0, 100) + "..." : prompt,
      category: "Custom",
      owner_id: "system",
      is_system: false,
      tasks: [
        {
          display_text: "Execute prompt",
          llm_prompt: prompt,
          subagent: "caipe",
        },
      ],
      is_quick_start: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    setSelectedConfig(tempConfig);
    setViewMode("runner");
  }, []);

  const handleEditConfig = (config: AgentConfig) => {
    router.push(`/skills/editor?id=${encodeURIComponent(config.id)}`);
  };

  const handleCreateNew = () => {
    router.push("/skills/editor");
  };

  const handleBackToGallery = () => {
    setViewMode("gallery");
    setSelectedConfig(null);
    setCameFromHistory(false);
  };

  return (
    <AuthGuard>
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
                  onRunQuickStart={workflowRunnerEnabled ? handleRunSkill : undefined}
                  onEditConfig={handleEditConfig}
                  onCreateNew={handleCreateNew}
                />
              </motion.div>
            )}

            {workflowRunnerEnabled && viewMode === "runner" && selectedConfig && (
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
                  cameFromHistory={cameFromHistory}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AuthGuard>
  );
}

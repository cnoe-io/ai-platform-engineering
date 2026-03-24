"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  SkillsGallery,
  SkillsRunner,
  TrySkillsGateway,
} from "@/components/skills";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import type { AgentSkill } from "@/types/agent-skill";

type ViewMode = "gallery" | "runner";
type SkillsTab = "browse" | "gateway";

export default function SkillsPage() {
  const router = useRouter();
  const workflowRunnerEnabled = getConfig('workflowRunnerEnabled');
  const [skillsTab, setSkillsTab] = useState<SkillsTab>("browse");
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  const [selectedConfig, setSelectedConfig] = useState<AgentSkill | null>(null);
  const [cameFromHistory, setCameFromHistory] = useState(false);

  const handleSelectConfig = (config: AgentSkill, fromHistory: boolean = false) => {
    setSelectedConfig(config);
    setViewMode("runner");
    setCameFromHistory(fromHistory);
  };

  const handleRunSkill = useCallback((prompt: string, configName?: string) => {
    const tempConfig: AgentSkill = {
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
          subagent: "user_input",
        },
      ],
      is_quick_start: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    setSelectedConfig(tempConfig);
    setViewMode("runner");
  }, []);

  const handleEditConfig = (config: AgentSkill) => {
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
        <div className="shrink-0 border-b border-border px-6 pt-4 pb-2 flex gap-2">
          <button
            type="button"
            onClick={() => setSkillsTab("browse")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              skillsTab === "browse"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Browse
          </button>
          <button
            type="button"
            onClick={() => setSkillsTab("gateway")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              skillsTab === "gateway"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Try API / Gateway
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {skillsTab === "gateway" && (
              <motion.div
                key="gateway"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <TrySkillsGateway />
              </motion.div>
            )}
            {skillsTab === "browse" && viewMode === "gallery" && (
              <motion.div
                key="gallery"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <SkillsGallery
                  onSelectConfig={handleSelectConfig}
                  onRunQuickStart={workflowRunnerEnabled ? handleRunSkill : undefined}
                  onEditConfig={handleEditConfig}
                  onCreateNew={handleCreateNew}
                />
              </motion.div>
            )}

            {skillsTab === "browse" &&
            workflowRunnerEnabled &&
            viewMode === "runner" &&
            selectedConfig && (
              <motion.div
                key="runner"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="h-full"
              >
                <SkillsRunner
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

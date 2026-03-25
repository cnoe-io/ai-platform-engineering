"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SkillsBuilderEditor } from "@/components/skills";
import { useAgentSkillsStore } from "@/store/agent-skills-store";
import { AuthGuard } from "@/components/auth-guard";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import type { AgentSkill } from "@/types/agent-skill";

export default function SkillEditorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const configId = searchParams.get("id");

  const { configs, isLoading, loadSkills, getSkillById } = useAgentSkillsStore();
  const [existingConfig, setExistingConfig] = useState<AgentSkill | undefined>(undefined);
  const [ready, setReady] = useState(!configId);

  useEffect(() => {
    if (configs.length === 0 && !isLoading) {
      loadSkills();
    }
  }, [configs.length, isLoading, loadSkills]);

  useEffect(() => {
    if (!configId) {
      setReady(true);
      return;
    }
    if (configs.length > 0) {
      const found = getSkillById(configId);
      if (found) setExistingConfig(found);
      setReady(true);
    }
  }, [configId, configs, getSkillById]);

  const handleClose = () => router.push("/skills");
  const handleSuccess = () => router.push("/skills");

  if (!ready || isLoading) {
    return (
      <AuthGuard>
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <CAIPESpinner size="lg" message="Loading editor..." />
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="h-[calc(100vh-4rem)] overflow-hidden">
        <SkillsBuilderEditor
          open
          inline
          onOpenChange={(open) => { if (!open) handleClose(); }}
          onSuccess={handleSuccess}
          existingConfig={existingConfig}
        />
      </div>
    </AuthGuard>
  );
}

"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  SkillsGallery,
} from "@/components/skills";
import { AuthGuard } from "@/components/auth-guard";
import type { AgentSkill } from "@/types/agent-skill";

export default function SkillsPage() {
  const router = useRouter();

  const handleEditConfig = (config: AgentSkill) => {
    router.push(`/skills/editor?id=${encodeURIComponent(config.id)}`);
  };

  const handleCreateNew = () => {
    router.push("/skills/editor");
  };

  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <SkillsGallery
            onEditConfig={handleEditConfig}
            onCreateNew={handleCreateNew}
          />
        </div>
      </div>
    </AuthGuard>
  );
}

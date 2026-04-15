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
        <div className="shrink-0 border-b border-border px-6 pt-4 pb-2 flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground"
          >
            Browse
          </button>
          <button
            type="button"
            onClick={() => router.push("/skills/gateway")}
            className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            Try API / Gateway
          </button>
        </div>
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

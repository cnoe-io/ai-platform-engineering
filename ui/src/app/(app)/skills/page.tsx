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
    router.push(`/skills/workspace/${encodeURIComponent(config.id)}`);
  };

  const handleCreateNew = () => {
    router.push("/skills/workspace/new");
  };

  // Note: the Browse / Skills API Gateway segmented toggle is
  // rendered inline inside `SkillsGallery`'s header toolbar (next
  // to "Scan history") rather than as a full-width row above the
  // gallery. That earlier full-width row was eating ~50px of
  // vertical space for two pills that fit naturally beside the
  // existing toolbar buttons. The Gateway page (`/skills/gateway`)
  // keeps its own row-style toggle since it doesn't have a gallery
  // header to host the inline version.
  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <SkillsGallery
            onEditConfig={handleEditConfig}
            onCreateNew={handleCreateNew}
          />
        </div>
      </div>
    </AuthGuard>
  );
}

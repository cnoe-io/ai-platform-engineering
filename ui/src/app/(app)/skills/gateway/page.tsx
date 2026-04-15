"use client";

import React from "react";
import { TrySkillsGateway } from "@/components/skills";
import { AuthGuard } from "@/components/auth-guard";

export default function SkillsGatewayPage() {
  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <TrySkillsGateway />
        </div>
      </div>
    </AuthGuard>
  );
}

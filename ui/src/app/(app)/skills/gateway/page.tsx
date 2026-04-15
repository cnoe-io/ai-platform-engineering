"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { TrySkillsGateway } from "@/components/skills";
import { AuthGuard } from "@/components/auth-guard";

export default function SkillsGatewayPage() {
  const router = useRouter();

  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 border-b border-border px-6 pt-4 pb-2 flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/skills")}
            className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            Browse
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground"
          >
            Skills API Gateway
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <TrySkillsGateway />
        </div>
      </div>
    </AuthGuard>
  );
}

"use client";

/**
 * Legacy `/skills/editor?id=...` route — now a redirect into the new
 * `/skills/workspace/[id]` Workspace. Kept around so existing bookmarks,
 * external links, and admin links don't 404 during the transition.
 */

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthGuard } from "@/components/auth-guard";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";

export default function SkillEditorRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = searchParams.get("id") || "new";
    const tab = searchParams.get("tab");
    const qs = new URLSearchParams();
    if (tab) qs.set("tab", tab);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    router.replace(`/skills/workspace/${encodeURIComponent(id)}${suffix}`);
  }, [router, searchParams]);

  return (
    <AuthGuard>
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <CAIPESpinner size="lg" message="Opening Skill Workspace…" />
      </div>
    </AuthGuard>
  );
}

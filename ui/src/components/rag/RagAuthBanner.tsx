"use client";

import { AlertTriangle } from "lucide-react";
import { useRagPermissions } from "@/hooks/useRagPermissions";

export function RagAuthIndicator() {
  const { userInfo, isLoading } = useRagPermissions();

  // Don't show while loading
  if (isLoading) {
    return null;
  }

  // Show unauthenticated indicator
  if (!userInfo?.is_authenticated) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-100/50 dark:bg-amber-950/30 border border-amber-300/50 dark:border-amber-800/50">
        <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        <span className="text-xs text-amber-900 dark:text-amber-100 font-medium">Unauthenticated</span>
      </div>
    );
  }

  // Show role badge when authenticated
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{userInfo.email}</span>
      <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary border border-primary/20">
        {userInfo.role}
      </span>
    </div>
  );
}

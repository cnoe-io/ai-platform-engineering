"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { useRagPermissions, Permission } from "@/hooks/useRagPermissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function RagAuthIndicator() {
  const { userInfo, hasPermission, isLoading } = useRagPermissions();

  // Don't show while loading
  if (isLoading) {
    return null;
  }

  // No user info available
  if (!userInfo) {
    return null;
  }

  // Show unauthenticated indicator with role
  if (!userInfo.is_authenticated) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-100/50 dark:bg-amber-950/30 border border-amber-300/50 dark:border-amber-800/50">
          <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
          <span className="text-xs text-amber-900 dark:text-amber-100 font-medium">Unauthenticated</span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-muted/50 text-muted-foreground border border-border cursor-help">
                {userInfo.role}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="w-48">
              <div className="space-y-1.5">
                <div className="font-semibold text-xs border-b border-border pb-1 mb-1">Permissions</div>
                <div className="flex items-center gap-2">
                  {hasPermission(Permission.READ) ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-red-500" />
                  )}
                  <span className="text-xs">View & Query</span>
                </div>
                <div className="flex items-center gap-2">
                  {hasPermission(Permission.INGEST) ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-red-500" />
                  )}
                  <span className="text-xs">Ingest Data</span>
                </div>
                <div className="flex items-center gap-2">
                  {hasPermission(Permission.DELETE) ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-red-500" />
                  )}
                  <span className="text-xs">Delete Resources</span>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Show role badge with permissions tooltip when authenticated
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{userInfo.email}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary border border-primary/20 cursor-help">
              {userInfo.role}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-48">
            <div className="space-y-1.5">
              <div className="font-semibold text-xs border-b border-border pb-1 mb-1">Permissions</div>
              <div className="flex items-center gap-2">
                {hasPermission(Permission.READ) ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <X className="h-3 w-3 text-red-500" />
                )}
                <span className="text-xs">View & Query</span>
              </div>
              <div className="flex items-center gap-2">
                {hasPermission(Permission.INGEST) ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <X className="h-3 w-3 text-red-500" />
                )}
                <span className="text-xs">Ingest Data</span>
              </div>
              <div className="flex items-center gap-2">
                {hasPermission(Permission.DELETE) ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <X className="h-3 w-3 text-red-500" />
                )}
                <span className="text-xs">Delete Resources</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

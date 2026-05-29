"use client";

import { AlertTriangle, Check, X, User } from "lucide-react";
import { useRagPermissions, Permission } from "@/hooks/useRagPermissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PermissionType } from "@/lib/rag-api";

interface RagAuthIndicatorProps {
  compact?: boolean;
}

interface PermissionsTooltipContentProps {
  hasPermission: (permission: PermissionType) => boolean;
}

function PermissionsTooltipContent({ hasPermission }: PermissionsTooltipContentProps) {
  return (
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
  );
}

export function RagAuthIndicator({ compact = false }: RagAuthIndicatorProps) {
  const { userInfo, hasPermission, isLoading } = useRagPermissions();

  // Don't show while loading
  if (isLoading) {
    return null;
  }

  // No user info available
  if (!userInfo) {
    return null;
  }

  const ragStatusLabel = userInfo.role === "ADMIN" ? "Admin" : "Non-admin";

  // Compact mode for collapsed sidebar - just show icon with tooltip
  if (compact) {
    const isAuthenticated = userInfo.is_authenticated;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "w-8 h-8 rounded-md flex items-center justify-center cursor-help",
              isAuthenticated 
                ? "bg-primary/10 border border-primary/20" 
                : "bg-amber-100/50 dark:bg-amber-950/30 border border-amber-300/50 dark:border-amber-800/50"
            )}>
              {isAuthenticated ? (
                <User className="h-4 w-4 text-primary" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="w-52">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  {isAuthenticated ? ragStatusLabel : "Unauthenticated"}
                </span>
              </div>
              <div className="border-t border-border pt-2">
                <PermissionsTooltipContent hasPermission={hasPermission} />
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Show unauthenticated indicator with permissions tooltip
  if (!userInfo.is_authenticated) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center gap-1 cursor-help">
              <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                <span className="text-[10px]">Unauthenticated</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="w-48">
            <PermissionsTooltipContent hasPermission={hasPermission} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Show authenticated identity with permissions tooltip
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col items-center gap-1 cursor-help">
            <div className="flex items-center gap-1">
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate">{ragStatusLabel}</span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="w-48">
          <PermissionsTooltipContent hasPermission={hasPermission} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

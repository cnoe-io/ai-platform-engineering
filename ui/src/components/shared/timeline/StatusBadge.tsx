"use client";

import React from "react";
import { Loader2, CheckCircle, XCircle, Clock, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusType = "running" | "completed" | "failed" | "pending" | "input_required";

interface StatusBadgeProps {
  status: StatusType;
  /** Size variant */
  size?: "sm" | "md";
  /** Whether to show a text label next to the icon */
  showLabel?: boolean;
  /** Custom label text (overrides default) */
  label?: string;
  className?: string;
}

const statusConfig: Record<
  StatusType,
  {
    icon: React.ElementType;
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
    animate?: boolean;
  }
> = {
  running: {
    icon: Loader2,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/25",
    label: "running",
    animate: true,
  },
  completed: {
    icon: CheckCircle,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/8",
    borderColor: "border-emerald-500/20",
    label: "done",
  },
  failed: {
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/25",
    label: "failed",
  },
  pending: {
    icon: Clock,
    color: "text-muted-foreground/50",
    bgColor: "bg-muted/10",
    borderColor: "border-muted/25",
    label: "pending",
  },
  input_required: {
    icon: PauseCircle,
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
    borderColor: "border-amber-400/25",
    label: "waiting",
  },
};

/**
 * Displays a status indicator with icon and optional label.
 * Used for tool call status, plan step status, etc.
 */
export function StatusBadge({
  status,
  size = "sm",
  showLabel = false,
  label,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span className={cn("inline-flex items-center gap-1 shrink-0", className)}>
      <Icon
        className={cn(iconSize, config.color, config.animate && "animate-spin")}
      />
      {showLabel && (
        <span className={cn("text-[10px]", config.color)}>
          {label ?? config.label}
        </span>
      )}
    </span>
  );
}

/**
 * Returns the background and border colors for a given status.
 * Useful for styling container elements based on status.
 */
export function getStatusColors(status: StatusType) {
  const config = statusConfig[status];
  return {
    bgColor: config.bgColor,
    borderColor: config.borderColor,
    textColor: config.color,
  };
}

/**
 * A simple status icon without any container styling.
 * For use in compact layouts like plan steps.
 */
export function StatusIcon({
  status,
  size = "sm",
  className,
}: {
  status: StatusType;
  size?: "sm" | "md";
  className?: string;
}) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <Icon
      className={cn(iconSize, config.color, config.animate && "animate-spin", "shrink-0", className)}
    />
  );
}

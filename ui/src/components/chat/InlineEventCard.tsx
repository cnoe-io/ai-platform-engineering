"use client";

import React from "react";
import { motion } from "framer-motion";
import { Loader2, CheckCircle, Wrench, Bot, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InlineEventCardProps {
  type: "tool" | "subagent" | "warning" | "error";
  name: string;
  status?: "running" | "completed";  // Only used for tool/subagent
  message?: string;  // Used for warning/error - the actual message content
}

/**
 * InlineEventCard - Thin single-line card for displaying tool/subagent executions,
 * warnings, and errors inline within chat messages.
 *
 * Design:
 * - Tool: Purple accent, Wrench icon, running/completed status
 * - Subagent: Blue accent, Bot icon, displayed as "task (name)", running/completed status
 * - Warning: Amber accent, AlertTriangle icon, displays message
 * - Error: Red accent, XCircle icon, displays message
 */
export function InlineEventCard({ type, name, status, message }: InlineEventCardProps) {
  const isRunning = status === "running";
  const isTool = type === "tool";
  const isSubagent = type === "subagent";
  const isWarning = type === "warning";
  const isError = type === "error";

  // Color classes based on type
  const getColorClasses = () => {
    if (isTool) {
      return {
        border: isRunning ? "border-purple-500/40" : "border-border/50",
        bg: isRunning ? "bg-purple-500/5" : "bg-muted/20",
        icon: "text-purple-400",
        status: "text-green-400",
      };
    }
    if (isSubagent) {
      return {
        border: isRunning ? "border-blue-500/40" : "border-border/50",
        bg: isRunning ? "bg-blue-500/5" : "bg-muted/20",
        icon: "text-blue-400",
        status: "text-blue-400",
      };
    }
    if (isWarning) {
      return {
        border: "border-amber-500/40",
        bg: "bg-amber-500/5",
        icon: "text-amber-400",
        status: "text-amber-400",
      };
    }
    // Error
    return {
      border: "border-red-500/40",
      bg: "bg-red-500/5",
      icon: "text-red-400",
      status: "text-red-400",
    };
  };

  const colorClasses = getColorClasses();

  // Display content
  const getDisplayContent = () => {
    if (isWarning || isError) {
      return message || name;
    }
    if (isSubagent) {
      return `task (${name})`;
    }
    return name;
  };

  // Icon component
  const getIcon = () => {
    if (isTool) {
      return <Wrench className={cn("h-3.5 w-3.5 shrink-0", colorClasses.icon)} />;
    }
    if (isSubagent) {
      return <Bot className={cn("h-3.5 w-3.5 shrink-0", colorClasses.icon)} />;
    }
    if (isWarning) {
      return <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", colorClasses.icon)} />;
    }
    // Error
    return <XCircle className={cn("h-3.5 w-3.5 shrink-0", colorClasses.icon)} />;
  };

  // Status indicator - only for tool/subagent
  const getStatusIndicator = () => {
    if (isWarning || isError) {
      return null; // No status indicator for warning/error
    }
    if (isRunning) {
      return (
        <Loader2
          className={cn("h-3.5 w-3.5 animate-spin shrink-0", colorClasses.icon)}
        />
      );
    }
    return (
      <CheckCircle
        className={cn("h-3.5 w-3.5 shrink-0", colorClasses.status)}
      />
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm",
        colorClasses.border,
        colorClasses.bg
      )}
    >
      {/* Status indicator (tool/subagent only) */}
      {getStatusIndicator()}

      {/* Type icon */}
      {getIcon()}

      {/* Content */}
      <span className="font-medium text-foreground/90 truncate">
        {getDisplayContent()}
      </span>
    </motion.div>
  );
}

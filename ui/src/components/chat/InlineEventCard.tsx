"use client";

import React from "react";
import { motion } from "framer-motion";
import { Loader2, CheckCircle, Wrench, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InlineEventCardProps {
  type: "tool" | "subagent";
  name: string;
  status: "running" | "completed";
}

/**
 * InlineEventCard - Thin single-line card for displaying tool/subagent executions
 * inline within chat messages.
 *
 * Design:
 * - Running: Spinner + Icon + name (colored border)
 * - Completed: Checkmark + Icon + name (muted border)
 * - Tool: Purple accent, Wrench icon
 * - Subagent: Blue accent, Bot icon, displayed as "task (name)"
 */
export function InlineEventCard({ type, name, status }: InlineEventCardProps) {
  const isRunning = status === "running";
  const isTool = type === "tool";

  // Display name - subagents show as "task (name)"
  const displayName = isTool ? name : `task (${name})`;

  // Color classes based on type
  const colorClasses = isTool
    ? {
        border: isRunning ? "border-purple-500/40" : "border-border/50",
        bg: isRunning ? "bg-purple-500/5" : "bg-muted/20",
        icon: "text-purple-400",
        check: "text-green-400",
      }
    : {
        border: isRunning ? "border-blue-500/40" : "border-border/50",
        bg: isRunning ? "bg-blue-500/5" : "bg-muted/20",
        icon: "text-blue-400",
        check: "text-blue-400",
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
      {/* Status indicator */}
      {isRunning ? (
        <Loader2
          className={cn("h-3.5 w-3.5 animate-spin shrink-0", colorClasses.icon)}
        />
      ) : (
        <CheckCircle
          className={cn("h-3.5 w-3.5 shrink-0", colorClasses.check)}
        />
      )}

      {/* Type icon */}
      {isTool ? (
        <Wrench className={cn("h-3.5 w-3.5 shrink-0", colorClasses.icon)} />
      ) : (
        <Bot className={cn("h-3.5 w-3.5 shrink-0", colorClasses.icon)} />
      )}

      {/* Name */}
      <span className="font-medium text-foreground/90 truncate">
        {displayName}
      </span>
    </motion.div>
  );
}

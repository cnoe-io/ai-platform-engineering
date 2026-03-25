"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle, Wrench, Bot, AlertTriangle, XCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InlineEventCardProps {
  type: "tool" | "subagent" | "warning" | "error";
  name: string;
  status?: "running" | "completed";
  message?: string;  // Used for warning/error
  args?: Record<string, unknown>;  // Tool args for expansion
  purpose?: string;  // Subagent purpose
}

/**
 * Extract a preview string from args - looks for thought/reason fields
 */
function extractPreviewFromArgs(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  
  // Look for common "thinking" fields
  const previewKeys = ["thought", "reason", "thinking", "rationale", "explanation", "description"];
  for (const key of previewKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      // Truncate to ~60 chars for inline display
      const trimmed = value.trim();
      return trimmed.length > 60 ? trimmed.slice(0, 60) + "..." : trimmed;
    }
  }
  return null;
}

/**
 * Format args as pretty JSON for expanded view
 */
function formatArgsJson(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * InlineEventCard - Slim, full-width card for displaying tool/subagent executions,
 * warnings, and errors inline within chat messages.
 *
 * Design:
 * - Subtle background, no harsh border
 * - Click anywhere to expand and see full args/details
 * - Shows thought/reason preview in collapsed state
 * - Status indicator (spinner → checkmark) without border color change
 */
export function InlineEventCard({ type, name, status, message, args, purpose }: InlineEventCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const isRunning = status === "running";
  const isTool = type === "tool";
  const isSubagent = type === "subagent";
  const isWarning = type === "warning";
  const isError = type === "error";

  // Check if expandable (has args or purpose to show)
  const hasExpandableContent = (isTool && args && Object.keys(args).length > 0) || 
                               (isSubagent && purpose);
  const canExpand = hasExpandableContent;

  // Get preview text
  const preview = isTool ? extractPreviewFromArgs(args) : 
                  isSubagent ? purpose : 
                  null;

  // Icon colors - muted, not harsh
  const getIconColor = () => {
    if (isTool) return "text-purple-400/70";
    if (isSubagent) return "text-blue-400/70";
    if (isWarning) return "text-amber-400/70";
    return "text-red-400/70";
  };

  // Background - very subtle
  const getBgColor = () => {
    if (isWarning) return "bg-amber-500/5";
    if (isError) return "bg-red-500/5";
    return "bg-muted/30";
  };

  // Display name
  const getDisplayName = () => {
    if (isSubagent) return `task (${name})`;
    return name;
  };

  // Icon component
  const getIcon = () => {
    const colorClass = getIconColor();
    if (isTool) return <Wrench className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />;
    if (isSubagent) return <Bot className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />;
    if (isWarning) return <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />;
    return <XCircle className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />;
  };

  // Status indicator - only for tool/subagent
  const getStatusIndicator = () => {
    if (isWarning || isError) return null;
    if (isRunning) {
      return <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground" />;
    }
    return <CheckCircle className="h-3 w-3 shrink-0 text-green-500/70" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.1 }}
      className={cn(
        "w-full rounded-md text-xs",
        getBgColor(),
        canExpand && "cursor-pointer hover:bg-muted/40 transition-colors"
      )}
      onClick={() => canExpand && setIsExpanded(!isExpanded)}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {/* Status indicator */}
        {getStatusIndicator()}

        {/* Type icon */}
        {getIcon()}

        {/* Name and preview */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-medium text-foreground/80 shrink-0">
            {getDisplayName()}
          </span>
          {preview && !isExpanded && (
            <>
              <span className="text-muted-foreground/50">—</span>
              <span className="text-muted-foreground/70 truncate italic">
                {preview}
              </span>
            </>
          )}
          {(isWarning || isError) && message && (
            <>
              <span className="text-muted-foreground/50">—</span>
              <span className={cn(
                "truncate",
                isWarning ? "text-amber-400/80" : "text-red-400/80"
              )}>
                {message}
              </span>
            </>
          )}
        </div>

        {/* Expand chevron */}
        {canExpand && (
          <ChevronRight 
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-150",
              isExpanded && "rotate-90"
            )} 
          />
        )}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && hasExpandableContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1">
              {isTool && args && (
                <pre className="text-[11px] leading-relaxed text-muted-foreground font-mono whitespace-pre-wrap break-words">
                  {formatArgsJson(args)}
                </pre>
              )}
              {isSubagent && purpose && (
                <p className="text-[11px] text-muted-foreground italic">
                  {purpose}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

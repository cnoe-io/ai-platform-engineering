"use client";

import React, { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  /** Title/label shown in the header */
  title: React.ReactNode;
  /** Optional icon to show before the title */
  icon?: React.ReactNode;
  /** Optional badge/counter to show on the right side */
  badge?: React.ReactNode;
  /** Content to render inside the collapsible area */
  children: React.ReactNode;
  /** Whether the section is expanded by default */
  defaultExpanded?: boolean;
  /** Controlled expanded state (if provided, component becomes controlled) */
  expanded?: boolean;
  /** Callback when expanded state changes */
  onExpandedChange?: (expanded: boolean) => void;
  /** Whether to auto-collapse when streaming ends */
  autoCollapseOnStreamEnd?: boolean;
  /** Current streaming state (used with autoCollapseOnStreamEnd) */
  isStreaming?: boolean;
  /** Additional class names for the container */
  className?: string;
  /** Additional class names for the header button */
  headerClassName?: string;
  /** Additional class names for the content area */
  contentClassName?: string;
  /** Whether to show a border around the section */
  bordered?: boolean;
}

/**
 * A reusable collapsible section component.
 * Uses CSS grid for smooth height animation that works with auto height.
 */
export function CollapsibleSection({
  title,
  icon,
  badge,
  children,
  defaultExpanded = true,
  expanded: controlledExpanded,
  onExpandedChange,
  autoCollapseOnStreamEnd = false,
  isStreaming = false,
  className,
  headerClassName,
  contentClassName,
  bordered = true,
}: CollapsibleSectionProps) {
  const isControlled = controlledExpanded !== undefined;
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const prevStreamingRef = useRef(isStreaming);

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (autoCollapseOnStreamEnd && prevStreamingRef.current && !isStreaming) {
      startTransition(() => {
        if (isControlled) {
          onExpandedChange?.(false);
        } else {
          setInternalExpanded(false);
        }
      });
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, autoCollapseOnStreamEnd, isControlled, onExpandedChange]);

  const handleToggle = useCallback(() => {
    const newExpanded = !expanded;
    if (isControlled) {
      onExpandedChange?.(newExpanded);
    } else {
      setInternalExpanded(newExpanded);
    }
  }, [expanded, isControlled, onExpandedChange]);

  return (
    <div
      className={cn(
        bordered && "rounded-lg border border-border/50 bg-card/50 overflow-hidden",
        className
      )}
    >
      <button
        onClick={handleToggle}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-xs text-left",
          "hover:bg-muted/30 transition-colors duration-150",
          headerClassName
        )}
      >
        <span 
          className={cn(
            "shrink-0 transition-transform duration-150 ease-out",
            expanded && "rotate-180"
          )}
        >
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </span>
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="text-muted-foreground flex-1">{title}</span>
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </button>
      {/* Grid-based animation for smooth auto-height transitions */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className={contentClassName}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { AppWindow, Sparkles, type LucideIcon, type LucideProps } from "lucide-react";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

/** Shared App spark mark for app-owned agents and application navigation. */
export const AgenticAppIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(function AgenticAppIcon(
  { color = "currentColor", size = 24, strokeWidth = 2, absoluteStrokeWidth, className, ...props },
  ref,
) {
  const maskId = `app-spark-${useId().replace(/:/g, "")}`;
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={cn("lucide lucide-app-spark", className)} {...props}>
      <defs>
        <mask id={maskId} x="0" y="0" width="24" height="24" maskUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="white" stroke="none" />
          <rect x="14" width="10" height="10" fill="black" stroke="none" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <AppWindow x={0} y={2} width={20} height={20} color={color} strokeWidth={strokeWidth}
          absoluteStrokeWidth={absoluteStrokeWidth} aria-hidden="true" />
      </g>
      <Sparkles x={14} y={0} width={10} height={10} color={color} strokeWidth={strokeWidth}
        absoluteStrokeWidth={absoluteStrokeWidth} aria-hidden="true" />
    </svg>
  );
});

"use client";

import { cn } from "@/lib/utils";
import { motion,useReducedMotion } from "framer-motion";

export type SlidingSelectorVariant = "pill" | "liquid" | "underline";

export interface SlidingSelectorBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface SlidingSelectorIndicatorProps {
  bounds?: SlidingSelectorBounds;
  className?: string;
  layoutId?: string;
  variant?: SlidingSelectorVariant;
}

/**
 * Shared active-state surface for navigation controls.
 *
 * Framer Motion moves the same layout element between items instead of
 * mounting an unrelated background on every selection. Keeping the motion in
 * this primitive gives every tab header the same timing and reduced-motion
 * behaviour, while the liquid preset adds a softer spring for large pills.
 */
function SlidingSelectorIndicator({
  bounds,
  className,
  layoutId,
  variant = "pill",
}: SlidingSelectorIndicatorProps) {
  const shouldReduceMotion = useReducedMotion();

  const transition = shouldReduceMotion
    ? { duration: 0 }
    : variant === "liquid"
      ? { type: "spring" as const, stiffness: 300, damping: 23, mass: 0.9 }
      : variant === "underline"
        ? {
            type: "tween" as const,
            duration: 0.2,
            ease: [0.22, 1, 0.36, 1] as const,
          }
        : {
            type: "tween" as const,
            duration: 0.24,
            ease: [0.22, 1, 0.36, 1] as const,
          };

  return (
    <motion.span
      aria-hidden="true"
      data-slot="sliding-selector-indicator"
      data-variant={variant}
      animate={
        bounds
          ? {
              height: bounds.height,
              width: bounds.width,
              x: bounds.x,
              y: bounds.y,
            }
          : undefined
      }
      initial={false}
      layoutId={layoutId}
      transition={transition}
      className={cn(
        "pointer-events-none absolute z-0",
        variant === "pill" &&
          cn(
            bounds ? "left-0 top-0" : "inset-0",
            "rounded-[inherit] bg-background shadow-sm ring-1 ring-border/50",
          ),
        variant === "liquid" &&
          cn(
            bounds ? "left-0 top-0" : "inset-0",
            "overflow-hidden rounded-[inherit] bg-primary shadow-md ring-1 ring-white/15",
          ),
        variant === "underline" &&
          cn(
            bounds ? "left-0 top-0" : "inset-x-0 -bottom-px h-0.5",
            "rounded-full bg-primary shadow-sm",
          ),
        className,
      )}
    >
      {variant === "liquid" && (
        <>
          <span className="absolute inset-x-3 top-px h-px rounded-full bg-white/35" />
          <span className="absolute -left-3 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white/10 blur-md" />
        </>
      )}
    </motion.span>
  );
}

export { SlidingSelectorIndicator };

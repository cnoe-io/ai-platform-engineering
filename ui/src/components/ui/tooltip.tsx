"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
}

const TooltipContext = React.createContext<{
  delayDuration: number;
}>({ delayDuration: 300 });

export function TooltipProvider({
  children,
  delayDuration = 300,
}: TooltipProviderProps) {
  return (
    <TooltipContext.Provider value={{ delayDuration }}>
      {children}
    </TooltipContext.Provider>
  );
}

interface TooltipProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const TooltipStateContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function Tooltip({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  
  const setOpen = React.useCallback((value: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(value);
    }
    onOpenChange?.(value);
  }, [isControlled, onOpenChange]);

  return (
    <TooltipStateContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block">{children}</div>
    </TooltipStateContext.Provider>
  );
}

interface TooltipTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function TooltipTrigger({ children, asChild }: TooltipTriggerProps) {
  const { setOpen } = React.useContext(TooltipStateContext);
  const { delayDuration } = React.useContext(TooltipContext);
  const timeoutRef = React.useRef<NodeJS.Timeout>();

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setOpen(true), delayDuration);
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  React.useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
    });
  }

  return (
    <span
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
    </span>
  );
}

interface TooltipContentProps {
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  className?: string;
}

export function TooltipContent({
  children,
  side = "top",
  sideOffset = 4,
  className,
}: TooltipContentProps) {
  const { open } = React.useContext(TooltipStateContext);

  if (!open) return null;

  const sideStyles = {
    top: `bottom-full left-1/2 -translate-x-1/2 mb-${sideOffset / 4}`,
    bottom: `top-full left-1/2 -translate-x-1/2 mt-${sideOffset / 4}`,
    left: `right-full top-1/2 -translate-y-1/2 mr-${sideOffset / 4}`,
    right: `left-full top-1/2 -translate-y-1/2 ml-${sideOffset / 4}`,
  };

  return (
    <div
      className={cn(
        "absolute z-50 px-2 py-1 text-xs font-medium text-popover-foreground bg-popover border border-border rounded-md shadow-md animate-in fade-in-0 zoom-in-95",
        sideStyles[side],
        className
      )}
      style={{ marginBottom: side === "top" ? sideOffset : undefined, marginTop: side === "bottom" ? sideOffset : undefined }}
    >
      {children}
    </div>
  );
}

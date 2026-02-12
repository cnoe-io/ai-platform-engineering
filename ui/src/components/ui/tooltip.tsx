"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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
  triggerRef: React.MutableRefObject<HTMLElement | null>;
}>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null }
});

export function Tooltip({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const setOpen = React.useCallback((value: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(value);
    }
    onOpenChange?.(value);
  }, [isControlled, onOpenChange]);

  return (
    <TooltipStateContext.Provider value={{ open, setOpen, triggerRef }}>
      <span className="relative inline-block">{children}</span>
    </TooltipStateContext.Provider>
  );
}

interface TooltipTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function TooltipTrigger({ children, asChild }: TooltipTriggerProps) {
  const { setOpen, triggerRef } = React.useContext(TooltipStateContext);
  const { delayDuration } = React.useContext(TooltipContext);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const elementRef = React.useRef<HTMLElement | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setOpen(true), delayDuration);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  React.useEffect(() => {
    if (elementRef.current) {
      triggerRef.current = elementRef.current;
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [triggerRef]);

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      ref: (node: HTMLElement | null) => {
        elementRef.current = node;
        if (typeof (children as any).ref === 'function') {
          (children as any).ref(node);
        } else if ((children as any).ref) {
          (children as any).ref.current = node;
        }
      },
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
    });
  }

  return (
    <span
      ref={(node) => {
        elementRef.current = node;
      }}
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
  const { open, triggerRef } = React.useContext(TooltipStateContext);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();

      let top = 0;
      let left = 0;

      switch (side) {
        case "top":
          top = rect.top - sideOffset;
          left = rect.left + rect.width / 2;
          break;
        case "bottom":
          top = rect.bottom + sideOffset;
          left = rect.left + rect.width / 2;
          break;
        case "left":
          top = rect.top + rect.height / 2;
          left = rect.left - sideOffset;
          break;
        case "right":
          top = rect.top + rect.height / 2;
          left = rect.right + sideOffset;
          break;
      }

      setPosition({ top, left });
    };

    updatePosition();

    // Update position on scroll/resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, side, sideOffset, triggerRef]);

  if (!open) return null;

  const content = (
    <div
      className={cn(
        "fixed z-[9999] px-2 py-1 text-xs font-medium text-popover-foreground bg-popover border border-border rounded-md shadow-lg whitespace-nowrap pointer-events-none",
        side === "top" && "-translate-x-1/2 -translate-y-full",
        side === "bottom" && "-translate-x-1/2",
        side === "left" && "-translate-x-full -translate-y-1/2",
        side === "right" && "-translate-y-1/2",
        className
      )}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {children}
    </div>
  );

  // Use portal to render outside overflow containers
  if (typeof window !== 'undefined') {
    return createPortal(content, document.body);
  }

  return null;
}

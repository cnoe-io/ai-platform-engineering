"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface PopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const PopoverStateContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function Popover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback((value: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(value);
    }
    onOpenChange?.(value);
  }, [isControlled, onOpenChange]);

  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, setOpen]);

  return (
    <PopoverStateContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-flex">{children}</div>
    </PopoverStateContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
  const { open, setOpen } = React.useContext(PopoverStateContext);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(!open);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
      onClick: handleClick,
    });
  }

  return (
    <button type="button" onClick={handleClick}>
      {children}
    </button>
  );
}

interface PopoverContentProps {
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  alignOffset?: number;
  className?: string;
}

export function PopoverContent({
  children,
  side = "bottom",
  align = "center",
  sideOffset = 8,
  alignOffset = 0,
  className,
}: PopoverContentProps) {
  const { open, setOpen } = React.useContext(PopoverStateContext);
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    // Delay to prevent immediate close from trigger click
    setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, setOpen]);

  if (!open) return null;

  // Position styles based on side and align
  const getPositionStyles = () => {
    const styles: Record<string, string> = {};
    
    // Side positioning
    if (side === "top") {
      styles.bottom = "100%";
      styles.marginBottom = `${sideOffset}px`;
    } else if (side === "bottom") {
      styles.top = "100%";
      styles.marginTop = `${sideOffset}px`;
    } else if (side === "left") {
      styles.right = "100%";
      styles.marginRight = `${sideOffset}px`;
    } else if (side === "right") {
      styles.left = "100%";
      styles.marginLeft = `${sideOffset}px`;
    }

    // Alignment
    if (side === "top" || side === "bottom") {
      if (align === "start") {
        styles.left = `${alignOffset}px`;
      } else if (align === "end") {
        styles.right = `${alignOffset}px`;
      } else {
        styles.left = "50%";
        styles.transform = "translateX(-50%)";
      }
    } else {
      if (align === "start") {
        styles.top = `${alignOffset}px`;
      } else if (align === "end") {
        styles.bottom = `${alignOffset}px`;
      } else {
        styles.top = "50%";
        styles.transform = "translateY(-50%)";
      }
    }

    return styles;
  };

  return (
    <div
      ref={contentRef}
      className={cn(
        "absolute z-50 rounded-lg bg-popover text-popover-foreground shadow-lg border border-border",
        "animate-in fade-in-0 zoom-in-95",
        side === "bottom" && "slide-in-from-top-2",
        side === "top" && "slide-in-from-bottom-2",
        side === "left" && "slide-in-from-right-2",
        side === "right" && "slide-in-from-left-2",
        className
      )}
      style={getPositionStyles()}
    >
      {children}
    </div>
  );
}

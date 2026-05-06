"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface PopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const PopoverStateContext = React.createContext<PopoverContextValue>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
});

export function Popover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: PopoverProps) {
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
    <PopoverStateContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="relative inline-flex">{children}</div>
    </PopoverStateContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
  const { open, setOpen, triggerRef } = React.useContext(PopoverStateContext);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(!open);
  };

  // Capture the rendered DOM node so PopoverContent can compute viewport
  // coordinates from it. Without this the popover has no anchor when it's
  // portaled to document.body.
  const setRef = React.useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    [triggerRef],
  );

  if (asChild && React.isValidElement(children)) {
    type ChildProps = React.HTMLAttributes<HTMLElement> & {
      ref?: React.Ref<HTMLElement>;
    };
    const childWithRef = children as React.ReactElement<ChildProps> & {
      ref?: React.Ref<HTMLElement>;
    };
    const existingRef = childWithRef.ref;
    const mergedRef = (node: HTMLElement | null) => {
      setRef(node);
      if (typeof existingRef === "function") existingRef(node);
      else if (existingRef && typeof existingRef === "object")
        (existingRef as React.MutableRefObject<HTMLElement | null>).current = node;
    };
    return React.cloneElement(childWithRef, {
      onClick: handleClick,
      ref: mergedRef,
    } as ChildProps);
  }

  return (
    <button type="button" onClick={handleClick} ref={setRef as React.Ref<HTMLButtonElement>}>
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

/**
 * Popover content rendered via React portal to `document.body`.
 *
 * The previous implementation used `position: absolute` inside the trigger's
 * relative parent, which meant any ancestor with `overflow: hidden` (e.g. a
 * narrow resizable panel like the Skill workspace Files tree) clipped the
 * popover. Portalling to body + computing fixed-position coordinates from
 * the trigger's `getBoundingClientRect()` lets the popover escape those
 * clipping contexts and stay anchored under any layout. We also clamp the
 * final coordinates to the viewport so a narrow panel can never push the
 * popover off-screen — the bug that motivated this change.
 *
 * Recomputed on open, on resize, and on scroll so it tracks the trigger
 * even when the user resizes the workspace pane while the popover is open.
 */
const VIEWPORT_PADDING = 8;

export function PopoverContent({
  children,
  side = "bottom",
  align = "center",
  sideOffset = 8,
  alignOffset = 0,
  className,
}: PopoverContentProps) {
  const { open, setOpen, triggerRef } = React.useContext(PopoverStateContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const computeCoords = React.useCallback(() => {
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;
    const tRect = trigger.getBoundingClientRect();
    const cRect = content.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;

    if (side === "top") {
      top = tRect.top - cRect.height - sideOffset;
    } else if (side === "bottom") {
      top = tRect.bottom + sideOffset;
    } else if (side === "left") {
      left = tRect.left - cRect.width - sideOffset;
    } else if (side === "right") {
      left = tRect.right + sideOffset;
    }

    if (side === "top" || side === "bottom") {
      if (align === "start") left = tRect.left + alignOffset;
      else if (align === "end") left = tRect.right - cRect.width - alignOffset;
      else left = tRect.left + tRect.width / 2 - cRect.width / 2;
    } else {
      if (align === "start") top = tRect.top + alignOffset;
      else if (align === "end") top = tRect.bottom - cRect.height - alignOffset;
      else top = tRect.top + tRect.height / 2 - cRect.height / 2;
    }

    // Viewport clamp — prevents the popover from disappearing off the
    // left/right edge of the screen on narrow side panels.
    left = Math.max(
      VIEWPORT_PADDING,
      Math.min(left, vw - cRect.width - VIEWPORT_PADDING),
    );
    top = Math.max(
      VIEWPORT_PADDING,
      Math.min(top, vh - cRect.height - VIEWPORT_PADDING),
    );

    setCoords({ top, left });
  }, [align, alignOffset, side, sideOffset, triggerRef]);

  React.useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    // Two-pass: first render off-screen so we can measure, then position.
    computeCoords();
    const onChange = () => computeCoords();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, computeCoords]);

  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, setOpen, triggerRef]);

  if (!open || !mounted) return null;

  const node = (
    <div
      ref={contentRef}
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        visibility: coords ? "visible" : "hidden",
      }}
      className={cn(
        "z-50 rounded-lg bg-popover text-popover-foreground shadow-lg border border-border",
        "animate-in fade-in-0 zoom-in-95",
        side === "bottom" && "slide-in-from-top-2",
        side === "top" && "slide-in-from-bottom-2",
        side === "left" && "slide-in-from-right-2",
        side === "right" && "slide-in-from-left-2",
        className,
      )}
    >
      {children}
    </div>
  );

  return createPortal(node, document.body);
}

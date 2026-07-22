"use client";

import { cn } from "@/lib/utils";
import {
  SlidingSelectorIndicator,
  type SlidingSelectorBounds,
  type SlidingSelectorVariant,
} from "@/components/ui/sliding-selector";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

interface TabsMotionContextValue {
  activeValue?: string;
}

const TabsMotionContext = React.createContext<TabsMotionContextValue | null>(null);

type TabsProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

/**
 * Radix Tabs with a controlled mirror of its current value. TabsList uses that
 * value to position one persistent indicator, so moving between any standard
 * tab headers animates by default without shared-layout stretching.
 */
function Tabs({ defaultValue,onValueChange,value,...props }: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const activeValue = value ?? uncontrolledValue;

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    },
    [onValueChange],
  );

  return (
    <TabsMotionContext.Provider value={{ activeValue }}>
      <TabsPrimitive.Root
        {...props}
        defaultValue={defaultValue}
        value={value}
        onValueChange={handleValueChange}
      />
    </TabsMotionContext.Provider>
  );
}
Tabs.displayName = TabsPrimitive.Root.displayName;

interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** Active selector style. Pill is the default for every standard tab header. */
  indicator?: SlidingSelectorVariant | "none";
  /** Optional colour/elevation overrides applied to the shared selector. */
  indicatorClassName?: string;
  /**
   * Separates menus that reuse the same Tabs root. Change this value when the
   * set of tabs represents a different navigation group so the selector does
   * not travel between unrelated item positions.
   */
  indicatorScope?: string;
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({
  children,
  className,
  indicator = "pill",
  indicatorClassName,
  indicatorScope,
  ...props
}, forwardedRef) => {
  const motionContext = React.useContext(TabsMotionContext);
  const listRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List>>(null);
  const scope = indicatorScope ?? "default";
  const [positionedIndicator, setPositionedIndicator] = React.useState<{
    bounds: SlidingSelectorBounds;
    scope: string;
  } | null>(null);

  const setListRef = React.useCallback(
    (node: React.ElementRef<typeof TabsPrimitive.List> | null) => {
      listRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef],
  );

  const measureActiveTrigger = React.useCallback(() => {
    const list = listRef.current;
    if (!list || indicator === "none") {
      setPositionedIndicator(null);
      return;
    }

    const activeTrigger = list.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]',
    );
    if (!activeTrigger) {
      setPositionedIndicator(null);
      return;
    }

    const isUnderline = indicator === "underline";
    const bounds: SlidingSelectorBounds = {
      height: isUnderline ? 2 : activeTrigger.offsetHeight,
      width: activeTrigger.offsetWidth,
      x: activeTrigger.offsetLeft,
      y: isUnderline
        ? activeTrigger.offsetTop + activeTrigger.offsetHeight - 1
        : activeTrigger.offsetTop,
    };

    setPositionedIndicator((current) => {
      if (
        current?.scope === scope &&
        current.bounds.height === bounds.height &&
        current.bounds.width === bounds.width &&
        current.bounds.x === bounds.x &&
        current.bounds.y === bounds.y
      ) {
        return current;
      }
      return { bounds, scope };
    });
  }, [indicator, scope]);

  React.useLayoutEffect(() => {
    measureActiveTrigger();
  }, [children, measureActiveTrigger, motionContext?.activeValue]);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measureActiveTrigger);
    observer.observe(list);
    const activeTrigger = list.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]',
    );
    if (activeTrigger) observer.observe(activeTrigger);
    return () => observer.disconnect();
  }, [measureActiveTrigger, motionContext?.activeValue]);

  return (
    <TabsPrimitive.List
      ref={setListRef}
      className={cn(
        "relative isolate inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      {indicator !== "none" && positionedIndicator?.scope === scope && (
        <SlidingSelectorIndicator
          key={scope}
          bounds={positionedIndicator.bounds}
          variant={indicator}
          className={indicatorClassName}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs,TabsContent,TabsList,TabsTrigger };

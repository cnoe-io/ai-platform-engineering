"use client";

/**
 * Lets a page layout (e.g. chat/layout.tsx) render its breadcrumb trail
 * *inside* AppHeader's row instead of in its own padded block underneath
 * it. Same portal-into-a-context-target idea already used by
 * `WorkspacePageActions`, just running in the other direction: here the
 * header owns the slot, and pages portal content into it.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";

interface HeaderBreadcrumbSlotContextValue {
  setTarget: RefCallback<HTMLDivElement>;
  target: HTMLDivElement | null;
}

const HeaderBreadcrumbSlotContext = createContext<
  HeaderBreadcrumbSlotContextValue | undefined
>(undefined);

/** Mount once, high in the tree (AppLayoutClient), alongside AppHeader. */
export function HeaderBreadcrumbSlotProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ setTarget, target }), [target]);

  return (
    <HeaderBreadcrumbSlotContext.Provider value={value}>
      {children}
    </HeaderBreadcrumbSlotContext.Provider>
  );
}

/** Used once, by AppHeader, to mark where portaled breadcrumbs should land. */
export function useHeaderBreadcrumbSlotRef():
  | RefCallback<HTMLDivElement>
  | undefined {
  return useContext(HeaderBreadcrumbSlotContext)?.setTarget;
}

/**
 * Used by a page layout to render its breadcrumb into the header slot.
 * Renders nothing until AppHeader has mounted and registered the target
 * (same brief-flash tradeoff WorkspacePageActions already accepts).
 */
export function HeaderBreadcrumbPortal({
  children,
}: {
  children: ReactNode;
}) {
  const context = useContext(HeaderBreadcrumbSlotContext);
  if (!context?.target) return null;
  return createPortal(children, context.target);
}

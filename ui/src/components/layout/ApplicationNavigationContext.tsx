"use client";

import { WorkspaceRailProvider } from "@/components/layout/WorkspaceRailContext";
import React from "react";

interface ApplicationNavigationRegistration {
  areaKey: string;
  content: React.ReactNode;
}

interface ApplicationNavigationContextValue {
  closeMobileNavigation: () => void;
  mobileNavigationOpen: boolean;
  openMobileNavigation: () => void;
  registration: ApplicationNavigationRegistration | null;
  registerNavigation: (
    registration: ApplicationNavigationRegistration,
  ) => () => void;
  setMobileNavigationOpen: (open: boolean) => void;
}

const ApplicationNavigationContext =
  React.createContext<ApplicationNavigationContextValue | null>(null);

export function ApplicationNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [registration,setRegistration] =
    React.useState<ApplicationNavigationRegistration | null>(null);
  const [mobileNavigationOpen,setMobileNavigationOpen] = React.useState(false);

  const registerNavigation = React.useCallback(
    (nextRegistration: ApplicationNavigationRegistration) => {
      setRegistration(nextRegistration);
      return () => {
        setRegistration((current) =>
          current?.areaKey === nextRegistration.areaKey ? null : current,
        );
      };
    },
    [],
  );
  const openMobileNavigation = React.useCallback(
    () => setMobileNavigationOpen(true),
    [],
  );
  const closeMobileNavigation = React.useCallback(
    () => setMobileNavigationOpen(false),
    [],
  );

  const value = React.useMemo<ApplicationNavigationContextValue>(
    () => ({
      closeMobileNavigation,
      mobileNavigationOpen,
      openMobileNavigation,
      registration,
      registerNavigation,
      setMobileNavigationOpen,
    }),
    [
      closeMobileNavigation,
      mobileNavigationOpen,
      openMobileNavigation,
      registration,
      registerNavigation,
    ],
  );

  return (
    <ApplicationNavigationContext.Provider value={value}>
      <WorkspaceRailProvider
        collapsible
        storageKey="application-navigation-collapsed"
      >
        {children}
      </WorkspaceRailProvider>
    </ApplicationNavigationContext.Provider>
  );
}

export function useApplicationNavigation():
  | ApplicationNavigationContextValue
  | null {
  return React.useContext(ApplicationNavigationContext);
}

export function useRegisterApplicationNavigation({
  areaKey,
  content,
  version,
}: {
  areaKey?: string;
  content?: React.ReactNode;
  version?: string;
}): boolean {
  const context = useApplicationNavigation();
  const contentRef = React.useRef(content);
  const registerNavigation = context?.registerNavigation;

  React.useLayoutEffect(() => {
    contentRef.current = content;
  },[content]);

  React.useLayoutEffect(() => {
    if (!registerNavigation || !areaKey || !contentRef.current) return;
    return registerNavigation({ areaKey,content: contentRef.current });
  }, [areaKey,registerNavigation,version]);

  return Boolean(context && areaKey && content != null);
}

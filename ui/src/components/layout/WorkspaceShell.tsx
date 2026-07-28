"use client";

import {
  useWorkspaceRail,
  WorkspaceRailProvider,
} from "@/components/layout/WorkspaceRailContext";
import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  children: React.ReactNode;
  className?: string;
  collapsibleNavigation?: boolean;
  containerClassName?: string;
  contentClassName?: string;
  header: React.ReactNode;
  maxWidthClassName?: string;
  navigation: React.ReactNode;
  navigationStorageKey?: string;
}

/** Shared page frame for routed workspaces with responsive section navigation. */
export function WorkspaceShell({
  collapsibleNavigation = true,
  navigationStorageKey,
  ...props
}: WorkspaceShellProps): React.ReactElement {
  return (
    <WorkspaceRailProvider
      collapsible={collapsibleNavigation && Boolean(props.navigation)}
      storageKey={navigationStorageKey}
    >
      <WorkspaceShellLayout {...props} />
    </WorkspaceRailProvider>
  );
}

function WorkspaceShellLayout({
  children,
  className,
  containerClassName,
  contentClassName,
  header,
  maxWidthClassName = "max-w-none",
  navigation,
}: WorkspaceShellProps): React.ReactElement {
  const hasNavigation = Boolean(navigation);
  const { collapsed } = useWorkspaceRail();

  return (
    <main className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div
        className={cn(
          "mx-auto min-h-full w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 xl:pl-5",
          maxWidthClassName,
          hasNavigation
            ? cn(
                "space-y-6 xl:grid xl:grid-rows-[min-content_minmax(0,1fr)] xl:items-start xl:gap-y-6 xl:space-y-0",
                collapsed
                  ? "xl:grid-cols-[4.25rem_minmax(0,1fr)] xl:gap-x-5"
                  : "xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-x-6",
              )
            : "space-y-6",
          containerClassName,
        )}
      >
        <div
          className={cn(
            "[&>header]:mb-0",
            hasNavigation && "xl:col-start-2 xl:row-start-1",
          )}
        >
          {header}
        </div>
        {navigation}
        <section
          className={cn(
            "min-w-0",
            hasNavigation && "xl:col-start-2 xl:row-start-2",
            contentClassName,
          )}
        >
          {children}
        </section>
      </div>
    </main>
  );
}

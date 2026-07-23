import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  header: React.ReactNode;
  maxWidthClassName?: string;
  navigation: React.ReactNode;
}

/** Shared page frame for routed workspaces with responsive section navigation. */
export function WorkspaceShell({
  children,
  className,
  contentClassName,
  header,
  maxWidthClassName = "max-w-7xl",
  navigation,
}: WorkspaceShellProps): React.ReactElement {
  return (
    <main className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div
        className={cn(
          "mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
          maxWidthClassName,
        )}
      >
        {header}
        <div className="space-y-6 lg:flex lg:items-start lg:gap-10 lg:space-y-0">
          {navigation}
          <section className={cn("min-w-0 flex-1", contentClassName)}>{children}</section>
        </div>
      </div>
    </main>
  );
}

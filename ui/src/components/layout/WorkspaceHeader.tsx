import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface WorkspaceHeaderProps {
  actions?: React.ReactNode;
  description: string;
  icon: LucideIcon;
  iconAnimationClassName?: string;
  iconTestId?: string;
  title: string;
}

/** Shared identity header for page-style workspaces. */
export function WorkspaceHeader({
  actions,
  description,
  icon: Icon,
  iconAnimationClassName,
  iconTestId,
  title,
}: WorkspaceHeaderProps): React.ReactElement {
  return (
    <header className="mb-8 flex shrink-0 flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="group rounded-xl bg-primary/10 p-2.5 text-primary"
          data-testid={iconTestId}
        >
          <Icon
            className={cn(
              "h-5 w-5 transform-gpu motion-safe:transition-transform motion-safe:ease-out",
              iconAnimationClassName,
            )}
          />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export interface WorkspaceBreadcrumbItem {
  href?: string;
  label: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}

interface WorkspacePageHeaderProps {
  actions?: React.ReactNode;
  breadcrumbs: WorkspaceBreadcrumbItem[];
  className?: string;
  description: string;
  title: string;
  titleId?: string;
}

/**
 * Contextual header for a routed workspace destination.
 *
 * Breadcrumbs preserve the route hierarchy while the single h1 names the
 * current task. This avoids repeating a workspace identity as a second title.
 */
export function WorkspacePageHeader({
  actions,
  breadcrumbs,
  className,
  description,
  title,
  titleId,
}: WorkspacePageHeaderProps): React.ReactElement {
  return (
    <header className={cn("space-y-3",className)}>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {breadcrumbs.map((item,index) => {
            const current = index === breadcrumbs.length - 1;
            return (
              <li className="flex min-w-0 items-center gap-1" key={`${item.label}-${index}`}>
                {index > 0 ? (
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-60" />
                ) : null}
                {item.href ? (
                  <Link
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "truncate rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      current && "font-medium text-foreground",
                    )}
                    href={item.href}
                    onClick={item.onClick}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-current={current ? "page" : undefined}
                    className={cn("truncate",current && "font-medium text-foreground")}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight" id={titleId}>{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

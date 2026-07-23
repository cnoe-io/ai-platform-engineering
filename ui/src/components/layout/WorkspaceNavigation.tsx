"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronDown,type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId,useState } from "react";

export interface WorkspaceNavigationItem {
  children?: WorkspaceNavigationItem[];
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  onSelect?: () => void;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  prefetch?: boolean;
  testId?: string;
}

function navigationLeaves(items: WorkspaceNavigationItem[]): WorkspaceNavigationItem[] {
  return items.flatMap((item) => item.children?.length
    ? navigationLeaves(item.children)
    : [item]);
}

export interface WorkspaceNavigationGroup {
  id: string;
  label?: string;
  icon?: LucideIcon;
  items: WorkspaceNavigationItem[];
}

export interface WorkspaceNavigationCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  groups: WorkspaceNavigationGroup[];
}

interface WorkspaceNavigationListProps {
  activeItemId: string;
  ariaLabel: string;
  className?: string;
  collapsed?: boolean;
  density?: "compact" | "descriptive";
  groups: WorkspaceNavigationGroup[];
}

function NavigationItem({
  active,
  collapsed,
  density,
  item,
}: {
  active: boolean;
  collapsed: boolean;
  density: "compact" | "descriptive";
  item: WorkspaceNavigationItem;
}): React.ReactElement {
  const Icon = item.icon;
  const itemClassName = cn(
    "group flex w-full items-center gap-3 rounded-xl border text-left outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    density === "descriptive" ? "min-h-14 px-2.5 py-2" : "min-h-12 px-2.5 py-2",
    collapsed && "justify-center px-2",
    item.disabled
      ? "cursor-not-allowed border-transparent text-muted-foreground opacity-50"
      : active
        ? "workspace-navigation-active border-transparent font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground",
  );
  const contents = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          !item.disabled && active
            ? "gradient-primary-br text-white shadow-sm"
            : "bg-muted text-muted-foreground",
          !item.disabled && !active && "group-hover:bg-background group-hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      {!collapsed ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.label}</span>
          {density === "descriptive" && item.description ? (
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {item.description}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  const control = item.disabled ? (
    <span
      aria-disabled="true"
      aria-label={`${item.label}: ${item.disabledReason ?? "Unavailable"}`}
      className={itemClassName}
      data-testid={item.testId}
      role="link"
      tabIndex={0}
    >
      {contents}
    </span>
  ) : item.href ? (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={itemClassName}
      data-testid={item.testId}
      href={item.href}
      prefetch={item.prefetch}
    >
      {contents}
    </Link>
  ) : (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={itemClassName}
      data-testid={item.testId}
      onClick={item.onSelect}
      type="button"
    >
      {contents}
    </button>
  );

  if (!collapsed && !item.disabled) return control;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-normal" side="right" sideOffset={8}>
        {item.disabled ? item.disabledReason ?? `${item.label} is unavailable` : item.label}
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceNavigationList({
  activeItemId,
  ariaLabel,
  className,
  collapsed = false,
  density = "compact",
  groups,
}: WorkspaceNavigationListProps): React.ReactElement {
  const [expandedItemIds,setExpandedItemIds] = useState<Set<string>>(() => new Set(
    groups.flatMap((group) => group.items)
      .filter((item) => item.children?.some((child) => child.id === activeItemId))
      .map((item) => item.id),
  ));

  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label={ariaLabel} className={cn("space-y-7",className)}>
        {groups.map((group) => {
          const GroupIcon = group.icon;
          const headingId = `workspace-navigation-${group.id}`;
          return (
            <section
              aria-labelledby={group.label ? headingId : undefined}
              className="space-y-2"
              key={group.id}
            >
              {group.label ? (
                <h2
                  className={cn(
                    "flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                    collapsed && "sr-only",
                  )}
                  id={headingId}
                >
                  {GroupIcon ? <GroupIcon aria-hidden="true" className="h-3 w-3" /> : null}
                  <span>{group.label}</span>
                </h2>
              ) : null}
              <div className="space-y-1">
                {group.items.map((item) => {
                  if (!item.children?.length) {
                    return (
                      <NavigationItem
                        active={item.id === activeItemId}
                        collapsed={collapsed}
                        density={density}
                        item={item}
                        key={item.id}
                      />
                    );
                  }

                  const Icon = item.icon;
                  const active = item.children.some((child) => child.id === activeItemId);
                  const expanded = expandedItemIds.has(item.id);
                  const childrenId = `workspace-navigation-children-${item.id}`;
                  return (
                    <div className="space-y-2" key={item.id}>
                      <button
                        aria-controls={childrenId}
                        aria-expanded={expanded}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left text-muted-foreground outline-none transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          density === "descriptive" ? "min-h-14" : "min-h-12",
                          active
                            ? "bg-muted/50 font-medium text-foreground"
                            : "hover:bg-muted/60 hover:text-foreground",
                          collapsed && "justify-center px-2",
                        )}
                        onClick={() => setExpandedItemIds((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) {
                            next.delete(item.id);
                          } else {
                            next.add(item.id);
                          }
                          return next;
                        })}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                            active && "gradient-primary-br text-white shadow-sm",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        {!collapsed ? (
                          <>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{item.label}</span>
                              {density === "descriptive" && item.description ? (
                                <span className="block truncate text-xs font-normal text-muted-foreground">
                                  {item.description}
                                </span>
                              ) : null}
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                "h-4 w-4 shrink-0 transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          </>
                        ) : null}
                      </button>

                      {expanded && !collapsed ? (
                        <div
                          className="ml-4 space-y-1 border-l border-border/70 pl-3"
                          id={childrenId}
                        >
                          {item.children.map((child) => (
                            <NavigationItem
                              active={child.id === activeItemId}
                              collapsed={false}
                              density="compact"
                              item={child}
                              key={child.id}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

interface WorkspaceSectionPickerProps {
  activeItemId: string;
  ariaLabel: string;
  className?: string;
  groups: WorkspaceNavigationGroup[];
}

export function WorkspaceSectionPicker({
  activeItemId,
  ariaLabel,
  className,
  groups,
}: WorkspaceSectionPickerProps): React.ReactElement {
  const id = useId();
  const router = useRouter();
  const activeItem = navigationLeaves(groups.flatMap((group) => group.items))
    .find((item) => item.id === activeItemId);
  const itemValue = (item: WorkspaceNavigationItem): string => item.href ?? item.id;

  return (
    <div className={cn("relative",className)}>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor={id}>
        {ariaLabel}
      </label>
      <select
        aria-label={ariaLabel}
        className="h-12 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        id={id}
        onChange={(event) => {
          const selectedItem = groups
            .flatMap((group) => navigationLeaves(group.items))
            .find((item) => itemValue(item) === event.target.value);
          if (selectedItem?.onSelect) {
            selectedItem.onSelect();
          } else if (selectedItem?.href) {
            router.push(selectedItem.href);
          }
        }}
        value={activeItem ? itemValue(activeItem) : ""}
      >
        {groups.map((group) => {
          const options = navigationLeaves(group.items).map((item) => (
            <option disabled={item.disabled} key={item.id} value={itemValue(item)}>
              {item.label}
            </option>
          ));
          return group.label ? (
            <optgroup key={group.id} label={group.label}>{options}</optgroup>
          ) : (
            <optgroup key={group.id} label="Sections">{options}</optgroup>
          );
        })}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute bottom-4 right-3 h-4 w-4 text-muted-foreground"
      />
    </div>
  );
}

interface WorkspaceSectionNavigationProps {
  activeItemId: string;
  desktopFooter?: React.ReactNode;
  groups: WorkspaceNavigationGroup[];
  mobileFooter?: React.ReactNode;
  navigationLabel: string;
  pickerLabel?: string;
}

/**
 * Canonical responsive section navigation used by page-style workspaces.
 * Keeping the mobile picker and desktop rail together prevents individual
 * workspaces from drifting in width, density, spacing, or breakpoints.
 */
export function WorkspaceSectionNavigation({
  activeItemId,
  desktopFooter,
  groups,
  mobileFooter,
  navigationLabel,
  pickerLabel = navigationLabel,
}: WorkspaceSectionNavigationProps): React.ReactElement {
  return (
    <>
      <div className="space-y-3 lg:hidden">
        <WorkspaceSectionPicker
          activeItemId={activeItemId}
          ariaLabel={pickerLabel}
          groups={groups}
        />
        {mobileFooter}
      </div>
      <aside className="hidden w-64 shrink-0 lg:block">
        <WorkspaceNavigationList
          activeItemId={activeItemId}
          ariaLabel={navigationLabel}
          className="sticky top-6"
          groups={groups}
        />
        {desktopFooter}
      </aside>
    </>
  );
}

interface WorkspaceHierarchicalSectionNavigationProps {
  activeCategoryId: string;
  activeItemId: string;
  categories: WorkspaceNavigationCategory[];
  navigationLabel: string;
  pickerLabel?: string;
}

/**
 * Responsive two-level navigation for information-dense workspaces.
 * Every category remains visible. Category buttons disclose destinations
 * without changing the current page, so users can navigate directly to the
 * destination they intended.
 */
export function WorkspaceHierarchicalSectionNavigation({
  activeCategoryId,
  activeItemId,
  categories,
  navigationLabel,
  pickerLabel = navigationLabel,
}: WorkspaceHierarchicalSectionNavigationProps): React.ReactElement {
  const [expandedCategoryIds,setExpandedCategoryIds] = useState<Set<string>>(
    () => new Set([activeCategoryId]),
  );

  const pickerGroups: WorkspaceNavigationGroup[] = categories.map((category) => ({
    id: category.id,
    label: category.label,
    items: category.groups.flatMap((group) => group.items),
  }));

  return (
    <>
      <div className="lg:hidden">
        <WorkspaceSectionPicker
          activeItemId={activeItemId}
          ariaLabel={pickerLabel}
          groups={pickerGroups}
        />
      </div>

      <aside className="hidden w-64 shrink-0 lg:block">
        <TooltipProvider delayDuration={200}>
          <nav aria-label={navigationLabel} className="sticky top-6 space-y-1">
            {categories.map((category) => {
              const active = category.id === activeCategoryId;
              const expanded = expandedCategoryIds.has(category.id);
              const CategoryIcon = category.icon;
              const destinationsId = `workspace-category-${category.id}`;
              return (
                <section className="space-y-2" key={category.id}>
                  <button
                    aria-controls={destinationsId}
                    aria-expanded={expanded}
                    className={cn(
                      "group flex min-h-11 w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active
                        ? "border-border/70 bg-muted/50 font-medium text-foreground"
                        : expanded
                          ? "border-border/50 bg-muted/30 text-foreground"
                          : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground",
                    )}
                    data-active={active || undefined}
                    onClick={() => setExpandedCategoryIds((current) => {
                      const next = new Set(current);
                      if (next.has(category.id)) {
                        next.delete(category.id);
                      } else {
                        next.add(category.id);
                      }
                      return next;
                    })}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                        active
                          ? "gradient-primary-br text-white shadow-sm"
                          : "bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground",
                      )}
                    >
                      <CategoryIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {category.label}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform",
                        expanded && "rotate-180",
                      )}
                    />
                  </button>

                  {expanded ? (
                    <div
                      className="ml-4 space-y-4 border-l border-border/70 pl-3"
                      id={destinationsId}
                    >
                      {category.groups.map((group) => {
                        const headingId = `workspace-navigation-${category.id}-${group.id}`;
                        return (
                          <section
                            aria-labelledby={group.label ? headingId : undefined}
                            className="space-y-1.5"
                            key={group.id}
                          >
                            {group.label ? (
                              <h2
                                className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                                id={headingId}
                              >
                                {group.label}
                              </h2>
                            ) : null}
                            <div className="space-y-1">
                              {group.items.map((item) => (
                                <NavigationItem
                                  active={item.id === activeItemId}
                                  collapsed={false}
                                  density="compact"
                                  item={item}
                                  key={item.id}
                                />
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </nav>
        </TooltipProvider>
      </aside>
    </>
  );
}

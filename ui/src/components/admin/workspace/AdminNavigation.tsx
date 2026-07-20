"use client";

import {
  WorkspaceHierarchicalSectionNavigation,
  type WorkspaceNavigationCategory,
  type WorkspaceNavigationGroup,
} from "@/components/layout/WorkspaceNavigation";
import type {
  AdminCategoryDefinition,
  AdminDestinationDefinition,
} from "@/components/admin/workspace/admin-routes";

interface AdminNavigationProps {
  activeDestination: AdminDestinationDefinition;
  categories: AdminCategoryDefinition[];
  searchParams: URLSearchParams;
}

function destinationHref(
  destination: AdminDestinationDefinition,
  searchParams: URLSearchParams,
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("cat");
  params.delete("tab");
  if (destination.id !== "access-explorer") {
    params.delete("subtab");
    params.delete("openfgaTab");
  }
  const query = params.toString();
  return query ? `${destination.href}?${query}` : destination.href;
}

function destinationGroups(
  category: AdminCategoryDefinition,
  searchParams: URLSearchParams,
): WorkspaceNavigationGroup[] {
  const groups = new Map<string, AdminDestinationDefinition[]>();
  for (const destination of category.destinations) {
    const key = destination.subgroup ?? "destinations";
    groups.set(key, [...(groups.get(key) ?? []), destination]);
  }

  return [...groups.entries()].map(([key, destinations]) => ({
    id: `${category.id}-${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: key === "destinations" ? undefined : key,
    items: destinations.map((destination) => ({
      ...destination,
      href: destinationHref(destination, searchParams),
    })),
  }));
}

export function AdminNavigation({
  activeDestination,
  categories,
  searchParams,
}: AdminNavigationProps): React.ReactElement {
  const navigationCategories: WorkspaceNavigationCategory[] = categories.map(
    (category) => ({
      id: category.id,
      label: category.label,
      icon: category.icon,
      groups: destinationGroups(category, searchParams),
    }),
  );
  const activeCategory = categories.find((category) =>
    category.destinations.some(
      (destination) => destination.id === activeDestination.id,
    ),
  );

  return (
    <WorkspaceHierarchicalSectionNavigation
      activeCategoryId={activeCategory?.id ?? categories[0]?.id ?? ""}
      activeItemId={activeDestination.id}
      categories={navigationCategories}
      navigationLabel="Admin sections"
      pickerLabel="Admin section"
    />
  );
}

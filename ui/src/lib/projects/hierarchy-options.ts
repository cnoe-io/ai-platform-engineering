export interface HierarchyOption {
  name: string;
  slug: string;
}

export interface HierarchyProject {
  name?: string;
  title?: string;
  slug: string;
}

/** Build hierarchy picker options from current and legacy Tome entities. */
export function toHierarchyOptions(projects: HierarchyProject[]): HierarchyOption[] {
  return projects.map((project) => ({
    name: project.title?.trim() || project.name?.trim() || project.slug,
    slug: project.slug,
  }));
}

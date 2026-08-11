import { ApiError } from "@/lib/api-error";
import { getCollection } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

/** Resolve slug routes without silently selecting one of multiple records. */
export async function resolveUniqueTomeProjectBySlug(
  slug: string,
): Promise<ProjectDocument | null> {
  const projects = await getCollection<ProjectDocument>("projects");
  const matches = await projects.find({ slug }).limit(2).toArray();
  if (matches.length > 1) {
    throw new ApiError(
      "Project slug is ambiguous; an administrator must resolve the duplicate records",
      409,
      "PROJECT_SLUG_AMBIGUOUS",
    );
  }
  const project = matches[0];
  return project ?? null;
}

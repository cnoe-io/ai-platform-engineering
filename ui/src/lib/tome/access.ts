import { ObjectId } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import { normLabel } from "@/lib/projects/labels";
import {
  batchCheckOpenFgaTuples,
  checkOpenFgaTuple,
  deleteExactOpenFgaTuples,
  listOpenFgaObjects,
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import type { ProjectDocument, ProjectType } from "@/types/projects";
import type { Team } from "@/types/teams";

const READ_RELATION = "can_read";
const TEAM_READER_RELATION = "reader";
const PARENT_RELATION = "parent";
const CATALOG_RECONCILE_TTL_MS = 5 * 60 * 1000;

export interface TomeParentAccess {
  slug: string;
  name: string;
  type: "bhag" | "area";
  object: string;
  team: {
    slug: string;
    name: string;
    subject: string;
  };
}

export interface TomeReadConfiguration {
  object: string;
  directTeam: {
    slug: string;
    name: string;
    subject: string;
    relation: "reader";
  };
  parents: TomeParentAccess[];
  inheritance: "BHAG and Area read access flows downward to linked descendants";
}

let catalogReconcile:
  | { expiresAt: number; promise: Promise<ProjectDocument[]> }
  | undefined;

function projectType(project: Pick<ProjectDocument, "type">): ProjectType {
  return project.type === "bhag" || project.type === "area" ? project.type : "project";
}

export function tomeDataObject(project: Pick<ProjectDocument, "slug" | "type">): string {
  return `document:tome/${projectType(project)}/${project.slug}`;
}

function validOpenFgaId(value: string): boolean {
  return Boolean(value) && value.length <= 256 && !/[\s:#]/.test(value);
}

async function resolveProjectTeam(
  project: Pick<ProjectDocument, "team_id" | "team_slug" | "team_name">,
): Promise<{ slug: string; name: string }> {
  const storedSlug = project.team_slug?.trim();
  if (storedSlug && validOpenFgaId(storedSlug)) {
    return { slug: storedSlug, name: project.team_name || storedSlug };
  }

  const teams = await getCollection<Team>("teams");
  let team: Team | null = null;
  if (ObjectId.isValid(project.team_id)) {
    team = await teams.findOne({
      _id: new ObjectId(project.team_id) as unknown as string,
    });
  }
  if (!team) team = await teams.findOne({ slug: project.team_id });
  const slug = team?.slug?.trim() || "";
  if (!team || !validOpenFgaId(slug)) {
    throw new Error(`Tome entity ${project.team_id} has no OpenFGA-safe shared team`);
  }
  return { slug, name: team.name || slug };
}

function parentLabelKeys(project: ProjectDocument): {
  bhags: Set<string>;
  areas: Set<string>;
} {
  const bhags = new Set(
    (project.labels?.initiatives ?? []).map(normLabel).filter(Boolean),
  );
  const areas = new Set(
    (project.labels?.areas ?? []).map(normLabel).filter(Boolean),
  );
  return { bhags, areas };
}

export function resolveTomeParentsFromCatalog(
  project: ProjectDocument,
  catalog: readonly ProjectDocument[],
): ProjectDocument[] {
  if (projectType(project) === "bhag") return [];
  const labels = parentLabelKeys(project);
  const parents: ProjectDocument[] = [];

  for (const candidate of catalog) {
    if (candidate.slug === project.slug) continue;
    const candidateName = normLabel(candidate.name || candidate.title || "");
    if (
      candidate.type === "bhag" &&
      labels.bhags.has(candidateName)
    ) {
      parents.push(candidate);
    } else if (
      projectType(project) === "project" &&
      candidate.type === "area" &&
      labels.areas.has(candidateName)
    ) {
      parents.push(candidate);
    }
  }
  return parents;
}

async function desiredReadTuples(
  project: ProjectDocument,
  catalog: readonly ProjectDocument[],
): Promise<OpenFgaTupleKey[]> {
  const team = await resolveProjectTeam(project);
  const object = tomeDataObject(project);
  return [
    {
      user: `team:${team.slug}#member`,
      relation: TEAM_READER_RELATION,
      object,
    },
    ...resolveTomeParentsFromCatalog(project, catalog).map((parent) => ({
      user: tomeDataObject(parent),
      relation: PARENT_RELATION,
      object,
    })),
  ];
}

async function readAllObjectTuples(
  object: string,
  relation: string,
): Promise<OpenFgaTupleKey[]> {
  const tuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      tuple: { object, relation },
      pageSize: 100,
      continuationToken,
    });
    tuples.push(...result.tuples.map((tuple) => tuple.key));
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return tuples;
}

function tupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
}

/**
 * Reconcile the direct shared-team reader and structural parent links for one
 * Tome entity. Team readers and document parents on Tome document objects are
 * owned by this projection; user/channel readers remain untouched.
 */
export async function reconcileTomeReadAccess(
  project: ProjectDocument,
  catalog?: readonly ProjectDocument[],
): Promise<void> {
  const projects =
    catalog ??
    (await (await getCollection<ProjectDocument>("projects")).find({}).toArray());
  const desired = await desiredReadTuples(project, projects);
  const object = tomeDataObject(project);
  const [storedReaders, storedParents] = await Promise.all([
    readAllObjectTuples(object, TEAM_READER_RELATION),
    readAllObjectTuples(object, PARENT_RELATION),
  ]);
  const managedStored = [
    ...storedReaders.filter((tuple) => /^team:[^#]+#member$/.test(tuple.user)),
    ...storedParents.filter((tuple) => tuple.user.startsWith("document:tome/")),
  ];
  const desiredKeys = new Set(desired.map(tupleKey));
  const storedKeys = new Set(managedStored.map(tupleKey));
  const writes = desired.filter((tuple) => !storedKeys.has(tupleKey(tuple)));
  const deletes = managedStored.filter((tuple) => !desiredKeys.has(tupleKey(tuple)));

  const writeResult = await writeOpenFgaTuples({ writes, deletes: [] });
  if (!writeResult.enabled) {
    throw new Error("OpenFGA is not configured");
  }
  if (deletes.length > 0) {
    await deleteExactOpenFgaTuples(deletes);
  }
}

export async function removeTomeReadAccess(project: ProjectDocument): Promise<void> {
  const object = tomeDataObject(project);
  const [storedReaders, storedParents] = await Promise.all([
    readAllObjectTuples(object, TEAM_READER_RELATION),
    readAllObjectTuples(object, PARENT_RELATION),
  ]);
  const deletes = [
    ...storedReaders.filter((tuple) => /^team:[^#]+#member$/.test(tuple.user)),
    ...storedParents.filter((tuple) => tuple.user.startsWith("document:tome/")),
  ];
  if (deletes.length > 0) {
    await deleteExactOpenFgaTuples(deletes);
  }
}

/** Reconcile legacy Tome documents once per process/TTL before list-objects. */
export async function ensureTomeReadAccessCatalog(): Promise<ProjectDocument[]> {
  const now = Date.now();
  if (catalogReconcile && catalogReconcile.expiresAt > now) {
    return catalogReconcile.promise;
  }
  const promise = (async () => {
    const projects = await getCollection<ProjectDocument>("projects");
    const catalog = await projects.find({}).toArray();
    for (const project of catalog) {
      await reconcileTomeReadAccess(project, catalog);
    }
    return catalog;
  })();
  catalogReconcile = { expiresAt: now + CATALOG_RECONCILE_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    catalogReconcile = undefined;
    throw error;
  }
}

export function resetTomeReadAccessCatalogCacheForTests(): void {
  catalogReconcile = undefined;
}

async function checkRead(subject: string, project: ProjectDocument): Promise<boolean> {
  return (
    await checkOpenFgaTuple({
      user: `user:${subject}`,
      relation: READ_RELATION,
      object: tomeDataObject(project),
    })
  ).allowed;
}

/** Check and lazily repair the exact entity before denying. */
export async function canReadTomeProject(
  subject: string,
  project: ProjectDocument,
): Promise<boolean> {
  try {
    if (await checkRead(subject, project)) return true;
    await reconcileTomeReadAccess(project);
    return await checkRead(subject, project);
  } catch {
    return false;
  }
}

export async function isTomeAdminSubject(subject: string): Promise<boolean> {
  try {
    return (
      await checkOpenFgaTuple({
        user: `user:${subject}`,
        relation: "can_manage",
        object: "admin_surface:tome",
      })
    ).allowed;
  } catch {
    return false;
  }
}

/**
 * Return only Tome entities OpenFGA says the caller can read. This is the
 * shared discovery primitive for lists, search, facets, MCP, and agent tools.
 */
export async function listReadableTomeProjects(
  subject: string | null,
  options: { isAdmin?: boolean; catalog?: readonly ProjectDocument[] } = {},
): Promise<ProjectDocument[]> {
  if (options.isAdmin) {
    return options.catalog
      ? [...options.catalog]
      : await (await getCollection<ProjectDocument>("projects")).find({}).toArray();
  }
  const catalog = options.catalog
    ? [...options.catalog]
    : await ensureTomeReadAccessCatalog();
  if (!subject) return [];
  const result = await listOpenFgaObjects({
    user: `user:${subject}`,
    relation: READ_RELATION,
    type: "document",
  });
  const allowed = new Set(result.objects);
  return catalog.filter((project) => allowed.has(tomeDataObject(project)));
}

export async function filterReadableTomeProjects(
  subject: string | null,
  projects: readonly ProjectDocument[],
  options: { isAdmin?: boolean } = {},
): Promise<ProjectDocument[]> {
  if (options.isAdmin) return [...projects];
  if (!subject || projects.length === 0) return [];
  const checks = projects.map((project) => ({
    user: `user:${subject}`,
    relation: READ_RELATION,
    object: tomeDataObject(project),
  }));
  try {
    const decisions = await batchCheckOpenFgaTuples(checks);
    return projects.filter((_, index) => decisions[index]);
  } catch {
    return [];
  }
}

export async function getTomeReadConfiguration(
  project: ProjectDocument,
): Promise<TomeReadConfiguration> {
  const catalog = await getCollection<ProjectDocument>("projects");
  const all = await catalog.find({}).toArray();
  const team = await resolveProjectTeam(project);
  const parents = await Promise.all(
    resolveTomeParentsFromCatalog(project, all).map(async (parent) => {
      const parentTeam = await resolveProjectTeam(parent);
      return {
        slug: parent.slug,
        name: parent.title || parent.name,
        type: parent.type === "area" ? "area" as const : "bhag" as const,
        object: tomeDataObject(parent),
        team: {
          slug: parentTeam.slug,
          name: parentTeam.name,
          subject: `team:${parentTeam.slug}#member`,
        },
      };
    }),
  );
  return {
    object: tomeDataObject(project),
    directTeam: {
      slug: team.slug,
      name: team.name,
      subject: `team:${team.slug}#member`,
      relation: TEAM_READER_RELATION,
    },
    parents,
    inheritance: "BHAG and Area read access flows downward to linked descendants",
  };
}

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
import {
  dataStewardOpenFgaSubject,
  resolveStoredDataSteward,
} from "@/lib/tome/steward-identity";
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
let warnedMissingParentRelation = false;

class TomeAuthorizationCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomeAuthorizationCollisionError";
  }
}

function projectType(project: Pick<ProjectDocument, "type">): ProjectType {
  return project.type === "bhag" || project.type === "area" ? project.type : "project";
}

export function legacyTomeDataObject(
  project: Pick<ProjectDocument, "slug" | "type">,
): string {
  return `document:tome/${projectType(project)}/${project.slug}`;
}

export function tomeDataObject(
  project: Pick<ProjectDocument, "_id" | "slug" | "type">,
): string {
  const id = project._id == null ? "" : String(project._id).trim();
  if (!validOpenFgaId(id)) {
    throw new Error(`Tome entity ${project.slug} has no immutable project id`);
  }
  return `document:tome/${projectType(project)}/${id}`;
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
    // Match by slug (post-migration convention) or by the candidate's legacy
    // frozen name (any relationship tagged before project_labels_to_slug_v1
    // ran, or never matched by it) — either can appear in a project's own
    // labels.initiatives/labels.areas.
    const candidateSlug = normLabel(candidate.slug);
    const candidateName = candidate.name ? normLabel(candidate.name) : null;
    if (
      candidate.type === "bhag" &&
      (labels.bhags.has(candidateSlug) || (candidateName && labels.bhags.has(candidateName)))
    ) {
      parents.push(candidate);
    } else if (
      projectType(project) === "project" &&
      candidate.type === "area" &&
      (labels.areas.has(candidateSlug) || (candidateName && labels.areas.has(candidateName)))
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

// OpenFGA's /read requires the tuple_key's object to carry at least a type
// (id may be empty), and rejects a filter where BOTH the object id and user
// are empty. A full `object` (type:id, as tomeDataObject always produces) is
// valid with no `user` at all, so object-scoped reads below keep using
// server-side tuple_key filtering — no need to scan the whole store. The one
// shape that actually breaks is a `user`-only filter with no object type at
// all (see readAllTuples below), which is what produced the "OpenFGA tuple
// read failed" 400 in practice.
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

const TOME_DOCUMENT_TYPE = "document:";

/**
 * Tuples matching `tuple`. A `user`-only filter has no object type at all,
 * which OpenFGA's /read rejects outright — every Tome object is a
 * `document:...`, so a `user`-only caller gets an explicit `object:
 * "document:"` type-only filter added (still narrows server-side; just
 * doesn't over-constrain the id). Callers that already pass a full `object`
 * (type:id) or a `user` alongside one are untouched.
 */
async function readAllTuples(
  tuple: Partial<OpenFgaTupleKey>,
): Promise<OpenFgaTupleKey[]> {
  const filter =
    tuple.object === undefined && tuple.user !== undefined
      ? { ...tuple, object: TOME_DOCUMENT_TYPE }
      : tuple;
  const tuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      tuple: filter,
      pageSize: 100,
      continuationToken,
    });
    tuples.push(
      ...result.tuples
        .map((stored) => stored.key)
        // The type-only object filter above widens the server-side match to
        // every document:* tuple for that user/relation; re-apply the
        // caller's exact filter (if it specified an object) in memory.
        .filter((key) => tuple.object === undefined || key.object === tuple.object),
    );
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return tuples;
}

function tupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
}

function isMissingDocumentParentRelation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & {
    status?: unknown;
    details?: { code?: unknown; message?: unknown };
  };
  const detailsCode =
    typeof candidate.details?.code === "string" ? candidate.details.code : "";
  const detailsMessage =
    typeof candidate.details?.message === "string" ? candidate.details.message : "";
  const missingParentRelation =
    /relation ['"]document#parent['"] not found/i;
  return (
    error.name === "OpenFgaWriteError" &&
    candidate.status === 400 &&
    (missingParentRelation.test(error.message) ||
      (detailsCode === "validation_error" &&
        missingParentRelation.test(detailsMessage)))
  );
}

async function writeRequiredTuples(writes: OpenFgaTupleKey[]): Promise<void> {
  const result = await writeOpenFgaTuples({ writes, deletes: [] });
  if (!result.enabled) {
    throw new Error("OpenFGA is not configured");
  }
}

/**
 * Rebuild trusted steward authorization on the immutable-id object, then
 * remove all legacy tuples. Team readers and parent edges are reconstructed by
 * the caller. A collision makes legacy grants unattributable, so migration
 * fails closed until an operator resolves the duplicate records.
 */
export async function migrateLegacyTomeAuthorization(
  project: ProjectDocument,
  catalog: readonly ProjectDocument[],
): Promise<void> {
  if (project.tome_authorization_version === 2) return;
  const legacyObject = legacyTomeDataObject(project);
  const object = tomeDataObject(project);
  const collisions = catalog.filter(
    (candidate) => legacyTomeDataObject(candidate) === legacyObject,
  );
  if (collisions.length > 1) {
    throw new TomeAuthorizationCollisionError(
      `Cannot migrate ambiguous Tome authorization object ${legacyObject}; ` +
        `${collisions.length} project records share it`,
    );
  }

  const [objectTuples, subjectTuples] = await Promise.all([
    readAllTuples({ object: legacyObject }),
    readAllTuples({ user: legacyObject }),
  ]);
  const legacyTuples = [...objectTuples, ...subjectTuples];
  const steward = await resolveStoredDataSteward(project.data_steward).catch(() => null);
  const writes: OpenFgaTupleKey[] = [
    ...(steward
      ? [{
          user: dataStewardOpenFgaSubject(steward),
          relation: "writer",
          object,
        }]
      : []),
    ...catalog
      .filter((candidate) =>
        resolveTomeParentsFromCatalog(candidate, catalog).some(
          (parent) => String(parent._id) === String(project._id),
        ),
      )
      .map((child) => ({
        user: object,
        relation: PARENT_RELATION,
        object: tomeDataObject(child),
      })),
  ];
  if (writes.length > 0) {
    await writeRequiredTuples(writes);
  }
  if (legacyTuples.length > 0) {
    await deleteExactOpenFgaTuples(legacyTuples);
  }

  const projects = await getCollection<ProjectDocument>("projects");
  await projects.updateOne(
    { _id: project._id },
    { $set: { tome_authorization_version: 2 } },
  );
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
  await migrateLegacyTomeAuthorization(project, projects);
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

  const readerWrites = writes.filter((tuple) => tuple.relation === TEAM_READER_RELATION);
  const parentWrites = writes.filter((tuple) => tuple.relation === PARENT_RELATION);
  await writeRequiredTuples(readerWrites);

  let parentRelationAvailable = true;
  try {
    await writeRequiredTuples(parentWrites);
  } catch (error) {
    if (!isMissingDocumentParentRelation(error)) throw error;
    parentRelationAvailable = false;
    if (!warnedMissingParentRelation) {
      console.warn(
        "[tome-access] OpenFGA model is missing document#parent; " +
          "direct team access remains available, but hierarchy inheritance requires rerunning openfga-init",
      );
      warnedMissingParentRelation = true;
    }
  }

  const safeDeletes = parentRelationAvailable
    ? deletes
    : deletes.filter((tuple) => tuple.relation !== PARENT_RELATION);
  if (safeDeletes.length > 0) {
    await deleteExactOpenFgaTuples(safeDeletes);
  }
}

export async function removeTomeReadAccess(project: ProjectDocument): Promise<void> {
  const object = tomeDataObject(project);
  const [storedReaders, storedParents, storedAsParent] = await Promise.all([
    readAllObjectTuples(object, TEAM_READER_RELATION),
    readAllObjectTuples(object, PARENT_RELATION),
    readAllTuples({ user: object, relation: PARENT_RELATION }),
  ]);
  const deletes = [
    ...storedReaders.filter((tuple) => /^team:[^#]+#member$/.test(tuple.user)),
    ...storedParents.filter((tuple) => tuple.user.startsWith("document:tome/")),
    ...storedAsParent,
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
      try {
        await reconcileTomeReadAccess(project, catalog);
      } catch (error) {
        if (!(error instanceof TomeAuthorizationCollisionError)) throw error;
        console.error(`[tome-access] ${error.message}`);
      }
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

/**
 * Drop the in-process catalog snapshot after a Tome entity mutation.
 *
 * The cache avoids repeatedly reconciling every document with OpenFGA, but it
 * also contains the project rows used for discovery. Without invalidation, a
 * newly created project can remain absent from `/api/projects` until the
 * five-minute TTL expires even when OpenFGA already grants access.
 */
export function invalidateTomeReadAccessCatalogCache(): void {
  catalogReconcile = undefined;
}

export function resetTomeReadAccessCatalogCacheForTests(): void {
  invalidateTomeReadAccessCatalogCache();
  warnedMissingParentRelation = false;
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

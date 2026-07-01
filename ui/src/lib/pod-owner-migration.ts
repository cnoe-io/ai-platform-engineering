import { ApiError } from "@/lib/api-error";

type FindChain<T> = {
  sort?: (sort: Record<string, 1 | -1>) => FindChain<T>;
  project?: (projection: Record<string, 0 | 1>) => FindChain<T>;
  limit?: (limit: number) => FindChain<T>;
  toArray: () => Promise<T[]>;
};

type MigrationCollection<T> = {
  find: (query?: Record<string, unknown>) => FindChain<T>;
  findOne: (query: Record<string, unknown>) => Promise<T | null>;
  updateOne?: (
    query: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => Promise<{ matchedCount?: number; modifiedCount?: number }>;
};

export interface PodOwnerMigrationCollections {
  pods: MigrationCollection<Record<string, unknown>>;
  users: MigrationCollection<Record<string, unknown>>;
  schedules: MigrationCollection<Record<string, unknown>>;
  conversations: MigrationCollection<Record<string, unknown>>;
}

export interface PodOwnerCandidate {
  owner_user_id: string;
  sources: string[];
  count: number;
  known_user: boolean;
}

export interface PodOwnerMigrationItem {
  pod_id: string;
  name: string | null;
  default_meeting_series: string | null;
  owner_user_id: string | null;
  pgm_email: string | null;
  created_at: string | null;
  updated_at: string | null;
  status: "owned" | "pgm_only" | "unowned";
  needs_owner: boolean;
  candidates: PodOwnerCandidate[];
  recommended_owner_user_id: string | null;
  recommended_source: string | null;
}

export interface PodOwnerMigrationUser {
  email: string;
  name: string;
  role: string;
}

export interface PodOwnerMigrationState {
  summary: {
    total: number;
    with_owner: number;
    pgm_only: number;
    without_owner: number;
    unowned: number;
    with_recommendation: number;
  };
  users: PodOwnerMigrationUser[];
  pods: PodOwnerMigrationItem[];
}

export function isPodOwnerMigrationEnabled(): boolean {
  const raw =
    process.env.POD_OWNER_MIGRATION_ENABLED ??
    process.env.NEXT_PUBLIC_POD_OWNER_MIGRATION_ENABLED ??
    "true";
  return !["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const text = stringValue(value);
  if (!text || !text.includes("@")) return null;
  return text.toLowerCase();
}

function idString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    const text = String(value);
    return text && text !== "[object Object]" ? text : null;
  }
  return null;
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function chainToArray<T>(
  chain: FindChain<T>,
  options: {
    project?: Record<string, 0 | 1>;
    sort?: Record<string, 1 | -1>;
    limit?: number;
  } = {},
): Promise<T[]> {
  let current = chain;
  if (options.project && current.project) current = current.project(options.project);
  if (options.sort && current.sort) current = current.sort(options.sort);
  if (options.limit && current.limit) current = current.limit(options.limit);
  return current.toArray();
}

function addCandidate(
  signals: Map<string, Map<string, { count: number; sources: Set<string> }>>,
  podId: string | null,
  owner: string | null,
  source: string,
) {
  if (!podId || !owner) return;
  const perPod = signals.get(podId) ?? new Map<string, { count: number; sources: Set<string> }>();
  const existing = perPod.get(owner) ?? { count: 0, sources: new Set<string>() };
  existing.count += 1;
  existing.sources.add(source);
  perPod.set(owner, existing);
  signals.set(podId, perPod);
}

function schedulePodId(schedule: Record<string, unknown>): string | null {
  const direct = idString(schedule.pod_id);
  if (direct) return direct;
  return idString(nestedRecord(schedule.attributes).pod_id);
}

function conversationPodIds(conversation: Record<string, unknown>): string[] {
  const metadata = nestedRecord(conversation.metadata);
  const clientContext = nestedRecord(metadata.client_context);
  const schedule = nestedRecord(metadata.schedule);
  const scheduler = nestedRecord(metadata.scheduler);
  const attributes = nestedRecord(metadata.attributes);
  return [
    idString(metadata.pod_id),
    idString(clientContext.pod_id),
    idString(schedule.pod_id),
    idString(scheduler.pod_id),
    idString(attributes.pod_id),
  ].filter((value): value is string => Boolean(value));
}

function recommendation(candidates: PodOwnerCandidate[]): PodOwnerCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return null;
}

export async function getPodOwnerMigrationState(
  collections: PodOwnerMigrationCollections,
): Promise<PodOwnerMigrationState> {
  const [podDocs, userDocs] = await Promise.all([
    chainToArray(collections.pods.find({}), { sort: { _id: 1 }, limit: 1000 }),
    chainToArray(collections.users.find({ email: { $type: "string", $ne: "" } }), {
      project: { email: 1, name: 1, metadata: 1 },
      sort: { email: 1 },
      limit: 2000,
    }),
  ]);

  const users = userDocs
    .map((user) => {
      const email = normalizeEmail(user.email);
      if (!email) return null;
      return {
        email,
        name: stringValue(user.name) || email,
        role: stringValue(nestedRecord(user.metadata).role) || "user",
      };
    })
    .filter((user): user is PodOwnerMigrationUser => Boolean(user))
    .sort((a, b) => a.email.localeCompare(b.email));

  const knownUsers = new Set(users.map((user) => user.email));
  const podIds = podDocs
    .map((pod) => idString(pod._id))
    .filter((value): value is string => Boolean(value));
  const podIdSet = new Set(podIds);
  const signals = new Map<string, Map<string, { count: number; sources: Set<string> }>>();

  for (const pod of podDocs) {
    const podId = idString(pod._id);
    addCandidate(signals, podId, normalizeEmail(pod.owner_user_id), "pod.owner_user_id");
    addCandidate(signals, podId, normalizeEmail(pod.pgm_email), "pod.pgm_email");
  }

  if (podIds.length > 0) {
    const [scheduleDocs, conversationDocs] = await Promise.all([
      chainToArray(
        collections.schedules.find({
          $or: [
            { pod_id: { $in: podIds } },
            { "attributes.pod_id": { $in: podIds } },
          ],
        }),
        { limit: 5000 },
      ),
      chainToArray(
        collections.conversations.find({
          $or: [
            { "metadata.pod_id": { $in: podIds } },
            { "metadata.client_context.pod_id": { $in: podIds } },
            { "metadata.schedule.pod_id": { $in: podIds } },
            { "metadata.scheduler.pod_id": { $in: podIds } },
            { "metadata.attributes.pod_id": { $in: podIds } },
          ],
        }),
        { limit: 5000 },
      ),
    ]);

    for (const schedule of scheduleDocs) {
      const podId = schedulePodId(schedule);
      if (podIdSet.has(podId || "")) {
        addCandidate(signals, podId, normalizeEmail(schedule.owner_user_id), "schedule.owner_user_id");
      }
    }

    for (const conversation of conversationDocs) {
      const owner = normalizeEmail(conversation.owner_id);
      for (const podId of conversationPodIds(conversation)) {
        if (podIdSet.has(podId)) {
          addCandidate(signals, podId, owner, "conversation.owner_id");
        }
      }
    }
  }

  const pods = podDocs
    .map((pod): PodOwnerMigrationItem | null => {
      const podId = idString(pod._id);
      if (!podId) return null;
      const owner = normalizeEmail(pod.owner_user_id);
      const pgmEmail = normalizeEmail(pod.pgm_email);
      const candidates = Array.from(signals.get(podId)?.entries() ?? [])
        .map(([ownerUserId, signal]) => ({
          owner_user_id: ownerUserId,
          sources: Array.from(signal.sources).sort(),
          count: signal.count,
          known_user: knownUsers.has(ownerUserId),
        }))
        .sort((a, b) => b.count - a.count || a.owner_user_id.localeCompare(b.owner_user_id));
      const recommended = owner ? null : recommendation(candidates);
      const status = owner ? "owned" : pgmEmail ? "pgm_only" : "unowned";
      return {
        pod_id: podId,
        name: stringValue(pod.name),
        default_meeting_series: stringValue(pod.default_meeting_series),
        owner_user_id: owner,
        pgm_email: pgmEmail,
        created_at: dateString(pod.created_at),
        updated_at: dateString(pod.updated_at),
        status,
        needs_owner: !owner,
        candidates,
        recommended_owner_user_id: recommended?.known_user ? recommended.owner_user_id : null,
        recommended_source: recommended?.known_user ? recommended.sources.join(", ") : null,
      };
    })
    .filter((pod): pod is PodOwnerMigrationItem => Boolean(pod))
    .sort((a, b) => Number(b.needs_owner) - Number(a.needs_owner) || a.pod_id.localeCompare(b.pod_id));

  const withOwner = pods.filter((pod) => pod.owner_user_id).length;
  const pgmOnly = pods.filter((pod) => pod.status === "pgm_only").length;
  const withoutOwner = pods.length - withOwner;

  return {
    summary: {
      total: pods.length,
      with_owner: withOwner,
      pgm_only: pgmOnly,
      without_owner: withoutOwner,
      unowned: pods.filter((pod) => pod.status === "unowned").length,
      with_recommendation: pods.filter((pod) => pod.recommended_owner_user_id).length,
    },
    users,
    pods,
  };
}

export async function assignPodOwner(
  collections: PodOwnerMigrationCollections,
  input: { pod_id: unknown; owner_user_id: unknown; migrated_by: string },
): Promise<PodOwnerMigrationItem> {
  if (!collections.pods.updateOne) {
    throw new ApiError("Pod owner migration collection is read-only", 500);
  }

  const podId = idString(input.pod_id);
  const owner = normalizeEmail(input.owner_user_id);
  if (!podId) {
    throw new ApiError("pod_id is required", 400);
  }
  if (!owner) {
    throw new ApiError("owner_user_id must be a valid email", 400);
  }

  const user =
    await collections.users.findOne({ email: owner }) ||
    await collections.users.findOne({
      email: { $regex: `^${escapeRegExp(owner)}$`, $options: "i" },
    });

  if (!user) {
    throw new ApiError("Selected owner is not an existing user", 400, "UNKNOWN_OWNER");
  }

  const canonicalOwner = normalizeEmail(user.email) || owner;
  const existing = await collections.pods.findOne({ _id: podId });
  if (!existing) {
    throw new ApiError("Pod meeting not found", 404, "POD_NOT_FOUND");
  }

  const now = new Date().toISOString();
  await collections.pods.updateOne(
    { _id: podId },
    {
      $set: {
        owner_user_id: canonicalOwner,
        updated_at: now,
        updated_by_user_id: input.migrated_by,
        owner_migration: {
          migrated_at: now,
          migrated_by: input.migrated_by,
          owner_user_id: canonicalOwner,
        },
      },
    },
  );

  const updated = await collections.pods.findOne({ _id: podId });
  const state = await getPodOwnerMigrationState({
    ...collections,
    pods: {
      ...collections.pods,
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => (updated ? [updated] : []),
          }),
          toArray: async () => (updated ? [updated] : []),
        }),
        limit: () => ({
          toArray: async () => (updated ? [updated] : []),
        }),
        toArray: async () => (updated ? [updated] : []),
      }),
    },
  });
  const item = state.pods.find((pod) => pod.pod_id === podId);
  if (!item) {
    throw new ApiError("Pod owner was updated but could not be reloaded", 500);
  }
  return item;
}

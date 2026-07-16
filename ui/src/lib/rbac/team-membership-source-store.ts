import type { TeamMembershipSource } from "@/types/identity-group-sync";

import { getRbacCollection } from "./mongo-collections";

function membershipSourceFilter(source: TeamMembershipSource): Record<string, unknown> {
  return {
    team_slug: source.team_slug,
    user_subject: source.user_subject,
    relationship: source.relationship,
    source_type: source.source_type,
    provider_id: source.provider_id,
    external_group_id: source.external_group_id,
    sync_rule_id: source.sync_rule_id,
  };
}

/**
 * Build a Mongo filter that locates the same logical source row as
 * `membershipSourceFilter`, but tolerates the synthetic-source case where
 * the caller does not have a resolved Keycloak `user_subject` (e.g. the
 * manual-delete path constructs a source from just the email + relationship
 * because the original subject was never re-fetched).
 *
 * Identity match rules:
 *   - When `user_subject` is set, prefer it.
 *   - Otherwise (subject unknown), match by `user_email`.
 *   - If neither is set, return a filter that matches nothing — we refuse
 *     to bulk-update rows with no identity anchor.
 *
 * Provenance fields (`provider_id`, `external_group_id`, `sync_rule_id`)
 * are matched as "field absent or matches the provided value" so a manual
 * source row (where these are undefined in Mongo) matches a synthetic
 * filter that also leaves them undefined.
 */
function membershipSourceMatchFilter(
  source: TeamMembershipSource,
): Record<string, unknown> | null {
  const filter: Record<string, unknown> = {
    team_slug: source.team_slug,
    relationship: source.relationship,
    source_type: source.source_type,
  };

  if (source.user_subject) {
    filter.user_subject = source.user_subject;
  } else if (source.user_email) {
    filter.user_email = source.user_email;
  } else {
    // No identity anchor at all — refuse to match.
    return null;
  }

  // For optional provenance fields, treat "unset" as a wildcard via $in [null, undefined]
  // when the caller did not provide the field. When the caller did provide it,
  // we require an exact match so cross-provider rows are never collapsed.
  if (source.provider_id !== undefined) {
    filter.provider_id = source.provider_id;
  } else {
    filter.provider_id = { $in: [null, undefined] };
  }
  if (source.external_group_id !== undefined) {
    filter.external_group_id = source.external_group_id;
  } else {
    filter.external_group_id = { $in: [null, undefined] };
  }
  if (source.sync_rule_id !== undefined) {
    filter.sync_rule_id = source.sync_rule_id;
  } else {
    filter.sync_rule_id = { $in: [null, undefined] };
  }

  return filter;
}

export async function listTeamMembershipSources(teamId: string): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_id: string }>(
    "teamMembershipSources"
  );
  return collection.find({ team_id: teamId }).sort({ created_at: -1 }).toArray();
}

export async function listActiveTeamMembershipSourcesBySlug(
  teamSlug: string
): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_slug: string }>(
    "teamMembershipSources"
  );
  return collection.find({ team_slug: teamSlug, status: "active" }).sort({ created_at: -1 }).toArray();
}

/**
 * Dedupes and sorts active members' emails across one or more teams entirely
 * in Mongo, then returns only the requested page. Unlike
 * `listActiveTeamMembershipSourcesBySlug`, this never materializes the full
 * membership set in Node — for an IdP-synced, org-wide team (thousands of
 * rows) that's the difference between a bounded query and a full collection
 * scan + JS sort on every page load.
 *
 * DocumentDB (this collection's engine) doesn't support `$facet`, so total
 * and page are two separate aggregations rather than one round trip.
 */
export async function listActiveTeamMemberEmailsBySlugsPaged(
  teamSlugs: string[],
  skip: number,
  limit: number
): Promise<{ emails: string[]; total: number }> {
  if (teamSlugs.length === 0) return { emails: [], total: 0 };

  const collection = await getRbacCollection<
    TeamMembershipSource & { team_slug: string }
  >("teamMembershipSources");
  const match = {
    team_slug: { $in: teamSlugs },
    status: "active",
    user_email: { $type: "string", $ne: "" },
  };
  const dedupeEmail = { $trim: { input: { $toLower: "$user_email" } } };

  const [countResult, page] = await Promise.all([
    collection
      .aggregate<{ total: number }>([
        { $match: match },
        { $group: { _id: dedupeEmail } },
        { $count: "total" },
      ])
      .toArray(),
    collection
      .aggregate<{ _id: string }>([
        { $match: match },
        { $group: { _id: dedupeEmail } },
        { $sort: { _id: 1 } },
        { $skip: skip },
        { $limit: limit },
      ])
      .toArray(),
  ]);

  return {
    emails: page.map((row) => row._id),
    total: countResult[0]?.total ?? 0,
  };
}

export async function listActiveTeamMembershipSourcesForProvider(
  providerId: string
): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { provider_id?: string }>(
    "teamMembershipSources"
  );
  return collection
    .find({ provider_id: providerId, status: "active", managed: true })
    .sort({ created_at: -1 })
    .toArray();
}

export async function listActiveTeamMembershipSourcesForTeamUser(input: {
  teamId?: string;
  teamSlug?: string;
  userSubject?: string;
  userEmail?: string;
  relationship?: TeamMembershipSource["relationship"];
}): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource>("teamMembershipSources");
  const identityFilters: Record<string, string>[] = [];
  if (input.userSubject) identityFilters.push({ user_subject: input.userSubject });
  if (input.userEmail) identityFilters.push({ user_email: input.userEmail });
  if (identityFilters.length === 0) return [];

  const filter: Record<string, unknown> = {
    status: "active",
    $or: identityFilters,
  };
  if (input.teamId) filter.team_id = input.teamId;
  if (input.teamSlug) filter.team_slug = input.teamSlug;
  if (input.relationship) filter.relationship = input.relationship;

  return collection.find(filter).sort({ created_at: -1 }).toArray();
}

export async function listActiveTeamMembershipSourcesForUser(input: {
  providerId: string;
  sourceType: TeamMembershipSource["source_type"];
  userSubject?: string;
  userEmail?: string;
}): Promise<TeamMembershipSource[]> {
  const collection = await getRbacCollection<TeamMembershipSource & { provider_id?: string }>(
    "teamMembershipSources"
  );
  const identityFilters: Record<string, string>[] = [];
  if (input.userSubject) identityFilters.push({ user_subject: input.userSubject });
  if (input.userEmail) identityFilters.push({ user_email: input.userEmail });
  if (identityFilters.length === 0) return [];

  return collection
    .find({
      provider_id: input.providerId,
      source_type: input.sourceType,
      status: "active",
      managed: true,
      $or: identityFilters,
    })
    .sort({ created_at: -1 })
    .toArray();
}

export async function upsertTeamMembershipSource(source: TeamMembershipSource): Promise<void> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_slug: string }>(
    "teamMembershipSources"
  );
  const { first_seen_at, created_at, created_by, ...mutableFields } = source;
  await collection.updateOne(
    membershipSourceFilter(source),
    {
      $set: mutableFields,
      $setOnInsert: {
        ...(first_seen_at !== undefined && { first_seen_at }),
        ...(created_at !== undefined && { created_at }),
        ...(created_by !== undefined && { created_by }),
      },
    },
    { upsert: true }
  );

  // Collapse stale orphans: when a user is removed and later re-added with a
  // different `relationship` (e.g. removed as member, re-added as admin), the
  // `relationship`-keyed upsert above does not match the previous row, so the
  // `status:"removed"` record is left behind. The UI then renders both a
  // "Manual" and "Manual: Removed" badge next to the same user, which is
  // confusing. Removed rows have no operational consumer (only the UI badge
  // renderer reads them, and we now filter them out there) so we drop them
  // here to keep the collection clean. Provenance fields are still matched
  // exactly so we never collapse rows that came from different providers /
  // sync rules.
  const orphanFilter = orphanRemovedMatchFilter(source);
  if (orphanFilter) {
    await collection.deleteMany({ ...orphanFilter, status: "removed" });
  }
}

/**
 * Filter for the same logical user+team+source combination as
 * `membershipSourceMatchFilter`, but intentionally agnostic to
 * `relationship` so we can find rows that differ only in member-vs-admin.
 * Returns `null` when the input has no usable identity anchor.
 */
function orphanRemovedMatchFilter(
  source: TeamMembershipSource,
): Record<string, unknown> | null {
  const filter: Record<string, unknown> = {
    team_slug: source.team_slug,
    source_type: source.source_type,
  };
  if (source.user_subject) {
    filter.user_subject = source.user_subject;
  } else if (source.user_email) {
    filter.user_email = source.user_email;
  } else {
    return null;
  }
  filter.provider_id =
    source.provider_id !== undefined ? source.provider_id : { $in: [null, undefined] };
  filter.external_group_id =
    source.external_group_id !== undefined
      ? source.external_group_id
      : { $in: [null, undefined] };
  filter.sync_rule_id =
    source.sync_rule_id !== undefined ? source.sync_rule_id : { $in: [null, undefined] };
  return filter;
}

export async function markTeamMembershipSourceRemoved(
  source: TeamMembershipSource,
  removedBy: string,
  removedAt: string
): Promise<{ matchedCount: number; modifiedCount: number }> {
  const collection = await getRbacCollection<TeamMembershipSource & { team_slug: string }>(
    "teamMembershipSources"
  );
  // Use updateMany so duplicate rows from past partial-failures (where the
  // same logical source was written twice) all get retired together. The
  // matcher tolerates a missing `user_subject` on the synthetic input by
  // falling back to `user_email`. We always scope to `status: "active"` so
  // we never accidentally revive a previously-removed row.
  const filter = membershipSourceMatchFilter(source);
  if (!filter) {
    return { matchedCount: 0, modifiedCount: 0 };
  }
  const result = await collection.updateMany(
    { ...filter, status: "active" },
    {
      $set: {
        status: "removed",
        removed_by: removedBy,
        removed_at: removedAt,
      },
    }
  );
  return {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
  };
}

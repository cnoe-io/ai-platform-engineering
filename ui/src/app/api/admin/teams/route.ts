// GET /api/admin/teams - List all teams
// POST /api/admin/teams - Create a new team

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import { isValidTeamSlug } from '@/lib/rbac/keycloak-admin';
import { requireAdminSurfaceManage,requireBaselineAdminSurfaceRead } from '@/lib/rbac/require-openfga';
import { upsertTeamMembershipSource } from '@/lib/rbac/team-membership-source-store';
import { loadTeamIdpSourceTypes,loadTeamMemberCounts } from '@/lib/rbac/team-membership-store';
import {
mongoRoleToOpenFgaRelations,
resolveKeycloakUserSubject,
writeTeamMembershipTuples,
} from '@/lib/rbac/team-membership-sync';
import type { TeamMembershipSource } from '@/types/identity-group-sync';
import { NextRequest,NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface CreateTeamRequest {
  name: string;
  slug?: string;
  description?: string;
  members?: string[];
}

/**
 * Derive a Keycloak-safe slug from a team name. Mirrors the rules enforced
 * by `isValidTeamSlug`: lowercase alphanumerics, hyphens, no leading/trailing
 * hyphen, max 63 chars. We deliberately do NOT strip Unicode-to-ASCII (we'd
 * rather fail loudly so the admin notices) — names that produce an empty
 * slug after stripping are rejected with a 400.
 */
function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

// GET /api/admin/teams
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - teams require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireBaselineAdminSurfaceRead(session, 'teams');

  const teams = await getCollection('teams');

  const allTeams = await teams
    .find({})
    .sort({ created_at: -1 })
    .toArray();

  // Commit 4/8 of the canonical-team-membership refactor (spec
  // 2026-05-26-canonical-team-membership): instead of returning
  // team.members[] (which the Admin UI used to read .length on for the
  // Members badge), decorate every row with `member_count` derived from
  // the canonical team_membership_sources store via a single aggregation
  // query. This is a tracer-bullet step — the legacy team.members[]
  // payload is still emitted so older UI revisions and integration
  // tests keep working until commit 5/8 drops the embedded array.
  const slugs = allTeams
    .map((team) => (typeof team.slug === 'string' ? team.slug : ''))
    .filter((slug): slug is string => slug.length > 0);
  const memberCounts = slugs.length > 0 ? await loadTeamMemberCounts(slugs) : new Map<string, number>();
  // Distinct IdP source types per team (okta/oidc_claim/...), for the
  // "synced from <IdP>" badge on the Admin team cards.
  const idpSourceTypes = slugs.length > 0 ? await loadTeamIdpSourceTypes(slugs) : new Map<string, string[]>();

  // Decorate each team with `kb_count`. The canonical store for team KB
  // assignments is the `team_kb_ownership` collection (keyed by the team's
  // string `_id`), NOT the legacy `team.resources.knowledge_bases` array on
  // the team document. Without this join the Admin team-card "KBs" badge
  // reads an almost-always-empty field and shows nothing even when a team
  // has KBs assigned (issue #1642 follow-up). We count distinct kb_ids per
  // team in a single query, falling back to the legacy doc field when no
  // ownership row exists yet.
  const teamIdStrings = allTeams.map((team) => team._id.toString());
  const kbCounts = new Map<string, number>();
  if (teamIdStrings.length > 0) {
    const ownership = await getCollection<{ team_id?: string; kb_ids?: string[] }>('team_kb_ownership');
    const ownershipRows = await ownership
      .find({ team_id: { $in: teamIdStrings } }, { projection: { team_id: 1, kb_ids: 1 } })
      .toArray();
    for (const row of ownershipRows) {
      if (typeof row.team_id !== 'string') continue;
      const ids = Array.isArray(row.kb_ids) ? row.kb_ids : [];
      kbCounts.set(row.team_id, new Set(ids).size);
    }
  }

  const teamsWithCounts = allTeams.map((team) => {
    const slug = typeof team.slug === 'string' ? team.slug : '';
    const idStr = team._id.toString();
    const legacyKbCount = Array.isArray(team.resources?.knowledge_bases)
      ? team.resources.knowledge_bases.length
      : 0;
    return {
      ...team,
      member_count: slug ? memberCounts.get(slug) ?? 0 : 0,
      kb_count: kbCounts.get(idStr) ?? legacyKbCount,
      idp_source_types: slug ? idpSourceTypes.get(slug) ?? [] : [],
    };
  });

  const response = successResponse({
    teams: teamsWithCounts,
    total: teamsWithCounts.length,
  });
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
});

// POST /api/admin/teams
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - teams require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, 'teams');

  const body: CreateTeamRequest = await request.json();

    if (!body.name || body.name.trim() === '') {
      throw new ApiError('Team name is required', 400);
    }

    const slug = (body.slug?.trim() || deriveSlug(body.name)).toLowerCase();
    if (!slug || !isValidTeamSlug(slug)) {
      throw new ApiError(
        `Could not derive a valid slug from team name "${body.name}". ` +
          `Provide a "slug" explicitly (lowercase letters, digits, hyphens; max 63 chars).`,
        400
      );
    }

    const teams = await getCollection('teams');
    
    // Check if team name already exists
    const existing = await teams.findOne({ name: body.name });
    if (existing) {
      throw new ApiError('Team name already exists', 400);
    }
    const slugConflict = await teams.findOne({ slug });
    if (slugConflict) {
      throw new ApiError(
        `Team slug "${slug}" already in use by team "${slugConflict.name}". ` +
          `Provide a different "slug" in the request.`,
        400
      );
    }

    // Compute the initial roster for OpenFGA + team_membership_sources
    // writes below. The creator is ALWAYS the owner — even if their own
    // email also appears in `body.members` (which the UI sometimes does
    // by mistake). Dedupe silently so we don't issue duplicate tuple
    // writes for the same identity.
    //
    // Commit 6/8 of the canonical-team-membership refactor (spec
    // 2026-05-26-canonical-team-membership): this roster is now a
    // local-only iteration helper. It is NOT persisted onto the team
    // document — `team_membership_sources` is the only store of truth.
    const now = new Date();
    const creatorEmail = user.email.trim().toLowerCase();
    const inviteeEmails = (body.members ?? [])
      .map(email => email.trim().toLowerCase())
      .filter(email => email.length > 0 && email !== creatorEmail);
    const members = [
      ...inviteeEmails.map(email => ({
        user_id: email,
        role: 'member' as const,
        added_at: now,
        added_by: user.email,
      })),
      {
        user_id: creatorEmail,
        role: 'owner' as const,
        added_at: now,
        added_by: user.email,
      },
    ];

    const team = {
      name: body.name,
      slug,
      description: body.description || '',
      source: 'manual',
      status: 'active',
      owner_id: user.email,
      created_by: user.email,
      updated_by: user.email,
      created_at: now,
      updated_at: now,
    };

    const result = await teams.insertOne(team);

    // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the per-team
    // Keycloak client scope. Team identity is now derived from the
    // channel→team mapping at message time, not from a baked-in `active_team`
    // JWT claim, so the BFF no longer needs to touch Keycloak when a team is
    // created. The remaining work is OpenFGA tuple sync below.

    // Sync OpenFGA + team_membership_sources for every member in the new
    // team. This is the step that the original implementation forgot to do
    // — without these tuples, `team:<slug>#can_use` is always false and
    // `OWNER_TEAM_FORBIDDEN` fires on the next agent-creation request,
    // even for the team's own creator.
    //
    // Failures here are logged but never thrown: the Mongo team + Keycloak
    // scope are already committed and the startup audit will repair any
    // tuple that didn't make it. The team-creation API is still useful
    // even if OpenFGA is briefly unreachable.
    const createdAt = now.toISOString();
    const sourceBase = {
      team_id: result.insertedId.toString(),
      team_slug: slug,
      source_type: 'manual' as const,
      managed: false,
      status: 'active' as const,
      created_by: user.email,
      created_at: createdAt,
      first_seen_at: createdAt,
      last_seen_at: createdAt,
      last_applied_at: createdAt,
    };

    await Promise.all(
      members.map(async (member) => {
        const email = member.user_id;
        const relationship =
          member.role === 'owner' ? 'admin' : (member.role as 'member' | 'admin');
        // Resolve the stable Keycloak subject for this email. May be
        // undefined when the user does not yet exist in Keycloak; we still
        // persist the source row so a later audit can repair the tuple.
        const userSubject = await resolveKeycloakUserSubject(email, slug);

        if (userSubject) {
          try {
            await writeTeamMembershipTuples(
              userSubject,
              slug,
              mongoRoleToOpenFgaRelations(member.role),
              'assign',
            );
          } catch (err) {
            console.error(
              `[Admin] Failed to write OpenFGA membership tuple for ${email} on team ${slug}:`,
              err,
            );
          }
        } else {
          console.warn(
            `[Admin] No Keycloak subject for ${email} on team ${slug}; ` +
              `skipping OpenFGA tuple write. Source row persisted for later repair.`,
          );
        }

        const source: TeamMembershipSource = {
          ...sourceBase,
          user_email: email,
          user_subject: userSubject,
          relationship,
        };
        await upsertTeamMembershipSource(source);
      }),
    );

    console.log(`[Admin] Team created: ${body.name} (slug=${slug}) by ${user.email}`);

  return successResponse({
    message: 'Team created successfully',
    team_id: result.insertedId,
    team,
  }, 201);
});

import { isBootstrapAdmin } from '@/lib/auth-config';
import { ApiError } from '@/lib/api-error';
import { checkOpenFgaTuple } from '@/lib/rbac/openfga';
import { organizationObjectId } from '@/lib/rbac/organization';

/**
 * Question set and question ids are upstream Postgres BIGSERIAL keys, not
 * Mongo ObjectIds — reject anything that isn't a positive integer before it
 * reaches the service and comes back as a confusing 422.
 */
export function parseNumericId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(`Invalid ${label} id`, 400, 'INVALID_ID');
  }
  return id;
}

interface SessionLike {
  sub?: string;
  user?: { email?: string | null };
}

async function isOrgAdminSession(session: SessionLike): Promise<boolean> {
  if (isBootstrapAdmin(session.user?.email ?? undefined)) return true;
  const subject = session.sub;
  if (!subject) return false;
  try {
    const decision = await checkOpenFgaTuple({
      user: `user:${subject}`,
      relation: 'can_manage',
      object: organizationObjectId(),
    });
    return decision.allowed;
  } catch {
    return false;
  }
}

async function canIngestSession(session: SessionLike): Promise<boolean> {
  if (await isOrgAdminSession(session)) return true;
  const subject = session.sub;
  if (!subject) return false;
  try {
    const decision = await checkOpenFgaTuple({
      user: `user:${subject}`,
      relation: 'can_ingest',
      object: organizationObjectId(),
    });
    return decision.allowed;
  } catch {
    return false;
  }
}

/**
 * Question Sets follow the same permission tiers documented for the Ingest
 * tab (README.md): READONLY can view, INGESTONLY+ can create/edit questions,
 * ADMIN-only can delete a whole set. Reuses the existing org-level
 * `can_ingest` / `can_manage` capabilities rather than introducing a new
 * OpenFGA object type just for question sets.
 */
export async function requireQuestionSetWriteAccess(session: SessionLike): Promise<void> {
  if (!(await canIngestSession(session))) {
    throw new ApiError('You do not have permission to create or edit question sets', 403, 'FORBIDDEN');
  }
}

export async function requireQuestionSetDeleteAccess(session: SessionLike): Promise<void> {
  if (!(await isOrgAdminSession(session))) {
    throw new ApiError('Only an organization admin can delete a question set', 403, 'FORBIDDEN');
  }
}

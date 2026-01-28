import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * User Info API Endpoint
 *
 * Returns current user's authentication and authorization information
 * from the NextAuth session. This mimics the RAG server's /v1/user/info
 * endpoint for compatibility with the old UI.
 *
 * Response Format:
 * {
 *   email: string;
 *   role: string;
 *   is_authenticated: boolean;
 *   groups: string[];
 *   permissions: {
 *     can_read: boolean;
 *     can_ingest: boolean;
 *     can_delete: boolean;
 *   };
 * }
 */

// Role definitions from RAG server rbac.py
const ROLE_READONLY = 'READONLY';
const ROLE_INGESTONLY = 'INGESTONLY';
const ROLE_ADMIN = 'ADMIN';

// Environment configuration
const RBAC_READONLY_GROUPS = (process.env.RBAC_READONLY_GROUPS || '').split(',').filter(g => g.trim());
const RBAC_INGESTONLY_GROUPS = (process.env.RBAC_INGESTONLY_GROUPS || '').split(',').filter(g => g.trim());
const RBAC_ADMIN_GROUPS = (process.env.RBAC_ADMIN_GROUPS || '').split(',').filter(g => g.trim());
const RBAC_DEFAULT_ROLE = process.env.RBAC_DEFAULT_ROLE || ROLE_READONLY;

/**
 * Determine user's role based on group membership
 * Matches the logic from RAG server's rbac.py::determine_role_from_groups()
 */
function determineRoleFromGroups(userGroups: string[]): string {
  // Most permissive role wins
  if (userGroups.some(group => RBAC_ADMIN_GROUPS.includes(group))) {
    return ROLE_ADMIN;
  }
  
  if (userGroups.some(group => RBAC_INGESTONLY_GROUPS.includes(group))) {
    return ROLE_INGESTONLY;
  }
  
  if (userGroups.some(group => RBAC_READONLY_GROUPS.includes(group))) {
    return ROLE_READONLY;
  }
  
  return RBAC_DEFAULT_ROLE;
}

/**
 * Calculate permissions based on role
 */
function getPermissionsForRole(role: string) {
  return {
    can_read: true, // All roles can read
    can_ingest: role === ROLE_INGESTONLY || role === ROLE_ADMIN,
    can_delete: role === ROLE_ADMIN,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);

  // Unauthenticated user
  if (!session || !session.user?.email) {
    return NextResponse.json(
      {
        email: 'unauthenticated',
        role: ROLE_READONLY,
        is_authenticated: false,
        groups: [],
        permissions: {
          can_read: false,
          can_ingest: false,
          can_delete: false,
        },
      },
      { status: 401 }
    );
  }

  // Authenticated user
  const userGroups = session.groups || [];
  const role = determineRoleFromGroups(userGroups);
  const permissions = getPermissionsForRole(role);

  return NextResponse.json({
    email: session.user.email,
    role,
    is_authenticated: true,
    groups: userGroups,
    permissions,
  });
}

import type { PermissionType,UserInfo } from '@/lib/rag-api';
import { Permission } from '@/lib/rag-api';
import { useKbTabGates } from './use-kb-tab-gates';

export { Permission };

export function useRagPermissions() {
  const { gates, loading, error, orgAdminBypass } = useKbTabGates();
  // Org admins keep the full grant. For everyone else, derive permissions from
  // the per-relation KB gates so team-scoped ingestors get INGEST without being
  // org admins: READ when they can read any KB, INGEST when they hold an
  // `ingestor`/`can_manage` grant on any KB (directly or via team membership).
  // DELETE remains org-admin-only (no team-scoped delete relation today).
  const permissions: PermissionType[] = orgAdminBypass
    ? [Permission.READ, Permission.INGEST, Permission.DELETE]
    : [
        ...(gates.has_any_kb ? [Permission.READ] : []),
        ...(gates.can_ingest ? [Permission.INGEST] : []),
      ];
  const userInfo: UserInfo | null = loading
    ? null
    : {
        email: 'authenticated-user',
        role: orgAdminBypass ? 'ADMIN' : 'OPENFGA',
        is_authenticated: true,
        permissions,
      };

  const hasPermission = (permission: PermissionType) => permissions.includes(permission);

  return {
    userInfo,
    permissions,
    hasPermission,
    isLoading: loading,
    error: error ? new Error(error) : null,
  };
}

import type { PermissionType, UserInfo } from '@/lib/rag-api';
import { Permission } from '@/lib/rag-api';
import { useKbTabGates } from './use-kb-tab-gates';

export { Permission };

export function useRagPermissions() {
  const { gates, loading, error, orgAdminBypass } = useKbTabGates();
  const permissions: PermissionType[] = orgAdminBypass
    ? [Permission.READ, Permission.INGEST, Permission.DELETE]
    : gates.has_any_kb
      ? [Permission.READ]
      : [];
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

/**
 * useRagPermissions Hook
 * 
 * Provides user's RAG permissions and loading state.
 * Automatically fetches on mount and caches the result.
 * 
 * @example
 * const { userInfo, permissions, hasPermission } = useRagPermissions();
 * <button disabled={!hasPermission(Permission.DELETE)}>Delete</button>
 */

import { useEffect, useState } from 'react';
import { getUserInfo, hasPermission as checkPermission, Permission, type UserInfo, type PermissionType } from '@/lib/rag-api';

export { Permission } from '@/lib/rag-api';

export function useRagPermissions() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchUserInfo() {
      console.log('[useRagPermissions] Fetching RAG user info...');
      try {
        const info = await getUserInfo();
        console.log('[useRagPermissions] RAG user info received:', {
          email: info.email,
          role: info.role,
          is_authenticated: info.is_authenticated,
          permissions: info.permissions,
          groups: info.groups?.length ?? 0,
          in_trusted_network: info.in_trusted_network
        });
        if (mounted) {
          setUserInfo(info);
          setError(null);
        }
      } catch (err) {
        console.error('[useRagPermissions] Failed to fetch RAG user info:', err);
        if (mounted) {
          setError(err as Error);
          setUserInfo(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    fetchUserInfo();

    return () => {
      mounted = false;
    };
  }, []);

  // Helper function bound to current userInfo
  const hasPermission = (permission: PermissionType) => {
    return checkPermission(userInfo, permission);
  };

  return {
    userInfo,
    permissions: userInfo?.permissions ?? [],
    hasPermission,
    isLoading,
    error,
  };
}

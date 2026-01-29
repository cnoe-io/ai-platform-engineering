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
      try {
        const info = await getUserInfo();
        if (mounted) {
          setUserInfo(info);
          setError(null);
        }
      } catch (err) {
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

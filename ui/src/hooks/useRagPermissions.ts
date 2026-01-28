/**
 * useRagPermissions Hook
 * 
 * Provides user's RAG permissions and loading state.
 * Automatically fetches on mount and caches the result.
 */

import { useEffect, useState } from 'react';
import { getUserInfo, type UserInfo } from '@/lib/rag-api';

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

  return {
    userInfo,
    permissions: userInfo?.permissions ?? {
      can_read: false,
      can_ingest: false,
      can_delete: false,
    },
    isLoading,
    error,
  };
}

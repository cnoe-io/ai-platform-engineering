import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getConfig } from '@/lib/config';

/**
 * Hook to check admin role and view access.
 *
 * Returns:
 * - `isAdmin`: true when user belongs to OIDC admin group (read-write access)
 * - `canViewAdmin`: true for any authenticated user (read-only access to Admin page)
 * - `loading`: true while role check is in progress
 *
 * Access model:
 * - All authenticated users can view the Admin dashboard (read-only).
 * - Only OIDC admin group members can perform write operations
 *   (role changes, team CRUD, migrations).
 */
export function useAdminRole() {
  const { data: session, status } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const isAuthenticated = status === 'authenticated';
  const canViewAdmin = isAuthenticated || (
    !getConfig('ssoEnabled') &&
    getConfig('allowDevAdminWhenSsoDisabled') &&
    getConfig('storageMode') === 'mongodb'
  );

  useEffect(() => {
    async function checkAdminRole() {
      if (!session) {
        if (!getConfig('ssoEnabled') && getConfig('allowDevAdminWhenSsoDisabled') && getConfig('storageMode') === 'mongodb') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
        setLoading(false);
        return;
      }

      if (session.role === 'admin') {
        setIsAdmin(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/role');
        const data = await response.json();
        setIsAdmin(data.role === 'admin');
      } catch (error) {
        console.warn('[useAdminRole] Failed to check MongoDB role:', error);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    }

    checkAdminRole();
  }, [session]);

  return { isAdmin, canViewAdmin, loading };
}

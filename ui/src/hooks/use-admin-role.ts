import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getConfig } from '@/lib/config';

/**
 * Hook to check admin role and view access.
 *
 * Returns:
 * - `isAdmin`: true when user belongs to OIDC admin group (read-write access)
 * - `canViewAdmin`: true when user belongs to OIDC admin view group (read-only)
 *   or when OIDC_REQUIRED_ADMIN_VIEW_GROUP is not set (all authenticated users)
 * - `loading`: true while role check is in progress
 *
 * Access model:
 * - Users in OIDC_REQUIRED_ADMIN_VIEW_GROUP (or all authenticated users if unset)
 *   can view the Admin dashboard read-only.
 * - Only OIDC admin group members can perform write operations
 *   (role changes, team CRUD, migrations).
 */
export function useAdminRole() {
  const { data: session, status } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const isDevAdmin = Boolean(
    !getConfig('ssoEnabled') &&
    getConfig('allowDevAdminWhenSsoDisabled') &&
    getConfig('storageMode') === 'mongodb'
  );

  const canViewAdmin = (session?.canViewAdmin === true) || isDevAdmin;

  useEffect(() => {
    async function checkAdminRole() {
      if (!session) {
        if (isDevAdmin) {
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

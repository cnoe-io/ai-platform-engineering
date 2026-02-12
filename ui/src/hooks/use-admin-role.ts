import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getConfig } from '@/lib/config';

/**
 * Hook to check if user is admin.
 * - With SSO: OIDC group (session.role) or MongoDB profile via GET /api/auth/role.
 * - Without SSO: if allowDevAdminWhenSsoDisabled and MongoDB configured, treat as admin (dev/local only).
 */
export function useAdminRole() {
  const { data: session } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAdminRole() {
      if (!session) {
        // No SSO login: allow admin only when explicitly enabled for dev (SSO disabled + MongoDB + flag)
        if (!getConfig('ssoEnabled') && getConfig('allowDevAdminWhenSsoDisabled') && getConfig('storageMode') === 'mongodb') {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
        setLoading(false);
        return;
      }

      // Check OIDC role first (fastest)
      if (session.role === 'admin') {
        setIsAdmin(true);
        setLoading(false);
        return;
      }

      // Fallback: Check MongoDB via API
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

  return { isAdmin, loading };
}

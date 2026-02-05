import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

/**
 * Hook to check if user is admin
 * Checks OIDC group first (from session), then MongoDB profile via API
 */
export function useAdminRole() {
  const { data: session } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAdminRole() {
      if (!session) {
        setIsAdmin(false);
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

"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionsMap, RbacResource, RbacScope } from "@/lib/rbac/types";

interface RbacPermissionsState {
  permissions: PermissionsMap;
  loading: boolean;
  error: string | null;
  /** Check if the user has a specific permission. */
  hasPermission: (resource: RbacResource, scope: RbacScope) => boolean;
  /** Force a re-fetch of permissions (e.g. after role change). */
  refresh: () => void;
}

/**
 * React hook — fetches the user's effective RBAC permissions from the BFF
 * and exposes a `hasPermission(resource, scope)` helper for conditional
 * rendering (US2, FR-004).
 *
 * Permissions are cached per session and automatically invalidated
 * when the access token changes (token refresh).
 */
export function useRbacPermissions(): RbacPermissionsState {
  const { data: session, status } = useSession();
  const [permissions, setPermissions] = useState<PermissionsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastTokenRef = useRef<string | undefined>(undefined);

  const fetchPermissions = useCallback(async () => {
    if (status !== "authenticated" || !session?.accessToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rbac/permissions");
      if (!res.ok) {
        throw new Error(`Failed to fetch permissions: ${res.status}`);
      }
      const data = await res.json();
      setPermissions(data.permissions ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPermissions({});
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken, status]);

  useEffect(() => {
    if (session?.accessToken && session.accessToken !== lastTokenRef.current) {
      lastTokenRef.current = session.accessToken;
      fetchPermissions();
    } else if (status === "unauthenticated") {
      setPermissions({});
      setLoading(false);
    }
  }, [session?.accessToken, status, fetchPermissions]);

  const hasPermission = useCallback(
    (resource: RbacResource, scope: RbacScope): boolean => {
      const scopes = permissions[resource];
      if (!scopes) return false;
      return scopes.includes(scope);
    },
    [permissions]
  );

  return { permissions, loading, error, hasPermission, refresh: fetchPermissions };
}

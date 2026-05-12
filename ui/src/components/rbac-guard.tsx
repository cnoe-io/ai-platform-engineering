"use client";

import { useRbacPermissions } from "@/hooks/useRbacPermissions";
import type { RbacResource, RbacScope } from "@/lib/rbac/types";

interface RbacGuardProps {
  /** Resource to check (e.g. "admin_ui", "rag") */
  resource: RbacResource;
  /** Scope to check (e.g. "view", "configure") */
  scope: RbacScope;
  /** Content to render when the user has the required permission */
  children: React.ReactNode;
  /** Optional fallback when permission is denied (defaults to nothing) */
  fallback?: React.ReactNode;
}

/**
 * Conditional rendering guard based on 098 RBAC permissions (US2).
 *
 * Wraps UI sections and renders children only if the user's effective
 * permissions include the required resource#scope. Renders nothing
 * (or an optional fallback) if denied.
 *
 * Usage:
 *   <RbacGuard resource="admin_ui" scope="configure">
 *     <AdminSettingsPanel />
 *   </RbacGuard>
 */
export function RbacGuard({
  resource,
  scope,
  children,
  fallback = null,
}: RbacGuardProps) {
  const { hasPermission, loading } = useRbacPermissions();

  if (loading) return null;

  if (!hasPermission(resource, scope)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

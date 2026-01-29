"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/config";
import { LoadingScreen } from "@/components/loading-screen";
import { isTokenExpired } from "@/lib/auth-utils";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Auth Guard Component
 *
 * Protects routes when SSO is enabled.
 * If SSO is disabled, it renders children directly without authentication check.
 * Also checks for group-based authorization (backstage-access group).
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);

  // Check SSO status after hydration to avoid server/client mismatch
  useEffect(() => {
    const enabled = getConfig('ssoEnabled');
    setSsoEnabled(enabled);
  }, []);

  useEffect(() => {
    // Only redirect if SSO is enabled
    if (ssoEnabled === null) {
      return; // Still checking SSO config
    }

    if (!ssoEnabled) {
      setAuthChecked(true);
      return;
    }

    if (status === "loading") {
      return; // Still loading, wait
    }

    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    // User is authenticated, check authorization and token expiry
    if (status === "authenticated") {
      // Check if token refresh failed
      if (session?.error === "RefreshTokenExpired" || session?.error === "RefreshTokenError") {
        console.warn("[AuthGuard] Token refresh failed, redirecting to login...");
        router.push("/login?session_expired=true");
        return;
      }

      // Check if user is authorized (has required group)
      if (session?.isAuthorized === false) {
        router.push("/unauthorized");
        return;
      }

      // Check if token is expired or about to expire (60s buffer)
      const jwtToken = session as unknown as { expiresAt?: number };
      const tokenExpiry = jwtToken.expiresAt;

      if (tokenExpiry && isTokenExpired(tokenExpiry, 60)) {
        console.warn("[AuthGuard] Token expired without refresh, redirecting to login...");
        router.push("/login?session_expired=true");
        return;
      }

      // Clear any stale token-expiry-handling flag
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('token-expiry-handling');
      }

      setAuthChecked(true);
      console.log("[AuthGuard] ✅ Authorization complete, rendering app");
    }
  }, [ssoEnabled, status, session, router]);

  // If SSO config is still loading, show nothing to prevent hydration mismatch
  if (ssoEnabled === null) {
    return null;
  }

  // If SSO is not enabled, render children directly
  if (!ssoEnabled) {
    return <>{children}</>;
  }

  // Show loading while checking authentication/authorization
  if (status === "loading" || !authChecked) {
    const message = status === "loading"
      ? "Checking authentication..."
      : "Verifying authorization...";
    return <LoadingScreen message={message} />;
  }

  // If not authenticated and SSO is enabled, show nothing (redirect will happen)
  if (status === "unauthenticated") {
    return null;
  }

  // If not authorized, show nothing (redirect will happen)
  if (session?.isAuthorized === false) {
    return null;
  }

  // Authenticated and authorized - render children
  return <>{children}</>;
}

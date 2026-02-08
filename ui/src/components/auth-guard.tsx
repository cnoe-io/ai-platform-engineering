"use client";

import { useSession, signOut } from "next-auth/react";
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
  // Initialize authChecked to true if already authenticated to avoid spinner on navigation
  const [authChecked, setAuthChecked] = useState(status === "authenticated");
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [autoResetInitiated, setAutoResetInitiated] = useState(false);

  // Check for corrupted session cookies on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if session cookie is oversized (Chrome limit is 4096 bytes)
    const cookies = document.cookie;
    const sessionCookie = cookies.split(';').find(c => c.trim().startsWith('next-auth.session-token='));

    if (sessionCookie && sessionCookie.length > 4096) {
      console.error(`[AuthGuard] Session cookie is too large (${sessionCookie.length} bytes), auto-clearing...`);
      localStorage.clear();
      sessionStorage.clear();
      document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      window.location.href = '/login?session_reset=auto';
    }
  }, []);

  // Enhanced timeout mechanism - if stuck for more than 5 seconds, show cancel button
  // If stuck for more than 15 seconds, auto-reset and redirect
  useEffect(() => {
    if ((status === "authenticated" || status === "loading") && !authChecked) {
      // Show cancel button after 5 seconds
      const timeoutButton = setTimeout(() => {
        console.warn("[AuthGuard] Authorization check taking too long - showing reset option");
        setLoadingTimeout(true);
      }, 5000); // 5 seconds

      // Auto-reset after 15 seconds if still stuck
      const timeoutReset = setTimeout(() => {
        if (!authChecked && !autoResetInitiated) {
          console.error("[AuthGuard] Authorization stuck for 15s - auto-resetting session...");
          setAutoResetInitiated(true);

          // Clear everything
          if (typeof window !== 'undefined') {
            localStorage.clear();
            sessionStorage.clear();
            // Clear all cookies
            document.cookie.split(";").forEach((c) => {
              document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
            });
          }

          // Force redirect to login
          window.location.href = '/login?session_reset=auto';
        }
      }, 15000); // 15 seconds

      return () => {
        clearTimeout(timeoutButton);
        clearTimeout(timeoutReset);
      };
    }
  }, [status, authChecked, autoResetInitiated]);

  useEffect(() => {
    if (!getConfig('ssoEnabled')) {
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
      // Check if TokenExpiryGuard is already handling expiry (prevents flickering)
      const isTokenExpiryHandling = typeof window !== 'undefined'
        ? sessionStorage.getItem('token-expiry-handling') === 'true'
        : false;

      if (isTokenExpiryHandling) {
        // Let TokenExpiryGuard handle the expiry with its modal
        console.log("[AuthGuard] TokenExpiryGuard is handling expiry, skipping redirect");
        // Still set authChecked to true to prevent infinite loading
        setAuthChecked(true);
        return;
      }

      // Check if token refresh failed
      if (session?.error === "RefreshTokenExpired" || session?.error === "RefreshTokenError") {
        console.warn("[AuthGuard] Token refresh failed, signing out and redirecting to login...");
        // Sign out to clear the corrupted session, then redirect
        signOut({ redirect: false }).then(() => {
          router.push("/login?session_expired=true");
        });
        return;
      }

      // Check if user is authorized (has required group)
      if (session?.isAuthorized === false) {
        // Set authChecked before redirect to prevent stuck state
        setAuthChecked(true);
        router.push("/unauthorized");
        return;
      }

      // Check if token is expired or about to expire (60s buffer)
      const jwtToken = session as unknown as { expiresAt?: number };
      const tokenExpiry = jwtToken.expiresAt;

      if (tokenExpiry && isTokenExpired(tokenExpiry, 60)) {
        console.warn("[AuthGuard] Token expired without refresh, redirecting to login...");
        // Set authChecked before redirect to prevent stuck state
        setAuthChecked(true);
        router.push("/login?session_expired=true");
        return;
      }

      // Clear any stale token-expiry-handling flag (auth check passed)
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('token-expiry-handling');
      }

      setAuthChecked(true);
      console.log("[AuthGuard] ✅ Authorization complete, rendering app");
    }
  }, [status, session, router]);

  // If SSO is not enabled, render children directly
  if (!getConfig('ssoEnabled')) {
    return <>{children}</>;
  }

  // Show loading while checking authentication/authorization
  if (status === "loading" || !authChecked) {
    const message = status === "loading"
      ? "Checking authentication..."
      : loadingTimeout
        ? "Session verification stuck - click below to reset"
        : "Verifying authorization...";

    const handleCancel = async () => {
      console.log("[AuthGuard] User manually resetting session...");
      // Clear everything including cookies
      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
        // Clear all cookies
        document.cookie.split(";").forEach((c) => {
          document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
      }
      // Force redirect to login instead of using signOut (which might also be stuck)
      window.location.href = '/login?session_reset=manual';
    };

    return (
      <LoadingScreen
        message={message}
        showCancel={loadingTimeout}
        onCancel={handleCancel}
      />
    );
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

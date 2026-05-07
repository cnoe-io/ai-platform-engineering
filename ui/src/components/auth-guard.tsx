"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
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
  const pathname = usePathname();
  // Initialize authChecked to true if already authenticated to avoid spinner on navigation
  const [authChecked, setAuthChecked] = useState(status === "authenticated");
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [autoResetInitiated, setAutoResetInitiated] = useState(false);

  /**
   * Build a login URL that preserves the current page as callbackUrl so the
   * user returns here after re-authenticating (e.g. /chat/<uuid>).
   */
  function loginUrl(params?: string): string {
    const cb = pathname && pathname !== '/' && pathname !== '/login'
      ? `callbackUrl=${encodeURIComponent(pathname)}`
      : '';
    const parts = [params, cb].filter(Boolean).join('&');
    return parts ? `/login?${parts}` : '/login';
  }

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
      window.location.href = loginUrl('session_reset=auto');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enhanced timeout mechanism - if stuck for more than 5 seconds, show cancel button
  // If stuck for more than 15s (60s in dev — Turbopack's first compile of /api/auth
  // is slow), auto-reset and redirect.
  useEffect(() => {
    if ((status === "authenticated" || status === "loading") && !authChecked) {
      // Show cancel button after 5 seconds
      const timeoutButton = setTimeout(() => {
        console.warn("[AuthGuard] Authorization check taking too long - showing reset option");
        setLoadingTimeout(true);
      }, 5000); // 5 seconds

      // Auto-reset after 15s in prod, 60s in dev (Turbopack first compile)
      const autoResetMs = process.env.NODE_ENV === "development" ? 60000 : 15000;
      const timeoutReset = setTimeout(() => {
        if (!authChecked && !autoResetInitiated) {
          console.error(`[AuthGuard] Authorization stuck for ${autoResetMs / 1000}s - auto-resetting session...`);
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
          window.location.href = loginUrl('session_reset=auto');
        }
      }, autoResetMs);

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
      router.push(loginUrl());
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
          router.push(loginUrl('session_expired=true'));
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
        router.push(loginUrl('session_expired=true'));
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

  // Already authenticated — render children immediately. Avoids the
  // "Checking authentication..." flash on every client-side navigation while
  // the auth-check effect runs. Token-expiry / unauth handling still runs
  // inside the effect above and will redirect if needed.
  if (status === "authenticated" && !session?.error && session?.isAuthorized !== false) {
    return <>{children}</>;
  }

  // Optimistic render during NextAuth's initial /api/auth/session fetch.
  // In dev mode Turbopack's first compile of that route takes 20-40s, which
  // would otherwise show "Checking authentication..." for that entire time.
  // If a session cookie exists, assume the user is logged in and render the
  // app; the effect above will redirect if the session turns out invalid.
  if (status === "loading" && typeof window !== "undefined") {
    const hasSessionCookie = document.cookie
      .split(";")
      .some((c) => {
        const t = c.trim();
        return (
          t.startsWith("next-auth.session-token=") ||
          t.startsWith("__Secure-next-auth.session-token=")
        );
      });
    if (hasSessionCookie) {
      return <>{children}</>;
    }
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
      window.location.href = loginUrl('session_reset=manual');
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

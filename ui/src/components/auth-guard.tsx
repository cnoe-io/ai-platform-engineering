"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { config } from "@/lib/config";
import { LoadingScreen } from "@/components/loading-screen";

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

  useEffect(() => {
    // Only redirect if SSO is enabled
    if (!config.ssoEnabled) {
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

    // User is authenticated, check authorization
    if (status === "authenticated") {
      // Check if user is authorized (has required group)
      if (session?.isAuthorized === false) {
        router.push("/unauthorized");
        return;
      }
      setAuthChecked(true);
    }
  }, [status, session, router]);

  // If SSO is not enabled, render children directly
  if (!config.ssoEnabled) {
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

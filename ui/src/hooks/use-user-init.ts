"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api-client";
import { getConfig } from "@/lib/config";

/**
 * Hook to ensure user is initialized in MongoDB on first login
 * Calls /api/users/me to create user profile if it doesn't exist
 * Only runs when both SSO and MongoDB are enabled
 */
export function useUserInit() {
  const { data: session, status } = useSession();
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeUser = async () => {
      // Check if SSO is enabled - only initialize user if SSO is enabled
      const ssoEnabled = getConfig('ssoEnabled');
      const mongodbEnabled = getConfig('mongodbEnabled');
      
      if (!ssoEnabled || !mongodbEnabled) {
        console.log("[useUserInit] SSO or MongoDB disabled, skipping user initialization");
        setInitialized(true);
        return;
      }

      if (status !== "authenticated" || !session?.user?.email) {
        return;
      }

      try {
        // Call /api/users/me to ensure user exists in MongoDB
        // This endpoint creates the user if it doesn't exist
        await apiClient.getCurrentUser();
        setInitialized(true);
        console.log("[useUserInit] User profile initialized in MongoDB");
      } catch (err) {
        // 401 is expected when SSO is disabled - don't log as error
        if (err instanceof Error && err.message.includes('401')) {
          console.log("[useUserInit] Authentication not configured, skipping initialization");
          setInitialized(true);
          return;
        }
        console.error("[useUserInit] Failed to initialize user:", err);
        setError(err instanceof Error ? err.message : "Failed to initialize user");
      }
    };

    initializeUser();
  }, [status, session]);

  return { initialized, error };
}

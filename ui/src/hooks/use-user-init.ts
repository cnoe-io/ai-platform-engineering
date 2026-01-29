"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api-client";

/**
 * Hook to ensure user is initialized in MongoDB on first login
 * Calls /api/users/me to create user profile if it doesn't exist
 */
export function useUserInit() {
  const { data: session, status } = useSession();
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeUser = async () => {
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
        console.error("[useUserInit] Failed to initialize user:", err);
        setError(err instanceof Error ? err.message : "Failed to initialize user");
      }
    };

    initializeUser();
  }, [status, session]);

  return { initialized, error };
}

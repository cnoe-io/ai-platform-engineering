"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { isTokenExpired, getTimeUntilExpiry, formatTimeUntilExpiry, getWarningTimestamp } from "@/lib/auth-utils";
import { getConfig } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { AlertCircle, LogOut, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * TokenExpiryGuard Component
 *
 * Monitors SSO token expiry and gracefully handles session expiration:
 * - Silently refreshes token when user is active on the page
 * - Shows warning toast 5 minutes before expiry (only if silent refresh failed)
 * - Shows critical alert when expired
 * - Redirects to login on expiry
 * - Dismiss persists until the warning window resets (token refreshed or new expiry cycle)
 */
export function TokenExpiryGuard() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  /** Tracks user dismissal — stores the expiresAt timestamp for which the warning was dismissed.
   *  This way, if the token is refreshed (new expiresAt), the warning can show again for the new cycle. */
  const dismissedForExpiryRef = useRef<number | null>(null);
  /** Tracks whether a silent refresh is in flight to prevent concurrent attempts. */
  const isRefreshingRef = useRef(false);

  // Handle logout
  const handleLogout = useCallback(async () => {
    setShowWarning(false);
    setShowExpired(false);
    // Clear the flag when logging out
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('token-expiry-handling');
    }
    await signOut({ callbackUrl: "/login" });
  }, []);

  // Handle relogin — must sign out first to clear the session cookie,
  // otherwise the login page sees "authenticated" status and bounces back,
  // creating an infinite redirect loop.
  const handleRelogin = useCallback(async () => {
    setShowWarning(false);
    setShowExpired(false);
    // Set flag to prevent AuthGuard from also redirecting (prevents flickering)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('token-expiry-handling', 'true');
    }
    await signOut({ callbackUrl: "/login?session_expired=true" });
  }, []);

  // Handle dismiss — persist until this expiry cycle ends
  const handleDismiss = useCallback((currentExpiresAt: number | null) => {
    setShowWarning(false);
    dismissedForExpiryRef.current = currentExpiresAt;
  }, []);

  /**
   * Silently refresh the session token.
   *
   * NextAuth's JWT callback (auth-config.ts) already handles the OIDC refresh_token
   * exchange when the token is within 5 minutes of expiry. However, the JWT callback
   * only runs on server-side requests. If the user is idle on the page (no API calls),
   * the token expires without being refreshed.
   *
   * Calling `updateSession()` (NextAuth's `update` from `useSession`) triggers a
   * server-side session check which runs the JWT callback, causing a token refresh.
   */
  const attemptSilentRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return false;
    if (!session?.hasRefreshToken) {
      console.log("[TokenExpiryGuard] No refresh token available, cannot silently refresh");
      return false;
    }

    isRefreshingRef.current = true;
    try {
      console.log("[TokenExpiryGuard] Attempting silent token refresh...");
      // updateSession() triggers NextAuth to re-run the JWT callback server-side.
      // If the token is near expiry, the JWT callback calls refreshAccessToken().
      await updateSession();
      console.log("[TokenExpiryGuard] Silent refresh triggered successfully");
      return true;
    } catch (error) {
      console.error("[TokenExpiryGuard] Silent refresh failed:", error);
      return false;
    } finally {
      isRefreshingRef.current = false;
    }
  }, [session?.hasRefreshToken, updateSession]);

  // Check token expiry
  const checkTokenExpiry = useCallback(() => {
    if (!getConfig('ssoEnabled')) {
      return; // SSO not enabled
    }

    if (status !== "authenticated" || !session) {
      return; // Not authenticated
    }

    // Check if token refresh failed
    if (session.error === "RefreshTokenExpired" || session.error === "RefreshTokenError") {
      console.error(`[TokenExpiryGuard] Token refresh failed: ${session.error}`);
      setShowWarning(false);
      setShowExpired(true);

      // Set flag to prevent AuthGuard from also redirecting (prevents flickering)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('token-expiry-handling', 'true');
      }

      // Stop checking
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }

      // Auto-redirect after 5 seconds
      setTimeout(() => {
        handleLogout();
      }, 5000);
      return;
    }

    // Get expiresAt from session (NextAuth JWT)
    const expiresAt = session.user as unknown as { expiresAt?: number };
    const tokenExpiresAt = expiresAt?.expiresAt;

    // Check if token exists (from auth-config.ts line 108)
    const jwtToken = session as unknown as { expiresAt?: number };
    const actualExpiresAt = tokenExpiresAt || jwtToken.expiresAt;

    if (!actualExpiresAt) {
      console.warn("[TokenExpiryGuard] No expiry time found in session");
      return;
    }

    const secondsUntilExpiry = getTimeUntilExpiry(actualExpiresAt);
    const isExpired = isTokenExpired(actualExpiresAt, 0); // No buffer for expiry check
    const warningTime = getWarningTimestamp(actualExpiresAt);

    // Update time remaining for display
    setTimeRemaining(formatTimeUntilExpiry(secondsUntilExpiry));

    // Token has expired
    if (isExpired) {
      console.error("[TokenExpiryGuard] Token expired! Forcing logout...");
      setShowWarning(false);
      setShowExpired(true);

      // Set flag to prevent AuthGuard from also redirecting (prevents flickering)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('token-expiry-handling', 'true');
      }

      // Stop checking
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }

      // Auto-redirect after 5 seconds
      setTimeout(() => {
        handleLogout();
      }, 5000);
      return;
    }

    // If the token was refreshed (expiresAt changed), clear the dismissed state
    // so the warning can show again for the next expiry cycle.
    if (dismissedForExpiryRef.current !== null && dismissedForExpiryRef.current !== actualExpiresAt) {
      console.log("[TokenExpiryGuard] Token was refreshed, clearing dismissed state");
      dismissedForExpiryRef.current = null;
    }

    // Within warning window (5 min before expiry)
    const now = Math.floor(Date.now() / 1000);
    if (warningTime && now >= warningTime && !showExpired) {
      // First: attempt silent refresh automatically (the user shouldn't have to do anything)
      if (!isRefreshingRef.current) {
        attemptSilentRefresh().then((refreshed) => {
          if (refreshed) {
            // Refresh was triggered — next check cycle will see the new expiresAt
            // and hide the warning (or never show it)
            console.log("[TokenExpiryGuard] Silent refresh initiated, waiting for updated session");
          }
        });
      }

      // Show warning only if not dismissed for this expiry cycle
      const isDismissed = dismissedForExpiryRef.current === actualExpiresAt;
      if (!showWarning && !isDismissed) {
        console.warn(`[TokenExpiryGuard] Token expiring in ${formatTimeUntilExpiry(secondsUntilExpiry)}`);
        setShowWarning(true);
      }
    } else if (showWarning && !isExpired) {
      // Token was refreshed (we're outside warning window now), hide warning
      setShowWarning(false);
      dismissedForExpiryRef.current = null;
    }
  }, [status, session, showWarning, showExpired, handleLogout, attemptSilentRefresh]);

  // Set up periodic token expiry checking
  useEffect(() => {
    if (!getConfig('ssoEnabled') || status !== "authenticated") {
      return;
    }

    // Check immediately
    checkTokenExpiry();

    // Check every 30 seconds
    checkIntervalRef.current = setInterval(checkTokenExpiry, 30 * 1000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [status, checkTokenExpiry]);

  // Don't render if SSO is not enabled
  if (!getConfig('ssoEnabled')) {
    return null;
  }

  // Compute current expiresAt for the dismiss handler (same logic as in checkTokenExpiry)
  const sessionExpiresAt = (() => {
    if (!session) return null;
    const userExpiry = (session.user as unknown as { expiresAt?: number })?.expiresAt;
    const jwtExpiry = (session as unknown as { expiresAt?: number }).expiresAt;
    return userExpiry || jwtExpiry || null;
  })();

  return (
    <>
      {/* Warning Toast - Token expiring soon */}
      <AnimatePresence>
        {showWarning && !showExpired && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-4 z-50 w-96"
          >
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 shadow-lg backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-500 mb-1">
                    Session Expiring Soon
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Your session will expire in <strong className="text-foreground">{timeRemaining}</strong>.
                    {session?.hasRefreshToken
                      ? " Attempting to refresh automatically..."
                      : " Please save your work and re-login to continue."}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRelogin}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Re-login Now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismiss(sessionExpiresAt)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Critical Alert - Token expired */}
      <AnimatePresence>
        {showExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-destructive/50 rounded-lg p-6 shadow-2xl max-w-md w-full"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 bg-destructive/10 rounded-full">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-foreground mb-2">
                    Session Expired
                  </h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your session has expired for security reasons. Please log in again to continue using the application.
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Redirecting to login in 5 seconds...
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleLogout}
                      className="gap-2 w-full"
                      variant="default"
                    >
                      <LogOut className="h-4 w-4" />
                      Log In Again
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

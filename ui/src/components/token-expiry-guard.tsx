"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { isTokenExpired, getTimeUntilExpiry, formatTimeUntilExpiry, getWarningTimestamp } from "@/lib/auth-utils";
import { useConfig } from "@/components/config-provider";
import { Button } from "@/components/ui/button";
import { AlertCircle, LogOut, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * TokenExpiryGuard Component
 *
 * Monitors SSO token expiry and gracefully handles session expiration:
 * - Shows warning toast 5 minutes before expiry
 * - Shows critical alert when expired
 * - Redirects to login on expiry
 * - Checks token before API calls
 */
export function TokenExpiryGuard() {
  const { data: session, status } = useSession();
  const config = useConfig();
  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  // Handle relogin
  const handleRelogin = useCallback(() => {
    setShowWarning(false);
    setShowExpired(false);
    router.push("/login");
  }, [router]);

  // Check token expiry
  const checkTokenExpiry = useCallback(() => {
    if (!config.ssoEnabled) {
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

    // Show warning if we're within warning window (5 min before expiry)
    const now = Math.floor(Date.now() / 1000);
    if (warningTime && now >= warningTime && !showExpired) {
      if (!showWarning) {
        console.warn(`[TokenExpiryGuard] Token expiring in ${formatTimeUntilExpiry(secondsUntilExpiry)}`);
        setShowWarning(true);
      }
    } else if (showWarning && !isExpired) {
      // Token was refreshed, hide warning
      setShowWarning(false);
    }
  }, [config.ssoEnabled, status, session, showWarning, showExpired, handleLogout]);

  // Set up periodic token expiry checking
  useEffect(() => {
    if (!config.ssoEnabled || status !== "authenticated") {
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
  }, [config.ssoEnabled, status, checkTokenExpiry]);

  // Don't render if SSO is not enabled
  if (!config.ssoEnabled) {
    return null;
  }

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
                    Please save your work and re-login to continue.
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
                      onClick={() => setShowWarning(false)}
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

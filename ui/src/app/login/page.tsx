"use client";

import React, { Suspense, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, Loader2, AlertCircle, Shield, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingScreen } from "@/components/loading-screen";
import { IntegrationOrbit } from "@/components/gallery/IntegrationOrbit";
import { config, getLogoFilterClass } from "@/lib/config";

// Circuit breaker: detect redirect loops via sessionStorage counter.
// If we've been redirected to /login more than 3 times within 10 seconds,
// force a full session reset to break the loop.
const LOOP_KEY = "login-redirect-count";
const LOOP_TS_KEY = "login-redirect-ts";
const LOOP_THRESHOLD = 3;
const LOOP_WINDOW_MS = 10_000;

function detectAndBreakRedirectLoop(): boolean {
  if (typeof window === "undefined") return false;

  const now = Date.now();
  const lastTs = parseInt(sessionStorage.getItem(LOOP_TS_KEY) || "0", 10);
  let count = parseInt(sessionStorage.getItem(LOOP_KEY) || "0", 10);

  // Reset counter if outside the time window
  if (now - lastTs > LOOP_WINDOW_MS) {
    count = 0;
  }

  count += 1;
  sessionStorage.setItem(LOOP_KEY, String(count));
  sessionStorage.setItem(LOOP_TS_KEY, String(now));

  if (count >= LOOP_THRESHOLD) {
    console.error(`[Login] Redirect loop detected (${count} redirects in ${LOOP_WINDOW_MS}ms). Breaking loop...`);
    // Clear everything to break the loop
    sessionStorage.removeItem(LOOP_KEY);
    sessionStorage.removeItem(LOOP_TS_KEY);
    sessionStorage.removeItem("token-expiry-handling");
    localStorage.clear();
    // Clear all cookies
    document.cookie.split(";").forEach((c) => {
      document.cookie = c
        .replace(/^ +/, "")
        .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    return true; // Loop detected — caller should NOT redirect
  }

  return false;
}

function clearRedirectLoopCounter() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(LOOP_KEY);
  sessionStorage.removeItem(LOOP_TS_KEY);
}

function LoginContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  // Initialize loopBroken synchronously so the redirect effect sees it immediately.
  // Using a lazy initializer ensures detectAndBreakRedirectLoop() runs exactly once
  // during the first render, before any effects fire.
  const [loopBroken] = useState(() => detectAndBreakRedirectLoop());
  const error = searchParams.get("error");
  const sessionExpired = searchParams.get("session_expired") === "true";
  const sessionReset = searchParams.get("session_reset");
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  // Admin local credentials state
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminTotp, setAdminTotp] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminInfo, setAdminInfo] = useState<string | null>(null);
  const [setupState, setSetupState] = useState<'local_only' | 'oidc_configured' | null>(null);

  // Check setup state to decide UI mode — runs once on mount
  useEffect(() => {
    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.state === 'no_admin') {
          router.replace('/setup');
        } else if (data.state === 'local_only') {
          setSetupState('local_only');
        } else if (data.state === 'oidc_configured') {
          setSetupState('oidc_configured');
        }
      })
      .catch(() => {
        // If check fails, assume local-only so credentials form is always accessible
        setSetupState('local_only');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect if already logged in — but NOT if:
  // - session_expired/session_reset param is present (user intentionally came here)
  // - a redirect loop was detected
  useEffect(() => {
    if (loopBroken || sessionExpired || sessionReset) {
      // User is here intentionally or we broke a loop — show login form
      return;
    }

    if (status === "authenticated") {
      // Clear counter on successful auth redirect (not a loop)
      clearRedirectLoopCounter();
      router.push(callbackUrl);
    }
  }, [status, router, callbackUrl, sessionExpired, sessionReset, loopBroken]);

  const handleSignIn = async () => {
    setIsLoading(true);
    // Clear loop detection state on intentional sign-in
    clearRedirectLoopCounter();
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("token-expiry-handling");
    }
    try {
      await signIn("oidc", { callbackUrl });
    } catch (err) {
      console.error("Sign in error:", err);
      setIsLoading(false);
    }
  };

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError(null);
    setAdminInfo(null);
    setIsLoading(true);
    clearRedirectLoopCounter();
    try {
      const result = await signIn("credentials", {
        email: adminEmail,
        password: adminPassword,
        totp: adminTotp,
        redirect: false,
      });
      if (result?.error === "TotpRequired") {
        setTotpRequired(true);
        setAdminInfo("Enter your authenticator code to continue.");
      } else if (result?.error === "TotpInvalid") {
        setAdminError("Invalid authenticator code. Please try again.");
      } else if (result?.error === "RateLimited") {
        setAdminError("Too many login attempts. Please try again in a few minutes.");
      } else if (result?.error === "AccountLocked") {
        setAdminError("Account is temporarily locked. Please try again in 15 minutes.");
      } else if (result?.error || !result?.ok) {
        setAdminError("Invalid email or password.");
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setAdminError("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading screen while checking auth or during redirect
  if (status === "loading" || isLoading) {
    return <LoadingScreen message={isLoading ? "Redirecting to SSO..." : "Loading..."} />;
  }

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      {/* Full-page background gradients that span both panels */}
      <div 
        className="absolute inset-0" 
        style={{
          background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 8%, transparent), transparent, color-mix(in srgb, var(--gradient-to) 8%, transparent))`
        }}
      />
      <div 
        className="absolute inset-0" 
        style={{
          background: `radial-gradient(ellipse at 30% 50%, color-mix(in srgb, var(--gradient-from) 10%, transparent), transparent)`
        }}
      />
      <div 
        className="absolute inset-0" 
        style={{
          background: `radial-gradient(ellipse at 70% 50%, color-mix(in srgb, var(--gradient-to) 8%, transparent), transparent)`
        }}
      />

      {/* Left Panel - Integration Animation */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center">
        <div className="relative z-10 flex flex-col items-center">
          <IntegrationOrbit />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-center mt-8 max-w-sm px-4"
          >
            <h2 className="text-2xl font-bold gradient-text mb-3">
              {config.tagline}
            </h2>
            <p className="text-muted-foreground">
              {config.description}
            </p>
          </motion.div>
        </div>
      </div>

      {/* Right Panel - Login Card */}
      <div className="flex-1 flex items-center justify-center p-8 relative">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-8 text-center border-b border-border bg-muted/30">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl gradient-primary-br flex items-center justify-center animate-pulse-glow">
                <img src={config.logoUrl} alt={config.appName} className={`h-10 w-10 ${getLogoFilterClass(config.logoStyle)}`} />
              </div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-2xl font-bold gradient-text">{config.appName}</h1>
                {config.envBadge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded">
                    {config.envBadge}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {config.tagline}
              </p>
            </div>

            {/* Content */}
            <div className="p-8">
              {/* Redirect Loop Recovery Message */}
              {loopBroken && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-3"
                >
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Session Reset
                    </p>
                    <p className="text-xs text-destructive/80 mt-1">
                      A login loop was detected and your session has been reset. Please sign in again.
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Session Expired Message */}
              {sessionExpired && !loopBroken && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3"
                >
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-500">
                      Session Expired
                    </p>
                    <p className="text-xs text-amber-500/80 mt-1">
                      Your authentication session has expired. Please sign in again to continue.
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Error Message */}
              {error && !sessionExpired && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-3"
                >
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Authentication Failed
                    </p>
                    <p className="text-xs text-destructive/80 mt-1">
                      {error === "OAuthSignin" && "Failed to start authentication flow."}
                      {error === "OAuthCallback" && "Failed to complete authentication."}
                      {error === "OAuthCreateAccount" && "Failed to create account."}
                      {error === "Callback" && "Authentication callback error."}
                      {error === "AccessDenied" && "Access denied. You may not have permission."}
                      {!["OAuthSignin", "OAuthCallback", "OAuthCreateAccount", "Callback", "AccessDenied"].includes(error) &&
                        "An unexpected error occurred. Please try again."}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Local-only mode: show credentials form as primary */}
              {setupState === 'local_only' && (
                <form onSubmit={handleAdminSignIn} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="admin-email" className="text-xs">Email</Label>
                    <Input id="admin-email" type="email" value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@example.com" required autoComplete="email" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="admin-password" className="text-xs">Password</Label>
                    <Input id="admin-password" type="password" value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      required autoComplete="current-password" />
                  </div>
                  <AnimatePresence>
                    {totpRequired && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }} className="space-y-1">
                        <Label htmlFor="admin-totp" className="text-xs">Authenticator Code</Label>
                        <Input id="admin-totp" type="text" inputMode="numeric" maxLength={10}
                          value={adminTotp} onChange={(e) => setAdminTotp(e.target.value)}
                          placeholder="6-digit code or backup code"
                          className="text-center font-mono tracking-widest"
                          autoComplete="one-time-code" autoFocus />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {adminInfo && (
                    <p className="text-xs text-muted-foreground">{adminInfo}</p>
                  )}
                  {adminError && (
                    <p className="text-xs text-destructive">{adminError}</p>
                  )}
                  <Button type="submit" disabled={isLoading}
                    className="w-full h-10 gap-2 gradient-primary text-white hover:opacity-90">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    {isLoading ? "Signing in…" : "Sign In"}
                  </Button>
                </form>
              )}

              {/* OIDC-configured mode: SSO as primary, admin login as secondary */}
              {setupState === 'oidc_configured' && (
                <>
                  <Button onClick={handleSignIn} disabled={isLoading}
                    className="w-full h-12 text-base gap-2 gradient-primary text-white hover:opacity-90 transition-opacity">
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                    {isLoading ? "Redirecting..." : "Sign in with SSO"}
                  </Button>

                  <div className="mt-4 pt-4 border-t border-border">
                    <button type="button" onClick={() => setShowAdminLogin(!showAdminLogin)}
                      className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
                      <span className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3" />
                        Admin login (recovery)
                      </span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${showAdminLogin ? "rotate-180" : ""}`} />
                    </button>
                    <AnimatePresence>
                      {showAdminLogin && (
                        <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }} onSubmit={handleAdminSignIn}
                          className="mt-3 space-y-2 overflow-hidden">
                          <Input type="email" value={adminEmail}
                            onChange={(e) => setAdminEmail(e.target.value)}
                            placeholder="admin@example.com" required autoComplete="email"
                            className="h-9 text-sm" />
                          <Input type="password" value={adminPassword}
                            onChange={(e) => setAdminPassword(e.target.value)}
                            required autoComplete="current-password"
                            placeholder="Password" className="h-9 text-sm" />
                          {totpRequired && (
                            <Input type="text" inputMode="numeric" maxLength={6}
                              value={adminTotp} onChange={(e) => setAdminTotp(e.target.value.replace(/\D/g, ""))}
                              placeholder="000000" className="h-9 text-sm text-center font-mono tracking-widest"
                              autoComplete="one-time-code" />
                          )}
                          {adminInfo && <p className="text-xs text-muted-foreground">{adminInfo}</p>}
                          {adminError && <p className="text-xs text-destructive">{adminError}</p>}
                          <Button type="submit" variant="outline" size="sm" disabled={isLoading} className="w-full">
                            {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                            Sign in as Admin
                          </Button>
                        </motion.form>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}

              {/* Loading state — show spinner while setup status is fetching */}
              {setupState === null && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          {/* Additional Info */}
          {config.showPoweredBy && (
            <p className="text-center text-xs text-muted-foreground mt-6">
              Powered by OSS{" "}
              <a
                href="https://caipe.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                caipe.io
              </a>
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen message="Loading..." />}>
      <LoginContent />
    </Suspense>
  );
}

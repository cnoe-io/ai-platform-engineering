"use client";

import React, { Suspense, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { LogIn, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { IntegrationOrbit } from "@/components/gallery/IntegrationOrbit";

function LoginContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const error = searchParams.get("error");
  const sessionExpired = searchParams.get("session_expired") === "true";
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  // Redirect if already logged in
  useEffect(() => {
    if (status === "authenticated") {
      router.push(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn("oidc", { callbackUrl });
    } catch (err) {
      console.error("Sign in error:", err);
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
              Multi-Agent Collaboration & Workflow Automation
            </h2>
            <p className="text-muted-foreground">
              AI agents and native apps collaborating across tools and teams to get work done.
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
                <img src="/logo.svg" alt="CAIPE" className="h-10 w-10" />
              </div>
              <h1 className="text-2xl font-bold gradient-text">CAIPE</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Multi-Agent Collaboration & Workflow Automation
              </p>
            </div>

            {/* Content */}
            <div className="p-8">
              {/* Session Expired Message */}
              {sessionExpired && (
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

              {/* SSO Login Button */}
              <Button
                onClick={handleSignIn}
                disabled={isLoading}
                className="w-full h-12 text-base gap-2 gradient-primary text-white hover:opacity-90 transition-opacity"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="h-5 w-5" />
                )}
                {isLoading ? "Redirecting..." : "Sign in with SSO"}
              </Button>
            </div>
          </div>

          {/* Additional Info */}
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

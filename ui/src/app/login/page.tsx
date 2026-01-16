"use client";

import React, { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { LogIn, Shield, Loader2, AlertCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const error = searchParams.get("error");
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

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(173,80%,40%)]/10 via-transparent to-[hsl(270,75%,60%)]/10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-8 text-center border-b border-border bg-muted/30">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[hsl(173,80%,40%)] via-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)] flex items-center justify-center animate-pulse-glow">
              <img src="/logo.svg" alt="CAIPE" className="h-10 w-10" />
            </div>
            <h1 className="text-2xl font-bold gradient-text">CAIPE</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Community AI Platform Engineering
            </p>
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Error Message */}
            {error && (
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
              className="w-full h-12 text-base gap-2 bg-gradient-to-r from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] hover:opacity-90 transition-opacity"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <LogIn className="h-5 w-5" />
              )}
              {isLoading ? "Redirecting..." : "Sign in with SSO"}
            </Button>

            {/* Security Note */}
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              <span>Secured with enterprise OIDC authentication</span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 border-t border-border bg-muted/20">
            <p className="text-[10px] text-center text-muted-foreground">
              By signing in, you agree to the terms of service and privacy policy.
            </p>
          </div>
        </div>

        {/* Additional Info */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          Powered by{" "}
          <a
            href="https://cnoe-io.github.io/ai-platform-engineering/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            CNOE
          </a>{" "}
          Agentic AI SIG
        </p>
      </motion.div>
    </div>
  );
}

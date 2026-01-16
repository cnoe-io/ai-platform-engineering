"use client";

import React, { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LogoutPage() {
  const { status } = useSession();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLoggedOut, setIsLoggedOut] = useState(false);

  // Auto logout if user is authenticated
  useEffect(() => {
    if (status === "authenticated" && !isLoggingOut && !isLoggedOut) {
      handleLogout();
    } else if (status === "unauthenticated") {
      setIsLoggedOut(true);
    }
  }, [status, isLoggingOut, isLoggedOut]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await signOut({ redirect: false });
      setIsLoggedOut(true);
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleBackToLogin = () => {
    router.push("/login");
  };

  const handleBackToHome = () => {
    router.push("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(173,80%,40%)]/5 via-transparent to-[hsl(270,75%,60%)]/5" />

      {/* Logout Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-8 text-center border-b border-border bg-muted/30">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[hsl(173,80%,40%)] via-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)] flex items-center justify-center">
              <img src="/logo.svg" alt="CAIPE" className="h-10 w-10" />
            </div>
            <h1 className="text-2xl font-bold gradient-text">CAIPE</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Community AI Platform Engineering
            </p>
          </div>

          {/* Content */}
          <div className="p-8">
            {isLoggingOut ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                <h2 className="text-lg font-semibold mb-2">Signing Out...</h2>
                <p className="text-sm text-muted-foreground">
                  Please wait while we securely log you out.
                </p>
              </motion.div>
            ) : isLoggedOut ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-4"
              >
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Successfully Signed Out</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  You have been securely logged out of CAIPE.
                </p>

                <div className="space-y-3">
                  <Button
                    onClick={handleBackToLogin}
                    className="w-full h-11 gap-2 bg-gradient-to-r from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] hover:opacity-90 transition-opacity"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign In Again
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleBackToHome}
                    className="w-full h-11 gap-2"
                  >
                    <ArrowRight className="h-4 w-4" />
                    Go to Home
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-4"
              >
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <LogOut className="h-8 w-8 text-amber-500" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Sign Out?</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Are you sure you want to sign out of CAIPE?
                </p>

                <div className="space-y-3">
                  <Button
                    onClick={handleLogout}
                    variant="destructive"
                    className="w-full h-11 gap-2"
                  >
                    <LogOut className="h-4 w-4" />
                    Yes, Sign Out
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleBackToHome}
                    className="w-full h-11 gap-2"
                  >
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-4 border-t border-border bg-muted/20">
            <p className="text-[10px] text-center text-muted-foreground">
              Your session has ended. Any unsaved work may be lost.
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

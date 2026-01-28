"use client";

import React, { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { User, LogIn, LogOut, ChevronDown, Shield, Users, Hash, Code, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check SSO status after hydration to avoid server/client mismatch
  useEffect(() => {
    const enabled = getConfig('ssoEnabled');
    setSsoEnabled(enabled);
  }, []);

  // Close on outside click - MUST be called before any returns (Rules of Hooks)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Now we can do early returns after all hooks are called
  // Don't render if SSO is not enabled
  if (ssoEnabled === false) {
    return null;
  }

  // Don't render during SSO check to prevent hydration mismatch
  if (ssoEnabled === null) {
    return null;
  }

  // Loading state
  if (status === "loading") {
    return (
      <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
    );
  }

  // Not authenticated
  if (status === "unauthenticated") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signIn("oidc")}
        className="gap-1.5 text-xs"
      >
        <LogIn className="h-3.5 w-3.5" />
        Sign In
      </Button>
    );
  }

  // Decode JWT token for advanced view
  const decodeJWT = (token: string | undefined) => {
    if (!token) return null;
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  };

  const decodedToken = session?.idToken ? decodeJWT(session.idToken) : null;

  // Authenticated - show user menu
  const userInitials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  // Get display name (first name or full name)
  const displayName = session?.user?.name || "User";
  const firstName = displayName.split(" ")[0];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-2 py-1 rounded-full transition-colors",
          open
            ? "bg-primary/10"
            : "hover:bg-muted"
        )}
      >
        {session?.user?.image ? (
          <img
            src={session.user.image}
            alt={displayName}
            className="h-6 w-6 rounded-full"
          />
        ) : (
          <div className="h-6 w-6 rounded-full gradient-primary-br flex items-center justify-center">
            <span className="text-[10px] font-medium text-white">{userInitials}</span>
          </div>
        )}
        <span className="text-xs font-medium max-w-[100px] truncate">{firstName}</span>
        <ChevronDown className={cn(
          "h-3 w-3 text-muted-foreground transition-transform",
          open && "rotate-180"
        )} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-card border border-border shadow-xl z-50 overflow-hidden"
          >
            {/* User Info */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-3">
                {session?.user?.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user.name || "User"}
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full gradient-primary-br flex items-center justify-center">
                    <span className="text-sm font-medium text-white">{userInitials}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {session?.user?.name || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {session?.user?.email || ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Session Info */}
            <div className="p-2 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Shield className="h-3 w-3 flex-shrink-0" />
                <span>Authenticated via SSO</span>
              </div>
            </div>

            {/* Advanced Info Toggle */}
            <div className="border-b border-border">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Code className="h-3.5 w-3.5" />
                  <span>Advanced</span>
                </div>
                <ChevronRight className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  showAdvanced && "rotate-90"
                )} />
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 bg-muted/30 space-y-3">
                      {/* MemberOf Groups */}
                      {session?.groups && session.groups.length > 0 && (
                        <div>
                          <div className="mb-2">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs font-semibold">Group Memberships</span>
                              <span className="text-[10px] text-muted-foreground/70">
                                ({session.groups.length})
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground/70 ml-5">
                              OIDC groups from memberOf claim
                            </p>
                          </div>
                          <div className="bg-card rounded-md p-2 border border-border">
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {session.groups.map((group, index) => (
                                <div
                                  key={index}
                                  className="text-xs font-mono text-muted-foreground break-all"
                                  title={group}
                                >
                                  • {group}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Decoded JWT Token */}
                      {decodedToken && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Code className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold">JWT Claims (ID Token)</span>
                          </div>
                          <div className="bg-card rounded-md p-2 border border-border">
                            <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                              {JSON.stringify(decodedToken, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}

                      {/* Copy Tokens */}
                      <div className="flex gap-2 pt-2">
                        {session?.accessToken && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(session.accessToken || '');
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded-md bg-card hover:bg-muted border border-border transition-colors"
                          >
                            <Code className="h-3 w-3" />
                            Copy Access Token
                          </button>
                        )}
                        {session?.idToken && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(session.idToken || '');
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded-md bg-card hover:bg-muted border border-border transition-colors"
                          >
                            <Code className="h-3 w-3" />
                            Copy ID Token
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Actions */}
            <div className="p-1.5">
              <button
                onClick={() => {
                  setOpen(false);
                  signOut({ callbackUrl: '/login' });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

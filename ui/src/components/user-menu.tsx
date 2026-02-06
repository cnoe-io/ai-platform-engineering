"use client";

import React, { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { User, LogIn, LogOut, ChevronDown, Shield, Users, Hash, Code, ChevronRight, Layers, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Tech Stack Data
interface TechItem {
  name: string;
  description: string;
  url: string;
  category: "platform" | "protocol" | "frontend" | "backend" | "community";
}

const techStack: TechItem[] = [
  { name: "CAIPE", description: "Multi-Agent Collaboration & Workflow Automation - AI agents and native apps collaborating across tools and teams to get work done", url: "https://caipe.io", category: "platform" },
  { name: "A2A Protocol", description: "Agent-to-Agent protocol for inter-agent communication (by Google)", url: "https://google.github.io/A2A/", category: "protocol" },
  { name: "A2UI", description: "Agent-to-User Interface specification for declarative UI widgets", url: "https://a2ui.org/", category: "protocol" },
  { name: "MCP", description: "Model Context Protocol for AI tool integration (by Anthropic)", url: "https://modelcontextprotocol.io/", category: "protocol" },
  { name: "Next.js 15", description: "React framework with App Router and Server Components", url: "https://nextjs.org/", category: "frontend" },
  { name: "React 19", description: "JavaScript library for building user interfaces", url: "https://react.dev/", category: "frontend" },
  { name: "TypeScript", description: "Typed superset of JavaScript for better developer experience", url: "https://www.typescriptlang.org/", category: "frontend" },
  { name: "Tailwind CSS", description: "Utility-first CSS framework for rapid UI development", url: "https://tailwindcss.com/", category: "frontend" },
  { name: "Radix UI", description: "Unstyled, accessible UI components for React", url: "https://www.radix-ui.com/", category: "frontend" },
  { name: "Zustand", description: "Lightweight state management for React applications", url: "https://zustand-demo.pmnd.rs/", category: "frontend" },
  { name: "Framer Motion", description: "Production-ready animation library for React", url: "https://www.framer.com/motion/", category: "frontend" },
  { name: "Sigma.js", description: "JavaScript library for graph visualization and analysis", url: "https://www.sigmajs.org/", category: "frontend" },
  { name: "NextAuth.js", description: "Authentication for Next.js applications with OAuth 2.0 support", url: "https://next-auth.js.org/", category: "frontend" },
  { name: "LangGraph", description: "Framework for building stateful, multi-actor applications with LLMs", url: "https://langchain-ai.github.io/langgraph/", category: "backend" },
  { name: "Python 3.11+", description: "Backend agent implementation with asyncio support", url: "https://www.python.org/", category: "backend" },
  { name: "CNOE", description: "Cloud Native Operational Excellence - Open source IDP reference implementations", url: "https://cnoe.io/", category: "community" },
];

const categoryLabels: Record<TechItem["category"], string> = {
  platform: "Platform",
  protocol: "Protocols",
  frontend: "Frontend",
  backend: "Backend",
  community: "Community",
};

const categoryColors: Record<TechItem["category"], string> = {
  platform: "gradient-primary-br",
  protocol: "bg-gradient-to-br from-purple-500 to-purple-600",
  frontend: "bg-gradient-to-br from-blue-500 to-blue-600",
  backend: "bg-gradient-to-br from-orange-500 to-orange-600",
  community: "bg-gradient-to-br from-green-500 to-green-600",
};

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
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

            {/* OIDC Token Section */}
            <div className="border-b border-border">
              <button
                onClick={() => {
                  setTokenOpen(true);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Code className="h-3.5 w-3.5" />
                  <span>OIDC Token</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Built with Section */}
            <div className="border-b border-border">
              <button
                onClick={() => {
                  setAboutOpen(true);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Built with</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
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

      {/* OIDC Token Dialog */}
      <Dialog open={tokenOpen} onOpenChange={setTokenOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] p-0">
          <DialogHeader className="p-6 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl gradient-primary-br">
                <Code className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle>OIDC Token Information</DialogTitle>
                <DialogDescription>
                  View authentication tokens and group memberships
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
            {/* MemberOf Groups */}
            {session?.groups && session.groups.length > 0 && (
              <div>
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Group Memberships</span>
                    <span className="text-xs text-muted-foreground/70">
                      ({session.groups.length})
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/70 ml-6">
                    OIDC groups from memberOf claim
                  </p>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 border border-border">
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {session.groups.map((group, index) => (
                      <div
                        key={index}
                        className="text-sm font-mono text-foreground/80 break-all"
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
                <div className="flex items-center gap-2 mb-3">
                  <Code className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">JWT Claims (ID Token)</span>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 border border-border">
                  <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                    {JSON.stringify(decodedToken, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Copy Tokens */}
            <div className="flex gap-3">
              {session?.accessToken && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(session.accessToken || '');
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg gradient-primary-br text-white hover:opacity-90 transition-opacity"
                >
                  <Code className="h-4 w-4" />
                  Copy Access Token
                </button>
              )}
              {session?.idToken && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(session.idToken || '');
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Code className="h-4 w-4" />
                  Copy ID Token
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Built with Dialog */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] p-0">
          <DialogHeader className="p-6 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl gradient-primary-br">
                <Layers className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle>Built with</DialogTitle>
                <DialogDescription>
                  Technology Stack - Powered by open standards
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-6 overflow-y-auto max-h-[60vh]">
            {(["platform", "protocol", "frontend", "backend", "community"] as const).map((category) => {
              const items = techStack.filter(item => item.category === category);
              if (items.length === 0) return null;

              return (
                <div key={category} className="mb-6 last:mb-0">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {categoryLabels[category]}
                  </h3>
                  <div className="space-y-2">
                    {items.map((tech) => (
                      <a
                        key={tech.name}
                        href={tech.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group border border-transparent hover:border-border"
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold",
                          categoryColors[tech.category]
                        )}>
                          {tech.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm group-hover:text-primary transition-colors">
                              {tech.name}
                            </span>
                            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {tech.description}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-border bg-muted/20">
            <p className="text-xs text-center text-muted-foreground">
              Built with ❤️ by the{" "}
              <a
                href="https://cnoe.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                CNOE
              </a>{" "}
              community
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

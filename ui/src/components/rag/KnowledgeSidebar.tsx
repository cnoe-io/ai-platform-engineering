"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Database,
  Search,
  GitFork,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RagAuthIndicator } from "@/components/rag/RagAuthBanner";

interface KnowledgeSidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  graphRagEnabled: boolean;
}

const navItems = [
  {
    id: "ingest",
    label: "Data Sources",
    href: "/knowledge-bases/ingest",
    icon: Database,
    description: "Ingest and manage sources",
  },
  {
    id: "search",
    label: "Search",
    href: "/knowledge-bases/search",
    icon: Search,
    description: "Search your knowledge base",
  },
  {
    id: "graph",
    label: "Graph",
    href: "/knowledge-bases/graph",
    icon: GitFork,
    description: "Explore entity relationships",
    requiresGraphRag: true,
  },
];

export function KnowledgeSidebar({ collapsed, onCollapse, graphRagEnabled }: KnowledgeSidebarProps) {
  const pathname = usePathname();

  const getActiveTab = () => {
    if (pathname?.includes("/ingest")) return "ingest";
    if (pathname?.includes("/search")) return "search";
    if (pathname?.includes("/graph")) return "graph";
    return "ingest";
  };

  const activeTab = getActiveTab();

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 280 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full bg-card/50 backdrop-blur-sm border-r border-border/50 shrink-0 overflow-hidden"
    >
      {/* Collapse Toggle */}
      <div className="flex items-center justify-end p-2 h-12">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapse(!collapsed)}
          className="h-8 w-8 hover:bg-muted"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Knowledge Base Info */}
      {!collapsed && (
        <div 
          className="mx-3 mb-4 relative overflow-hidden rounded-xl border border-primary/20 p-4"
          style={{
            background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 20%, transparent), color-mix(in srgb, var(--gradient-to) 15%, transparent), transparent)`
          }}
        >
          <div className="relative">
            <div className="w-10 h-10 mb-3 rounded-xl gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/30">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <p className="text-sm font-semibold gradient-text">Knowledge Bases</p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Manage your data sources, search content, and explore relationships.
            </p>
          </div>
        </div>
      )}

      {/* Navigation Items */}
      <div className="flex-1 px-2">
        {!collapsed && (
          <div className="px-1 py-2 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
            <span>Navigation</span>
          </div>
        )}

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isDisabled = item.requiresGraphRag && !graphRagEnabled;

            if (isDisabled) {
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg cursor-not-allowed opacity-50",
                    collapsed && "justify-center"
                  )}
                  title="Graph RAG is disabled"
                >
                  <div className={cn(
                    "shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-muted"
                  )}>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground/70 truncate">
                        {item.description}
                      </p>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                prefetch={true}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg transition-all",
                  isActive
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/50 border border-transparent",
                  collapsed && "justify-center"
                )}
              >
                <div className={cn(
                  "shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
                  isActive
                    ? "bg-primary/20"
                    : "bg-muted"
                )}>
                  <Icon className={cn(
                    "h-4 w-4",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                  )} />
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-sm font-medium",
                      isActive ? "text-primary" : "text-foreground"
                    )}>
                      {item.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.description}
                    </p>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Auth Status at bottom */}
      <div className={cn(
        "border-t border-border/50",
        collapsed ? "p-2 flex justify-center" : "p-3"
      )}>
        {!collapsed && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">RAG Status</span>
            <RagAuthIndicator />
          </div>
        )}
        {collapsed && (
          <RagAuthIndicator compact />
        )}
      </div>
    </motion.div>
  );
}

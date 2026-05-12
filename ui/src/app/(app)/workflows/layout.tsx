"use client";

import React, { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { WorkflowSidebar } from "@/components/workflows/WorkflowSidebar";

/**
 * Workflows layout — renders the WorkflowSidebar (tabbed: Workflows + Runs)
 * and content area side by side, mimicking the chat layout.
 *
 * Routes:
 *   /workflows           → page.tsx (editor or landing)
 *   /workflows/run/[id]  → run timeline
 */
export default function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <AuthGuard>
      <div className="flex-1 flex overflow-hidden">
        <WorkflowSidebar
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </AuthGuard>
  );
}

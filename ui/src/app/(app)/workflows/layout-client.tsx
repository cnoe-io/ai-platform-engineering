"use client";

import React, { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { WorkflowSidebar } from "@/components/workflows/WorkflowSidebar";

/**
 * Client-side workflows layout — manages sidebar collapse state.
 */
export function WorkflowsLayoutClient({
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

import { config } from "@/lib/config";
import React from "react";
import { WorkflowsLayoutClient } from "./layout-client";

/**
 * Workflows layout (server component) — gates access via WORKFLOWS_ENABLED env var.
 * If disabled, renders a "feature not enabled" page. Otherwise delegates to the
 * client layout which manages sidebar state.
 */
export default function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!config.workflowsEnabled) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6 max-w-md">
          <div className="text-4xl mb-4 opacity-30">&#128679;</div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Workflows not enabled
          </h2>
          <p className="text-sm text-muted-foreground">
            The Workflows feature is not enabled on this instance.
            Set <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">WORKFLOWS_ENABLED=true</code> to activate it.
          </p>
        </div>
      </div>
    );
  }

  return <WorkflowsLayoutClient>{children}</WorkflowsLayoutClient>;
}

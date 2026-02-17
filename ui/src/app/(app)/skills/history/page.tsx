"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowHistoryView } from "@/components/agent-builder/WorkflowHistoryView";
import { AuthGuard } from "@/components/auth-guard";
import type { WorkflowRun } from "@/types/workflow-run";

/**
 * Dedicated Workflow Run History Page
 * 
 * Shows all workflow runs across all workflows for the current user.
 * Provides full-page view with better visibility than the slide-in panel.
 */
export default function WorkflowHistoryPage() {
  const router = useRouter();

  const handleReRun = (run: WorkflowRun) => {
    // Navigate to agent builder with the workflow ID
    // The agent-builder page will need to handle the runWorkflow query param
    router.push(`/skills?workflow=${run.workflow_id}&autorun=true`);
  };

  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 pb-4 border-b border-border shrink-0">
          {/* Navigation buttons */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => router.push('/')}
            title="Go to home page"
          >
            <LayoutGrid className="h-5 w-5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => router.push('/skills')}
            title="Back to Skills"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          {/* Title */}
          <div>
            <h1 className="text-2xl font-bold">Skills Run History</h1>
            <p className="text-sm text-muted-foreground">
              View and manage all your skill executions
            </p>
          </div>
        </div>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 overflow-y-auto p-6"
        >
          <WorkflowHistoryView
            onReRun={handleReRun}
          />
        </motion.div>
      </div>
    </AuthGuard>
  );
}

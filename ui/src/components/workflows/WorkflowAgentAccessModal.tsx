"use client";

import React, { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentAccessGap } from "@/app/api/workflow-configs/check-agent-access/route";

interface WorkflowAgentAccessModalProps {
  gaps: AgentAccessGap[];
  onGrantAndSave: () => Promise<void>;
  onCancel: () => void;
}

export function WorkflowAgentAccessModal({
  gaps,
  onGrantAndSave,
  onCancel,
}: WorkflowAgentAccessModalProps) {
  const [isGranting, setIsGranting] = useState(false);

  const handleGrant = async () => {
    setIsGranting(true);
    try {
      await onGrantAndSave();
    } finally {
      setIsGranting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Agent access required
          </DialogTitle>
          <DialogDescription>
            The following agents are not accessible to all teams this workflow is shared with.
            Grant access to let those teams run this workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 max-h-64 overflow-y-auto">
          {gaps.map((gap) => (
            <div key={gap.agentId} className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">{gap.agentName}</p>
              <p className="text-muted-foreground mt-0.5">
                Not accessible to:{" "}
                <span className="font-mono">{gap.teamsWithoutAccess.join(", ")}</span>
              </p>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isGranting}>
            Cancel
          </Button>
          <Button onClick={handleGrant} disabled={isGranting} className="gap-2">
            <ShieldCheck className="h-4 w-4" />
            {isGranting ? "Granting access…" : "Grant access and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

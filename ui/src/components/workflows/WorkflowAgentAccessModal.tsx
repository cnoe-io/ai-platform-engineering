"use client";

import React, { useState } from "react";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
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
  visibility: "private" | "team" | "global";
  onGrantAndSave: () => Promise<void>;
  onSaveAsPrivate: () => Promise<void>;
  onCancel: () => void;
}

export function WorkflowAgentAccessModal({
  gaps,
  visibility,
  onGrantAndSave,
  onSaveAsPrivate,
  onCancel,
}: WorkflowAgentAccessModalProps) {
  const [isGranting, setIsGranting] = useState(false);
  const [isSavingPrivate, setIsSavingPrivate] = useState(false);
  const busy = isGranting || isSavingPrivate;

  const handleGrant = async () => {
    setIsGranting(true);
    try {
      await onGrantAndSave();
    } finally {
      setIsGranting(false);
    }
  };

  const handleSaveAsPrivate = async () => {
    setIsSavingPrivate(true);
    try {
      await onSaveAsPrivate();
    } finally {
      setIsSavingPrivate(false);
    }
  };

  const sharingLabel =
    visibility === "global"
      ? "everyone in the organization"
      : "the teams this workflow is shared with";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Agent access required
          </DialogTitle>
          <DialogDescription>
            To share this workflow with {sharingLabel}, each step agent must be accessible
            to those users. Granting that access requires manage permission on each agent.
            If you only need a personal workflow, save as private instead.
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

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={handleGrant} disabled={busy} className="gap-2 w-full sm:w-auto">
            <ShieldCheck className="h-4 w-4" />
            {isGranting ? "Granting access…" : "Grant access and save"}
          </Button>
          <Button
            variant="secondary"
            onClick={handleSaveAsPrivate}
            disabled={busy}
            className="gap-2 w-full sm:w-auto"
          >
            <Lock className="h-4 w-4" />
            {isSavingPrivate ? "Saving…" : "Save as private instead"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy} className="w-full sm:w-auto">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

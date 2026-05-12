"use client";

import React, { useMemo } from "react";
import { Workflow } from "lucide-react";
import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";
import { useWorkflowConfigStore } from "@/store/workflow-config-store";
import type { WorkflowStep } from "@/types/workflow-config";

export default function WorkflowsPage() {
  const { configs, editMode, selectedConfigId, closeEditor, loadConfigs } =
    useWorkflowConfigStore();

  const selectedConfig = useMemo(
    () => (selectedConfigId ? configs.find((c) => c._id === selectedConfigId) : undefined),
    [configs, selectedConfigId]
  );

  const handleBack = () => {
    closeEditor();
    loadConfigs();
  };

  // Clone: pre-populate from the selected config
  const cloneProps = useMemo(() => {
    if (editMode !== "clone" || !selectedConfig) return {};
    return {
      initialName: `${selectedConfig.name} (Copy)`,
      initialDescription: selectedConfig.description || undefined,
      initialSteps: selectedConfig.steps
        .filter((s): s is WorkflowStep => s.type === "step")
        .map((s) => ({ ...s })),
    };
  }, [editMode, selectedConfig]);

  // Editor mode
  if (editMode === "edit" && selectedConfig) {
    return (
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas key={selectedConfig._id} existingConfig={selectedConfig} onBack={handleBack} />
      </div>
    );
  }

  if (editMode === "clone") {
    return (
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas
          key={`clone-${selectedConfigId}`}
          {...cloneProps}
          onBack={handleBack}
        />
      </div>
    );
  }

  if (editMode === "new") {
    return (
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas key="new" onBack={handleBack} />
      </div>
    );
  }

  // Landing state — no config selected
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <Workflow className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-muted-foreground mb-1">
          Workflows
        </h2>
        <p className="text-sm text-muted-foreground/70">
          Select a workflow to edit or a run to view
        </p>
      </div>
    </div>
  );
}

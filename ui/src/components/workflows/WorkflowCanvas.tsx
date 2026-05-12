"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Panel,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  WorkflowStepNode,
  AddButtonNode,
  type WorkflowStepNodeData,
  type AddButtonNodeData,
} from "./WorkflowStepNode";
import { WorkflowStepSidebar } from "./WorkflowStepSidebar";
import { WorkflowToolbar } from "./WorkflowToolbar";
import type {
  WorkflowConfig,
  WorkflowStep,
  CreateWorkflowConfigInput,
  UpdateWorkflowConfigInput,
} from "@/types/workflow-config";
import { createBlankStep } from "@/types/workflow-config";
import { useWorkflowConfigStore } from "@/store/workflow-config-store";
import { useWorkflowExecStore } from "@/store/workflow-exec-store";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { useToast } from "@/components/ui/toast";
import type { AgentAvatarAgent } from "@/components/dynamic-agents/AgentAvatar";

// ---------------------------------------------------------------------------
// Node types — defined outside component to avoid re-renders
// ---------------------------------------------------------------------------

const nodeTypes = {
  workflowStep: WorkflowStepNode,
  addButton: AddButtonNode,
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_X = 300;
const NODE_WIDTH = 220; // matches w-[220px] in WorkflowStepNode
const NODE_CENTER_X = NODE_X + NODE_WIDTH / 2; // 410
const NODE_VERTICAL_GAP = 140;
const ADD_BUTTON_Y_OFFSET = 80; // position of "+" button below the step node
const ADD_BUTTON_APPEND_SIZE = 28; // w-7
const ADD_BUTTON_INSERT_SIZE = 20; // w-5

// ---------------------------------------------------------------------------
// Agent fetching hook
// ---------------------------------------------------------------------------

interface DAOption {
  value: string;
  label: string;
}

interface AgentInfo extends DAOption {
  description?: string;
  ui?: AgentAvatarAgent["ui"];
}

function useDynamicAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dynamic-agents/available");
        if (!res.ok) throw new Error("Failed to fetch agents");
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        if (!cancelled) {
          setAgents(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            list.map((a: any) => ({
              value: a._id || a.id,
              label: a.name || a._id || a.id,
              description: a.description || undefined,
              ui: a.ui || null,
            })),
          );
        }
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { agents, loading };
}

// ---------------------------------------------------------------------------
// Build nodes & edges from steps (pure functions, no callbacks in data)
// ---------------------------------------------------------------------------

function buildNodes(steps: WorkflowStep[], agents: AgentInfo[]): Node[] {
  const nodes: Node[] = [];
  const agentMap = new Map(agents.map((a) => [a.value, a]));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentInfo = agentMap.get(step.agent_id);
    const yPos = i * NODE_VERTICAL_GAP;

    nodes.push({
      id: `step-${i}`,
      type: "workflowStep",
      position: { x: NODE_X, y: yPos },
      draggable: false,
      data: {
        stepIndex: i,
        display_text: step.display_text,
        agent_id: step.agent_id,
        prompt: step.prompt,
        on_error: step.on_error,
        agent: agentInfo ? { name: agentInfo.label, ui: agentInfo.ui } : null,
      } satisfies WorkflowStepNodeData,
    });

    // "+" button after each step
    const isLastStep = i === steps.length - 1;
    const btnSize = isLastStep ? ADD_BUTTON_APPEND_SIZE : ADD_BUTTON_INSERT_SIZE;
    nodes.push({
      id: `add-${i}`,
      type: "addButton",
      position: { x: NODE_CENTER_X - btnSize / 2, y: yPos + ADD_BUTTON_Y_OFFSET },
      selectable: false,
      draggable: false,
      data: {
        insertIndex: i + 1,
        variant: isLastStep ? "append" : "insert",
        onAdd: () => {},
      } satisfies AddButtonNodeData,
    });
  }

  // If no steps, show a single "+" button
  if (steps.length === 0) {
    nodes.push({
      id: "add-initial",
      type: "addButton",
      position: { x: NODE_CENTER_X - ADD_BUTTON_APPEND_SIZE / 2, y: 0 },
      selectable: false,
      draggable: false,
      data: {
        insertIndex: 0,
        variant: "append",
        onAdd: () => {},
      } satisfies AddButtonNodeData,
    });
  }

  return nodes;
}

function buildEdges(steps: WorkflowStep[]): Edge[] {
  return steps.slice(0, -1).map((_, i) => ({
    id: `edge-${i}-${i + 1}`,
    source: `step-${i}`,
    target: `step-${i + 1}`,
    type: "default",
    animated: true,
    style: {
      stroke: "hsl(var(--primary))",
      strokeWidth: 2,
      strokeDasharray: "5 5",
    },
  }));
}

// ---------------------------------------------------------------------------
// Canvas controls
// ---------------------------------------------------------------------------

function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btnClass =
    "w-8 h-8 flex items-center justify-center rounded-md text-primary hover:bg-primary/15 hover:text-primary transition-colors";

  return (
    <Panel position="bottom-left">
      <div className="flex flex-col gap-0.5 bg-card border border-border rounded-lg p-1 shadow-lg">
        <button onClick={() => zoomIn()} className={btnClass} title="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button onClick={() => zoomOut()} className={btnClass} title="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div className="h-px bg-border my-0.5" />
        <button onClick={() => fitView({ padding: 0.3 })} className={btnClass} title="Fit view">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkflowCanvasProps {
  existingConfig?: WorkflowConfig;
  initialName?: string;
  initialDescription?: string;
  initialSteps?: WorkflowStep[];
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({
  existingConfig,
  initialName,
  initialDescription,
  initialSteps,
  onBack,
}: WorkflowCanvasProps) {
  const { createConfig, updateConfig, deleteConfig, closeEditor, loadConfigs } = useWorkflowConfigStore();
  const { executeWorkflow } = useWorkflowExecStore();
  const { setUnsaved, pendingNavigationHref, cancelNavigation, confirmNavigation } =
    useUnsavedChangesStore();
  const { agents, loading: agentsLoading } = useDynamicAgents();
  const router = useRouter();
  const { toast } = useToast();

  // -----------------------------------------------------------------------
  // Steps = source of truth
  // -----------------------------------------------------------------------

  const seedSteps = useMemo(() => {
    if (existingConfig) {
      return existingConfig.steps.filter((s): s is WorkflowStep => s.type === "step");
    }
    return initialSteps && initialSteps.length > 0 ? initialSteps : [];
  }, [existingConfig, initialSteps]);

  const [steps, setSteps] = useState<WorkflowStep[]>(seedSteps);
  const [name, setName] = useState(existingConfig?.name || initialName || "");
  const [description, setDescription] = useState(
    existingConfig?.description || initialDescription || "",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number>(-1);

  const isDirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    isDirtyRef.current = true;
    setUnsaved(true);
  }, [setUnsaved]);

  // -----------------------------------------------------------------------
  // Derive nodes & edges from steps + agents (reactive, no stale closures)
  // -----------------------------------------------------------------------

  const nodes = useMemo(() => buildNodes(steps, agents), [steps, agents]);
  const edges = useMemo(() => buildEdges(steps), [steps]);

  // -----------------------------------------------------------------------
  // Node click handler — handles both step selection and "+" button clicks
  // -----------------------------------------------------------------------

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "addButton") {
        const insertIndex = (node.data as unknown as AddButtonNodeData).insertIndex;
        markDirty();
        const newStep = createBlankStep();
        setSteps((prev) => {
          const next = [...prev];
          next.splice(insertIndex, 0, newStep);
          return next;
        });
        // Select the newly inserted step
        setSelectedStepIndex(insertIndex);
      } else if (node.type === "workflowStep") {
        const d = node.data as unknown as WorkflowStepNodeData;
        setSelectedStepIndex(d.stepIndex);
      }
    },
    [markDirty],
  );

  // Clicking on the canvas background deselects
  const onPaneClick = useCallback(() => {
    setSelectedStepIndex(-1);
  }, []);

  // -----------------------------------------------------------------------
  // Selected step
  // -----------------------------------------------------------------------

  const selectedStep = selectedStepIndex >= 0 && selectedStepIndex < steps.length
    ? steps[selectedStepIndex]
    : null;

  // -----------------------------------------------------------------------
  // Step mutations (called from sidebar)
  // -----------------------------------------------------------------------

  const handleStepChange = useCallback(
    (updates: Partial<WorkflowStep>) => {
      if (selectedStepIndex < 0) return;
      markDirty();
      setSteps((prev) =>
        prev.map((s, i) => (i === selectedStepIndex ? { ...s, ...updates } : s)),
      );
    },
    [selectedStepIndex, markDirty],
  );

  const handleDeleteStep = useCallback(
    (stepIndex: number) => {
      markDirty();
      setSteps((prev) => prev.filter((_, i) => i !== stepIndex));
      if (selectedStepIndex === stepIndex) setSelectedStepIndex(-1);
      else if (selectedStepIndex > stepIndex) setSelectedStepIndex((i) => i - 1);
    },
    [selectedStepIndex, markDirty],
  );

  // Expose delete to node via a ref so it's always fresh
  const deleteStepRef = useRef(handleDeleteStep);
  deleteStepRef.current = handleDeleteStep;

  // -----------------------------------------------------------------------
  // Unsaved changes & navigation guards
  // -----------------------------------------------------------------------

  useEffect(() => {
    return () => setUnsaved(false);
  }, [setUnsaved]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (pendingNavigationHref && isDirtyRef.current) {
      setShowUnsavedDialog(true);
      pendingActionRef.current = () => {
        const href = confirmNavigation();
        if (href) {
          setUnsaved(false);
          isDirtyRef.current = false;
          window.location.href = href;
        }
      };
    }
  }, [pendingNavigationHref, confirmNavigation, setUnsaved]);

  const guardAction = useCallback((action: () => void) => {
    if (isDirtyRef.current) {
      pendingActionRef.current = action;
      setShowUnsavedDialog(true);
    } else {
      action();
    }
  }, []);

  const handleBack = useCallback(() => {
    guardAction(onBack);
  }, [onBack, guardAction]);

  const handleNameChange = useCallback(
    (v: string) => { markDirty(); setName(v); },
    [markDirty],
  );

  const handleDescriptionChange = useCallback(
    (v: string) => { markDirty(); setDescription(v); },
    [markDirty],
  );

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!name || steps.length === 0) return;
    setIsSaving(true);

    try {
      if (existingConfig) {
        const updates: UpdateWorkflowConfigInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          steps,
        };
        await updateConfig(existingConfig._id, updates);
      } else {
        const input: CreateWorkflowConfigInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          steps,
        };
        await createConfig(input);
      }
      isDirtyRef.current = false;
      setUnsaved(false);
      toast("Workflow saved", "success");
    } catch (error) {
      console.error("Failed to save workflow config:", error);
      toast("Failed to save workflow", "error");
    } finally {
      setIsSaving(false);
    }
  }, [name, description, steps, existingConfig, createConfig, updateConfig, setUnsaved, toast]);

  // -----------------------------------------------------------------------
  // Run workflow
  // -----------------------------------------------------------------------

  const handleRun = useCallback(async () => {
    if (!existingConfig) return;
    try {
      const runId = await executeWorkflow(existingConfig._id);
      isDirtyRef.current = false;
      setUnsaved(false);
      closeEditor();
      // Navigate directly to the new run
      router.push(`/workflows/run/${runId}`);
    } catch (error) {
      console.error("Failed to execute workflow:", error);
    }
  }, [existingConfig, executeWorkflow, setUnsaved, closeEditor, router]);

  // -----------------------------------------------------------------------
  // Delete workflow
  // -----------------------------------------------------------------------

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!existingConfig) return;
    try {
      await deleteConfig(existingConfig._id);
      isDirtyRef.current = false;
      setUnsaved(false);
      closeEditor();
      loadConfigs();
    } catch (error) {
      console.error("Failed to delete workflow:", error);
    } finally {
      setShowDeleteDialog(false);
    }
  }, [existingConfig, deleteConfig, setUnsaved, closeEditor, loadConfigs]);

  // -----------------------------------------------------------------------
  // Export / Import workflow JSON
  // -----------------------------------------------------------------------

  const handleExport = useCallback(() => {
    const config = {
      name,
      description: description || undefined,
      steps,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [name, description, steps]);

  const handleImport = useCallback(
    (parsed: unknown) => {
      if (!parsed || typeof parsed !== "object") return;
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.name === "string") setName(obj.name);
      if (typeof obj.description === "string") setDescription(obj.description);
      if (Array.isArray(obj.steps)) {
        setSteps(obj.steps as WorkflowStep[]);
      }
      markDirty();
    },
    [markDirty],
  );

  // Agent objects for the sidebar (with _id, name, description, ui)
  const sidebarAgents = useMemo(
    () => agents.map((a) => ({ _id: a.value, name: a.label, description: a.description, ui: a.ui })),
    [agents],
  );

  // -----------------------------------------------------------------------
  // Unsaved changes dialog handlers
  // -----------------------------------------------------------------------

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedDialog(false);
    isDirtyRef.current = false;
    setUnsaved(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
    cancelNavigation();
  }, [setUnsaved, cancelNavigation]);

  const handleCancelDialog = useCallback(() => {
    setShowUnsavedDialog(false);
    pendingActionRef.current = null;
    cancelNavigation();
  }, [cancelNavigation]);

  // -----------------------------------------------------------------------
  // Mark selected node visually
  // -----------------------------------------------------------------------

  const nodesWithSelection = useMemo(() => {
    if (selectedStepIndex < 0) return nodes;
    const selectedId = `step-${selectedStepIndex}`;
    return nodes.map((n) =>
      n.id === selectedId ? { ...n, selected: true } : { ...n, selected: false },
    );
  }, [nodes, selectedStepIndex]);

  return (
    <div className="flex flex-col h-full">
      <WorkflowToolbar
        name={name}
        description={description}
        onNameChange={handleNameChange}
        onDescriptionChange={handleDescriptionChange}
        onSave={handleSave}
        onBack={handleBack}
        onRun={handleRun}
        onDelete={handleDelete}
        onExport={handleExport}
        onImport={handleImport}
        isSaving={isSaving}
        isEditing={!!existingConfig}
        stepCount={steps.length}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodesWithSelection}
            edges={edges}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.5, maxZoom: 1.5 }}
            className="bg-background"
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <CanvasControls />
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="hsl(var(--muted-foreground) / 0.15)"
            />
          </ReactFlow>
        </div>

        <WorkflowStepSidebar
          step={selectedStep}
          stepIndex={selectedStepIndex}
          onChange={handleStepChange}
          onDelete={handleDeleteStep}
          onAddStep={() => {
            markDirty();
            const newStep = createBlankStep();
            setSteps((prev) => [...prev, newStep]);
            setSelectedStepIndex(0);
          }}
          agents={sidebarAgents}
          agentsLoading={agentsLoading}
          totalSteps={steps.length}
        />
      </div>

      {/* Unsaved changes dialog */}
      {showUnsavedDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 shadow-xl max-w-sm mx-4">
            <h3 className="text-sm font-bold text-foreground mb-2">Unsaved changes</h3>
            <p className="text-sm text-muted-foreground mb-4">
              You have unsaved changes. Discard them?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDialog}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDiscardChanges}
                className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 shadow-xl max-w-sm mx-4">
            <h3 className="text-sm font-bold text-foreground mb-2">Delete workflow</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete &ldquo;{name}&rdquo;? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

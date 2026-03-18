"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Panel,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TaskStepNode, type TaskStepNodeData } from "./TaskStepNode";
import { TaskBuilderSidebar } from "./TaskBuilderSidebar";
import { TaskBuilderToolbar } from "./TaskBuilderToolbar";
import { StepPalette } from "./StepPalette";
import { ImportDialog } from "./ImportDialog";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { YamlPreviewDialog } from "./YamlPreviewDialog";
import type {
  TaskStep,
  TaskConfig,
  CreateTaskConfigInput,
  StepTemplate,
} from "@/types/task-config";
import { toTaskConfigYamlFormat, extractFileIO, extractEnvVars } from "@/types/task-config";
import { useTaskConfigStore } from "@/store/task-config-store";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import yaml from "js-yaml";

const nodeTypes = { taskStep: TaskStepNode };

const NODE_VERTICAL_GAP = 140;
const NODE_X_LEFT = 150;
const NODE_X_RIGHT = 450;

function stepsToNodes(steps: TaskStep[], onDelete: (id: string) => void): Node[] {
  return steps.map((step, i) => ({
    id: `step-${i}`,
    type: "taskStep",
    position: {
      x: i % 2 === 0 ? NODE_X_LEFT : NODE_X_RIGHT,
      y: i * NODE_VERTICAL_GAP,
    },
    data: {
      stepIndex: i,
      display_text: step.display_text,
      llm_prompt: step.llm_prompt,
      subagent: step.subagent,
      onDelete,
    } satisfies TaskStepNodeData,
  }));
}

function stepsToEdges(steps: TaskStep[]): Edge[] {
  return steps.slice(0, -1).map((_, i) => {
    const writerIO = extractFileIO(steps[i].llm_prompt || "");
    const readerIO = extractFileIO(steps[i + 1].llm_prompt || "");
    const sharedFiles = writerIO.writes.filter((f) => readerIO.reads.includes(f));
    const isDataFlow = sharedFiles.length > 0;

    return {
      id: `edge-${i}-${i + 1}`,
      source: `step-${i}`,
      target: `step-${i + 1}`,
      type: "default",
      animated: true,
      label: isDataFlow ? sharedFiles.join(", ") : undefined,
      labelStyle: { fontSize: 9, fill: "hsl(var(--muted-foreground))" },
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      style: {
        stroke: isDataFlow ? "#10b981" : "hsl(var(--primary))",
        strokeWidth: isDataFlow ? 2.5 : 2,
        strokeDasharray: isDataFlow ? undefined : "5 5",
      },
    };
  });
}

function nodesToSteps(nodes: Node[]): TaskStep[] {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  return sorted.map((n) => {
    const d = n.data as unknown as TaskStepNodeData;
    return {
      display_text: d.display_text,
      llm_prompt: d.llm_prompt,
      subagent: d.subagent,
    };
  });
}

function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btnClass =
    "w-8 h-8 flex items-center justify-center rounded-md text-primary hover:bg-primary/15 hover:text-primary transition-colors";

  return (
    <Panel position="bottom-left">
      <div className="flex flex-col gap-0.5 bg-card border border-border rounded-lg p-1 shadow-lg">
        <button onClick={() => zoomIn()} className={btnClass} title="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button onClick={() => zoomOut()} className={btnClass} title="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <div className="h-px bg-border my-0.5" />
        <button onClick={() => fitView({ padding: 0.3 })} className={btnClass} title="Fit view">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
      </div>
    </Panel>
  );
}

interface TaskBuilderCanvasProps {
  existingConfig?: TaskConfig;
  initialSteps?: TaskStep[];
  initialName?: string;
  initialCategory?: string;
  onBack: () => void;
}

export function TaskBuilderCanvas(props: TaskBuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <TaskBuilderCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function TaskBuilderCanvasInner({
  existingConfig,
  initialSteps,
  initialName,
  initialCategory,
  onBack,
}: TaskBuilderCanvasProps) {
  const reactFlowInstance = useReactFlow();
  const { configs, createConfig, updateConfig } = useTaskConfigStore();
  const { setUnsaved, pendingNavigationHref, cancelNavigation, confirmNavigation } =
    useUnsavedChangesStore();

  const [name, setName] = useState(existingConfig?.name || initialName || "");
  const [category, setCategory] = useState(existingConfig?.category || initialCategory || "Custom");
  const [description, setDescription] = useState(existingConfig?.description || "");
  const [allowedTools, setAllowedTools] = useState<string[] | undefined>(
    existingConfig?.metadata?.allowed_tools
  );
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [previewYaml, setPreviewYaml] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const isDirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    isDirtyRef.current = true;
    setUnsaved(true);
  }, [setUnsaved]);

  // Clear global unsaved state on unmount
  useEffect(() => {
    return () => setUnsaved(false);
  }, [setUnsaved]);

  // Browser beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Handle pending navigation from header tabs
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

  const guardAction = useCallback(
    (action: () => void) => {
      if (isDirtyRef.current) {
        pendingActionRef.current = action;
        setShowUnsavedDialog(true);
      } else {
        action();
      }
    },
    []
  );

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

  const handleBack = useCallback(() => {
    guardAction(onBack);
  }, [onBack, guardAction]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    markDirty();
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId, markDirty]);

  const seedSteps = existingConfig?.tasks || initialSteps || [];
  const [nodes, setNodes, onNodesChange] = useNodesState(
    stepsToNodes(seedSteps, handleDeleteNode)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(stepsToEdges(seedSteps));

  const currentSteps = useMemo(() => nodesToSteps(nodes), [nodes]);
  const envVarCount = useMemo(() => extractEnvVars(currentSteps).length, [currentSteps]);

  const rebuildEdges = useCallback(
    (updatedNodes: Node[]) => {
      const steps = [...updatedNodes]
        .sort((a, b) => a.position.y - b.position.y)
        .map((n) => {
          const d = n.data as unknown as TaskStepNodeData;
          return { display_text: d.display_text, llm_prompt: d.llm_prompt, subagent: d.subagent };
        });

      const sortedIds = [...updatedNodes]
        .sort((a, b) => a.position.y - b.position.y)
        .map((n) => n.id);

      const newEdges: Edge[] = sortedIds.slice(0, -1).map((srcId, i) => {
        const writerIO = extractFileIO(steps[i].llm_prompt || "");
        const readerIO = extractFileIO(steps[i + 1].llm_prompt || "");
        const sharedFiles = writerIO.writes.filter((f) => readerIO.reads.includes(f));
        const isDataFlow = sharedFiles.length > 0;

        return {
          id: `edge-${srcId}-${sortedIds[i + 1]}`,
          source: srcId,
          target: sortedIds[i + 1],
          animated: true,
          label: isDataFlow ? sharedFiles.join(", ") : undefined,
          labelStyle: { fontSize: 9, fill: "hsl(var(--muted-foreground))" },
          labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke: isDataFlow ? "#10b981" : "hsl(var(--primary))",
            strokeWidth: isDataFlow ? 2.5 : 2,
            strokeDasharray: isDataFlow ? undefined : "5 5",
          },
        };
      });
      setEdges(newEdges);
    },
    [setEdges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      markDirty();
      setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } }, eds));
    },
    [setEdges, markDirty]
  );

  const onSelectionChange = useCallback(({ nodes: selected }: OnSelectionChangeParams) => {
    setSelectedNodeId(selected.length === 1 ? selected[0].id : null);
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const selectedStep: TaskStep | null = selectedNode
    ? {
        display_text: (selectedNode.data as unknown as TaskStepNodeData).display_text,
        llm_prompt: (selectedNode.data as unknown as TaskStepNodeData).llm_prompt,
        subagent: (selectedNode.data as unknown as TaskStepNodeData).subagent,
      }
    : null;

  const selectedStepIndex = selectedNode
    ? (selectedNode.data as unknown as TaskStepNodeData).stepIndex
    : -1;

  const handleStepChange = useCallback(
    (updates: Partial<TaskStep>) => {
      if (!selectedNodeId) return;
      markDirty();
      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          return { ...n, data: { ...n.data, ...updates } };
        });
        rebuildEdges(updated);
        return updated;
      });
    },
    [selectedNodeId, setNodes, rebuildEdges, markDirty]
  );

  const addNodeFromStep = useCallback(
    (step: TaskStep) => {
      markDirty();
      const newIndex = nodes.length;
      const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
      const yPos = lastNode ? lastNode.position.y + NODE_VERTICAL_GAP : 0;
      const xPos = newIndex % 2 === 0 ? NODE_X_LEFT : NODE_X_RIGHT;

      const newNode: Node = {
        id: `step-${Date.now()}`,
        type: "taskStep",
        position: { x: xPos, y: yPos },
        data: {
          stepIndex: newIndex,
          display_text: step.display_text,
          llm_prompt: step.llm_prompt,
          subagent: step.subagent,
          onDelete: handleDeleteNode,
        } satisfies TaskStepNodeData,
      };

      setNodes((nds) => {
        const next = [...nds, newNode];
        rebuildEdges(next);
        return next;
      });
    },
    [nodes, setNodes, handleDeleteNode, rebuildEdges, markDirty]
  );

  const handleAddStep = useCallback(() => {
    addNodeFromStep({ display_text: "", llm_prompt: "", subagent: "user_input" });
  }, [addNodeFromStep]);

  const handleAddTemplate = useCallback(
    (template: StepTemplate) => {
      addNodeFromStep({
        display_text: template.display_text,
        llm_prompt: template.llm_prompt,
        subagent: template.subagent,
      });
    },
    [addNodeFromStep]
  );

  const addNodeAtPosition = useCallback(
    (step: TaskStep, position: { x: number; y: number }) => {
      markDirty();
      const newIndex = nodes.length;

      const newNode: Node = {
        id: `step-${Date.now()}`,
        type: "taskStep",
        position,
        data: {
          stepIndex: newIndex,
          display_text: step.display_text,
          llm_prompt: step.llm_prompt,
          subagent: step.subagent,
          onDelete: handleDeleteNode,
        } satisfies TaskStepNodeData,
      };

      setNodes((nds) => {
        const next = [...nds, newNode];
        rebuildEdges(next);
        return next;
      });
    },
    [nodes, setNodes, handleDeleteNode, rebuildEdges, markDirty]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/step-template");
      if (!raw) return;

      try {
        const template: StepTemplate = JSON.parse(raw);
        const position = reactFlowInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        addNodeAtPosition(
          {
            display_text: template.display_text,
            llm_prompt: template.llm_prompt,
            subagent: template.subagent,
          },
          position
        );
      } catch {
        /* ignore malformed drag data */
      }
    },
    [reactFlowInstance, addNodeAtPosition]
  );

  const handleNameChange = useCallback((v: string) => { markDirty(); setName(v); }, [markDirty]);
  const handleCategoryChange = useCallback((v: string) => { markDirty(); setCategory(v); }, [markDirty]);
  const handleDescriptionChange = useCallback((v: string) => { markDirty(); setDescription(v); }, [markDirty]);

  const handleSave = useCallback(async () => {
    if (!name || nodes.length === 0) return;
    setIsSaving(true);

    try {
      const steps = nodesToSteps(nodes);
      const input: CreateTaskConfigInput = {
        name,
        category,
        description: description || undefined,
        tasks: steps,
        visibility: "global",
        metadata: {
          ...(allowedTools && allowedTools.length > 0 ? { allowed_tools: allowedTools } : {}),
        },
      };

      if (existingConfig) {
        await updateConfig(existingConfig.id, input);
      } else {
        await createConfig(input);
      }
      isDirtyRef.current = false;
      setUnsaved(false);
      onBack();
    } catch (error) {
      console.error("Failed to save task config:", error);
    } finally {
      setIsSaving(false);
    }
  }, [name, category, description, nodes, existingConfig, createConfig, updateConfig, onBack, allowedTools]);

  const buildYamlString = useCallback(() => {
    const steps = nodesToSteps(nodes);
    const yamlObj = toTaskConfigYamlFormat([
      {
        id: "",
        name,
        category,
        tasks: steps,
        owner_id: "",
        is_system: false,
        visibility: "global",
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    return yaml.dump(yamlObj, { lineWidth: 120, noRefs: true, quotingType: '"' });
  }, [name, category, nodes]);

  const handleExportYaml = useCallback(() => {
    const yamlStr = buildYamlString();
    const blob = new Blob([yamlStr], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "task_config"}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [name, buildYamlString]);

  const handlePreview = useCallback(() => {
    setPreviewYaml(buildYamlString());
  }, [buildYamlString]);

  const handleLoadConfig = useCallback(
    (config: TaskConfig) => {
      markDirty();
      setName(config.name);
      setCategory(config.category);
      setDescription(config.description || "");
      const newNodes = stepsToNodes(config.tasks, handleDeleteNode);
      setNodes(newNodes);
      setEdges(stepsToEdges(config.tasks));
      requestAnimationFrame(() => reactFlowInstance.fitView({ padding: 0.3 }));
    },
    [setNodes, setEdges, handleDeleteNode, markDirty, reactFlowInstance]
  );

  const handleImportSteps = useCallback(
    (importName: string, importCategory: string, steps: TaskStep[]) => {
      markDirty();
      setName(importName);
      setCategory(importCategory);
      const newNodes = stepsToNodes(steps, handleDeleteNode);
      setNodes(newNodes);
      setEdges(stepsToEdges(steps));
      requestAnimationFrame(() => reactFlowInstance.fitView({ padding: 0.3 }));
    },
    [setNodes, setEdges, handleDeleteNode, markDirty, reactFlowInstance]
  );

  return (
    <div className="flex flex-col h-full">
      <TaskBuilderToolbar
        name={name}
        category={category}
        description={description}
        onNameChange={handleNameChange}
        onCategoryChange={handleCategoryChange}
        onDescriptionChange={handleDescriptionChange}
        onAddStep={handleAddStep}
        onSave={handleSave}
        onExportYaml={handleExportYaml}
        onPreview={handlePreview}
        onBack={handleBack}
        onImport={() => setImportOpen(true)}
        isSaving={isSaving}
        isEditing={!!existingConfig}
        stepCount={nodes.length}
        envVarCount={envVarCount}
      />

      <div className="flex flex-1 overflow-hidden">
        <StepPalette onAddTemplate={handleAddTemplate} />

        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            className="bg-background"
          >
            <CanvasControls />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
          </ReactFlow>
        </div>

        <TaskBuilderSidebar
          step={selectedStep}
          stepIndex={selectedStepIndex}
          onChange={handleStepChange}
          allSteps={currentSteps}
          isSystemWorkflow={existingConfig?.is_system ?? false}
          allowedTools={allowedTools}
          onAllowedToolsChange={(tools) => { markDirty(); setAllowedTools(tools); }}
        />
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        savedConfigs={configs}
        onLoadConfig={handleLoadConfig}
        onImportSteps={handleImportSteps}
      />

      {previewYaml !== null && (
        <YamlPreviewDialog
          yaml={previewYaml}
          filename={`${name || "task_config"}.yaml`}
          onClose={() => setPreviewYaml(null)}
          onDownload={handleExportYaml}
        />
      )}

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onDiscard={handleDiscardChanges}
        onCancel={handleCancelDialog}
      />
    </div>
  );
}

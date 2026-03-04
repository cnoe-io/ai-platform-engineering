"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
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
import type { TaskStep, TaskConfig, CreateTaskConfigInput } from "@/types/task-config";
import { toTaskConfigYamlFormat } from "@/types/task-config";
import { useTaskConfigStore } from "@/store/task-config-store";

const nodeTypes = { taskStep: TaskStepNode };

function stepsToNodes(steps: TaskStep[], onDelete: (id: string) => void): Node[] {
  return steps.map((step, i) => ({
    id: `step-${i}`,
    type: "taskStep",
    position: { x: 250, y: i * 160 },
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
  return steps.slice(0, -1).map((_, i) => ({
    id: `edge-${i}-${i + 1}`,
    source: `step-${i}`,
    target: `step-${i + 1}`,
    animated: true,
    style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  }));
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

interface TaskBuilderCanvasProps {
  existingConfig?: TaskConfig;
  onBack: () => void;
}

export function TaskBuilderCanvas({ existingConfig, onBack }: TaskBuilderCanvasProps) {
  const { createConfig, updateConfig } = useTaskConfigStore();

  const [name, setName] = useState(existingConfig?.name || "");
  const [category, setCategory] = useState(existingConfig?.category || "Custom");
  const [description, setDescription] = useState(existingConfig?.description || "");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const initialSteps = existingConfig?.tasks || [];
  const [nodes, setNodes, onNodesChange] = useNodesState(
    stepsToNodes(initialSteps, handleDeleteNode)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(stepsToEdges(initialSteps));

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } }, eds));
    },
    [setEdges]
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
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          return {
            ...n,
            data: { ...n.data, ...updates },
          };
        })
      );
    },
    [selectedNodeId, setNodes]
  );

  const handleAddStep = useCallback(() => {
    const newIndex = nodes.length;
    const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
    const yPos = lastNode ? lastNode.position.y + 160 : 0;

    const newNode: Node = {
      id: `step-${newIndex}`,
      type: "taskStep",
      position: { x: 250, y: yPos },
      data: {
        stepIndex: newIndex,
        display_text: "",
        llm_prompt: "",
        subagent: "caipe",
        onDelete: handleDeleteNode,
      } satisfies TaskStepNodeData,
    };

    setNodes((nds) => [...nds, newNode]);

    if (nodes.length > 0) {
      const lastId = nodes[nodes.length - 1].id;
      setEdges((eds) => [
        ...eds,
        {
          id: `edge-${lastId}-${newNode.id}`,
          source: lastId,
          target: newNode.id,
          animated: true,
          style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
        },
      ]);
    }
  }, [nodes, setNodes, setEdges, handleDeleteNode]);

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
      };

      if (existingConfig) {
        await updateConfig(existingConfig.id, input);
      } else {
        await createConfig(input);
      }
      onBack();
    } catch (error) {
      console.error("Failed to save task config:", error);
    } finally {
      setIsSaving(false);
    }
  }, [name, category, description, nodes, existingConfig, createConfig, updateConfig, onBack]);

  const handleExportYaml = useCallback(() => {
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

    const blob = new Blob([JSON.stringify(yamlObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "task-config"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [name, category, nodes]);

  return (
    <div className="flex flex-col h-full">
      <TaskBuilderToolbar
        name={name}
        category={category}
        description={description}
        onNameChange={setName}
        onCategoryChange={setCategory}
        onDescriptionChange={setDescription}
        onAddStep={handleAddStep}
        onSave={handleSave}
        onExportYaml={handleExportYaml}
        onBack={onBack}
        isSaving={isSaving}
        isEditing={!!existingConfig}
        stepCount={nodes.length}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            className="bg-background"
          >
            <Controls position="bottom-left" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
          </ReactFlow>
        </div>

        <TaskBuilderSidebar
          step={selectedStep}
          stepIndex={selectedStepIndex}
          onChange={handleStepChange}
        />
      </div>
    </div>
  );
}

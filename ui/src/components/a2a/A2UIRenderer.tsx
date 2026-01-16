"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WidgetCatalog } from "./widgets";
import { Widget, WidgetAction } from "@/types/a2a";

// A2UI Protocol Types
interface A2UISurfaceUpdate {
  surfaceId: string;
  components: A2UIComponent[];
}

interface A2UIComponent {
  id: string;
  component: Record<string, unknown>;
  position?: { x: number; y: number };
}

interface A2UIDataModelUpdate {
  contents: Record<string, unknown>;
}

interface A2UIMessage {
  surfaceUpdate?: A2UISurfaceUpdate;
  dataModelUpdate?: A2UIDataModelUpdate;
  beginRendering?: { surfaceId: string };
  deleteSurface?: { surfaceId: string };
}

interface A2UIRendererProps {
  messages: A2UIMessage[];
  onAction?: (action: WidgetAction) => void;
}

// Convert A2UI component to Widget type
function a2uiToWidget(component: A2UIComponent): Widget | null {
  const { id, component: spec } = component;

  // Detect component type from A2UI spec
  if ("Button" in spec) {
    const btn = spec.Button as {
      child?: { Text?: { text?: { literalString?: string } } };
      action?: { name: string; context?: Record<string, unknown> };
    };
    return {
      id,
      type: "button",
      props: {
        label: btn.child?.Text?.text?.literalString || "Button",
      },
      actions: btn.action ? [{ name: btn.action.name, context: btn.action.context }] : [],
    };
  }

  if ("Text" in spec) {
    const text = spec.Text as { text?: { literalString?: string }; usageHint?: string };
    return {
      id,
      type: "card",
      props: {
        content: text.text?.literalString || "",
        variant: text.usageHint === "h1" ? "default" : "default",
      },
    };
  }

  if ("Form" in spec) {
    const form = spec.Form as {
      title?: string;
      fields?: Array<{
        name: string;
        label: string;
        type: string;
        required?: boolean;
      }>;
      submitAction?: { name: string; context?: Record<string, unknown> };
    };
    return {
      id,
      type: "form",
      props: {
        title: form.title,
        fields: form.fields || [],
      },
      actions: form.submitAction
        ? [{ name: form.submitAction.name, context: form.submitAction.context }]
        : [],
    };
  }

  if ("List" in spec) {
    const list = spec.List as {
      title?: string;
      items?: Array<{ id: string; text: string; status?: string }>;
      ordered?: boolean;
    };
    return {
      id,
      type: "list",
      props: {
        title: list.title,
        items: list.items || [],
        ordered: list.ordered,
      },
    };
  }

  if ("Table" in spec) {
    const table = spec.Table as {
      title?: string;
      headers?: string[];
      rows?: string[][];
    };
    return {
      id,
      type: "table",
      props: {
        title: table.title,
        headers: table.headers || [],
        rows: table.rows || [],
      },
    };
  }

  if ("Progress" in spec) {
    const progress = spec.Progress as {
      value?: number;
      max?: number;
      label?: string;
    };
    return {
      id,
      type: "progress",
      props: {
        value: progress.value || 0,
        max: progress.max || 100,
        label: progress.label,
      },
    };
  }

  if ("Select" in spec) {
    const select = spec.Select as {
      label?: string;
      options?: Array<{ value: string; label: string }>;
      action?: { name: string; context?: Record<string, unknown> };
    };
    return {
      id,
      type: "select",
      props: {
        label: select.label,
        options: select.options || [],
      },
      actions: select.action ? [{ name: select.action.name, context: select.action.context }] : [],
    };
  }

  if ("Input" in spec) {
    const input = spec.Input as {
      label?: string;
      placeholder?: string;
      type?: string;
      required?: boolean;
      action?: { name: string; context?: Record<string, unknown> };
    };
    return {
      id,
      type: "input",
      props: {
        label: input.label,
        placeholder: input.placeholder,
        type: input.type || "text",
        required: input.required,
      },
      actions: input.action ? [{ name: input.action.name, context: input.action.context }] : [],
    };
  }

  // Unknown component type
  console.warn("Unknown A2UI component type:", Object.keys(spec)[0]);
  return null;
}

export function A2UIRenderer({ messages, onAction }: A2UIRendererProps) {
  const [surfaces, setSurfaces] = useState<Map<string, A2UIComponent[]>>(new Map());
  const [dataModel, setDataModel] = useState<Record<string, unknown>>({});
  const [activeSurface, setActiveSurface] = useState<string | null>(null);

  useEffect(() => {
    for (const msg of messages) {
      if (msg.surfaceUpdate) {
        const { surfaceId, components } = msg.surfaceUpdate;
        setSurfaces((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(surfaceId) || [];
          // Merge or replace components
          const merged = [...existing];
          for (const comp of components) {
            const idx = merged.findIndex((c) => c.id === comp.id);
            if (idx >= 0) {
              merged[idx] = comp;
            } else {
              merged.push(comp);
            }
          }
          updated.set(surfaceId, merged);
          return updated;
        });
        setActiveSurface(surfaceId);
      }

      if (msg.dataModelUpdate) {
        setDataModel((prev) => ({ ...prev, ...msg.dataModelUpdate!.contents }));
      }

      if (msg.beginRendering) {
        setActiveSurface(msg.beginRendering.surfaceId);
      }

      if (msg.deleteSurface) {
        setSurfaces((prev) => {
          const updated = new Map(prev);
          updated.delete(msg.deleteSurface!.surfaceId);
          return updated;
        });
      }
    }
  }, [messages]);

  // Convert A2UI components to widgets
  const widgets: Widget[] = [];
  if (activeSurface) {
    const components = surfaces.get(activeSurface) || [];
    for (const comp of components) {
      const widget = a2uiToWidget(comp);
      if (widget) {
        widgets.push(widget);
      }
    }
  }

  if (widgets.length === 0) {
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeSurface}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="a2ui-surface"
      >
        <WidgetCatalog widgets={widgets} onAction={onAction} />
      </motion.div>
    </AnimatePresence>
  );
}

// Export data model for components that need reactive updates
export function useA2UIDataModel() {
  const [dataModel, setDataModel] = useState<Record<string, unknown>>({});

  const updateDataModel = (updates: Record<string, unknown>) => {
    setDataModel((prev) => ({ ...prev, ...updates }));
  };

  return { dataModel, updateDataModel };
}

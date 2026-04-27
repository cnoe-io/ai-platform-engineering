"use client";

import React, { useState, useEffect, useCallback, startTransition } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type CaipeFormField,
  parseCaipeFields,
  generateCaipePrompt,
} from "@/types/task-config";

interface CaipeFormBuilderProps {
  prompt: string;
  onChange: (prompt: string) => void;
}

const EMPTY_FIELD: CaipeFormField = {
  name: "",
  required: true,
  description: "",
  default_value: undefined,
  field_values: undefined,
  auto_filled: false,
};

export function CaipeFormBuilder({ prompt, onChange }: CaipeFormBuilderProps) {
  const [fields, setFields] = useState<CaipeFormField[]>(() => {
    const parsed = parseCaipeFields(prompt);
    return parsed.length > 0 ? parsed : [{ ...EMPTY_FIELD }];
  });
  const [outputFile, setOutputFile] = useState(() => {
    const m = prompt.match(/[Ww]rite\s+(?:.*?\s+)?(?:to\s+)?(\/[\w./-]+)/);
    return m ? m[1] : "/request.txt";
  });

  useEffect(() => {
    const parsed = parseCaipeFields(prompt);
    if (parsed.length > 0) {
      startTransition(() => {
        setFields(parsed);
      });
    }
  }, [prompt]);

  const syncPrompt = useCallback(
    (updated: CaipeFormField[], file: string) => {
      onChange(generateCaipePrompt(updated, file));
    },
    [onChange]
  );

  const updateField = (idx: number, patch: Partial<CaipeFormField>) => {
    setFields((prev) => {
      const next = prev.map((f, i) => (i === idx ? { ...f, ...patch } : f));
      syncPrompt(next, outputFile);
      return next;
    });
  };

  const addField = () => {
    setFields((prev) => {
      const next = [...prev, { ...EMPTY_FIELD }];
      syncPrompt(next, outputFile);
      return next;
    });
  };

  const removeField = (idx: number) => {
    setFields((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      syncPrompt(next, outputFile);
      return next;
    });
  };

  const handleOutputChange = (file: string) => {
    setOutputFile(file);
    syncPrompt(fields, file);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold">Form Fields</Label>
        <Button variant="ghost" size="sm" onClick={addField} className="h-6 gap-1 text-xs px-2">
          <Plus className="h-3 w-3" />
          Field
        </Button>
      </div>

      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-border bg-background/50 p-2.5 space-y-2"
          >
            <div className="flex items-center gap-1.5">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
              <Input
                value={field.name}
                onChange={(e) =>
                  updateField(idx, { name: e.target.value.replace(/\s/g, "_") })
                }
                placeholder="field_name"
                className="h-7 text-xs font-mono flex-1"
              />
              <button
                onClick={() =>
                  updateField(idx, { required: !field.required })
                }
                className={cn(
                  "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 transition-colors",
                  field.required
                    ? "bg-red-500/15 text-red-400 border border-red-500/20"
                    : "bg-muted text-muted-foreground border border-border"
                )}
              >
                {field.required ? "req" : "opt"}
              </button>
              <button
                onClick={() => removeField(idx)}
                className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <Input
              value={field.description}
              onChange={(e) => updateField(idx, { description: e.target.value })}
              placeholder="Description"
              className="h-7 text-xs"
            />
            <div className="flex gap-1.5">
              <Input
                value={field.default_value || ""}
                onChange={(e) =>
                  updateField(idx, { default_value: e.target.value || undefined })
                }
                placeholder="Default value"
                className="h-7 text-xs flex-1"
              />
              <Input
                value={field.field_values?.join(", ") || ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  updateField(idx, {
                    field_values: raw
                      ? raw.split(",").map((s) => s.trim())
                      : undefined,
                  });
                }}
                placeholder="Options (comma-sep)"
                className="h-7 text-xs flex-1"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground">
          Output File Path
        </Label>
        <Input
          value={outputFile}
          onChange={(e) => handleOutputChange(e.target.value)}
          placeholder="/request.txt"
          className="h-7 text-xs font-mono"
        />
      </div>
    </div>
  );
}

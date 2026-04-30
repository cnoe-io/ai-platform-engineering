"use client";

/**
 * VariablesTab — manage the skill's input variables (name/label/required/
 * placeholder). Variables are surfaced to runtime callers as form fields
 * and (per the SkillMdEditor lint) any `{{var}}` reference in the SKILL.md
 * body that doesn't match a declared variable is flagged as a warning.
 *
 * The on-disk shape (`SkillInputVariable`) is intentionally minimal —
 * `name`, `label`, `required`, optional `placeholder`. We derive a list
 * of "missing" variables by scanning SKILL.md for `{{name}}` references
 * that aren't declared, so the user can promote them with one click.
 */

import React, { useCallback, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  extractPromptVariables,
  type SkillInputVariable,
} from "@/types/agent-skill";
import type { UseSkillFormResult } from "@/components/skills/workspace/use-skill-form";

export interface VariablesTabProps {
  form: UseSkillFormResult;
}

export function VariablesTab({ form }: VariablesTabProps) {
  const { inputVariables, setInputVariables, skillContent } = form;

  const referencedNames = useMemo(
    () => new Set(extractPromptVariables(skillContent).map((v) => v.name)),
    [skillContent],
  );
  const declaredNames = useMemo(
    () => new Set(inputVariables.map((v) => v.name)),
    [inputVariables],
  );
  const missingNames = useMemo(
    () => Array.from(referencedNames).filter((n) => !declaredNames.has(n)),
    [referencedNames, declaredNames],
  );

  const addVariable = useCallback(
    (name?: string) => {
      const next: SkillInputVariable = {
        name: name || `variable_${inputVariables.length + 1}`,
        label: name
          ? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          : `Variable ${inputVariables.length + 1}`,
        required: true,
      };
      setInputVariables([...inputVariables, next]);
    },
    [inputVariables, setInputVariables],
  );

  const updateVariable = useCallback(
    (index: number, patch: Partial<SkillInputVariable>) => {
      setInputVariables(
        inputVariables.map((v, i) => (i === index ? { ...v, ...patch } : v)),
      );
    },
    [inputVariables, setInputVariables],
  );

  const removeVariable = useCallback(
    (index: number) => {
      setInputVariables(inputVariables.filter((_, i) => i !== index));
    },
    [inputVariables, setInputVariables],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Input variables</h2>
          <p className="text-xs text-muted-foreground">
            Variables are referenced as <code>{`{{name}}`}</code> in SKILL.md
            and prompted at runtime.
          </p>
        </div>
        <Button size="sm" onClick={() => addVariable()}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add variable
        </Button>
      </div>

      {missingNames.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <div className="font-medium mb-1">
            {missingNames.length} variable
            {missingNames.length === 1 ? "" : "s"} referenced in SKILL.md but
            not declared:
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {missingNames.map((n) => (
              <Badge
                key={n}
                variant="outline"
                className="text-[10px] cursor-pointer hover:bg-amber-500/20"
                onClick={() => addVariable(n)}
              >
                + {n}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {inputVariables.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No variables yet. Click <strong>Add variable</strong> or reference{" "}
          <code>{`{{example}}`}</code> in SKILL.md and we&apos;ll suggest it.
        </div>
      ) : (
        <div className="space-y-2">
          {inputVariables.map((v, i) => {
            const isReferenced = referencedNames.has(v.name);
            return (
              <div
                key={`${v.name}-${i}`}
                className={cn(
                  "rounded-md border bg-background p-3 space-y-2",
                  isReferenced
                    ? "border-border/60"
                    : "border-amber-500/30 bg-amber-500/5",
                )}
                data-testid={`variable-row-${i}`}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      Name (matches <code>{`{{name}}`}</code>)
                    </label>
                    <Input
                      aria-label={`variable-${i}-name`}
                      value={v.name}
                      onChange={(e) =>
                        updateVariable(i, { name: e.target.value })
                      }
                      placeholder="variable_name"
                      className="h-8 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      Label (shown to user)
                    </label>
                    <Input
                      aria-label={`variable-${i}-label`}
                      value={v.label}
                      onChange={(e) =>
                        updateVariable(i, { label: e.target.value })
                      }
                      placeholder="Friendly label"
                      className="h-8 text-sm"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 mt-4"
                    onClick={() => removeVariable(i)}
                    aria-label={`Remove ${v.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={v.required}
                      onChange={(e) =>
                        updateVariable(i, { required: e.target.checked })
                      }
                      className="accent-primary"
                    />
                    Required
                  </label>
                  <Input
                    aria-label={`variable-${i}-placeholder`}
                    value={v.placeholder ?? ""}
                    onChange={(e) =>
                      updateVariable(i, { placeholder: e.target.value })
                    }
                    placeholder="Placeholder shown in the input"
                    className="h-7 flex-1 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

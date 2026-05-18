"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Send, AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Platform Engineer Input Field (from A2A response)
export interface InputField {
  field_name: string;
  field_label?: string;
  field_description?: string;
  field_type?: "text" | "select" | "multiselect" | "boolean" | "number" | "url" | "email";
  field_values?: string[] | null;
  placeholder?: string;
  required?: boolean;
  default_value?: string;
}

export interface UserInputMetadata {
  user_input?: boolean;
  input_title?: string;
  input_description?: string;
  input_fields?: InputField[];
  response?: string;
}

interface MetadataInputFormProps {
  messageId: string;
  title?: string;
  description?: string;
  inputFields: InputField[];
  onSubmit: (data: Record<string, string>) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function MetadataInputForm({
  messageId,
  title = "Additional Input Required",
  description,
  inputFields,
  onSubmit,
  onCancel,
  disabled = false,
}: MetadataInputFormProps) {
  // Initialize form data with default values
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    inputFields.forEach((field) => {
      if (field.default_value) {
        initial[field.field_name] = field.default_value;
      }
    });
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per-field: when true, show checkboxes (multi-select); when false, show dropdown (default)
  const [multiselectMode, setMultiselectMode] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    inputFields.forEach((field) => {
      if (field.field_values && field.field_values.length > 0) {
        initial[field.field_name] = field.field_type === "multiselect";
      }
    });
    return initial;
  });

  const setMultiselectForField = useCallback((fieldName: string, enabled: boolean) => {
    setMultiselectMode((prev) => ({ ...prev, [fieldName]: enabled }));
    setFormData((prev) => {
      const current = prev[fieldName] || "";
      if (enabled) {
        return { ...prev, [fieldName]: current }; // keep current (single or comma-separated)
      }
      // Switching to dropdown: use first value if comma-separated
      const first = current.split(",").map((s) => s.trim()).filter(Boolean)[0];
      return { ...prev, [fieldName]: first || "" };
    });
  }, []);

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    // Clear error when user types
    if (errors[fieldName]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  }, [errors]);

  /** Toggle one value in a comma-separated multiselect field. */
  const handleMultiselectToggle = useCallback(
    (fieldName: string, value: string) => {
      setFormData((prev) => {
        const current = prev[fieldName] || "";
        const selected = current ? current.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const idx = selected.indexOf(value);
        const next = idx === -1 ? [...selected, value] : selected.filter((_, i) => i !== idx);
        return { ...prev, [fieldName]: next.join(", ") };
      });
      if (errors[fieldName]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[fieldName];
          return newErrors;
        });
      }
    },
    [errors]
  );

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};

    inputFields.forEach((field) => {
      if (field.required !== false && !formData[field.field_name]?.trim()) {
        newErrors[field.field_name] = "This field is required";
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [inputFields, formData]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, onSubmit, validateForm]);

  const useCompactGrid = inputFields.length >= 7;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 w-full max-w-lg rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
    >
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-medium text-amber-400">
          {title}
        </span>
      </div>

      {/* Description */}
      {description && (
        <p className="mb-3 text-xs leading-snug text-muted-foreground">{description}</p>
      )}

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "grid gap-3",
          useCompactGrid ? "md:grid-cols-2" : "grid-cols-1"
        )}
      >
        {inputFields.map((field, idx) => {
          const fieldType = field.field_type || "text";
          const fieldLabel = field.field_label || field.field_name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const hasOptions = field.field_values && field.field_values.length > 0;
          const isMultiselect = hasOptions && multiselectMode[field.field_name];

          return (
            <div key={field.field_name} className="min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-medium text-foreground">
                  {fieldLabel}
                  {field.required !== false && <span className="text-red-400 ml-1">*</span>}
                </label>
                {hasOptions && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                    <input
                      type="checkbox"
                      checked={!!multiselectMode[field.field_name]}
                      onChange={(e) => setMultiselectForField(field.field_name, e.target.checked)}
                      disabled={disabled || isSubmitting}
                      className="h-3 w-3 rounded border-border text-primary focus:ring-2 focus:ring-primary/50"
                    />
                    <span>Allow multiple</span>
                  </label>
                )}
              </div>

              {field.field_description && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {field.field_description}
                </p>
              )}

              {/* Multi-select: checkboxes, value stored as comma-separated */}
              {isMultiselect ? (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border bg-background px-2.5 py-2">
                  {field.field_values!.map((value) => {
                    const selected = (formData[field.field_name] || "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const checked = selected.includes(value);
                    return (
                      <label
                        key={value}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded px-2 py-1 -mx-2 hover:bg-muted/50",
                          (disabled || isSubmitting) && "opacity-60 cursor-not-allowed"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleMultiselectToggle(field.field_name, value)}
                          disabled={disabled || isSubmitting}
                          className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-2 focus:ring-primary/50"
                        />
                        <span className="text-xs text-foreground">{value}</span>
                      </label>
                    );
                  })}
                </div>
              ) : hasOptions ? (
                <div className="relative">
                  <select
                    value={formData[field.field_name] || ""}
                    onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                    disabled={disabled || isSubmitting}
                    className={cn(
                      "h-8 w-full appearance-none rounded-md px-2.5 py-1.5 pr-7 text-xs",
                      "bg-background border transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-primary/50",
                      errors[field.field_name]
                        ? "border-red-500"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <option value="">Select an option...</option>
                    {field.field_values!.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              ) : fieldType === "boolean" ? (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={formData[field.field_name] === "Yes" || formData[field.field_name] === "true"}
                    onClick={() => {
                      const currentValue = formData[field.field_name];
                      const newValue = (currentValue === "Yes" || currentValue === "true") ? "No" : "Yes";
                      handleFieldChange(field.field_name, newValue);
                    }}
                    disabled={disabled || isSubmitting}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-primary/50",
                      (formData[field.field_name] === "Yes" || formData[field.field_name] === "true")
                        ? "bg-primary"
                        : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                        (formData[field.field_name] === "Yes" || formData[field.field_name] === "true")
                          ? "translate-x-5"
                          : "translate-x-1"
                      )}
                    />
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {(formData[field.field_name] === "Yes" || formData[field.field_name] === "true") ? "Yes" : "No"}
                  </span>
                </div>
              ) : (
                <input
                  type={fieldType === "number" ? "number" : fieldType === "email" ? "email" : fieldType === "url" ? "url" : "text"}
                  value={formData[field.field_name] || ""}
                  onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                  placeholder={field.placeholder || `Enter ${fieldLabel.toLowerCase()}...`}
                  disabled={disabled || isSubmitting}
                  autoFocus={idx === 0}
                  className={cn(
                    "h-8 w-full rounded-md px-2.5 py-1.5 text-xs",
                    "bg-background border transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50",
                    errors[field.field_name]
                      ? "border-red-500"
                      : "border-border hover:border-primary/50"
                  )}
                />
              )}

              {/* Error message */}
              {errors[field.field_name] && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[11px] text-red-400"
                >
                  {errors[field.field_name]}
                </motion.p>
              )}
            </div>
          );
        })}

        {/* Submit button */}
        <div className={cn("flex justify-end gap-2 pt-1", useCompactGrid && "md:col-span-2")}>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isSubmitting}
              className="h-8 px-3 text-xs"
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={disabled || isSubmitting}
            className="h-8 gap-2 px-3 text-xs"
          >
            {isSubmitting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white"
              />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Submit
          </Button>
        </div>
      </form>
    </motion.div>
  );
}

/**
 * Check if a message requires user input based on its content
 * Looks for patterns like: require_user_input: true, UserInputMetaData artifact, etc.
 */
export function parseUserInputRequest(content: string): UserInputMetadata | null {
  // Check for UserInputMetaData artifact pattern
  const userInputMatch = content.match(/UserInputMetaData|require_user_input|input_fields/i);
  if (!userInputMatch) return null;

  // Try to parse JSON from the content
  try {
    // Look for JSON-like structure
    const jsonMatch = content.match(/\{[\s\S]*"input_fields"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.input_fields) {
        return {
          user_input: true,
          input_fields: parsed.input_fields,
        };
      }
    }
  } catch {
    // If JSON parsing fails, try pattern matching
  }

  // Fallback: Look for field patterns in text
  const fieldPattern = /(\w+):\s*(?:\[([^\]]+)\]|(.+?)(?:\n|$))/g;
  const fields: InputField[] = [];
  let match;

  while ((match = fieldPattern.exec(content)) !== null) {
    const fieldName = match[1];
    const fieldValues = match[2]
      ? match[2].split(",").map((v) => v.trim().replace(/['"]/g, ""))
      : null;
    const description = match[3] || "";

    if (fieldName && !["messageId", "role", "content"].includes(fieldName)) {
      fields.push({
        field_name: fieldName,
        field_description: description,
        field_values: fieldValues,
      });
    }
  }

  if (fields.length > 0) {
    return {
      user_input: true,
      input_fields: fields,
    };
  }

  return null;
}

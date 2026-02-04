"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Send, AlertCircle, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Platform Engineer Input Field (from A2A response)
export interface InputField {
  field_name: string;
  field_description: string;
  field_values?: string[] | null;
}

export interface UserInputMetadata {
  user_input?: boolean;
  input_fields?: InputField[];
}

interface MetadataInputFormProps {
  messageId: string;
  inputFields: InputField[];
  onSubmit: (data: Record<string, string>) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function MetadataInputForm({
  messageId,
  inputFields,
  onSubmit,
  onCancel,
  disabled = false,
}: MetadataInputFormProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};

    inputFields.forEach((field) => {
      if (!formData[field.field_name]?.trim()) {
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-amber-400">
            Additional Input Required
          </span>
        </div>
        {onCancel && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onCancel}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {inputFields.map((field, idx) => (
          <div key={field.field_name} className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              {field.field_name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </label>

            {field.field_description && (
              <p className="text-xs text-muted-foreground">
                {field.field_description}
              </p>
            )}

            {/* Render select if field_values provided, otherwise text input */}
            {field.field_values && field.field_values.length > 0 ? (
              <div className="relative">
                <select
                  value={formData[field.field_name] || ""}
                  onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                  disabled={disabled || isSubmitting}
                  className={cn(
                    "w-full px-3 py-2 pr-8 rounded-lg text-sm appearance-none",
                    "bg-background border transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50",
                    errors[field.field_name]
                      ? "border-red-500"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <option value="">Select an option...</option>
                  {field.field_values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            ) : (
              <input
                type="text"
                value={formData[field.field_name] || ""}
                onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                placeholder={`Enter ${field.field_name.replace(/_/g, " ")}...`}
                disabled={disabled || isSubmitting}
                autoFocus={idx === 0}
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-sm",
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
                className="text-xs text-red-400"
              >
                {errors[field.field_name]}
              </motion.p>
            )}
          </div>
        ))}

        {/* Submit button */}
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={disabled || isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full"
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

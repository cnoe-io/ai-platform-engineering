"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { AlertCircle,ChevronDown,Send } from "lucide-react";
import React,{ useCallback,useEffect,useMemo,useRef,useState } from "react";

// Dynamic agent input field metadata.
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
  conversationId?: string;
  title?: string;
  description?: string;
  inputFields: InputField[];
  onSubmit: (data: Record<string, string>) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

const USER_INPUT_DRAFT_STORAGE_PREFIX = "caipe.metadata-input-form-draft.v1";

interface UserInputDraft {
  formData?: Record<string, string>;
  multiselectMode?: Record<string, boolean>;
}

function getDefaultFormData(inputFields: InputField[]): Record<string, string> {
  const initial: Record<string, string> = {};
  inputFields.forEach((field) => {
    if (field.default_value !== undefined) {
      initial[field.field_name] = field.default_value;
    }
  });
  return initial;
}

function getDefaultMultiselectMode(inputFields: InputField[]): Record<string, boolean> {
  const initial: Record<string, boolean> = {};
  inputFields.forEach((field) => {
    if (field.field_values && field.field_values.length > 0) {
      initial[field.field_name] = field.field_type === "multiselect";
    }
  });
  return initial;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function getInputFieldsSignature(inputFields: InputField[]): string {
  return hashString(JSON.stringify(inputFields.map((field) => ({
    field_name: field.field_name,
    field_label: field.field_label,
    field_type: field.field_type,
    field_values: field.field_values,
    required: field.required,
    default_value: field.default_value,
  }))));
}

function getDraftCacheKey(messageId: string, conversationId: string | undefined, inputFieldsSignature: string): string {
  return [
    USER_INPUT_DRAFT_STORAGE_PREFIX,
    encodeURIComponent(conversationId || "unknown-conversation"),
    encodeURIComponent(messageId),
    inputFieldsSignature,
  ].join(":");
}

function getStoredUserInputDraft(cacheKey: string, inputFields: InputField[]): {
  formData: Record<string, string>;
  multiselectMode: Record<string, boolean>;
} {
  const formData = getDefaultFormData(inputFields);
  const multiselectMode = getDefaultMultiselectMode(inputFields);

  if (typeof window === "undefined") {
    return { formData, multiselectMode };
  }

  try {
    const stored = window.localStorage.getItem(cacheKey);
    if (!stored) {
      return { formData, multiselectMode };
    }

    const parsed = JSON.parse(stored) as UserInputDraft;
    const fieldNames = new Set(inputFields.map((field) => field.field_name));

    if (parsed.formData && typeof parsed.formData === "object") {
      Object.entries(parsed.formData).forEach(([fieldName, value]) => {
        if (fieldNames.has(fieldName) && value !== undefined && value !== null) {
          formData[fieldName] = String(value);
        }
      });
    }

    if (parsed.multiselectMode && typeof parsed.multiselectMode === "object") {
      Object.entries(parsed.multiselectMode).forEach(([fieldName, value]) => {
        if (fieldNames.has(fieldName)) {
          multiselectMode[fieldName] = Boolean(value);
        }
      });
    }
  } catch {
    // Ignore malformed or unavailable browser storage and fall back to defaults.
  }

  return { formData, multiselectMode };
}

function saveUserInputDraft(
  cacheKey: string,
  inputFields: InputField[],
  formData: Record<string, string>,
  multiselectMode: Record<string, boolean>
) {
  if (typeof window === "undefined") return;

  try {
    const fieldNames = new Set(inputFields.map((field) => field.field_name));
    const defaultFormData = getDefaultFormData(inputFields);
    const defaultMultiselectMode = getDefaultMultiselectMode(inputFields);
    const filteredFormData = Object.fromEntries(
      Object.entries(formData).filter(([fieldName]) => fieldNames.has(fieldName))
    );
    const filteredMultiselectMode = Object.fromEntries(
      Object.entries(multiselectMode).filter(([fieldName]) => fieldNames.has(fieldName))
    );
    const hasChanges = inputFields.some((field) => {
      const fieldName = field.field_name;
      const currentValue = filteredFormData[fieldName] || "";
      const defaultValue = defaultFormData[fieldName] || "";
      const currentMultiselectMode = Boolean(filteredMultiselectMode[fieldName]);
      const defaultFieldMultiselectMode = Boolean(defaultMultiselectMode[fieldName]);

      return currentValue !== defaultValue || currentMultiselectMode !== defaultFieldMultiselectMode;
    });

    if (!hasChanges) {
      window.localStorage.removeItem(cacheKey);
      return;
    }

    window.localStorage.setItem(cacheKey, JSON.stringify({
      formData: filteredFormData,
      multiselectMode: filteredMultiselectMode,
      updatedAt: Date.now(),
    }));
  } catch {
    // Best-effort draft persistence; storage failures should not block form use.
  }
}

function clearUserInputDraft(cacheKey: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(cacheKey);
  } catch {
    // Best-effort cleanup.
  }
}

export function MetadataInputForm({
  messageId,
  conversationId,
  title = "Additional Input Required",
  description,
  inputFields,
  onSubmit,
  onCancel,
  disabled = false,
}: MetadataInputFormProps) {
  const inputFieldsSignature = useMemo(() => getInputFieldsSignature(inputFields), [inputFields]);
  const draftCacheKey = useMemo(
    () => getDraftCacheKey(messageId, conversationId, inputFieldsSignature),
    [conversationId, inputFieldsSignature, messageId]
  );
  const draftInputFieldsRef = useRef({ signature: inputFieldsSignature, inputFields });
  if (draftInputFieldsRef.current.signature !== inputFieldsSignature) {
    draftInputFieldsRef.current = { signature: inputFieldsSignature, inputFields };
  }

  // Initialize with defaults, then restore any browser draft after mount.
  const [formData, setFormData] = useState<Record<string, string>>(() => getDefaultFormData(inputFields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per-field: when true, show checkboxes (multi-select); when false, show dropdown (default)
  const [multiselectMode, setMultiselectMode] = useState<Record<string, boolean>>(() => getDefaultMultiselectMode(inputFields));
  const skipNextDraftPersistRef = useRef(true);

  useEffect(() => {
    skipNextDraftPersistRef.current = true;

    const nextDraft = getStoredUserInputDraft(draftCacheKey, draftInputFieldsRef.current.inputFields);
    setFormData(nextDraft.formData);
    setMultiselectMode(nextDraft.multiselectMode);
    setErrors({});
  }, [draftCacheKey]);

  useEffect(() => {
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }

    saveUserInputDraft(draftCacheKey, draftInputFieldsRef.current.inputFields, formData, multiselectMode);
  }, [draftCacheKey, formData, multiselectMode]);

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
    clearUserInputDraft(draftCacheKey);
    try {
      await onSubmit(formData);
    } catch (error) {
      saveUserInputDraft(draftCacheKey, draftInputFieldsRef.current.inputFields, formData, multiselectMode);
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }, [draftCacheKey, formData, multiselectMode, onSubmit, validateForm]);

  const handleCancel = useCallback(() => {
    clearUserInputDraft(draftCacheKey);
    onCancel?.();
  }, [draftCacheKey, onCancel]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-amber-400">
          {title}
        </span>
      </div>

      {/* Description */}
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {inputFields.map((field, idx) => {
          const fieldType = field.field_type || "text";
          const fieldLabel = field.field_label || field.field_name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const hasOptions = field.field_values && field.field_values.length > 0;
          const isMultiselect = hasOptions && multiselectMode[field.field_name];

          return (
            <div key={field.field_name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-sm font-medium text-foreground">
                  {fieldLabel}
                  {field.required !== false && <span className="text-red-400 ml-1">*</span>}
                </label>
                {hasOptions && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    <input
                      type="checkbox"
                      checked={!!multiselectMode[field.field_name]}
                      onChange={(e) => setMultiselectForField(field.field_name, e.target.checked)}
                      disabled={disabled || isSubmitting}
                      className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-2 focus:ring-primary/50"
                    />
                    <span>Allow multiple</span>
                  </label>
                )}
              </div>

              {field.field_description && (
                <p className="text-xs text-muted-foreground">
                  {field.field_description}
                </p>
              )}

              {/* Multi-select: checkboxes, value stored as comma-separated */}
              {isMultiselect ? (
                <div className="space-y-2 rounded-lg border border-border bg-background px-3 py-2.5">
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
                          "flex items-center gap-3 cursor-pointer rounded py-1.5 px-2 -mx-2 hover:bg-muted/50",
                          (disabled || isSubmitting) && "opacity-60 cursor-not-allowed"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleMultiselectToggle(field.field_name, value)}
                          disabled={disabled || isSubmitting}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/50"
                        />
                        <span className="text-sm text-foreground">{value}</span>
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
                      "w-full px-3 py-2 pr-8 rounded-lg text-sm appearance-none",
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
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              ) : fieldType === "boolean" ? (
                <div className="flex items-center gap-3 pt-1">
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
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-primary/50",
                      (formData[field.field_name] === "Yes" || formData[field.field_name] === "true")
                        ? "bg-primary"
                        : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        (formData[field.field_name] === "Yes" || formData[field.field_name] === "true")
                          ? "translate-x-6"
                          : "translate-x-1"
                      )}
                    />
                  </button>
                  <span className="text-sm text-muted-foreground">
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
          );
        })}

        {/* Submit button */}
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
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
            {(isSubmitting || disabled) ? (
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

"use client";

import React, { useState, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  RotateCcw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Square,
  Wrench,
  Brain,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Send,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import type { AgentConfig } from "@/types/agent-config";
import { A2ASDKClient, type ParsedA2AEvent } from "@/lib/a2a-sdk-client";
import { useChatStore } from "@/store/chat-store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentBuilderRunnerProps {
  config: AgentConfig;
  onBack?: () => void;
  onComplete?: (result: string) => void;
}

// Execution step parsed from execution_plan events
interface ExecutionStep {
  id: string;
  agent: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  order: number;
}

// Tool call being executed
interface ToolCall {
  id: string;
  tool: string;
  agent: string;
  status: "running" | "completed";
  timestamp: number;
}

// Detected input field from natural language
interface DetectedInputField {
  name: string;
  label: string;
  description?: string;
  type: "text" | "select" | "boolean";
  options?: string[];
  required: boolean;
}

// Status icons and colors
const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
    emoji: "⏳",
  },
  in_progress: {
    icon: Loader2,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    emoji: "🔄",
  },
  completed: {
    icon: CheckCircle,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    emoji: "✅",
  },
  failed: {
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    emoji: "❌",
  },
};

/**
 * Parse natural language to detect input fields
 * Handles patterns like:
 * - "Repository Name - What should the repository be named?"
 * - "Visibility - Should it be: Public / Private"
 * - "Required Information:" sections
 */
function parseInputFieldsFromText(text: string): DetectedInputField[] | null {
  const fields: DetectedInputField[] = [];
  const seenLabels = new Set<string>();
  
  // Check if this looks like an input request
  const inputIndicators = [
    /I need the following information/i,
    /Please provide/i,
    /Required Information/i,
    /What should/i,
    /Enter the/i,
    /Specify the/i,
    /need.*information.*from you/i,
  ];
  
  const hasInputIndicator = inputIndicators.some(pattern => pattern.test(text));
  if (!hasInputIndicator) return null;
  
  // Helper to add a field if not duplicate
  const addField = (field: DetectedInputField) => {
    const normalizedLabel = field.label.toLowerCase().trim();
    // Skip if we've seen this label or a very similar one
    if (seenLabels.has(normalizedLabel)) return;
    // Skip very short labels (likely parsing errors)
    if (field.label.length < 3) return;
    // Skip labels that are just fragments
    if (/^[A-Z][a-z]$/.test(field.label)) return;
    
    seenLabels.add(normalizedLabel);
    fields.push(field);
  };
  
  // Pattern 1: Markdown bold "**Field Name** - Description" or "**Field Name**: Description"
  // This is the most common format from LLMs
  const boldFieldPattern = /\*\*([^*]+)\*\*\s*[-–:]?\s*([^\n*]+)?/g;
  let match;
  
  while ((match = boldFieldPattern.exec(text)) !== null) {
    const [, rawName, description = ""] = match;
    const name = rawName.trim();
    
    // Skip common non-field patterns
    if (/^(Required|Optional|Note|Example|Step|Next|Important|Warning)/i.test(name)) continue;
    if (name.length > 60) continue; // Too long to be a field name
    if (name.length < 2) continue; // Too short
    
    // Detect field type from description
    let type: "text" | "select" | "boolean" = "text";
    let options: string[] | undefined;
    
    // Check for Public/Private options
    if (/\b(Public|Private)\b.*\b(Public|Private)\b/i.test(description) ||
        /should.*be.*(Public|Private)/i.test(description)) {
      type = "select";
      options = ["Public", "Private"];
    }
    // Check for Yes/No options
    else if (/\b(Yes|No)\b.*\b(Yes|No)\b/i.test(description) ||
             /\(Yes\/No\)/i.test(description)) {
      type = "boolean";
      options = ["Yes", "No"];
    }
    
    // Check if optional
    const isOptional = /\(optional\)/i.test(name) || /\(optional\)/i.test(description);
    const cleanName = name.replace(/\s*\(optional\)/i, "").trim();
    
    addField({
      name: cleanName.toLowerCase().replace(/[\s\/]+/g, "_").replace(/[^a-z0-9_]/g, ""),
      label: cleanName,
      description: description.replace(/\(.*?\)/g, "").trim() || undefined,
      type,
      options,
      required: !isOptional,
    });
  }
  
  // Pattern 2: Numbered list items "1. Repository Name - description" or "1. **Repository Name**"
  const numberedPattern = /^\s*\d+\.\s*\*?\*?([^*\n-]+?)\*?\*?\s*[-–:]?\s*([^\n]*)$/gm;
  while ((match = numberedPattern.exec(text)) !== null) {
    const [, rawName, description = ""] = match;
    const name = rawName.trim();
    
    // Skip if too short/long or already added
    if (name.length < 3 || name.length > 60) continue;
    if (seenLabels.has(name.toLowerCase())) continue;
    
    // Detect field type
    let type: "text" | "select" | "boolean" = "text";
    let options: string[] | undefined;
    
    if (/\b(Public|Private)\b/i.test(description)) {
      type = "select";
      options = ["Public", "Private"];
    } else if (/\b(Yes|No)\b/i.test(description) || /\(Yes\/No\)/i.test(description)) {
      type = "boolean";
      options = ["Yes", "No"];
    }
    
    const isOptional = /\(optional\)/i.test(name) || /\(optional\)/i.test(description);
    const cleanName = name.replace(/\s*\(optional\)/i, "").trim();
    
    addField({
      name: cleanName.toLowerCase().replace(/[\s\/]+/g, "_").replace(/[^a-z0-9_]/g, ""),
      label: cleanName,
      description: description.trim() || undefined,
      type,
      options,
      required: !isOptional,
    });
  }
  
  // Pattern 3: Bullet points "- Repository Name: description"
  const bulletPattern = /^\s*[-•]\s*\*?\*?([^*\n:]+?)\*?\*?\s*[:]\s*([^\n]*)$/gm;
  while ((match = bulletPattern.exec(text)) !== null) {
    const [, rawName, description = ""] = match;
    const name = rawName.trim();
    
    if (name.length < 3 || name.length > 60) continue;
    if (seenLabels.has(name.toLowerCase())) continue;
    
    let type: "text" | "select" | "boolean" = "text";
    let options: string[] | undefined;
    
    if (/\b(Public|Private)\b/i.test(description)) {
      type = "select";
      options = ["Public", "Private"];
    } else if (/\b(Yes|No)\b/i.test(description)) {
      type = "boolean";
      options = ["Yes", "No"];
    }
    
    const isOptional = /\(optional\)/i.test(name) || /\(optional\)/i.test(description);
    const cleanName = name.replace(/\s*\(optional\)/i, "").trim();
    
    addField({
      name: cleanName.toLowerCase().replace(/[\s\/]+/g, "_").replace(/[^a-z0-9_]/g, ""),
      label: cleanName,
      description: description.trim() || undefined,
      type,
      options,
      required: !isOptional,
    });
  }
  
  // Only return fields if we found at least 2 valid ones
  return fields.length >= 2 ? fields : null;
}

/**
 * UserInputForm - Renders detected input fields as a form
 */
function UserInputForm({
  fields,
  onSubmit,
  disabled,
}: {
  fields: DetectedInputField[];
  onSubmit: (data: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    const newErrors: Record<string, string> = {};
    fields.forEach(field => {
      if (field.required && !formData[field.name]?.trim()) {
        newErrors[field.name] = `${field.label} is required`;
      }
    });
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    onSubmit(formData);
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
        <span className="text-sm text-amber-400">
          Please provide the following information to continue
        </span>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {fields.map((field, idx) => (
          <div key={field.name} className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1">
              {field.label}
              {field.required && <span className="text-red-400">*</span>}
            </label>
            
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}
            
            {field.type === "select" && field.options ? (
              <select
                value={formData[field.name] || ""}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, [field.name]: e.target.value }));
                  if (errors[field.name]) setErrors(prev => ({ ...prev, [field.name]: "" }));
                }}
                disabled={disabled}
                className={cn(
                  "w-full h-10 px-3 rounded-lg text-sm bg-background border",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50",
                  errors[field.name] ? "border-red-500" : "border-input"
                )}
              >
                <option value="">Select...</option>
                {field.options.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <div className="flex gap-4">
                {["Yes", "No"].map(opt => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={field.name}
                      value={opt}
                      checked={formData[field.name] === opt}
                      onChange={(e) => {
                        setFormData(prev => ({ ...prev, [field.name]: e.target.value }));
                        if (errors[field.name]) setErrors(prev => ({ ...prev, [field.name]: "" }));
                      }}
                      disabled={disabled}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Input
                value={formData[field.name] || ""}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, [field.name]: e.target.value }));
                  if (errors[field.name]) setErrors(prev => ({ ...prev, [field.name]: "" }));
                }}
                placeholder={`Enter ${field.label.toLowerCase()}...`}
                disabled={disabled}
                autoFocus={idx === 0}
                className={cn(errors[field.name] && "border-red-500")}
              />
            )}
            
            {errors[field.name] && (
              <p className="text-xs text-red-400">{errors[field.name]}</p>
            )}
          </div>
        ))}
        
        <div className="pt-2">
          <Button type="submit" disabled={disabled} className="gap-2 gradient-primary text-white">
            <Send className="h-4 w-4" />
            Submit & Continue
          </Button>
        </div>
      </form>
    </motion.div>
  );
}

/**
 * ExecutionStepCard - Individual execution step display
 */
function ExecutionStepCard({
  step,
  isActive,
}: {
  step: ExecutionStep;
  isActive: boolean;
}) {
  const statusConfig = STATUS_CONFIG[step.status];
  const StatusIcon = statusConfig.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: step.order * 0.05 }}
      className={cn(
        "relative p-3 rounded-lg border transition-all",
        isActive
          ? "border-primary/50 bg-primary/5 shadow-md shadow-primary/10"
          : "border-border/50 bg-card/50",
        step.status === "failed" && "border-red-500/50"
      )}
    >
      {/* Connection Line */}
      {step.order > 0 && (
        <div className="absolute -top-3 left-5 w-0.5 h-3 bg-border/50" />
      )}

      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
            statusConfig.bgColor
          )}
        >
          <StatusIcon
            className={cn(
              "h-3.5 w-3.5",
              statusConfig.color,
              step.status === "in_progress" && "animate-spin"
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {step.agent}
            </Badge>
          </div>
          <p className="text-sm text-foreground">{step.description}</p>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * ToolCallIndicator - Shows active tool calls
 */
function ToolCallIndicator({ toolCalls }: { toolCalls: ToolCall[] }) {
  const activeTools = toolCalls.filter((t) => t.status === "running");

  if (activeTools.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/30"
    >
      <Wrench className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
      <span className="text-xs text-muted-foreground">
        {activeTools.map((t) => t.tool).join(", ")}
      </span>
    </motion.div>
  );
}

/**
 * ThinkingIndicator - Shows when the agent is thinking
 */
function ThinkingIndicator({ isThinking }: { isThinking: boolean }) {
  if (!isThinking) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20"
    >
      <Brain className="h-3.5 w-3.5 text-primary animate-pulse" />
      <span className="text-xs text-primary">Thinking...</span>
    </motion.div>
  );
}

/**
 * ResultOrInputForm - Renders either a form (if input is requested) or markdown result
 * Prioritizes structured input fields from backend over regex parsing
 */
function ResultOrInputForm({
  content,
  onSubmitInput,
  isSubmitting,
  structuredFields,
  structuredTitle,
}: {
  content: string;
  onSubmitInput: (data: Record<string, string>) => void;
  isSubmitting: boolean;
  structuredFields?: DetectedInputField[] | null;
  structuredTitle?: string;
}) {
  // Prioritize structured fields from backend (request_user_input tool)
  if (structuredFields && structuredFields.length > 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {structuredTitle && (
          <h3 className="text-lg font-semibold mb-4">{structuredTitle}</h3>
        )}
        <UserInputForm
          fields={structuredFields}
          onSubmit={onSubmitInput}
          disabled={isSubmitting}
        />
      </motion.div>
    );
  }
  
  // Fallback: Try to detect input fields from the content using regex
  const detectedFields = useMemo(() => parseInputFieldsFromText(content), [content]);
  
  if (detectedFields && detectedFields.length > 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <UserInputForm
          fields={detectedFields}
          onSubmit={onSubmitInput}
          disabled={isSubmitting}
        />
      </motion.div>
    );
  }
  
  // No input fields detected - render as markdown
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="prose prose-sm dark:prose-invert max-w-none"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </motion.div>
  );
}

/**
 * AgentBuilderRunner - Main execution component with real A2A streaming
 */
export function AgentBuilderRunner({
  config,
  onBack,
  onComplete,
}: AgentBuilderRunnerProps) {
  // Workflow state
  const [status, setStatus] = useState<
    "idle" | "running" | "completed" | "failed" | "cancelled"
  >("idle");
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [finalResult, setFinalResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [showStreamingOutput, setShowStreamingOutput] = useState(false);
  const [isSubmittingInput, setIsSubmittingInput] = useState(false);
  
  // Structured user input state (from request_user_input tool)
  const [structuredInputFields, setStructuredInputFields] = useState<DetectedInputField[] | null>(null);
  const [structuredInputTitle, setStructuredInputTitle] = useState<string>("");

  // Router for navigation
  const router = useRouter();
  
  // Chat store for creating conversations
  const { createConversation, setPendingMessage } = useChatStore();

  // Auth - same pattern as ChatPanel
  const { data: session } = useSession();
  const ssoEnabled = getConfig('ssoEnabled');
  const accessToken = ssoEnabled ? session?.accessToken : undefined;

  // A2A client ref
  const clientRef = useRef<A2ASDKClient | null>(null);
  const abortedRef = useRef(false);

  // Get A2A endpoint from config (same as ChatPanel)
  const endpoint = getConfig('caipeUrl');

  /**
   * Parse execution plan from event text
   * Matches patterns like: ⏳ [ArgoCD] List all applications
   */
  const parseExecutionPlan = useCallback(
    (text: string): ExecutionStep[] => {
      const todoPattern = /([⏳✅🔄❌📋])\s*\[([^\]]+)\]\s*(.+)/g;
      const newSteps: ExecutionStep[] = [];
      let match;
      let order = 0;

      while ((match = todoPattern.exec(text)) !== null) {
        const [, statusEmoji, agent, description] = match;
        const taskId = `${agent}-${description.slice(0, 20)}`
          .replace(/\s+/g, "-")
          .toLowerCase();

        let stepStatus: ExecutionStep["status"] = "pending";
        if (statusEmoji === "✅") stepStatus = "completed";
        else if (statusEmoji === "🔄" || statusEmoji === "⏳")
          stepStatus = statusEmoji === "🔄" ? "in_progress" : "pending";
        else if (statusEmoji === "❌") stepStatus = "failed";

        newSteps.push({
          id: taskId,
          agent: agent.trim(),
          description: description.trim(),
          status: stepStatus,
          order: order++,
        });
      }

      return newSteps;
    },
    []
  );

  /**
   * Handle A2A streaming events
   */
  const handleEvent = useCallback(
    (event: ParsedA2AEvent) => {
      const artifactName = event.artifactName || "";
      const content = event.displayContent || "";

      // Handle execution plan updates
      if (
        artifactName === "execution_plan_update" ||
        artifactName === "execution_plan_status_update"
      ) {
        const parsedSteps = parseExecutionPlan(content);
        if (parsedSteps.length > 0) {
          setSteps(parsedSteps);
          // Check if any step is in progress
          const hasInProgress = parsedSteps.some(
            (s) => s.status === "in_progress"
          );
          setIsThinking(hasInProgress);
        }
        return;
      }

      // Handle tool notifications
      if (artifactName === "tool_notification_start") {
        const toolMatch = content.match(
          /(?:Calling|Tool)\s+(?:Agent\s+)?(\w+)/i
        );
        const toolName = toolMatch ? toolMatch[1] : "tool";
        const toolId = `tool-${Date.now()}`;

        setToolCalls((prev) => [
          ...prev,
          {
            id: toolId,
            tool: toolName,
            agent: "Agent",
            status: "running",
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (artifactName === "tool_notification_end") {
        // Mark most recent running tool as completed
        setToolCalls((prev) => {
          const updated = [...prev];
          const runningIdx = updated.findIndex((t) => t.status === "running");
          if (runningIdx >= 0) {
            updated[runningIdx] = { ...updated[runningIdx], status: "completed" };
          }
          return updated;
        });
        return;
      }

      // Handle structured user input request (from request_user_input tool)
      if (event.requireUserInput && event.metadata?.input_fields) {
        console.log("[AgentBuilderRunner] 📝 Received structured user input request");
        const fields = event.metadata.input_fields;
        
        // Convert backend field format to DetectedInputField format
        const convertedFields: DetectedInputField[] = fields.map((f) => ({
          name: f.field_name,
          label: f.field_label || f.field_name,
          description: f.field_description,
          type: (f.field_type === "select" ? "select" : 
                 f.field_type === "boolean" ? "boolean" : "text") as "text" | "select" | "boolean",
          options: f.field_values,
          required: f.required ?? true,
        }));
        
        setStructuredInputFields(convertedFields);
        setStructuredInputTitle(event.metadata.input_title || "User Input Required");
        setFinalResult(content); // Show the description as content
        setStatus("completed"); // Pause for user input
        setIsThinking(false);
        return;
      }

      // Handle final result
      if (artifactName === "final_result" || artifactName === "partial_result") {
        if (content) {
          setFinalResult(content);
          setStatus("completed");
          setIsThinking(false);
          onComplete?.(content);
        }
        return;
      }

      // Accumulate streaming content for display
      if (
        event.type === "message" ||
        (event.type === "artifact" &&
          !["tool_notification_start", "tool_notification_end"].includes(
            artifactName
          ))
      ) {
        if (content) {
          setStreamingContent((prev) =>
            event.shouldAppend === false ? content : prev + content
          );
        }
      }
    },
    [parseExecutionPlan, onComplete]
  );

  /**
   * Start workflow execution
   */
  const handleStart = useCallback(async () => {
    setStatus("running");
    setSteps([]);
    setToolCalls([]);
    setFinalResult("");
    setError("");
    setStreamingContent("");
    setIsThinking(true);
    abortedRef.current = false;

    // Create A2A client
    const client = new A2ASDKClient({
      endpoint,
      accessToken,
    });
    clientRef.current = client;

    // Build the prompt:
    // - For quick-start workflows, use the actual task prompt
    // - For multi-step workflows, use the workflow title/description
    let prompt: string;
    if (config.is_quick_start && config.tasks.length > 0 && config.tasks[0].llm_prompt) {
      prompt = config.tasks[0].llm_prompt;
    } else {
      prompt = config.description
        ? `${config.name}: ${config.description}`
        : config.name;
    }

    console.log(`[AgentBuilderRunner] Starting workflow: "${prompt.substring(0, 100)}..."`);

    try {
      // Stream events from supervisor
      for await (const event of client.sendMessageStream(prompt)) {
        if (abortedRef.current) {
          console.log("[AgentBuilderRunner] Workflow aborted");
          break;
        }

        handleEvent(event);

        // Check for completion
        if (event.type === "status" && event.isFinal) {
          console.log("[AgentBuilderRunner] Workflow complete (final status)");
          if (!finalResult) {
            // If no final result yet, mark as completed with streaming content
            setStatus("completed");
            setIsThinking(false);
          }
          break;
        }
      }

      // Finalize
      if (!abortedRef.current && status !== "completed") {
        setStatus("completed");
        setIsThinking(false);
      }
    } catch (err) {
      console.error("[AgentBuilderRunner] Error:", err);
      if (!abortedRef.current) {
        setError((err as Error).message || "Workflow execution failed");
        setStatus("failed");
        setIsThinking(false);
      }
    } finally {
      clientRef.current = null;
    }
  }, [config, endpoint, accessToken, handleEvent, finalResult, status]);

  /**
   * Stop workflow execution
   */
  const handleStop = useCallback(() => {
    abortedRef.current = true;
    if (clientRef.current) {
      clientRef.current.abort();
      clientRef.current = null;
    }
    setStatus("cancelled");
    setIsThinking(false);
  }, []);

  /**
   * Reset workflow
   */
  const handleReset = useCallback(() => {
    setStatus("idle");
    setSteps([]);
    setToolCalls([]);
    setFinalResult("");
    setError("");
    setStreamingContent("");
    setIsThinking(false);
    setIsSubmittingInput(false);
    setStructuredInputFields(null);
    setStructuredInputTitle("");
    abortedRef.current = false;
  }, []);

  /**
   * Run in Chat - Opens a new chat conversation with the query
   */
  const handleRunInChat = useCallback(() => {
    // Build the prompt (same logic as handleStart)
    let prompt: string;
    if (config.is_quick_start && config.tasks.length > 0 && config.tasks[0].llm_prompt) {
      prompt = config.tasks[0].llm_prompt;
    } else {
      prompt = config.description
        ? `${config.name}: ${config.description}`
        : config.name;
    }

    // Create a new conversation
    const conversationId = createConversation();
    
    // Set the pending message to be auto-submitted when the chat loads
    setPendingMessage(prompt);
    
    // Navigate to the chat page
    router.push(`/chat/${conversationId}`);
  }, [config, createConversation, setPendingMessage, router]);

  /**
   * Handle user input form submission
   * Sends the collected data back to the supervisor to continue the workflow
   */
  const handleUserInputSubmit = useCallback(async (data: Record<string, string>) => {
    setIsSubmittingInput(true);
    
    // Format the user input as a response message
    const formattedResponse = Object.entries(data)
      .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
      .join("\n");
    
    console.log("[AgentBuilderRunner] Submitting user input:", formattedResponse);
    
    // Reset state for continuation
    setFinalResult("");
    setStreamingContent("");
    setStatus("running");
    setIsThinking(true);
    abortedRef.current = false;
    
    // Create A2A client
    const client = new A2ASDKClient({
      endpoint,
      accessToken,
    });
    clientRef.current = client;
    
    try {
      // Send the user's input as a follow-up message
      for await (const event of client.sendMessageStream(formattedResponse)) {
        if (abortedRef.current) {
          console.log("[AgentBuilderRunner] Workflow aborted");
          break;
        }
        
        handleEvent(event);
        
        // Check for completion
        if (event.type === "status" && event.isFinal) {
          console.log("[AgentBuilderRunner] Workflow complete (final status)");
          setStatus("completed");
          setIsThinking(false);
          break;
        }
      }
      
      // Finalize
      if (!abortedRef.current && status !== "completed") {
        setStatus("completed");
        setIsThinking(false);
      }
    } catch (err) {
      console.error("[AgentBuilderRunner] Error:", err);
      if (!abortedRef.current) {
        setError((err as Error).message || "Failed to submit input");
        setStatus("failed");
        setIsThinking(false);
      }
    } finally {
      clientRef.current = null;
      setIsSubmittingInput(false);
    }
  }, [endpoint, accessToken, handleEvent, status]);

  // Get current active step
  const activeStepIndex = steps.findIndex((s) => s.status === "in_progress");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h1 className="text-lg font-semibold">{config.name}</h1>
            {config.description && (
              <p className="text-sm text-muted-foreground line-clamp-1">
                {config.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === "idle" && (
            <>
              <Button
                onClick={handleRunInChat}
                variant="outline"
                className="gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                Run in Chat
              </Button>
              <Button
                onClick={handleStart}
                className="gap-2 gradient-primary text-white"
              >
                <Play className="h-4 w-4" />
                Run in Workflow
              </Button>
            </>
          )}
          {status === "running" && (
            <>
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStop}
                className="gap-1"
              >
                <Square className="h-3 w-3" />
                Stop
              </Button>
            </>
          )}
          {status === "completed" && (
            <>
              <Badge
                variant="secondary"
                className="gap-1 bg-green-500/10 text-green-500"
              >
                <CheckCircle className="h-3 w-3" />
                Completed
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1"
              >
                <RotateCcw className="h-4 w-4" />
                Run Again
              </Button>
            </>
          )}
          {status === "failed" && (
            <>
              <Badge
                variant="secondary"
                className="gap-1 bg-red-500/10 text-red-500"
              >
                <XCircle className="h-3 w-3" />
                Failed
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1"
              >
                <RotateCcw className="h-4 w-4" />
                Retry
              </Button>
            </>
          )}
          {status === "cancelled" && (
            <>
              <Badge variant="secondary" className="gap-1">
                <Square className="h-3 w-3" />
                Cancelled
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1"
              >
                <RotateCcw className="h-4 w-4" />
                Restart
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        {/* Left Panel - Execution Steps */}
        <div className="w-1/3 flex flex-col min-h-0">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 shrink-0">
            Execution Plan
          </h2>

          <ScrollArea className="flex-1">
            <div className="space-y-3 pr-2">
              {status === "idle" && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Play className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Click "Start Workflow" to begin
                  </p>
                </div>
              )}

              {status === "running" && steps.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="h-10 w-10 text-primary animate-spin mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Planning execution...
                  </p>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                {steps.map((step) => (
                  <ExecutionStepCard
                    key={step.id}
                    step={step}
                    isActive={step.order === activeStepIndex}
                  />
                ))}
              </AnimatePresence>

              {/* Tool calls and thinking indicators */}
              <AnimatePresence>
                {isThinking && steps.length > 0 && (
                  <ThinkingIndicator key="thinking-indicator" isThinking={true} />
                )}
                {toolCalls.filter(t => t.status === "running").length > 0 && (
                  <ToolCallIndicator key="tool-indicator" toolCalls={toolCalls} />
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel - Output */}
        <div className="flex-1 flex flex-col border-l border-border/50 pl-4 min-h-0">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h2 className="text-sm font-medium text-muted-foreground">
              {finalResult ? "Result" : "Output"}
            </h2>
            {streamingContent && !finalResult && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowStreamingOutput(!showStreamingOutput)}
                className="gap-1 h-7 text-xs"
              >
                {showStreamingOutput ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    Hide Stream
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    Show Stream
                  </>
                )}
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="pr-2">
              {/* Idle state */}
              {status === "idle" && (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <MessageSquare className="h-12 w-12 text-muted-foreground/20 mb-4" />
                  <p className="text-muted-foreground">
                    Results will appear here
                  </p>
                </div>
              )}

              {/* Running state - show streaming output */}
              {status === "running" && !finalResult && (
                <div className="space-y-4">
                  {showStreamingOutput && streamingContent && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="p-3 rounded-lg bg-muted/30 border border-border/30"
                    >
                      <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                        {streamingContent}
                      </p>
                    </motion.div>
                  )}

                  {!showStreamingOutput && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                      <p className="text-muted-foreground">
                        Executing workflow...
                      </p>
                      {steps.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Step {activeStepIndex + 1} of {steps.length}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Completed state - show final result or input form */}
              {(status === "completed" || finalResult) && (
                <ResultOrInputForm
                  content={finalResult || streamingContent || "Workflow completed."}
                  onSubmitInput={handleUserInputSubmit}
                  isSubmitting={isSubmittingInput}
                  structuredFields={structuredInputFields}
                  structuredTitle={structuredInputTitle}
                />
              )}

              {/* Failed state */}
              {status === "failed" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-12 text-center"
                >
                  <XCircle className="h-12 w-12 text-red-500 mb-4" />
                  <p className="text-lg font-medium text-foreground mb-2">
                    Workflow Failed
                  </p>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {error || "An error occurred during execution"}
                  </p>
                </motion.div>
              )}

              {/* Cancelled state */}
              {status === "cancelled" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-12 text-center"
                >
                  <Square className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium text-foreground mb-2">
                    Workflow Cancelled
                  </p>
                  <p className="text-sm text-muted-foreground">
                    The workflow was stopped before completion
                  </p>
                </motion.div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

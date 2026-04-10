"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, ArrowLeft, RotateCcw, Activity, ShieldCheck } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { createStreamAdapter, type StreamAdapter, type StreamCallbacks } from "@/lib/streaming";
import { type StreamEvent, createStreamEvent, FILE_TOOL_NAMES, TODO_TOOL_NAME } from "@/components/dynamic-agents/sse-types";
import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { cn, deduplicateByKey } from "@/lib/utils";
import { ChatMessage as ChatMessageType, TurnStatus, Conversation } from "@/types/a2a";
import { getConfig } from "@/lib/config";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { DEFAULT_AGENTS } from "./CustomCallButtons";
import { MetadataInputForm, type UserInputMetadata, type InputField } from "./MetadataInputForm";
import { SlashCommandMenu, getFilteredCommands, type SlashCommand } from "./SlashCommandMenu";
import { useSlashCommands } from "./useSlashCommands";
import { getGradientStyle } from "@/lib/gradient-themes";
import { DynamicAgentTimeline, type SubagentLookupInfo } from "./DynamicAgentTimeline";
import { useDynamicAgentTimeline } from "@/hooks/useDynamicAgentTimeline";
import type { TaskItem } from "@/components/shared/timeline";
import { MarkdownRenderer } from "@/components/shared/timeline";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

type ReadOnlyReason = 'admin_audit' | 'shared_readonly' | 'agent_deleted' | 'agent_disabled';

interface DynamicAgentChatPanelProps {
  endpoint: string;
  conversationId?: string; // MongoDB conversation UUID
  conversationTitle?: string;
  readOnly?: boolean;
  readOnlyReason?: ReadOnlyReason;
  agentId: string; // Mandatory for Dynamic Agents
  agentGradient?: string | null; // Gradient theme for agent avatar
  agentName?: string; // Agent name for display
  isLoadingMessages?: boolean; // Whether messages are still loading (show skeleton)
}

export function DynamicAgentChatPanel({ endpoint, conversationId, conversationTitle, readOnly, readOnlyReason, agentId, agentGradient, agentName, isLoadingMessages }: DynamicAgentChatPanelProps) {
  const { data: session } = useSession();
  const autoScrollEnabled = useFeatureFlagStore((s) => s.flags.autoScroll ?? true);
  const showTimestamps = useFeatureFlagStore((s) => s.flags.showTimestamps ?? false);

  // Derive the user's first name for message labels (falls back to "You")
  const userDisplayName = useMemo(() => {
    const fullName = session?.user?.name;
    if (!fullName) return "You";
    const firstName = fullName.split(" ")[0].trim();
    return firstName || "You";
  }, [session?.user?.name]);

  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // User input form state (HITL - Human-in-the-Loop)
  const [pendingUserInput, setPendingUserInput] = useState<{
    messageId: string;
    metadata: UserInputMetadata;
    contextId?: string;
    // SSE/Dynamic Agent specific fields
    isSSE?: boolean;
    agentId?: string;
  } | null>(null);

  // Track message IDs where the user explicitly dismissed the input form,
  // so we don't re-show it after the restore effect runs.
  const dismissedInputForMessageRef = useRef<Set<string>>(new Set());

  // Auto-scroll state
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAutoScrollingRef = useRef(false);

  // Message window: progressive loading of older turns
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_VISIBLE_TURNS);
  // Ref to preserve scroll position when loading more turns
  const scrollDistanceFromBottomRef = useRef<number | null>(null);

  const {
    activeConversationId,
    getActiveConversation,
    createConversation,
    addMessage,
    updateMessage,
    // appendToMessage, // Unused in filtered code? Let's check. Used in error handling.
    appendToMessage,
    addStreamEvent,
    clearStreamEvents,
    setConversationStreaming,
    isConversationStreaming,
    cancelConversationRequest,
    updateMessageFeedback,
    consumePendingMessage,
    // recoverInterruptedTask, // A2A recovery logic - keep or remove?
    // The A2A recovery logic relies on tasks/get which might not exist for Dynamic Agents yet.
    // The plan says "Phase 2... survives pod restarts".
    // "Phase 3... Persistent History... history loads from checkpointer".
    // For Phase 1 (UI), let's keep it simple and maybe comment out A2A recovery if it's specific to A2A endpoints.
    // Dynamic Agents don't have a /tasks/get endpoint in the same way, or at least the client usage might differ.
    // Let's remove it for now to avoid errors, as Dynamic Agents rely on SSE resume, not task polling.
    evictOldMessageContent,
    loadMessagesFromServer,
    saveMessagesToServer,
    updateConversationTitle,
  } = useChatStore();

  // Slash command registry
  const slashCommands = useSlashCommands();

  // Get access token from session (if SSO is enabled and user is authenticated)
  const ssoEnabled = getConfig('ssoEnabled');
  const accessToken = ssoEnabled ? session?.accessToken : undefined;

  const conversation = getActiveConversation();

  // Ref to track which conversations we've checked for HITL interrupt state
  const interruptCheckedRef = useRef<Set<string>>(new Set());

  // ─── Files & Tasks for Timeline (fetched via API) ─────────────────
  const [timelineFiles, setTimelineFiles] = useState<string[]>([]);
  const [timelineTasks, setTimelineTasks] = useState<TaskItem[]>([]);
  const [isDownloadingFile, setIsDownloadingFile] = useState(false);
  const [downloadingFilePath, setDownloadingFilePath] = useState<string | undefined>();
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [deletingFilePath, setDeletingFilePath] = useState<string | undefined>();
  const [filesFetchKey, setFilesFetchKey] = useState(0);
  const [todosFetchKey, setTodosFetchKey] = useState(0);
  const filesFetchedForRef = useRef<{ conversationId: string; agentId: string; fetchKey: number } | null>(null);
  const todosFetchedForRef = useRef<{ conversationId: string; agentId: string; fetchKey: number } | null>(null);

  // ─── Subagent Info Cache (for timeline avatar gradients) ──────────
  const [subagentCache, setSubagentCache] = useState<Map<string, SubagentLookupInfo>>(new Map());
  const subagentCacheFetchedRef = useRef(false);

  // Fetch all available agents once for subagent lookup
  useEffect(() => {
    if (subagentCacheFetchedRef.current) return;
    subagentCacheFetchedRef.current = true;

    const fetchAgents = async () => {
      try {
        const response = await fetch("/api/dynamic-agents?enabled_only=true");
        const data = await response.json();
        if (data.success && data.data?.items) {
          const cache = new Map<string, SubagentLookupInfo>();
          for (const agent of data.data.items as DynamicAgentConfig[]) {
            // Index by both id and name for flexible lookup
            const info: SubagentLookupInfo = {
              name: agent.name,
              gradientTheme: agent.ui?.gradient_theme,
            };
            cache.set(agent._id, info);
            // Also index by lowercase name for name-based lookup
            cache.set(agent.name.toLowerCase(), info);
          }
          setSubagentCache(cache);
        }
      } catch (err) {
        console.warn("[DynamicAgentChatPanel] Failed to fetch agents for subagent lookup:", err);
      }
    };

    fetchAgents();
  }, []);

  // Callback to look up subagent info by name
  const getSubagentInfo = useCallback((subagentName: string): SubagentLookupInfo | undefined => {
    // Try exact match first, then lowercase
    return subagentCache.get(subagentName) || subagentCache.get(subagentName.toLowerCase());
  }, [subagentCache]);

  // Check if THIS conversation is streaming (not global)
  const isThisConversationStreaming = activeConversationId
    ? isConversationStreaming(activeConversationId)
    : false;

  // Check if user is near the bottom of the scroll area
  const isNearBottom = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return true;

    // During streaming, use a much larger threshold to prevent false positives
    // when content updates faster than scroll can complete
    const threshold = isThisConversationStreaming ? 300 : 100; // pixels from bottom
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, [isThisConversationStreaming]);

  // Scroll to bottom with smooth animation
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (messagesEndRef.current) {
      isAutoScrollingRef.current = true;
      messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
      // Reset auto-scrolling flag after animation
      setTimeout(() => {
        isAutoScrollingRef.current = false;
        setIsUserScrolledUp(false);
        setShowScrollButton(false);
      }, behavior === "smooth" ? 300 : 0);
    }
  }, []);

  // Handle scroll events to detect user scrolling
  const handleScroll = useCallback(() => {
    // Ignore scroll events caused by auto-scrolling
    if (isAutoScrollingRef.current) return;

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);
    setShowScrollButton(!nearBottom);
  }, [isNearBottom]);

  // Set up scroll listener
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Auto-scroll when new messages arrive (only if user hasn't scrolled up)
  useEffect(() => {
    if (autoScrollEnabled && !isUserScrolledUp) {
      scrollToBottom("smooth");
    }
  }, [conversation?.messages?.length, isUserScrolledUp, scrollToBottom, autoScrollEnabled]);

  // Auto-scroll during streaming only if user is near the bottom
  // Depend on both message content AND streamEvents length since timeline renders from SSE events
  useEffect(() => {
    if (autoScrollEnabled && isThisConversationStreaming && !isUserScrolledUp) {
      scrollToBottom("instant");
    }
  }, [conversation?.messages?.at(-1)?.content, conversation?.streamEvents?.length, isThisConversationStreaming, isUserScrolledUp, scrollToBottom, autoScrollEnabled]);

  // ResizeObserver-based auto-scroll: catches DOM changes from morphdom patches
  // that happen asynchronously after React renders (marked parses async, then
  // morphdom patches the DOM directly). Without this, scrollToBottom fires before
  // the DOM height has actually grown.
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !autoScrollEnabled) return;

    const observer = new ResizeObserver(() => {
      if (isThisConversationStreaming && !isUserScrolledUp && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "instant", block: "end" });
      }
    });

    // Observe the first child of the viewport (the content wrapper)
    const content = viewport.firstElementChild;
    if (content) {
      observer.observe(content);
    }

    return () => observer.disconnect();
  }, [isThisConversationStreaming, isUserScrolledUp, autoScrollEnabled]);

  // Reset scroll state and visible turns when conversation changes
  useEffect(() => {
    setIsUserScrolledUp(false);
    setShowScrollButton(false);
    setVisibleTurnCount(INITIAL_VISIBLE_TURNS);
    // Scroll to bottom when switching conversations. Use rAF to wait for
    // the browser to lay out the newly rendered messages, then scroll.
    const raf = requestAnimationFrame(() => {
      scrollToBottom("instant");
    });
    return () => cancelAnimationFrame(raf);
  }, [activeConversationId, scrollToBottom]);

  // RECOVERY LOGIC REMOVED (A2A specific)
  const recoveringMessageId = null; 

  // ═══════════════════════════════════════════════════════════════
  // CHECK HITL INTERRUPT STATE from checkpointer (messages loaded by ChatContainer)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Skip if no conversationId (new conversation) or agentId
    if (!conversationId || !agentId) return;
    
    // Skip if already checked this conversation
    if (interruptCheckedRef.current.has(conversationId)) return;
    
    // Mark as checked BEFORE async to prevent duplicate checks in Strict Mode
    interruptCheckedRef.current.add(conversationId);

    const checkInterruptState = async () => {
      try {
        // Check for pending HITL interrupt state (lightweight call to checkpointer)
        // Messages are already loaded by ChatContainer - we only check interrupt state here
        const interruptResponse = await fetch(
          `/api/dynamic-agents/conversations/${conversationId}/interrupt-state?agent_id=${encodeURIComponent(agentId)}`
        );
        
        if (interruptResponse.ok) {
          const interruptData = await interruptResponse.json();
          
          // Handle pending interrupt - restore the HITL form if present
          if (interruptData.has_pending_interrupt && interruptData.interrupt_data) {
            const { prompt, fields } = interruptData.interrupt_data;
            
            // Get the last message from the store (already loaded by ChatContainer)
            const currentConv = useChatStore.getState().conversations.find(c => c.id === conversationId);
            const lastMsg = currentConv?.messages?.[currentConv.messages.length - 1];
            
            if (lastMsg && lastMsg.role === "assistant") {
              const inputFields: InputField[] = fields.map((f: { field_name: string; field_label?: string; field_description?: string; field_type?: string; field_values?: string[]; required?: boolean; default_value?: string; placeholder?: string }) => ({
                field_name: f.field_name,
                field_label: f.field_label,
                field_description: f.field_description,
                field_type: f.field_type,
                field_values: f.field_values,
                required: f.required,
                default_value: f.default_value,
                placeholder: f.placeholder,
              }));

              setPendingUserInput({
                messageId: lastMsg.id,
                metadata: {
                  user_input: true,
                  input_title: `Input Required`,
                  input_description: prompt,
                  input_fields: inputFields,
                },
                contextId: conversationId,
                isSSE: true,
                agentId: agentId,
              });
            }
          }
        }
      } catch (interruptError) {
        // Non-fatal: HITL state check failed
        console.warn("[DynamicAgentChatPanel] Failed to check interrupt state:", interruptError);
      }
    };

    checkInterruptState();
  }, [conversationId, agentId]);

  // ═══════════════════════════════════════════════════════════════
  // FILES & TASKS FETCH (for timeline display in latest message)
  // ═══════════════════════════════════════════════════════════════

  // Fetch files from API
  useEffect(() => {
    if (!conversationId || !agentId) {
      setTimelineFiles([]);
      filesFetchedForRef.current = null;
      return;
    }

    const currentFetchState = { conversationId, agentId, fetchKey: filesFetchKey };
    if (
      filesFetchedForRef.current?.conversationId === currentFetchState.conversationId &&
      filesFetchedForRef.current?.agentId === currentFetchState.agentId &&
      filesFetchedForRef.current?.fetchKey === currentFetchState.fetchKey
    ) {
      return;
    }
    
    filesFetchedForRef.current = currentFetchState;

    const fetchFiles = async () => {
      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${conversationId}/files/list?agent_id=${encodeURIComponent(agentId)}`,
          {
            headers: {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          setTimelineFiles(data.files || []);
        }
      } catch {
        // Silently ignore fetch errors - files are optional
      }
    };

    fetchFiles();
  }, [conversationId, agentId, filesFetchKey, accessToken]);

  // Fetch todos from API
  useEffect(() => {
    if (!conversationId || !agentId) {
      setTimelineTasks([]);
      todosFetchedForRef.current = null;
      return;
    }

    const currentFetchState = { conversationId, agentId, fetchKey: todosFetchKey };
    if (
      todosFetchedForRef.current?.conversationId === currentFetchState.conversationId &&
      todosFetchedForRef.current?.agentId === currentFetchState.agentId &&
      todosFetchedForRef.current?.fetchKey === currentFetchState.fetchKey
    ) {
      return;
    }
    
    todosFetchedForRef.current = currentFetchState;

    const fetchTodos = async () => {
      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${conversationId}/todos?agent_id=${encodeURIComponent(agentId)}`,
          {
            headers: {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          const fetchedTodos: TaskItem[] = (data.todos || []).map(
            (todo: { content?: string; status?: string }, idx: number) => ({
              id: `todo-${idx}`,
              content: todo.content || "",
              status: (todo.status as "pending" | "in_progress" | "completed") || "pending",
            })
          );
          setTimelineTasks(fetchedTodos);
        }
      } catch {
        // Silently ignore fetch errors - todos are optional
      }
    };

    fetchTodos();
  }, [conversationId, agentId, todosFetchKey, accessToken]);

  // Handle file download
  const handleTimelineFileDownload = useCallback(
    async (path: string) => {
      if (!conversationId || !agentId || isDownloadingFile) return;

      setIsDownloadingFile(true);
      setDownloadingFilePath(path);

      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${conversationId}/files/content?agent_id=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}`,
          {
            headers: {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          const content = data.content || "";

          // Create blob and download
          const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const filename = path.split("/").pop() || "file.txt";
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {
        // Silently ignore download errors
      } finally {
        setIsDownloadingFile(false);
        setDownloadingFilePath(undefined);
      }
    },
    [conversationId, agentId, accessToken, isDownloadingFile]
  );

  // Handle file delete
  const handleTimelineFileDelete = useCallback(
    async (path: string) => {
      if (!conversationId || !agentId || isDeletingFile) return;

      setIsDeletingFile(true);
      setDeletingFilePath(path);

      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${conversationId}/files/content?agent_id=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}`,
          {
            method: "DELETE",
            headers: {
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
          }
        );

        if (response.ok) {
          setFilesFetchKey((k) => k + 1);
        }
      } catch {
        // Silently ignore delete errors
      } finally {
        setIsDeletingFile(false);
        setDeletingFilePath(undefined);
      }
    },
    [conversationId, agentId, accessToken, isDeletingFile]
  );

  // ═══════════════════════════════════════════════════════════════
  // RESTORE PENDING USER INPUT FORM after page refresh / navigation.
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Clear dismissed-form tracking when switching conversations
    dismissedInputForMessageRef.current.clear();
    setPendingUserInput(null);
  }, [activeConversationId]);

  // Track last message SSE events length to re-trigger restoration when events load
  const lastMsgEventsLen = conversation?.messages?.[conversation.messages.length - 1]?.streamEvents?.length ?? 0;

  useEffect(() => {
    if (pendingUserInput || isThisConversationStreaming) return;
    if (!conversation || conversation.messages.length === 0) return;

    const messages = conversation.messages;
    const lastMsg = messages[messages.length - 1];

    // Only restore if the last message is from the assistant (user hasn't replied yet)
    if (lastMsg.role !== "assistant") return;

    // Don't restore if the assistant message completed (isFinal=true)
    if (lastMsg.isFinal) {
      return;
    }

    // Don't restore if user explicitly dismissed the form for this message
    if (dismissedInputForMessageRef.current.has(lastMsg.id)) return;

    // Check for SSE "input_required" events
    // Note: Only streamEvents have the input_required type. Message events (A2A) don't.
    const streamEventsFromConv = conversation.streamEvents || [];
    
    // Find the last input_required event
    // We reverse to find the most recent one
    const inputEvent = [...streamEventsFromConv].reverse().find((e) => e.type === "input_required");

    if (inputEvent && inputEvent.inputRequiredData) {
       const { prompt, fields } = inputEvent.inputRequiredData;

       // Check if already answered
       const assistantIdx = messages.findIndex(m => m.id === lastMsg.id);
       const hasUserReplyAfter = messages.slice(assistantIdx + 1).some(m => m.role === "user");
       if (hasUserReplyAfter) {
         return;
       }

       const inputFields: InputField[] = fields.map(f => ({
            field_name: f.field_name,
            field_label: f.field_label,
            field_description: f.field_description,
            field_type: f.field_type,
            field_values: f.field_values,
            required: f.required,
            default_value: f.default_value,
            placeholder: f.placeholder,
          }));

       setPendingUserInput({
          messageId: lastMsg.id,
          metadata: {
            user_input: true,
            input_title: `Input Required`,
            input_description: prompt,
            input_fields: inputFields,
          },
          contextId: activeConversationId,
          isSSE: true,
          agentId: agentId,
       });
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, conversation?.messages?.length, conversation?.streamEvents?.length, lastMsgEventsLen, isThisConversationStreaming, agentId]);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ═══════════════════════════════════════════════════════════════
  // Streaming state & helpers
  // ═══════════════════════════════════════════════════════════════
  interface StreamLoopState {
    accumulatedText: string;
    rawStreamContent: string;
    hitlFormRequested: boolean;
    hasError: boolean;
  }

  // Get the protocol-agnostic adapter config
  const agentProtocol = getConfig('agentProtocol');

  /**
   * Build StreamCallbacks that wire adapter events into the Zustand store,
   * HITL form, and file/todo fetches. Used by both submitMessage and HITL resume.
   */
  const buildStreamCallbacks = useCallback((
    convId: string,
    assistantMsgId: string,
    loopState: StreamLoopState,
    toolCallIdToName: Map<string, string>,
  ): StreamCallbacks => ({
    onContent(text, namespace) {
      loopState.accumulatedText += text;
      loopState.rawStreamContent += text;

      // Build a StreamEvent for the store (timeline rendering)
      const streamEvent = createStreamEvent("content", { text, namespace });
      addStreamEvent(streamEvent, convId);

      // Update message content immediately for progressive rendering
      updateMessage(convId, assistantMsgId, {
        content: loopState.accumulatedText,
        rawStreamContent: loopState.rawStreamContent,
      });
    },

    onToolStart(toolCallId, toolName, args, namespace) {
      toolCallIdToName.set(toolCallId, toolName);
      const streamEvent = createStreamEvent("tool_start", {
        tool_name: toolName,
        tool_call_id: toolCallId,
        args,
        namespace: namespace ?? [],
      });
      addStreamEvent(streamEvent, convId);
    },

    onToolEnd(toolCallId, toolName, error, namespace) {
      const resolvedName = toolName ?? toolCallIdToName.get(toolCallId);
      const streamEvent = createStreamEvent("tool_end", {
        tool_call_id: toolCallId,
        error,
        namespace: namespace ?? [],
      });
      addStreamEvent(streamEvent, convId);

      // Trigger file/todo fetches when the relevant tool completes
      if (resolvedName) {
        if (FILE_TOOL_NAMES.includes(resolvedName as typeof FILE_TOOL_NAMES[number])) {
          setFilesFetchKey((k) => k + 1);
        } else if (resolvedName === TODO_TOOL_NAME) {
          setTodosFetchKey((k) => k + 1);
        }
      }
    },

    onInputRequired(interruptId, prompt, fields, agent) {
      loopState.hitlFormRequested = true;

      const streamEvent = createStreamEvent("input_required", {
        interrupt_id: interruptId,
        prompt,
        fields,
        agent,
        namespace: [],
      });
      addStreamEvent(streamEvent, convId);

      const inputFields: InputField[] = fields.map(f => ({
        field_name: f.field_name,
        field_label: f.field_label,
        field_description: f.field_description,
        field_type: f.field_type,
        field_values: f.field_values,
        required: f.required,
        default_value: f.default_value,
        placeholder: f.placeholder,
      }));

      setPendingUserInput({
        messageId: assistantMsgId,
        metadata: {
          user_input: true,
          input_title: "Input Required",
          input_description: prompt,
          input_fields: inputFields,
        },
        contextId: convId,
        isSSE: true,
        agentId,
      });

      if (prompt) {
        loopState.accumulatedText = prompt;
        updateMessage(convId, assistantMsgId, { content: loopState.accumulatedText });
      }
    },

    onWarning(message, namespace) {
      const streamEvent = createStreamEvent("warning", {
        message,
        namespace: namespace ?? [],
      });
      addStreamEvent(streamEvent, convId);
    },

    onDone() {
      // Finalization handled after adapter.streamMessage resolves
    },

    onError(message) {
      console.error("[DynamicAgent] Stream error event:", message);
      loopState.hasError = true;
    },
  }), [agentId, addStreamEvent, updateMessage, setPendingUserInput, setFilesFetchKey, setTodosFetchKey]);

  /**
   * Finalize a stream loop — copies conversation-level streamEvents to the
   * message for persistence, determines turn status, and saves to MongoDB.
   */
  const finalizeStreamLoop = useCallback((
    conversationId: string,
    assistantMsgId: string,
    state: StreamLoopState,
  ) => {
    // Check if the message was already finalized (e.g., by cancelConversationRequest)
    const currentConv = useChatStore.getState().conversations.find((c: Conversation) => c.id === conversationId);
    const currentMsg = currentConv?.messages.find((m: ChatMessageType) => m.id === assistantMsgId);
    const wasAlreadyCancelled = currentMsg?.isFinal && currentMsg?.turnStatus === "interrupted";

    // Copy conversation-level streamEvents to the message for persistence.
    const turnStreamEvents = currentConv?.streamEvents || [];

    if (wasAlreadyCancelled) {
      saveMessagesToServer(conversationId).catch((err) => {
        console.error('[DynamicAgent] Failed to save cancelled messages:', err);
      });
      return;
    }

    const isFinal = !state.hitlFormRequested;
    const turnStatus: TurnStatus = state.hitlFormRequested
      ? "waiting_for_input"
      : state.hasError
        ? "interrupted"
        : "done";

    updateMessage(conversationId, assistantMsgId, {
      content: state.accumulatedText,
      rawStreamContent: state.rawStreamContent,
      isFinal,
      turnStatus,
      streamEvents: turnStreamEvents.length > 0 ? turnStreamEvents : undefined,
    });
    setConversationStreaming(conversationId, null);
    saveMessagesToServer(conversationId).catch((err) => {
      console.error('[DynamicAgent] Failed to save messages:', err);
    });
  }, [updateMessage, setConversationStreaming, saveMessagesToServer]);

  // Core submit function that accepts a message directly
  const submitMessage = useCallback(async (messageToSend: string) => {
    if (!messageToSend.trim() || isThisConversationStreaming) return;

    // Create conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation(agentId);
    }

    // Clear previous turn's events
    clearStreamEvents(convId);

    // Add user message - generate turnId for this request/response pair
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    addMessage(convId, {
      role: "user",
      content: messageToSend,
      senderEmail: session?.user?.email ?? undefined,
      senderName: session?.user?.name ?? undefined,
      senderImage: session?.user?.image ?? undefined,
    }, turnId);

    // Add assistant message placeholder with same turnId
    const assistantMsgId = addMessage(convId, { role: "assistant", content: "" }, turnId);

    // Create protocol-agnostic adapter
    const adapter = createStreamAdapter({
      protocol: agentProtocol as "custom" | "agui",
      baseUrl: "/api/dynamic-agents/chat",
      accessToken,
    });

    const loopState: StreamLoopState = {
      accumulatedText: "",
      rawStreamContent: "",
      hitlFormRequested: false,
      hasError: false,
    };
    const toolCallIdToName = new Map<string, string>();

    // Mark this conversation as streaming
    setConversationStreaming(convId, {
      conversationId: convId,
      messageId: assistantMsgId,
      client: { abort: () => adapter.abort() },
      streamAdapter: adapter,
    });

    try {
      const callbacks = buildStreamCallbacks(convId, assistantMsgId, loopState, toolCallIdToName);

      await adapter.streamMessage(
        { message: messageToSend, conversationId: convId, agentId },
        callbacks,
      );

      // Finalize the stream
      finalizeStreamLoop(convId, assistantMsgId, loopState);

    } catch (error) {
      console.error("[DynamicAgent] Stream error:", error);
      appendToMessage(convId, assistantMsgId, `\n\n**Error:** ${(error as Error).message || "Failed to connect to agent endpoint"}`);
      updateMessage(convId, assistantMsgId, { turnStatus: "interrupted" as TurnStatus });
      setConversationStreaming(convId, null);
      saveMessagesToServer(convId).catch((err) => {
        console.error('[DynamicAgent] Failed to save error messages:', err);
      });
    }
  }, [isThisConversationStreaming, activeConversationId, accessToken, agentId, agentProtocol, createConversation, clearStreamEvents, addMessage, appendToMessage, updateMessage, setConversationStreaming, saveMessagesToServer, buildStreamCallbacks, finalizeStreamLoop, session?.user]);

  // Handle queued messages after streaming completes
  useEffect(() => {
    if (!isThisConversationStreaming && queuedMessages.length > 0) {
      // Process first queued message
      const [firstMessage, ...remaining] = queuedMessages;
      setQueuedMessages(remaining);
      // Small delay to ensure previous message is fully processed
      setTimeout(() => {
        submitMessage(firstMessage);
      }, 300);
    }
  }, [isThisConversationStreaming, queuedMessages, submitMessage]);

  // Retry handler - re-sends the message content
  const handleRetry = useCallback((content: string) => {
    if (isThisConversationStreaming) return; // Don't retry while streaming
    submitMessage(content);
  }, [isThisConversationStreaming, submitMessage]);

  // Handle /skills chat command: fetch catalog and render in-chat (FR-002)
  const handleSkillsCommand = useCallback(async () => {
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation(agentId);
    }

    const turnId = `turn-${Date.now()}`;
    addMessage(convId, { role: "user", content: "/skills" }, turnId);

    // Set a descriptive title instead of "/skills"
    updateConversationTitle(convId, "Skills Catalog");

    const msgId = addMessage(convId, { role: "assistant", content: "Loading skills..." }, turnId);

    try {
      const res = await fetch("/api/skills?page=1&page_size=50", { credentials: "include" });
      if (!res.ok) {
        updateMessage(convId, msgId, { content: "Skills are temporarily unavailable. Please try again later.", isFinal: true });
        return;
      }
      const data = await res.json();
      const skills = data.skills || [];
      const total = typeof data.meta?.total === "number" ? data.meta.total : skills.length;
      const noMatches = data.meta?.message === "no_matches";
      if (skills.length === 0) {
        updateMessage(
          convId,
          msgId,
          {
            content: noMatches
              ? "No skills match your current search or filters. Open the skills page to adjust filters or add hubs."
              : "No skills available at the moment. Ask an admin to register hubs or agent config skills.",
            isFinal: true,
          },
        );
        return;
      }
      const more = total > skills.length ? ` (showing ${skills.length} of ${total})` : "";
      const lines = [
        `**Available Skills**${more}\n`,
        ...skills.map((s: { name: string; description: string; source: string }) =>
          `- **${s.name}**: ${s.description} *(${s.source})*`
        ),
        "\n*Same catalog as the skills page (first page). Type /skills any time to refresh.*",
      ];
      updateMessage(convId, msgId, { content: lines.join("\n"), isFinal: true });
    } catch {
      updateMessage(convId, msgId, { content: "Skills are temporarily unavailable. Please try again later.", isFinal: true });
    }
  }, [activeConversationId, createConversation, addMessage, updateMessage, updateConversationTitle]);

  // Handle /help command: show available commands in chat
  const handleHelpCommand = useCallback(() => {
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation(agentId);
    }
    const turnId = `turn-${Date.now()}`;
    addMessage(convId, { role: "user", content: "/help" }, turnId);

    // Set a descriptive title instead of "/help"
    updateConversationTitle(convId, "Help & Commands");

    const agentLines = DEFAULT_AGENTS.map(a => `  \`/@${a.id}\` — ${a.label} agent`).join("\n");
    const helpText = [
      "**Available Commands**\n",
      "  `/skills` — List all available skills",
      "  `/help` — Show this help message",
      "  `/clear` — Clear the current conversation",
      "",
      "**Agents** (inserts @mention, then keep typing your question)\n",
      agentLines,
      "",
      "*Type `/` to see the autocomplete menu. Use Arrow keys + Tab to select.*",
    ].join("\n");

    addMessage(convId, { role: "assistant", content: helpText, isFinal: true } as any, turnId);
  }, [activeConversationId, createConversation, addMessage, updateConversationTitle]);

  // Handle /clear command
  const handleClearCommand = useCallback(() => {
    createConversation(agentId);
  }, [createConversation, agentId]);

  // Unified slash command executor
  const executeSlashCommand = useCallback(async (commandId: string) => {
    switch (commandId) {
      case "skills":
        await handleSkillsCommand();
        break;
      case "help":
        handleHelpCommand();
        break;
      case "clear":
        handleClearCommand();
        break;
    }
  }, [handleSkillsCommand, handleHelpCommand, handleClearCommand]);

  // Wrapper for form submission that uses input state
  const handleSubmit = useCallback(async (forceSend = false) => {
    if (!input.trim()) return;

    // Check for slash commands via the registry
    const trimmed = input.trim();
    if (trimmed.startsWith("/")) {
      const cmdName = trimmed.slice(1).toLowerCase();
      const cmd = slashCommands.find(
        (c) => c.action === "execute" && c.id === cmdName,
      );
      if (cmd) {
        setInput("");
        await executeSlashCommand(cmd.id);
        return;
      }
    }

    // If streaming and not force sending, queue the message (up to 3)
    if (isThisConversationStreaming && !forceSend) {
      const message = input.trim();

      // Add to queue if under limit
      if (queuedMessages.length < 3) {
        setQueuedMessages(prev => [...prev, message]);
        setInput("");
      } else {
        // Queue is full
        console.log("Queue is full (3/3). Send or cancel messages to queue more.");
      }
      return;
    }

    // If streaming and force sending, stop current task first
    if (isThisConversationStreaming && forceSend) {
      handleStop();
      // Clear queued messages when force sending
      setQueuedMessages([]);
      // Wait a bit for cancellation to process
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const message = input.trim();

    // Dismiss any pending input form when user types text directly
    if (pendingUserInput) {
      dismissedInputForMessageRef.current.add(pendingUserInput.messageId);
      setPendingUserInput(null);
    }

    setInput("");

    await submitMessage(message);
  }, [input, submitMessage, isThisConversationStreaming, queuedMessages, pendingUserInput, slashCommands, executeSlashCommand]);

  // Auto-submit pending message from use case selection
  useEffect(() => {
    const pendingMessage = consumePendingMessage();
    if (pendingMessage) {
      submitMessage(pendingMessage);
    }
  }, [activeConversationId, consumePendingMessage, submitMessage]);

  const handleStop = useCallback(() => {
    if (activeConversationId) {
      cancelConversationRequest(activeConversationId);
    }
  }, [activeConversationId, cancelConversationRequest]);

  // Stable callback for feedback changes
  const handleFeedbackChange = useCallback((messageId: string, feedback: Feedback) => {
    if (activeConversationId) {
      updateMessageFeedback(activeConversationId, messageId, feedback);
    }
  }, [activeConversationId, updateMessageFeedback]);

  // Feedback submission is handled by FeedbackButton → POST /api/feedback
  // which writes to both Langfuse and the unified feedback MongoDB collection.
  const handleFeedbackSubmit = useCallback(async (_messageId: string, _feedback: Feedback) => {
    // no-op: POST /api/feedback handles both Langfuse + MongoDB
  }, []);

  // Handle user input form submission via SSE/Dynamic Agents resume
  const handleUserInputSubmitSSE = useCallback(async (formData: Record<string, string>) => {
    if (!pendingUserInput || !activeConversationId || !pendingUserInput.agentId) return;

    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const selectionSummary = Object.entries(formData)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    addMessage(activeConversationId, { role: "user", content: selectionSummary || "Form submitted." }, turnId);
    const assistantMsgId = addMessage(activeConversationId, { role: "assistant", content: "" }, turnId);

    dismissedInputForMessageRef.current.add(pendingUserInput.messageId);
    const resumeAgentId = pendingUserInput.agentId;
    setPendingUserInput(null);

    // Clear previous turn's events before starting resume stream
    clearStreamEvents(activeConversationId);

    // Create protocol-agnostic adapter for resume
    const adapter = createStreamAdapter({
      protocol: agentProtocol as "custom" | "agui",
      baseUrl: "/api/dynamic-agents/chat",
      accessToken,
    });

    // Send form data as JSON string
    const formDataJson = JSON.stringify(formData);

    setConversationStreaming(activeConversationId, {
      conversationId: activeConversationId,
      messageId: assistantMsgId,
      client: { abort: () => adapter.abort() },
      streamAdapter: adapter,
    });

    const loopState: StreamLoopState = {
      accumulatedText: "",
      rawStreamContent: "",
      hitlFormRequested: false,
      hasError: false,
    };
    const toolCallIdToName = new Map<string, string>();

    try {
      const callbacks = buildStreamCallbacks(activeConversationId, assistantMsgId, loopState, toolCallIdToName);

      await adapter.resumeStream(
        { conversationId: activeConversationId, agentId: resumeAgentId, formData: formDataJson },
        callbacks,
      );

      // Finalize the stream
      finalizeStreamLoop(activeConversationId, assistantMsgId, loopState);

    } catch (error) {
      console.error("[DynamicAgent] HITL resume error:", error);
      appendToMessage(activeConversationId, assistantMsgId,
        `\n\n**Error:** ${(error as Error).message || "Failed to resume"}`);
      updateMessage(activeConversationId, assistantMsgId, { turnStatus: "interrupted" as TurnStatus });
      setConversationStreaming(activeConversationId, null);
      saveMessagesToServer(activeConversationId).catch((err) => {
        console.error('[DynamicAgent] Failed to save HITL resume error messages:', err);
      });
    }
  }, [pendingUserInput, activeConversationId, accessToken, agentProtocol, addMessage, updateMessage,
      appendToMessage, setConversationStreaming, saveMessagesToServer,
      clearStreamEvents, buildStreamCallbacks, finalizeStreamLoop]);

  // Handle slash command detection in input
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInput(newValue);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);

    // Detect / at start of input or after a newline
    const lastSlash = textBeforeCursor.lastIndexOf("/");
    if (lastSlash !== -1) {
      const charBefore = lastSlash > 0 ? textBeforeCursor[lastSlash - 1] : undefined;
      const isAtStart = lastSlash === 0 || charBefore === "\n";

      if (isAtStart) {
        const filterText = textBeforeCursor.slice(lastSlash + 1);
        if (!filterText.includes(" ") && !filterText.includes("\n")) {
          setSlashFilter(filterText);
          setShowSlashMenu(true);
          setSlashSelectedIndex(0);
          return;
        }
      }
    }

    setShowSlashMenu(false);
  }, []);

  // Handle slash command selection (Tab/Enter/click)
  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashMenu(false);

    if (cmd.action === "execute") {
      setInput("");
      executeSlashCommand(cmd.id);
      return;
    }

    // Insert commands
    if (cmd.category === "agent") {
      // Agent: replace /text with @agentname + trailing space
      const cursorPos = inputRef.current?.selectionStart ?? input.length;
      const textBeforeCursor = input.slice(0, cursorPos);
      const lastSlash = textBeforeCursor.lastIndexOf("/");
      const textBefore = lastSlash >= 0 ? input.slice(0, lastSlash) : "";
      const textAfter = input.slice(cursorPos);
      const newText = textBefore + cmd.value + " " + textAfter;

      setInput(newText);
      setTimeout(() => {
        if (inputRef.current) {
          const newPos = textBefore.length + cmd.value.length + 1;
          inputRef.current.selectionStart = newPos;
          inputRef.current.selectionEnd = newPos;
          inputRef.current.focus();
        }
      }, 0);
    } else if (cmd.category === "skill") {
      // Skill: send a rich prompt so the supervisor recognizes the skill invocation
      setInput("");
      const skillPrompt = `Execute skill: ${cmd.value}\n\nRead and follow the instructions in the SKILL.md file for the "${cmd.value}" skill.`;
      submitMessage(skillPrompt).then(() => {
        const convId = activeConversationId;
        if (convId) {
          updateConversationTitle(convId, `Skill: ${cmd.label}`);
        }
      });
    }
  }, [input, executeSlashCommand, submitMessage, activeConversationId, updateConversationTitle]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash menu keyboard navigation
    if (showSlashMenu) {
      const filtered = getFilteredCommands(slashCommands, slashFilter);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        if (filtered.length > 0) {
          handleSlashSelect(filtered[slashSelectedIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    // Force send: Cmd/Ctrl + Enter
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(true); // Force send
      return;
    }
    // Normal send: Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(false);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-background relative">
      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1" viewportRef={scrollViewportRef}>
          <div className="max-w-7xl mx-auto pl-1 pr-1 py-4 space-y-6">
            {!conversation?.messages.length && (
              <div className="text-center py-20">
                {isLoadingMessages ? (
                  <>
                    <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 text-white animate-spin" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Loading conversation...</h2>
                    <p className="text-muted-foreground max-w-md mx-auto mb-1">
                      Retrieving your conversation history
                    </p>
                  </>
                ) : (
                  <>
                    {(() => {
                      const gradientStyle = agentGradient ? getGradientStyle(agentGradient) : null;
                      return (
                        <div 
                          className={cn(
                            "w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center",
                            !gradientStyle && "bg-gradient-to-br from-primary to-primary/60"
                          )}
                          style={gradientStyle || undefined}
                        >
                          <Sparkles className="h-8 w-8 text-white" />
                        </div>
                      );
                    })()}
                    <h2 className="text-2xl font-bold mb-4">Welcome to {getConfig('appName')}</h2>
                    <p className="text-muted-foreground mb-3">
                      Start your conversation with
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      {(() => {
                        const gradientStyle = agentGradient ? getGradientStyle(agentGradient) : null;
                        return (
                          <div 
                            className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center",
                              !gradientStyle && "bg-gradient-to-br from-primary to-primary/60"
                            )}
                            style={gradientStyle || undefined}
                          >
                            <Bot className="h-4 w-4 text-white" />
                          </div>
                        );
                      })()}
                      <span className="text-lg font-semibold">
                        {agentName || "your agent"}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            <AnimatePresence mode="popLayout">
              {(() => {
                const allMessages = deduplicateByKey(conversation?.messages ?? [], (msg) => msg.id);
                const turns = groupMessagesIntoTurns(allMessages);
                
                // Progressive loading: show only the most recent N turns
                const totalTurns = turns.length;
                const effectiveVisibleCount = Math.min(visibleTurnCount, totalTurns);
                const hiddenTurnCount = Math.max(0, totalTurns - effectiveVisibleCount);
                const visibleTurns = turns.slice(-effectiveVisibleCount);
                
                // Flatten visible turns to messages for rendering
                const visibleMessages = visibleTurns.flatMap(t =>
                  [t.userMsg, t.assistantMsg].filter(Boolean) as ChatMessageType[]
                );

                // Build a Set of visible message IDs for quick lookup
                const visibleMsgIds = new Set(visibleMessages.map(m => m.id));
                const renderMessages = allMessages.filter(m => visibleMsgIds.has(m.id));

                // Handle loading more turns
                const handleLoadMore = async () => {
                  // Capture scroll position before loading
                  if (scrollViewportRef.current) {
                    const viewport = scrollViewportRef.current;
                    scrollDistanceFromBottomRef.current = viewport.scrollHeight - viewport.scrollTop;
                  }
                  
                  // Increase visible turn count
                  const newVisibleCount = Math.min(visibleTurnCount + LOAD_MORE_BATCH_SIZE, totalTurns);
                  setVisibleTurnCount(newVisibleCount);
                  
                  // Re-load messages from MongoDB to restore evicted content
                  if (activeConversationId) {
                    await loadMessagesFromServer(activeConversationId, { force: true });
                  }
                  
                  // Restore scroll position after render (use rAF to wait for layout)
                  requestAnimationFrame(() => {
                    if (scrollViewportRef.current && scrollDistanceFromBottomRef.current !== null) {
                      const viewport = scrollViewportRef.current;
                      viewport.scrollTop = viewport.scrollHeight - scrollDistanceFromBottomRef.current;
                      scrollDistanceFromBottomRef.current = null;
                    }
                  });
                };

                return (
                  <>
                    {/* Load earlier turns divider */}
                    {hiddenTurnCount > 0 && (
                      <LoadEarlierDivider
                        key="load-earlier"
                        count={hiddenTurnCount}
                        onLoad={handleLoadMore}
                      />
                    )}

                    {/* Rendered messages (visible turns only) */}
                    {renderMessages.map((msg, index, arr) => {
                      const isLastMessage = index === arr.length - 1;
                      const isAssistantStreaming = isThisConversationStreaming && msg.role === "assistant" && isLastMessage;

                      // For retry: if user message, use its content; if assistant, find preceding user message
                      const getRetryContent = () => {
                        if (msg.role === "user") return msg.content;
                        for (let i = index - 1; i >= 0; i--) {
                          if (arr[i].role === "user") {
                            return arr[i].content;
                          }
                        }
                        return null;
                      };

                      // Check if this is the last assistant message (latest answer)
                      const isLastAssistantMessage = msg.role === "assistant" &&
                        index === arr.length - 1;

                      // Get SSE events for this message turn:
                      // - For completed messages: use msg.streamEvents (persisted with the message)
                      // - For streaming (latest message): use conversation.streamEvents (live buffer)
                      // - Fall back to timestamp-based filtering if msg.streamEvents is not available
                      const isStreaming = isLastAssistantMessage && isThisConversationStreaming;
                      let turnEvents: StreamEvent[];
                      
                      if (msg.role !== "assistant") {
                        turnEvents = [];
                      } else if (isStreaming) {
                        // Streaming: use live buffer from conversation
                        turnEvents = conversation?.streamEvents ?? [];
                      } else if (msg.streamEvents && msg.streamEvents.length > 0) {
                        // Completed message with persisted events
                        turnEvents = msg.streamEvents;
                      } else {
                        // Fall back to timestamp-based filtering (legacy/edge cases)
                        turnEvents = filterEventsForTurn(
                          conversation?.streamEvents ?? [],
                          msg,
                          allMessages,
                          allMessages.findIndex(m => m.id === msg.id)
                        );
                      }

                      return (
                        <ChatMessage
                          key={msg.id}
                          message={msg}
                          onCopy={handleCopy}
                          isCopied={copiedId === msg.id}
                          isStreaming={isAssistantStreaming}
                          isLatestAnswer={isLastAssistantMessage}
                          onStop={isAssistantStreaming ? handleStop : undefined}
                          onRetry={getRetryContent() ? () => handleRetry(getRetryContent()!) : undefined}
                          feedback={msg.feedback}
                          onFeedbackChange={(feedback) => handleFeedbackChange(msg.id, feedback)}
                          onFeedbackSubmit={(feedback) => handleFeedbackSubmit(msg.id, feedback)}
                          isRecovering={recoveringMessageId === msg.id}
                          conversationId={conversationId}
                          userDisplayName={userDisplayName}
                          showTimestamp={showTimestamps}
                          agentGradient={agentGradient}
                          agentName={agentName}
                          turnEvents={turnEvents}
                          // Timeline props (only passed to latest message)
                          timelineFiles={timelineFiles}
                          timelineTasks={timelineTasks}
                          onFileDownload={handleTimelineFileDownload}
                          onFileDelete={handleTimelineFileDelete}
                          isDownloadingFile={isDownloadingFile}
                          downloadingFilePath={downloadingFilePath}
                          isDeletingFile={isDeletingFile}
                          deletingFilePath={deletingFilePath}
                          getSubagentInfo={getSubagentInfo}
                        />
                      );
                    })}
                  </>
                );
              })()}
            </AnimatePresence>

            {/* User Input Form */}
            {pendingUserInput && pendingUserInput.metadata.input_fields && (
              <MetadataInputForm
                messageId={pendingUserInput.messageId}
                title={pendingUserInput.metadata.input_title}
                description={pendingUserInput.metadata.input_description}
                inputFields={pendingUserInput.metadata.input_fields}
                onSubmit={handleUserInputSubmitSSE}
                onCancel={() => {
                  if (pendingUserInput) {
                    dismissedInputForMessageRef.current.add(pendingUserInput.messageId);
                    // For SSE, send dismissal message to resume the agent
                    if (pendingUserInput.isSSE && pendingUserInput.agentId && activeConversationId) {
                      const dismissAdapter = createStreamAdapter({
                        protocol: agentProtocol as "custom" | "agui",
                        baseUrl: "/api/dynamic-agents/chat",
                        accessToken,
                      });
                      // Fire-and-forget: resume with rejection message
                      const dismissalMessage = "User dismissed the input form without providing values.";
                      dismissAdapter.resumeStream(
                        {
                          conversationId: activeConversationId,
                          agentId: pendingUserInput.agentId,
                          formData: dismissalMessage,
                        },
                        {}, // No callbacks — we don't render the response
                      ).catch((err) => {
                        console.error("[ChatPanel] Error sending SSE form dismissal:", err);
                      });
                    }
                  }
                  setPendingUserInput(null);
                }}
                disabled={isThisConversationStreaming}
              />
            )}

            {/* Invisible marker for scroll-to-bottom */}
            <div ref={messagesEndRef} className="h-px" />
          </div>
        </ScrollArea>
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollButton && conversation?.messages.length && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10"
          >
            <Button
              onClick={() => scrollToBottom("smooth")}
              size="sm"
              variant="secondary"
              className="rounded-full shadow-lg border border-border/50 gap-1.5 px-4 hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <ArrowDown className="h-4 w-4" />
              <span className="text-xs font-medium">New messages</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area - Fixed bottom, doesn't scroll */}
      {readOnly ? (
        <div className={`border-t border-border shrink-0 ${readOnlyReason === 'agent_deleted' || readOnlyReason === 'agent_disabled' ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
            <div className={`flex items-center gap-2 ${readOnlyReason === 'agent_deleted' || readOnlyReason === 'agent_disabled' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {readOnlyReason === 'admin_audit' ? (
                <>
                  <span className="text-sm font-medium">Read-Only Audit Mode</span>
                  <span className="text-xs text-amber-600 dark:text-amber-500">— You are viewing this conversation as an admin auditor.</span>
                </>
              ) : readOnlyReason === 'agent_deleted' ? (
                <>
                  <span className="text-sm font-medium">Agent No Longer Exists</span>
                  <span className="text-xs text-red-600 dark:text-red-500">— This agent has been deleted. You can view the history but cannot send new messages.</span>
                </>
              ) : readOnlyReason === 'agent_disabled' ? (
                <>
                  <span className="text-sm font-medium">Agent Disabled</span>
                  <span className="text-xs text-red-600 dark:text-red-500">— This agent has been disabled by an administrator. You can view the history but cannot send new messages.</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">View Only</span>
                  <span className="text-xs text-amber-600 dark:text-amber-500">— This conversation was shared with you as read-only.</span>
                </>
              )}
            </div>
            {readOnlyReason === 'admin_audit' && (
            <a
              href="/admin?tab=feedback"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600/20 text-amber-700 dark:text-amber-300 hover:bg-amber-600/30 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Feedback
            </a>
            )}
          </div>
        </div>
      ) : (
      <div className="border-t border-border bg-background shrink-0">
        <div className="max-w-7xl mx-auto px-6 py-3 space-y-2">
          {/* Queued Messages Display */}
          {queuedMessages.length > 0 && (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {queuedMessages.map((queuedMsg, index) => (
                  <motion.div
                    key={`${index}-${queuedMsg.slice(0, 20)}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg border border-border/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          Queued {queuedMessages.length > 1 ? `(${index + 1}/${queuedMessages.length})` : 'message'}:
                        </span>
                        <button
                          onClick={() => {
                            setQueuedMessages(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          title="Remove this queued message"
                        >
                          ×
                        </button>
                      </div>
                      <p className="text-sm text-foreground/90 break-words">{queuedMsg}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {queuedMessages.length >= 3 && (
                <div className="text-xs text-muted-foreground px-3">
                  Maximum of 3 queued messages. Send or cancel messages to queue more.
                </div>
              )}
            </div>
          )}

          <div className="relative">
            {/* Slash command autocomplete menu */}
            <SlashCommandMenu
              filter={slashFilter}
              commands={slashCommands}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSlashSelect}
              visible={showSlashMenu}
            />

            <div className="relative flex items-center gap-3 bg-card rounded-xl border border-border p-3 transition-all duration-200">
              <TextareaAutosize
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  isThisConversationStreaming
                    ? queuedMessages.length >= 3
                      ? "Queue full (3/3). Send or cancel messages to queue more, or Cmd+Enter to force send..."
                      : `Type to queue message (${queuedMessages.length}/3), or Cmd+Enter to force send...`
                    : `Ask anything, or type / to see commands, skills, and agents...`
                }
                className="flex-1 bg-transparent resize-none outline-none px-3 py-2.5 text-sm"
                minRows={1}
                maxRows={10}
              />
            {/* Send/Stop button - toggles based on streaming state */}
            {isThisConversationStreaming ? (
              <Button
                size="icon"
                onClick={handleStop}
                variant="destructive"
                className="shrink-0"
                title="Stop generating"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => handleSubmit(false)}
                disabled={!input.trim()}
                variant="default"
                className="shrink-0"
                title="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {getConfig('appName')} can make mistakes. Verify important info.
            {getConfig('auditLogsEnabled') && ' · Conversations are logged for audit.'}
          </p>
        </div>
      </div>
      )}
    </div>
  );
}

/**
 * Filter SSE events for a specific message turn based on timestamps.
 * Returns events that occurred between this message and the next user message.
 * 
 * NOTE: This is a fallback for legacy messages. Prefer using msg.streamEvents directly
 * for completed messages, as the message timestamp may be after all events finished.
 */
function filterEventsForTurn(
  streamEvents: StreamEvent[],
  message: ChatMessageType,
  allMessages: ChatMessageType[],
  messageIndex: number
): StreamEvent[] {
  if (message.role !== "assistant") return [];
  
  const msgTime = new Date(message.timestamp).getTime();
  
  // Find next user message timestamp (or use Infinity for latest)
  let endTime = Infinity;
  for (let i = messageIndex + 1; i < allMessages.length; i++) {
    if (allMessages[i].role === "user") {
      endTime = new Date(allMessages[i].timestamp).getTime();
      break;
    }
  }
  
  // Filter events within this turn's time window
  // Events without timestamps are assumed to be from this turn if it's the latest
  return streamEvents.filter(e => {
    if (!e.timestamp) {
      // For events without timestamps, include only if this is the latest assistant message
      return messageIndex === allMessages.length - 1 || 
             (messageIndex === allMessages.length - 2 && allMessages[allMessages.length - 1].role === "assistant");
    }
    const eventTime = new Date(e.timestamp).getTime();
    return eventTime >= msgTime && eventTime < endTime;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Window: Progressive loading of older turns
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_VISIBLE_TURNS = 3;
const LOAD_MORE_BATCH_SIZE = 3;

interface Turn {
  userMsg?: ChatMessageType;
  assistantMsg?: ChatMessageType;
  preview: string;
  timestamp: Date;
}

function groupMessagesIntoTurns(messages: ChatMessageType[]): Turn[] {
  const turns: Turn[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user" && i + 1 < messages.length && messages[i + 1].role === "assistant") {
      const assistantMsg = messages[i + 1];
      turns.push({
        userMsg: msg,
        assistantMsg,
        preview: msg.content.slice(0, 80).trim() + (msg.content.length > 80 ? "..." : ""),
        timestamp: msg.timestamp,
      });
      i += 2;
    } else {
      turns.push({
        ...(msg.role === "user" ? { userMsg: msg } : { assistantMsg: msg }),
        preview: msg.content.slice(0, 80).trim() + (msg.content.length > 80 ? "..." : ""),
        timestamp: msg.timestamp,
      });
      i += 1;
    }
  }
  return turns;
}

/**
 * Subtle divider that shows how many earlier turns are available to load.
 * Clicking loads the next batch progressively.
 */
const LoadEarlierDivider = React.memo(function LoadEarlierDivider({
  count,
  onLoad,
}: {
  count: number;
  onLoad: () => void;
}) {
  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onLoad}
      className={cn(
        "w-full flex items-center justify-center gap-2 py-3 my-2",
        "text-xs text-muted-foreground hover:text-foreground transition-colors group cursor-pointer"
      )}
    >
      <span className="flex-1 h-px bg-border/40 group-hover:bg-border/60 transition-colors" />
      <span className="flex items-center gap-1.5 px-3">
        <ChevronUp className="h-3 w-3" />
        {count} earlier
      </span>
      <span className="flex-1 h-px bg-border/40 group-hover:bg-border/60 transition-colors" />
    </motion.button>
  );
});

interface ChatMessageProps {
  message: ChatMessageType;
  onCopy: (content: string, id: string) => void;
  isCopied: boolean;
  isStreaming?: boolean;
  isLatestAnswer?: boolean;
  onStop?: () => void;
  onRetry?: () => void;
  feedback?: Feedback;
  onFeedbackChange?: (feedback: Feedback) => void;
  onFeedbackSubmit?: (feedback: Feedback) => void;
  conversationId?: string;
  isRecovering?: boolean;
  userDisplayName?: string;
  showTimestamp?: boolean;
  agentGradient?: string | null;
  agentName?: string;
  turnEvents?: StreamEvent[];
  // Timeline props (for DynamicAgentTimeline)
  timelineFiles?: string[];
  timelineTasks?: TaskItem[];
  onFileDownload?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  isDownloadingFile?: boolean;
  downloadingFilePath?: string;
  isDeletingFile?: boolean;
  deletingFilePath?: string;
  getSubagentInfo?: (agentId: string) => SubagentLookupInfo | undefined;
}

const ChatMessage = React.memo(function ChatMessage({
  message,
  onCopy,
  isCopied,
  isStreaming = false,
  isLatestAnswer = false,
  onStop,
  onRetry,
  feedback,
  onFeedbackChange,
  onFeedbackSubmit,
  conversationId,
  isRecovering = false,
  userDisplayName = "You",
  showTimestamp = false,
  agentGradient,
  agentName,
  turnEvents = [],
  // Timeline props
  timelineFiles = [],
  timelineTasks = [],
  onFileDownload,
  onFileDelete,
  isDownloadingFile,
  downloadingFilePath,
  isDeletingFile,
  deletingFilePath,
  getSubagentInfo,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [isHovered, setIsHovered] = useState(false);

  const displayContent = message.content;

  // Transform SSE events into grouped timeline data for assistant messages
  // Use turnStatus from message (defaults to "done" for backward compatibility)
  const { data: timelineData } = useDynamicAgentTimeline(
    turnEvents, 
    isStreaming, 
    message.turnStatus
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn(
        "flex gap-3 group px-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {(() => {
        const gradientStyle = !isUser && agentGradient ? getGradientStyle(agentGradient) : null;
        return (
          <div
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm overflow-hidden",
              isUser
                ? "bg-primary"
                : !gradientStyle && "gradient-primary-br",
              isStreaming && "animate-pulse"
            )}
            style={gradientStyle || undefined}
          >
            {isUser ? (
              message.senderImage ? (
                <img
                  src={message.senderImage}
                  alt={message.senderName || userDisplayName}
                  className="w-9 h-9 rounded-xl object-cover"
                />
              ) : (
                <User className="h-4 w-4 text-white" />
              )
            ) : isStreaming ? (
              <Loader2 className="h-4 w-4 text-white animate-spin" />
            ) : (
              <Bot className="h-4 w-4 text-white" />
            )}
          </div>
        );
      })()}

      <div className={cn(
        "flex-1 min-w-0",
        isUser ? "max-w-[85%] text-right ml-auto" : "max-w-full"
      )}>
        <div className={cn(
          "flex items-center mb-1.5",
          isUser
            ? "text-primary justify-end"
            : "text-muted-foreground justify-between"
        )}>
          {isUser ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">
                {message.senderName
                  ? message.senderName.split(" ")[0]
                  : userDisplayName}
              </span>
              {showTimestamp && (
                <span className="text-[10px] text-muted-foreground/60 font-normal">
                  {message.timestamp instanceof Date
                    ? message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{agentName || getConfig('appName')}</span>
                {showTimestamp && (
                  <span className="text-[10px] text-muted-foreground/60 font-normal">
                    {message.timestamp instanceof Date
                      ? message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
              </div>
            </>
          )}
        </div>

        {isUser ? (
          // ── User message bubble ──
          <>
            <div
              className="rounded-xl rounded-tr-sm relative overflow-hidden inline-block bg-primary text-primary-foreground px-4 py-3 max-w-full selection:bg-primary-foreground selection:text-primary"
            >
              <div className="overflow-hidden break-words text-left" style={{ overflowWrap: 'anywhere' }}>
                <MarkdownRenderer content={message.content} variant="user" />
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: isHovered ? 1 : 0.8 }}
              className="flex items-center gap-1 mt-2 justify-end"
            >
              {onRetry && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={onRetry}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Retry this prompt
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={() => onCopy(message.content, message.id)}
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isCopied ? "Copied!" : "Copy message"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </motion.div>
          </>
        ) : (
          // ── Assistant message ──
          <>
            {/* Recovery / interrupted banner */}
            {(isRecovering || message.isInterrupted) && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg border mb-3",
                  isRecovering
                    ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                )}
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Recovering interrupted task...</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Activity className="h-4 w-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Response was interrupted</p>
                    </div>
                    {onRetry && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onRetry}
                        className="shrink-0 gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* Main content: timeline (streaming or completed with events) or fallback */}
            {isStreaming || turnEvents.length > 0 ? (
              <DynamicAgentTimeline
                data={timelineData}
                files={isLatestAnswer ? timelineFiles : []}
                tasks={isLatestAnswer ? timelineTasks : []}
                isLatestMessage={isLatestAnswer}
                onFileDownload={onFileDownload}
                onFileDelete={onFileDelete}
                isDownloadingFile={isDownloadingFile}
                downloadingFilePath={downloadingFilePath}
                isDeletingFile={isDeletingFile}
                deletingFilePath={deletingFilePath}
                getSubagentInfo={getSubagentInfo}
              />
            ) : displayContent ? (
              // Legacy fallback: completed message with no persisted events
              <div className="rounded-xl bg-card/50 border border-border/50 px-4 py-3">
                <MarkdownRenderer content={displayContent} />
              </div>
            ) : null}

            {/* Action buttons (copy, retry, collapse) */}
            {displayContent && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isHovered ? 1 : 0.8 }}
                className="flex items-center gap-1 mt-2"
              >
                {onRetry && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={onRetry}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Regenerate response
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={() => onCopy(displayContent, message.id)}
                      >
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isCopied ? "Copied!" : "Copy response"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <div className="h-4 w-px bg-border/50" />

                <FeedbackButton
                  messageId={message.id}
                  conversationId={conversationId}
                  feedback={feedback}
                  onFeedbackChange={onFeedbackChange}
                  onFeedbackSubmit={onFeedbackSubmit}
                />
              </motion.div>
            )}

          </>
        )}
      </div>
    </motion.div>
  );
});

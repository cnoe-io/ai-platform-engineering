"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, ArrowLeft, RotateCcw, Activity, MessageSquare, Clock, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { DynamicAgentClient } from "@/lib/dynamic-agent-client";
import { type SSEAgentEvent, type ToolStartEventData, type ToolEndEventData, isToolStartData, FILE_TOOL_NAMES, TODO_TOOL_NAME } from "@/components/dynamic-agents/sse-types";
import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { cn, deduplicateByKey } from "@/lib/utils";
import { ChatMessage as ChatMessageType, TurnStatus, Conversation } from "@/types/a2a";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { MetadataInputForm, type UserInputMetadata, type InputField } from "./MetadataInputForm";
import { getGradientStyle } from "@/lib/gradient-themes";
import { InlineEventCard } from "./InlineEventCard";
import { DynamicAgentTimeline, type SubagentLookupInfo } from "./DynamicAgentTimeline";
import { useDynamicAgentTimeline } from "@/hooks/useDynamicAgentTimeline";
import type { TaskItem } from "@/components/shared/timeline";
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
  // Removed mention menu state
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
    // addEventToMessage, // Unused?
    // addA2AEvent, // Removed
    // clearA2AEvents, // Removed
    addSSEEvent,
    clearSSEEvents,
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
  } = useChatStore();

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
  // Depend on both message content AND sseEvents length since timeline renders from SSE events
  useEffect(() => {
    if (autoScrollEnabled && isThisConversationStreaming && !isUserScrolledUp) {
      scrollToBottom("instant");
    }
  }, [conversation?.messages?.at(-1)?.content, conversation?.sseEvents?.length, isThisConversationStreaming, isUserScrolledUp, scrollToBottom, autoScrollEnabled]);

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

  // Detect file write events and trigger a fetch
  useEffect(() => {
    const events = conversation?.sseEvents || [];
    const hasFileWriteEvent = events.some(
      (e) =>
        e.type === "tool_start" &&
        isToolStartData(e.toolData) &&
        FILE_TOOL_NAMES.includes(e.toolData.tool_name as typeof FILE_TOOL_NAMES[number])
    );
    if (hasFileWriteEvent) {
      setFilesFetchKey((k) => k + 1);
    }
  }, [conversation?.sseEvents]);

  // Detect write_todos tool events and trigger a fetch
  useEffect(() => {
    const events = conversation?.sseEvents || [];
    const hasWriteTodosEvent = events.some(
      (e) => e.type === "tool_start" && isToolStartData(e.toolData) && e.toolData.tool_name === TODO_TOOL_NAME
    );
    if (hasWriteTodosEvent) {
      setTodosFetchKey((k) => k + 1);
    }
  }, [conversation?.sseEvents]);

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

  // Track last message events length to re-trigger restoration when events load
  const lastMsgEventsLen = conversation?.messages?.[conversation.messages.length - 1]?.events?.length ?? 0;

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
    // Note: Only sseEvents have the input_required type. Message events (A2A) don't.
    const sseEventsFromConv = conversation.sseEvents || [];
    
    // Find the last input_required event
    // We reverse to find the most recent one
    const inputEvent = [...sseEventsFromConv].reverse().find((e) => e.type === "input_required");

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
  }, [activeConversationId, conversation?.messages?.length, conversation?.sseEvents?.length, lastMsgEventsLen, isThisConversationStreaming, agentId]);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Core submit function that accepts a message directly
  const submitMessage = useCallback(async (messageToSend: string) => {
    if (!messageToSend.trim() || isThisConversationStreaming) return;

    // Create conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation();
    }

    // Clear previous turn's events
    console.log(`[SSE-DEBUG] 🧹 clearSSEEvents() called for conv=${convId} — starting new turn`);
    clearSSEEvents(convId);

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

    // Dynamic agent: use lightweight SSE client via proxy route
    const dynClient = new DynamicAgentClient({
      proxyUrl: "/api/dynamic-agents/chat",
      accessToken,
    });
    const abortFn = () => dynClient.abort();
    const eventStream = dynClient.sendMessageStream(messageToSend, convId, agentId);

    // ═══════════════════════════════════════════════════════════════
    // AGENT-FORGE PATTERN: Use local variables for streaming state
    // ═══════════════════════════════════════════════════════════════
    let accumulatedText = ""; 
    let rawStreamContent = ""; 
    let eventCounter = 0;
    let hitlFormRequested = false;
    let hasError = false;
    let lastUIUpdate = 0;
    const UI_UPDATE_INTERVAL = 100; // Throttle UI updates to max 10/sec
    const eventBuffer: SSEAgentEvent[] = [];

    // Helper to add buffered event to the correct store
    const flushEventBuffer = () => {
      for (const bufferedEvent of eventBuffer) {
        addSSEEvent(bufferedEvent, convId!);
      }
      eventBuffer.length = 0;
    };

    // Mark this conversation as streaming
    setConversationStreaming(convId, {
      conversationId: convId,
      messageId: assistantMsgId,
      client: { abort: abortFn } as ReturnType<typeof setConversationStreaming> extends void ? never : Parameters<typeof setConversationStreaming>[1] extends { client: infer C } ? C : never,
      // For Dynamic Agents: enable backend cancellation
      dynamicAgentClient: dynClient,
    });

    try {
      // ═══════════════════════════════════════════════════════════════
      // SSE STREAM LOOP
      // ═══════════════════════════════════════════════════════════════
      for await (const event of eventStream) {
        eventCounter++;
        const sseEvent = event as SSEAgentEvent;

        // Normalize properties
        const newContent = sseEvent.displayContent || sseEvent.content || "";
        const eventType = sseEvent.type;

        // Buffer event
        eventBuffer.push(sseEvent);

        // Flush buffer immediately for important events
        const isImportantArtifact = 
             sseEvent.type === "tool_start" ||
             sseEvent.type === "tool_end" ||
             sseEvent.type === "error";

        if (isImportantArtifact && eventBuffer.length > 0) {
          flushEventBuffer();
        }

        // ═══════════════════════════════════════════════════════════════
        // DETECT USER INPUT FORM REQUEST (SSE)
        // ═══════════════════════════════════════════════════════════════
        if (sseEvent.type === "input_required" && sseEvent.inputRequiredData) {
          console.log(`[ChatPanel] 📝 SSE INPUT REQUIRED`, sseEvent.inputRequiredData);
          const { prompt, fields } = sseEvent.inputRequiredData;
          
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

          hitlFormRequested = true;
          setPendingUserInput({
            messageId: assistantMsgId,
            metadata: {
              user_input: true,
              input_title: `Input Required`,
              input_description: prompt,
              input_fields: inputFields,
            },
            contextId: convId,
            isSSE: true,
            agentId: agentId,
          });

          // Update message content with the prompt
          if (prompt) {
            accumulatedText = prompt;
            updateMessage(convId!, assistantMsgId, { content: accumulatedText });
          }
        }

        // Skip events without content
        if (!newContent) continue;

        // ═══════════════════════════════════════════════════════════════
        // ACCUMULATE CONTENT
        // ═══════════════════════════════════════════════════════════════
        if (eventType === "content") {
          accumulatedText += newContent;
          rawStreamContent += newContent;

          // Throttle UI updates
          const now = Date.now();
          if (now - lastUIUpdate >= UI_UPDATE_INTERVAL) {
            if (eventBuffer.length > 0) {
              flushEventBuffer();
            }
            updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent });
            lastUIUpdate = now;
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // FINALIZE
      // ═══════════════════════════════════════════════════════════════

      // Flush any remaining buffered events
      if (eventBuffer.length > 0) {
        flushEventBuffer();
      }

      // Check if the message was already finalized (e.g., by cancelConversationRequest)
      // If so, don't overwrite the turnStatus that was set there
      const currentConv = useChatStore.getState().conversations.find((c: Conversation) => c.id === convId);
      const currentMsg = currentConv?.messages.find((m: ChatMessageType) => m.id === assistantMsgId);
      const wasAlreadyCancelled = currentMsg?.isFinal && currentMsg?.turnStatus === "interrupted";

      // CRITICAL: Copy conversation-level sseEvents to the message for persistence.
      // During streaming, events are collected at conversation.sseEvents. When we finalize,
      // we must attach them to the message so historical messages render timelines correctly
      // (without this, only the latest streaming message would show the timeline).
      const turnSSEEvents = currentConv?.sseEvents || [];

      if (wasAlreadyCancelled) {
        // Message was cancelled by user - don't overwrite the interrupted status
        // Also don't call setConversationStreaming(null) - cancelConversationRequest already did that
        console.log("[DynamicAgent] Stream finalize skipped - message was already cancelled");
      } else if (hitlFormRequested) {
        updateMessage(convId!, assistantMsgId, { 
          content: accumulatedText, 
          rawStreamContent, 
          isFinal: false,
          turnStatus: "waiting_for_input" as TurnStatus,
          sseEvents: turnSSEEvents.length > 0 ? turnSSEEvents : undefined,
        });
        setConversationStreaming(convId!, null);
      } else {
        // Stream ended - mark as final with accumulated content
        updateMessage(convId!, assistantMsgId, { 
          content: accumulatedText, 
          rawStreamContent, 
          isFinal: true,
          turnStatus: "done" as TurnStatus,
          sseEvents: turnSSEEvents.length > 0 ? turnSSEEvents : undefined,
        });
        setConversationStreaming(convId!, null);
      }

    } catch (error) {
      console.error("[DynamicAgent] Stream error:", error);
      appendToMessage(convId, assistantMsgId, `\n\n**Error:** ${(error as Error).message || "Failed to connect to agent endpoint"}`);
      // Set interrupted status on error
      updateMessage(convId!, assistantMsgId, {
        turnStatus: "interrupted" as TurnStatus,
      });
      setConversationStreaming(convId, null);
    }
  }, [isThisConversationStreaming, activeConversationId, accessToken, agentId, createConversation, clearSSEEvents, addMessage, appendToMessage, updateMessage, addSSEEvent, setConversationStreaming, session?.user]);

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

  // Wrapper for form submission that uses input state
  const handleSubmit = useCallback(async (forceSend = false) => {
    if (!input.trim()) return;

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
  }, [input, submitMessage, isThisConversationStreaming, queuedMessages, pendingUserInput]);

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

  // Stable callback for feedback submission
  const handleFeedbackSubmit = useCallback(async (messageId: string, feedback: Feedback) => {
    if (!feedback.type || getConfig('storageMode') !== 'mongodb') return;
    try {
      await apiClient.updateMessage(messageId, {
        feedback: {
          rating: feedback.type === 'like' ? 'positive' : 'negative',
          comment: feedback.reason === 'Other' ? feedback.additionalFeedback : feedback.reason,
        },
      });
    } catch (err) {
      console.error('[ChatPanel] Failed to persist feedback to MongoDB:', err);
    }
  }, []);

  // Handle user input form submission via SSE/Dynamic Agents resume
  const handleUserInputSubmitSSE = useCallback(async (formData: Record<string, string>) => {
    if (!pendingUserInput || !activeConversationId || !pendingUserInput.agentId) return;

    console.log("[ChatPanel] 📝 SSE HITL form submitted:", formData);

    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const selectionSummary = Object.entries(formData)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    addMessage(activeConversationId, { role: "user", content: selectionSummary || "Form submitted." }, turnId);
    const assistantMsgId = addMessage(activeConversationId, { role: "assistant", content: "" }, turnId);

    dismissedInputForMessageRef.current.add(pendingUserInput.messageId);
    const agentId = pendingUserInput.agentId;
    setPendingUserInput(null);

    // Clear previous turn's events before starting resume stream
    // (the previous message already has its sseEvents persisted)
    console.log(`[SSE-DEBUG] 🧹 clearSSEEvents() called for conv=${activeConversationId} — starting HITL resume`);
    clearSSEEvents(activeConversationId);

    // Create Dynamic Agent client for resume
    const dynClient = new DynamicAgentClient({
      proxyUrl: "/api/dynamic-agents/chat",
      accessToken,
    });

    // Send form data as JSON string
    const formDataJson = JSON.stringify(formData);

    setConversationStreaming(activeConversationId, {
      conversationId: activeConversationId,
      messageId: assistantMsgId,
      client: { abort: () => dynClient.abort() } as ReturnType<typeof setConversationStreaming> extends void ? never : Parameters<typeof setConversationStreaming>[1] extends { client: infer C } ? C : never,
      // For Dynamic Agents: enable backend cancellation
      dynamicAgentClient: dynClient,
    });

    let accumulatedText = "";
    let rawStreamContent = "";
    let hitlFormRequested = false;
    let hasError = false;

    try {
      for await (const event of dynClient.resumeStream(activeConversationId, agentId, formDataJson)) {
        const sseEvent = event as SSEAgentEvent;

        // Buffer event for store
        addSSEEvent(sseEvent, activeConversationId);

        // Handle input_required
        if (sseEvent.type === "input_required" && sseEvent.inputRequiredData) {
          console.log(`[ChatPanel] 📝 SSE Additional input required:`, sseEvent.inputRequiredData);
          const { prompt, fields } = sseEvent.inputRequiredData;
          
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

          hitlFormRequested = true;
          setPendingUserInput({
            messageId: assistantMsgId,
            metadata: {
              user_input: true,
              input_title: `Input Required`,
              input_description: prompt,
              input_fields: inputFields,
            },
            contextId: activeConversationId,
            isSSE: true,
            agentId,
          });

          if (prompt) {
            accumulatedText = prompt;
            updateMessage(activeConversationId, assistantMsgId, { content: accumulatedText });
          }
          break; // Stream pauses for user input
        }

        // Handle content tokens
        if (sseEvent.type === "content" && sseEvent.content) {
          accumulatedText += sseEvent.content;
          rawStreamContent += sseEvent.content;
          updateMessage(activeConversationId, assistantMsgId, { content: accumulatedText, rawStreamContent });
        }

        // Handle errors - break stream, error will be rendered inline via StreamingView
        if (sseEvent.type === "error") {
          console.error("[ChatPanel] SSE resume error event:", sseEvent.displayContent);
          hasError = true;
          break;
        }
      }

      // Determine turn status based on stream outcome
      let finalTurnStatus: TurnStatus = "done";
      if (hitlFormRequested) {
        finalTurnStatus = "waiting_for_input";
      } else if (hasError) {
        finalTurnStatus = "interrupted";
      }

      // CRITICAL: Copy conversation-level sseEvents to the message for persistence.
      // (Same reason as in submitMessage - see comment there)
      const currentConv = useChatStore.getState().conversations.find((c: Conversation) => c.id === activeConversationId);
      const turnSSEEvents = currentConv?.sseEvents || [];

      if (!hitlFormRequested) {
        updateMessage(activeConversationId, assistantMsgId, {
          content: accumulatedText,
          rawStreamContent,
          isFinal: true,
          turnStatus: finalTurnStatus,
          sseEvents: turnSSEEvents.length > 0 ? turnSSEEvents : undefined,
        });
      } else {
        updateMessage(activeConversationId, assistantMsgId, {
          content: accumulatedText,
          rawStreamContent,
          isFinal: false,
          turnStatus: finalTurnStatus,
          sseEvents: turnSSEEvents.length > 0 ? turnSSEEvents : undefined,
        });
      }
      setConversationStreaming(activeConversationId, null);
    } catch (error) {
      console.error("[ChatPanel] SSE HITL resume error:", error);
      appendToMessage(activeConversationId, assistantMsgId,
        `\n\n**Error:** ${(error as Error).message || "Failed to resume"}`);
      // Set interrupted status on error
      updateMessage(activeConversationId, assistantMsgId, {
        turnStatus: "interrupted" as TurnStatus,
      });
      setConversationStreaming(activeConversationId, null);
    }
  }, [pendingUserInput, activeConversationId, accessToken, addMessage, updateMessage,
      appendToMessage, addSSEEvent, setConversationStreaming]);

  // Handle @mention detection - REMOVED
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
                      // - For completed messages: use msg.sseEvents (persisted with the message)
                      // - For streaming (latest message): use conversation.sseEvents (live buffer)
                      // - Fall back to timestamp-based filtering if msg.sseEvents is not available
                      const isStreaming = isLastAssistantMessage && isThisConversationStreaming;
                      let turnEvents: SSEAgentEvent[];
                      
                      if (msg.role !== "assistant") {
                        turnEvents = [];
                      } else if (isStreaming) {
                        // Streaming: use live buffer from conversation
                        turnEvents = conversation?.sseEvents ?? [];
                      } else if (msg.sseEvents && msg.sseEvents.length > 0) {
                        // Completed message with persisted events
                        turnEvents = msg.sseEvents;
                      } else {
                        // Fall back to timestamp-based filtering (legacy/edge cases)
                        turnEvents = filterEventsForTurn(
                          conversation?.sseEvents ?? [],
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
                      const dynClient = new DynamicAgentClient({
                        proxyUrl: "/api/dynamic-agents/chat",
                        accessToken,
                      });
                      // Fire-and-forget: resume with rejection message
                      (async () => {
                        try {
                          const dismissalMessage = "User dismissed the input form without providing values.";
                          for await (const _event of dynClient.resumeStream(
                            activeConversationId,
                            pendingUserInput.agentId!,
                            dismissalMessage
                          )) {
                            // Consume events but don't display
                          }
                        } catch (err) {
                          console.error("[ChatPanel] Error sending SSE form dismissal:", err);
                        }
                      })();
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
            {/* NO MENTION MENU */}

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
                    : `Ask anything...`
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

// ─────────────────────────────────────────────────────────────────────────────
// Inline Event Types and Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  agent?: string;
  status: "running" | "completed";
}

interface SubagentCall {
  id: string;
  name: string;
  purpose?: string;
  parentAgent?: string;
  status: "running" | "completed";
  /** tool_call_id used to match tool_end events back to this subagent */
  toolCallId?: string;
  /** MongoDB agent_id for looking up subagent config (avatar, display name, etc.) */
  agentId?: string;
}

interface ErrorEvent {
  id: string;
  message: string;
}

interface WarningEvent {
  id: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream Segments - Interleaved content and tool/subagent events
// ─────────────────────────────────────────────────────────────────────────────

type StreamSegment =
  | { type: "content"; id: string; text: string }
  | { type: "tool"; id: string; data: ToolCall }
  | { type: "subagent"; id: string; data: SubagentCall }
  | { type: "warning"; id: string; data: WarningEvent }
  | { type: "error"; id: string; data: ErrorEvent };

/**
 * Parse SSE events into ordered stream segments for interleaved rendering.
 * Segments maintain stream order: content → tool → content → tool etc.
 * 
 * Content chunks between events are grouped into single content segments.
 */
function parseStreamSegments(events: SSEAgentEvent[], isStreaming: boolean): StreamSegment[] {
  const segments: StreamSegment[] = [];
  const toolsMap = new Map<string, ToolCall>();
  const subagentsMap = new Map<string, SubagentCall>();
  let contentBuffer = "";
  let contentId = 0;

  // Helper to flush accumulated content as a segment
  const flushContent = () => {
    if (contentBuffer.trim()) {
      segments.push({
        type: "content",
        id: `content-${contentId++}`,
        text: contentBuffer,
      });
      contentBuffer = "";
    }
  };

  // Process events in order
  events.forEach((event, idx) => {
    switch (event.type) {
      case "content":
        // Accumulate content
        if (event.content) {
          contentBuffer += event.content;
        }
        break;

      case "tool_start":
        // Flush any pending content before the tool
        flushContent();
        if (event.toolData) {
          const { tool_name, tool_call_id, args } = event.toolData as ToolStartEventData;
          // Determine parent agent from namespace (empty = root agent)
          const parentAgentId = event.namespace.length > 0 ? event.namespace[0] : undefined;
          
          // Check if this is a subagent invocation (task tool)
          if (tool_name === "task") {
            const subagent_type = args?.subagent_type as string || "unknown";
            const purpose = args?.description as string || "";
            const subagentId = `subagent-${tool_call_id}`;
            const subagent: SubagentCall = {
              id: subagentId,
              name: subagent_type,
              purpose,
              parentAgent: parentAgentId,
              status: "running",
              toolCallId: tool_call_id,
              // subagent_type IS the agent_id now (semantic slug)
              agentId: subagent_type,
            };
            subagentsMap.set(tool_call_id, subagent);
            segments.push({ type: "subagent", id: subagentId, data: subagent });
          } else {
            // Regular tool call
            const tool: ToolCall = {
              id: tool_call_id,
              tool: tool_name,
              args,
              agent: parentAgentId,
              status: "running",
            };
            toolsMap.set(tool_call_id, tool);
            segments.push({ type: "tool", id: tool_call_id, data: tool });
          }
        }
        break;

      case "tool_end":
        // Update tool or subagent status (segment already in array)
        if (event.toolData) {
          const { tool_call_id } = event.toolData as ToolEndEventData;
          // Check if this is a subagent completion
          const subagent = subagentsMap.get(tool_call_id);
          if (subagent) {
            subagent.status = "completed";
          } else {
            // Regular tool completion
            const tool = toolsMap.get(tool_call_id);
            if (tool) {
              tool.status = "completed";
            }
          }
        }
        break;

      case "warning":
        flushContent();
        segments.push({
          type: "warning",
          id: event.id || `warning-${idx}`,
          data: {
            id: event.id || `warning-${idx}`,
            message: event.displayContent || event.warningData?.message || "A warning occurred",
          },
        });
        break;

      case "error":
        flushContent();
        segments.push({
          type: "error",
          id: event.id || `error-${idx}`,
          data: {
            id: event.id || `error-${idx}`,
            message: event.displayContent || event.content || "An error occurred",
          },
        });
        break;
    }
  });

  // Flush any remaining content
  flushContent();

  // When not streaming, mark all tools/subagents as completed
  if (!isStreaming) {
    segments.forEach((seg) => {
      if (seg.type === "tool") {
        seg.data.status = "completed";
      } else if (seg.type === "subagent") {
        seg.data.status = "completed";
      }
    });
  }

  return segments;
}

/**
 * Filter SSE events for a specific message turn based on timestamps.
 * Returns events that occurred between this message and the next user message.
 * 
 * NOTE: This is a fallback for legacy messages. Prefer using msg.sseEvents directly
 * for completed messages, as the message timestamp may be after all events finished.
 */
function filterEventsForTurn(
  sseEvents: SSEAgentEvent[],
  message: ChatMessageType,
  allMessages: ChatMessageType[],
  messageIndex: number
): SSEAgentEvent[] {
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
  return sseEvents.filter(e => {
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
// Typing Indicator - Pulsing dot with CSS animation for smooth 60fps
// ─────────────────────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-card/50 border border-border/50">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary/80" />
      </span>
      <span className="text-xs text-muted-foreground">Thinking...</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Markdown Components - Used in both StreamingView and final message
// ─────────────────────────────────────────────────────────────────────────────

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-bold text-foreground mb-3 mt-4 first:mt-0 pb-2 border-b border-border/50">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-lg font-semibold text-foreground mb-2 mt-4 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold text-foreground mb-2 mt-3 first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm leading-relaxed text-foreground/90 mb-2 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-outside ml-6 mb-2 space-y-1 text-sm text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-outside ml-6 mb-2 space-y-1 text-sm text-foreground/90">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const codeContent = String(children).replace(/\n$/, "");
    const hasNewlines = codeContent.includes("\n");
    const isCodeBlock = match || hasNewlines || className;

    if (!isCodeBlock) {
      return (
        <code
          className="bg-muted/80 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono break-all"
          {...props}
        >
          {children}
        </code>
      );
    }

    const language = match ? match[1] : "";
    const shellLanguages = ["bash", "sh", "shell", "zsh", "fish", "console", "terminal"];
    const isShell = shellLanguages.includes(language.toLowerCase());
    const shouldHighlight = match && language !== "text" && !isShell;

    return (
      <div className="my-4 rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e] max-w-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-[#181825]">
          <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide">
            {language || "plain text"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-300 hover:bg-transparent"
            onClick={() => {
              navigator.clipboard.writeText(codeContent);
            }}
            title="Copy code"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        {shouldHighlight ? (
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            wrapLongLines
            customStyle={{
              margin: 0,
              borderRadius: 0,
              padding: "1rem 1.25rem",
              fontSize: "13px",
              lineHeight: "1.6",
              background: "transparent",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {codeContent}
          </SyntaxHighlighter>
        ) : (
          <pre className="p-4 overflow-x-auto max-w-full">
            <code className="text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words">
              {codeContent.split("\n").map((line, i) => {
                const trimmed = line.trimStart();
                const isComment = trimmed.startsWith("#") || trimmed.startsWith("//");
                return (
                  <span key={i}>
                    {isComment ? (
                      <span className="text-zinc-500 italic">{line}</span>
                    ) : (
                      <span className="text-zinc-300">{line}</span>
                    )}
                    {i < codeContent.split("\n").length - 1 ? "\n" : ""}
                  </span>
                );
              })}
            </code>
          </pre>
        )}
      </div>
    );
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 my-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-border/50 w-full">
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold text-foreground border-b border-border/50 break-words">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 border-b border-border/30 text-foreground/90 break-words align-top">
      {children}
    </td>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/50 hover:decoration-primary transition-colors"
    >
      {children}
    </a>
  ),
  hr: () => (
    <hr className="my-6 border-border/50" />
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-foreground/90">{children}</em>
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// StreamingView Component - Shows inline events and streaming content
// ─────────────────────────────────────────────────────────────────────────────

interface StreamingViewProps {
  message: ChatMessageType;
  isStreaming?: boolean;
  turnEvents?: SSEAgentEvent[];
}

function StreamingView({ message, isStreaming = false, turnEvents = [] }: StreamingViewProps) {
  // Parse events into ordered segments for interleaved rendering
  const segments = useMemo(
    () => parseStreamSegments(turnEvents, isStreaming),
    [turnEvents, isStreaming]
  );

  // Check if we have any content or events
  const hasContent = segments.some((s) => s.type === "content");
  const hasEvents = segments.some(
    (s) => s.type === "tool" || s.type === "subagent" || s.type === "warning" || s.type === "error"
  );

  return (
    <div className="space-y-2">
      {/* Show typing indicator when no content and no events yet */}
      {!hasContent && !hasEvents && (
        <TypingIndicator />
      )}

      {/* Render interleaved segments in stream order */}
      {segments.map((segment) => {
        switch (segment.type) {
          case "content":
            return (
              <div
                key={segment.id}
                className="rounded-xl bg-card/50 border border-border/50 px-4 py-3"
              >
                <div
                  className="prose-container overflow-hidden break-words"
                  style={{ overflowWrap: "anywhere" }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={markdownComponents}
                  >
                    {segment.text}
                  </ReactMarkdown>
                </div>
              </div>
            );

          case "tool":
            return (
              <InlineEventCard
                key={segment.id}
                type="tool"
                name={segment.data.tool}
                status={segment.data.status}
                args={segment.data.args}
              />
            );

          case "subagent":
            return (
              <InlineEventCard
                key={segment.id}
                type="subagent"
                name={segment.data.name}
                status={segment.data.status}
                purpose={segment.data.purpose}
              />
            );

          case "warning":
            return (
              <InlineEventCard
                key={segment.id}
                type="warning"
                name="Warning"
                message={segment.data.message}
              />
            );

          case "error":
            return (
              <InlineEventCard
                key={segment.id}
                type="error"
                name="Error"
                message={segment.data.message}
              />
            );

          default:
            return null;
        }
      })}
    </div>
  );
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
  turnEvents?: SSEAgentEvent[];
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
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (isUser) return false;
    return !isLatestAnswer && message.content && message.content.length > 300;
  });

  const displayContent = message.content;
  const collapsedPreview = message.content.slice(0, 300).trim();

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
                {!isStreaming && displayContent && displayContent.length > 300 && (
                  <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title={isCollapsed ? "Expand answer" : "Collapse answer"}
                  >
                    {isCollapsed ? (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        <span>Expand</span>
                      </>
                    ) : (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        <span>Collapse</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {isStreaming && message.role === "assistant" ? (
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
        ) : !isUser && turnEvents.length > 0 ? (
          // Completed assistant message with events - use interleaved view
          <>
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
          </>
        ) : (
          <>
            {/* Recovery/interrupted banner for assistant messages without events */}
            {!isUser && (isRecovering || message.isInterrupted) && (
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

            <div
              className={cn(
                "rounded-xl relative overflow-hidden",
                isUser
                  ? "inline-block bg-primary text-primary-foreground px-4 py-3 rounded-tr-sm max-w-full selection:bg-primary-foreground selection:text-primary"
                  : "bg-card/50 border border-border/50 px-4 py-3"
              )}
            >
              {isUser ? (
                <div className="overflow-hidden break-words text-left" style={{ overflowWrap: 'anywhere' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                      // Simplified markdown components for user messages
                      p: ({ children }) => <p className="text-sm leading-relaxed mb-1.5 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-outside ml-6 mb-1.5 space-y-0.5 text-sm text-primary-foreground/90">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-outside ml-6 mb-1.5 space-y-0.5 text-sm text-primary-foreground/90">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      code: ({ children }) => <code className="bg-black/20 px-1 rounded font-mono text-xs">{children}</code>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="prose-container overflow-hidden break-words overflow-wrap-anywhere">
                  {isCollapsed ? (
                    <div className="space-y-2">
                      <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                        {collapsedPreview}
                        {displayContent.length > 300 && "..."}
                      </div>
                      <button
                        onClick={() => setIsCollapsed(false)}
                        className="text-xs text-primary hover:text-primary/80 underline transition-colors"
                      >
                        Show full answer
                      </button>
                    </div>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      components={markdownComponents}
                    >
                      {displayContent || "..."}
                    </ReactMarkdown>
                  )}
                </div>
              )}
            </div>

            {isUser && (
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
            )}

            {!isUser && displayContent && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isHovered ? 1 : 0.8 }}
                className="flex items-center gap-1 mt-2"
              >
                {!isStreaming && displayContent && displayContent.length > 300 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={() => setIsCollapsed(!isCollapsed)}
                        >
                          {isCollapsed ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronUp className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isCollapsed ? "Expand answer" : "Collapse answer"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

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

"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, ArrowLeft, RotateCcw, Activity, MessageSquare, Clock, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { DynamicAgentClient } from "@/lib/dynamic-agent-client";
import { type SSEAgentEvent } from "@/components/dynamic-agents/sse-types";
import { useFeatureFlagStore } from "@/store/feature-flag-store";
import { cn, deduplicateByKey } from "@/lib/utils";
import { ChatMessage as ChatMessageType } from "@/types/a2a";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { MetadataInputForm, type UserInputMetadata, type InputField } from "./MetadataInputForm";
import { getGradientStyle } from "@/lib/gradient-themes";

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
}

export function DynamicAgentChatPanel({ endpoint, conversationId, conversationTitle, readOnly, readOnlyReason, agentId, agentGradient, agentName }: DynamicAgentChatPanelProps) {
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

  // Message window: collapse older turns for render performance
  const [olderTurnsExpanded, setOlderTurnsExpanded] = useState(false);

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

  // State for tracking history loading
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());

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
  useEffect(() => {
    if (autoScrollEnabled && isThisConversationStreaming && !isUserScrolledUp) {
      scrollToBottom("instant");
    }
  }, [conversation?.messages?.at(-1)?.content, isThisConversationStreaming, isUserScrolledUp, scrollToBottom]);

  // Reset scroll state and collapse older turns when conversation changes
  useEffect(() => {
    setIsUserScrolledUp(false);
    setShowScrollButton(false);
    setOlderTurnsExpanded(false);
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
  // LOAD CHAT HISTORY from checkpointer on mount/conversation change
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Skip if no conversationId (new conversation) or agentId
    if (!conversationId || !agentId) return;
    
    // Skip if already loaded this conversation
    if (historyLoadedRef.current.has(conversationId)) return;
    
    // Skip if conversation already has messages (e.g., from streaming session)
    if (conversation?.messages && conversation.messages.length > 0) {
      historyLoadedRef.current.add(conversationId);
      return;
    }

    const loadHistory = async () => {
      setIsLoadingHistory(true);
      setHistoryLoadError(null);
      
      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${conversationId}/messages?agent_id=${encodeURIComponent(agentId)}`
        );
        
        if (!response.ok) {
          if (response.status === 404) {
            // Conversation doesn't exist yet - this is fine for new conversations
            console.log(`[DynamicAgentChatPanel] Conversation ${conversationId} not found, starting fresh`);
            historyLoadedRef.current.add(conversationId);
            return;
          }
          throw new Error(`Failed to load history: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Mark as loaded before populating to avoid race conditions
        historyLoadedRef.current.add(conversationId);
        
        // Populate messages into the store
        if (data.messages && data.messages.length > 0) {
          console.log(`[DynamicAgentChatPanel] Loaded ${data.messages.length} messages from checkpointer`);
          
          for (const msg of data.messages) {
            addMessage(conversationId, {
              role: msg.role as "user" | "assistant",
              content: msg.content,
              // Use the message ID from the checkpointer
            }, undefined, msg.id);
          }
        }
        
        // Handle pending interrupt - restore the HITL form if present
        if (data.has_pending_interrupt && data.interrupt_data) {
          const { prompt, fields } = data.interrupt_data;
          const lastMsg = data.messages?.[data.messages.length - 1];
          
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
      } catch (error) {
        console.error("[DynamicAgentChatPanel] Failed to load history:", error);
        setHistoryLoadError((error as Error).message);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistory();
  }, [conversationId, agentId, conversation?.messages?.length, addMessage]); 

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
    const msgEvents = lastMsg.events || [];
    // We also check conversation.sseEvents if any are global, but usually they are attached to messages or we look at the store.
    // In ChatStore, addSSEEvent adds to conversation.sseEvents.
    const convEvents = conversation.sseEvents || [];
    const eventsToCheck = [...convEvents, ...(msgEvents as SSEAgentEvent[])];

    // Find the last input_required event
    // We reverse to find the most recent one
    const inputEvent = [...eventsToCheck].reverse().find((e) => e.type === "input_required");

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
    let hasReceivedCompleteResult = false;
    let hitlFormRequested = false;
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
    });

    try {
      // ═══════════════════════════════════════════════════════════════
      // SSE STREAM LOOP
      // ═══════════════════════════════════════════════════════════════
      for await (const event of eventStream) {
        eventCounter++;
        const sseEvent = event as SSEAgentEvent;

        // Normalize properties
        const artifactName = sseEvent.type === "final_result" ? "final_result" : sseEvent.artifact?.name || sseEvent.type;
        const newContent = sseEvent.displayContent || sseEvent.content || "";
        const eventIsFinal = sseEvent.isFinal;
        const eventType = sseEvent.type;

        // Buffer event
        eventBuffer.push(sseEvent);

        // Flush buffer immediately for important events
        const isImportantArtifact = 
             sseEvent.type === "tool_start" ||
             sseEvent.type === "tool_end" ||
             sseEvent.type === "todo_update" ||
             sseEvent.type === "subagent_start" ||
             sseEvent.type === "subagent_end" ||
             sseEvent.type === "final_result" ||
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

        // ═══════════════════════════════════════════════════════════════
        // HANDLE FINAL RESULT
        // ═══════════════════════════════════════════════════════════════
        if (artifactName === "final_result") {
          if (newContent) {
            accumulatedText = newContent;
            rawStreamContent += `\n\n[final_result]\n${newContent}`;
            hasReceivedCompleteResult = true;
            updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent, isFinal: true });
          }
        }

        // Skip events without content
        if (!newContent) continue;

        // ═══════════════════════════════════════════════════════════════
        // ACCUMULATE RAW STREAM CONTENT
        // ═══════════════════════════════════════════════════════════════
        // Only accumulate actual streaming content
        if (eventType === "content") {
          rawStreamContent += newContent;
        }

        // GUARD: Don't accumulate to final content after receiving complete result
        if (hasReceivedCompleteResult) continue;

        // ═══════════════════════════════════════════════════════════════
        // ACCUMULATE FINAL CONTENT
        // ═══════════════════════════════════════════════════════════════
        if (eventType === "content") {
           accumulatedText += newContent;

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

      if (hitlFormRequested) {
        updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent, isFinal: false });
      } else if (!hasReceivedCompleteResult) {
        if (accumulatedText.length > 0) {
          updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent, isFinal: true });
        } else {
          updateMessage(convId!, assistantMsgId, { rawStreamContent, isFinal: true });
        }
      } else {
        updateMessage(convId!, assistantMsgId, { rawStreamContent });
      }

      setConversationStreaming(convId!, null);

    } catch (error) {
      console.error("[DynamicAgent] Stream error:", error);
      appendToMessage(convId, assistantMsgId, `\n\n**Error:** ${(error as Error).message || "Failed to connect to agent endpoint"}`);
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
    });

    let accumulatedText = "";
    let rawStreamContent = "";
    let hasReceivedCompleteResult = false;
    let hitlFormRequested = false;

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

        // Handle final_result
        if (sseEvent.type === "final_result" && sseEvent.content) {
          accumulatedText = sseEvent.content;
          rawStreamContent += `\n\n[final_result]\n${sseEvent.content}`;
          hasReceivedCompleteResult = true;
          updateMessage(activeConversationId, assistantMsgId, {
            content: accumulatedText,
            rawStreamContent,
            isFinal: true,
          });
        }

        // Handle content tokens
        if (sseEvent.type === "content" && sseEvent.content) {
          accumulatedText += sseEvent.content;
          rawStreamContent += sseEvent.content;
          updateMessage(activeConversationId, assistantMsgId, { content: accumulatedText, rawStreamContent });
        }

        // Handle errors
        if (sseEvent.type === "error") {
          console.error("[ChatPanel] SSE resume error event:", sseEvent.displayContent);
          appendToMessage(activeConversationId, assistantMsgId,
            `\n\n**Error:** ${sseEvent.displayContent || "Unknown error"}`);
          break;
        }
      }

      if (!hitlFormRequested && !hasReceivedCompleteResult) {
        if (accumulatedText.length > 0) {
          updateMessage(activeConversationId, assistantMsgId, {
            content: accumulatedText,
            rawStreamContent,
            isFinal: true,
          });
        } else {
          updateMessage(activeConversationId, assistantMsgId, { rawStreamContent, isFinal: true });
        }
      }
      setConversationStreaming(activeConversationId, null);
    } catch (error) {
      console.error("[ChatPanel] SSE HITL resume error:", error);
      appendToMessage(activeConversationId, assistantMsgId,
        `\n\n**Error:** ${(error as Error).message || "Failed to resume"}`);
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
                {isLoadingHistory ? (
                  <>
                    <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 text-white animate-spin" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Loading conversation...</h2>
                    <p className="text-muted-foreground max-w-md mx-auto mb-1">
                      Retrieving your conversation history
                    </p>
                  </>
                ) : historyLoadError ? (
                  <>
                    <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                      <Sparkles className="h-8 w-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Welcome to {getConfig('appName')}</h2>
                    <p className="text-muted-foreground max-w-md mx-auto mb-1">
                      Failed to load history: {historyLoadError}
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
                const shouldCollapse = turns.length > COLLAPSE_THRESHOLD && !olderTurnsExpanded;
                const collapsedTurns = shouldCollapse ? turns.slice(0, -VISIBLE_TURN_COUNT) : [];
                // Flatten visible turns back to messages for rendering
                const visibleTurns = shouldCollapse ? turns.slice(-VISIBLE_TURN_COUNT) : turns;
                const visibleMessages = visibleTurns.flatMap(t =>
                  [t.userMsg, t.assistantMsg].filter(Boolean) as ChatMessageType[]
                );

                // Build a Set of visible message IDs for quick lookup against allMessages
                const visibleMsgIds = new Set(visibleMessages.map(m => m.id));
                // When expanded, render all messages
                const renderMessages = olderTurnsExpanded || turns.length <= COLLAPSE_THRESHOLD
                  ? allMessages
                  : allMessages.filter(m => visibleMsgIds.has(m.id));

                // Collect message IDs for older turns (for eviction on collapse)
                const olderTurnMsgIds = shouldCollapse
                  ? [] // Not needed when already collapsed
                  : turns.slice(0, -VISIBLE_TURN_COUNT).flatMap(t =>
                      [t.userMsg?.id, t.assistantMsg?.id].filter(Boolean) as string[]
                    );

                const handleCollapse = () => {
                  // Evict content from old messages before collapsing
                  if (activeConversationId && olderTurnMsgIds.length > 0) {
                    evictOldMessageContent(activeConversationId, olderTurnMsgIds);
                  }
                  setOlderTurnsExpanded(false);
                };

                const handleExpand = () => {
                  setOlderTurnsExpanded(true);
                  // Re-load messages from MongoDB to restore evicted content
                  if (activeConversationId) {
                    loadMessagesFromServer(activeConversationId, { force: true });
                  }
                };

                return (
                  <>
                    {/* Collapsed older turns banner */}
                    {shouldCollapse && collapsedTurns.length > 0 && (
                      <CollapsedTurnsBanner
                        key="collapsed-turns"
                        turns={collapsedTurns}
                        onExpand={handleExpand}
                      />
                    )}

                    {/* Re-collapse button when older turns are expanded */}
                    {olderTurnsExpanded && turns.length > COLLAPSE_THRESHOLD && (
                      <motion.button
                        key="collapse-banner"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onClick={handleCollapse}
                        className={cn(
                          "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
                          "bg-muted/30 hover:bg-muted/50 border border-dashed border-border/40 hover:border-border/60",
                          "transition-all duration-200 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <ChevronUp className="h-3 w-3" />
                        <span>Collapse {turns.length - VISIBLE_TURN_COUNT} older turns</span>
                      </motion.button>
                    )}

                    {/* Rendered messages (recent turns, or all if expanded) */}
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
// StreamingView Component - Shows sub-agent cards and raw streaming output
// ─────────────────────────────────────────────────────────────────────────────

interface StreamingViewProps {
  message: ChatMessageType;
  showRawStream: boolean;
  setShowRawStream: (show: boolean) => void;
  isStreaming?: boolean;
}

function StreamingView({ message, showRawStream, setShowRawStream, isStreaming = false }: StreamingViewProps) {
  const thinkingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [message.rawStreamContent, isStreaming]);

  return (
    <div className="space-y-4">
      {/* Show thinking indicator when no content yet */}
      {!message.content && message.events.length === 0 && (
        <motion.div
          key="thinking"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border/50"
        >
          <div className="relative">
            <div className="w-2 h-2 bg-primary rounded-full animate-ping absolute" />
            <div className="w-2 h-2 bg-primary rounded-full" />
          </div>
          <span className="text-sm text-muted-foreground">Thinking...</span>
        </motion.div>
      )}

      {(message.rawStreamContent || message.content) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Thinking
              {message.rawStreamContent && (
                <span className="ml-2 text-[10px] text-muted-foreground/60">
                  ({message.rawStreamContent.length.toLocaleString()} chars)
                </span>
              )}
            </span>
            <button
              onClick={() => setShowRawStream(!showRawStream)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRawStream ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  <span>Collapse</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>Expand</span>
                </>
              )}
            </button>
          </div>

          <AnimatePresence>
            {showRawStream && (
              <motion.div
                ref={thinkingRef}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 rounded-lg bg-card/80 border border-border/50 max-h-64 overflow-y-auto"
              >
                <pre className="text-sm text-foreground/80 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {(() => {
                    const raw = message.rawStreamContent || message.content || "";
                    if (isStreaming && raw.length > 2000) {
                      return "…" + raw.slice(-2000);
                    }
                    return raw;
                  })()}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Window: Auto-collapse old turns for performance
// ─────────────────────────────────────────────────────────────────────────────

const VISIBLE_TURN_COUNT = 2;
const COLLAPSE_THRESHOLD = 2;

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

const CollapsedTurnsBanner = React.memo(function CollapsedTurnsBanner({
  turns,
  onExpand,
}: {
  turns: Turn[];
  onExpand: () => void;
}) {
  if (turns.length === 0) return null;

  const oldest = turns[0];
  const newest = turns[turns.length - 1];
  const msgCount = turns.reduce((n, t) => n + (t.userMsg ? 1 : 0) + (t.assistantMsg ? 1 : 0), 0);

  const formatTime = (d: Date) => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <motion.button
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onExpand}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
        "bg-muted/40 hover:bg-muted/60 border border-border/40 hover:border-border/60",
        "transition-all duration-200 cursor-pointer group text-left"
      )}
    >
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <MessageSquare className="h-4 w-4 text-primary/70" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground/80">
            {turns.length} older {turns.length === 1 ? "turn" : "turns"}
          </span>
          <span className="text-xs text-muted-foreground">
            ({msgCount} messages)
          </span>
        </div>
        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
          {oldest.preview}
          {turns.length > 1 && ` — ... — ${newest.preview}`}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground/60">
        <Clock className="h-3 w-3" />
        <span>{formatTime(oldest.timestamp)}</span>
        {turns.length > 1 && (
          <>
            <span>—</span>
            <span>{formatTime(newest.timestamp)}</span>
          </>
        )}
      </div>

      <ChevronDown className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors shrink-0" />
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
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const showThinkingDefault = useFeatureFlagStore((s) => s.flags.showThinking ?? true);
  const [showRawStream, setShowRawStream] = useState(showThinkingDefault);
  const [isHovered, setIsHovered] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (isUser) return false;
    return !isLatestAnswer && message.content && message.content.length > 300;
  });

  const displayContent = message.content;
  const collapsedPreview = message.content.slice(0, 300).trim();

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
          <StreamingView
            message={message}
            showRawStream={showRawStream}
            setShowRawStream={setShowRawStream}
            isStreaming={isStreaming}
          />
        ) : (
          <>
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
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Simplified markdown components for user messages
                      p: ({ children }) => <p className="text-sm leading-relaxed mb-0">{children}</p>,
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
                      remarkPlugins={[remarkGfm]}
                      components={{
                      h1: ({ children }) => (
                        <h1 className="text-xl font-bold text-foreground mb-3 mt-4 first:mt-0 pb-2 border-b border-border/50">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg font-semibold text-foreground mb-2 mt-4 first:mt-0">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-semibold text-foreground mb-2 mt-3 first:mt-0">
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => (
                        <p className="text-sm leading-relaxed text-foreground/90 mb-2 last:mb-0">
                          {children}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc list-outside ml-5 mb-2 space-y-1 text-sm text-foreground/90">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-outside ml-5 mb-2 space-y-1 text-sm text-foreground/90">
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className="leading-relaxed">{children}</li>
                      ),
                      code({ className, children, node, ...props }) {
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
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-primary/50 pl-4 my-3 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      ),
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-3 rounded-lg border border-border/50 w-full">
                          <table className="w-full text-sm">
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => (
                        <thead className="bg-muted/50">{children}</thead>
                      ),
                      th: ({ children }) => (
                        <th className="px-3 py-2 text-left font-semibold text-foreground border-b border-border/50 break-words">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-2 border-b border-border/30 text-foreground/90 break-words align-top">
                          {children}
                        </td>
                      ),
                      tr: ({ children }) => (
                        <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
                      ),
                      a: ({ href, children }) => (
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
                      strong: ({ children }) => (
                        <strong className="font-semibold text-foreground">{children}</strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic text-foreground/90">{children}</em>
                      ),
                    }}
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

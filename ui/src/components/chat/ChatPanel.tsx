"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, RotateCcw, Gitlab, Slack, Video, Activity, MessageSquare, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { A2ASDKClient, type ParsedA2AEvent, type HITLDecision, toStoreEvent } from "@/lib/a2a-sdk-client";
import { cn, deduplicateByKey } from "@/lib/utils";
import { ChatMessage as ChatMessageType } from "@/types/a2a";
import { getConfig } from "@/lib/config";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { DEFAULT_AGENTS, CustomCall } from "./CustomCallButtons";
import { AGENT_LOGOS } from "@/components/shared/AgentLogos";
import { MetadataInputForm, type UserInputMetadata, type InputField } from "./MetadataInputForm";

interface ChatPanelProps {
  endpoint: string;
  conversationId?: string; // MongoDB conversation UUID
  conversationTitle?: string;
}

export function ChatPanel({ endpoint, conversationId, conversationTitle }: ChatPanelProps) {
  const { data: session } = useSession();

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
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // User input form state (HITL - Human-in-the-Loop)
  const [pendingUserInput, setPendingUserInput] = useState<{
    messageId: string;
    metadata: UserInputMetadata;
    contextId?: string;
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
    appendToMessage,
    addEventToMessage,
    addA2AEvent,
    clearA2AEvents,
    setConversationStreaming,
    isConversationStreaming,
    cancelConversationRequest,
    updateMessageFeedback,
    consumePendingMessage,
    recoverInterruptedTask,
    evictOldMessageContent,
    loadMessagesFromServer,
  } = useChatStore();

  // Get access token from session (if SSO is enabled and user is authenticated)
  const ssoEnabled = getConfig('ssoEnabled');
  const accessToken = ssoEnabled ? session?.accessToken : undefined;

  const conversation = getActiveConversation();

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
    if (!isUserScrolledUp) {
      scrollToBottom("smooth");
    }
  }, [conversation?.messages?.length, isUserScrolledUp, scrollToBottom]);

  // Auto-scroll during streaming only if user is near the bottom
  useEffect(() => {
    if (isThisConversationStreaming && !isUserScrolledUp) {
      scrollToBottom("instant");
    }
  }, [conversation?.messages?.at(-1)?.content, isThisConversationStreaming, isUserScrolledUp, scrollToBottom]);

  // Reset scroll state and collapse older turns when conversation changes
  useEffect(() => {
    setIsUserScrolledUp(false);
    setShowScrollButton(false);
    setOlderTurnsExpanded(false); // Re-collapse older turns on conversation switch
    // Scroll to bottom when switching conversations
    setTimeout(() => scrollToBottom("instant"), 50);
  }, [activeConversationId, scrollToBottom]);

  // ═══════════════════════════════════════════════════════════════
  // LEVEL 2 CRASH RECOVERY: On mount / conversation change, check for
  // interrupted messages and attempt to recover the result via tasks/get.
  // ═══════════════════════════════════════════════════════════════
  const [recoveringMessageId, setRecoveringMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeConversationId || !conversation) return;
    if (isThisConversationStreaming) return; // Don't recover while streaming

    // Find the last interrupted assistant message with a taskId
    const msgs = conversation.messages || [];
    const interruptedMsg = [...msgs].reverse().find(
      (m) => m.role === "assistant" && m.isInterrupted && m.taskId
    );

    // Diagnostic: log message states for debugging recovery detection
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    if (assistantMsgs.length > 0) {
      const last = assistantMsgs[assistantMsgs.length - 1];
      console.log(`[ChatPanel][Recovery] Last assistant message: id=${last.id}, isFinal=${last.isFinal}, isInterrupted=${last.isInterrupted}, taskId=${last.taskId || 'none'}`);
    }

    if (!interruptedMsg) {
      console.log(`[ChatPanel][Recovery] No interrupted message with taskId found in ${assistantMsgs.length} assistant messages`);
      return;
    }

    // Don't re-attempt if already recovering this message
    if (recoveringMessageId === interruptedMsg.id) return;

    // Validate endpoint before attempting recovery
    if (!endpoint) {
      console.error(`[ChatPanel][Recovery] Cannot recover — endpoint is not set`);
      return;
    }

    console.log(`[ChatPanel][Recovery] Found interrupted message ${interruptedMsg.id} with taskId=${interruptedMsg.taskId} — attempting recovery via ${endpoint}`);
    setRecoveringMessageId(interruptedMsg.id);

    recoverInterruptedTask(activeConversationId, interruptedMsg.id, endpoint, accessToken as string | undefined)
      .then((recovered) => {
        if (recovered) {
          console.log(`[ChatPanel][Recovery] Successfully recovered task result for message ${interruptedMsg.id}`);
        } else {
          console.log(`[ChatPanel][Recovery] Could not recover task for message ${interruptedMsg.id} — user can retry`);
        }
      })
      .catch((error) => {
        console.error(`[ChatPanel][Recovery] Recovery failed:`, error);
      })
      .finally(() => {
        setRecoveringMessageId(null);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, conversation?.messages?.length]);

  // ═══════════════════════════════════════════════════════════════
  // RESTORE PENDING USER INPUT FORM after page refresh / navigation.
  // During live streaming, pendingUserInput is set when a UserInputMetaData
  // artifact arrives.  That state is ephemeral — lost on refresh.  Here we
  // reconstruct it from the persisted A2A events so the form re-appears.
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Clear dismissed-form tracking when switching conversations
    dismissedInputForMessageRef.current.clear();
    setPendingUserInput(null);
  }, [activeConversationId]);

  useEffect(() => {
    if (pendingUserInput || isThisConversationStreaming) return;
    if (!conversation || conversation.messages.length === 0) return;

    const messages = conversation.messages;
    const lastMsg = messages[messages.length - 1];

    // Only restore if the last message is from the assistant (user hasn't replied yet)
    if (lastMsg.role !== "assistant") return;

    // Don't restore if user explicitly dismissed the form for this message
    if (dismissedInputForMessageRef.current.has(lastMsg.id)) return;

    // Gather events from both conversation-level and message-level sources
    const eventsToCheck = [
      ...(conversation.a2aEvents || []),
      ...(lastMsg.events || []),
    ];

    for (const event of eventsToCheck) {
      if (event.artifact?.name !== "UserInputMetaData") continue;

      let metadata: UserInputMetadata | null = null;

      // Extract from DataPart (primary format)
      if (event.artifact?.parts) {
        for (const part of event.artifact.parts) {
          if (part.kind === "data" && part.data) {
            metadata = part.data as UserInputMetadata;
            break;
          }
        }
      }

      // Fallback: artifact.metadata.metadata (legacy format)
      if (!metadata && event.artifact?.metadata) {
        const artMeta = event.artifact.metadata as Record<string, unknown>;
        if (artMeta.metadata && typeof artMeta.metadata === "object") {
          metadata = artMeta.metadata as UserInputMetadata;
        }
      }

      if (metadata?.input_fields && metadata.input_fields.length > 0) {
        console.log(
          `[ChatPanel] 📝 Restoring pending user input form from persisted events (${metadata.input_fields.length} fields)`
        );
        setPendingUserInput({ messageId: lastMsg.id, metadata });
        return;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, conversation?.messages?.length, isThisConversationStreaming]);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Core submit function that accepts a message directly
  // Uses @a2a-js/sdk with AsyncGenerator pattern (same as agent-forge)
  const submitMessage = useCallback(async (messageToSend: string) => {
    if (!messageToSend.trim() || isThisConversationStreaming) return;

    // Create conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation();
    }

    // Clear previous turn's events (tasks, tool completions, A2A stream events)
    console.log(`[A2A-DEBUG] 🧹 clearA2AEvents() called for conv=${convId} — starting new turn`);
    const preCleanConv = useChatStore.getState().conversations.find((c: any) => c.id === convId);
    console.log(`[A2A-DEBUG] 🧹 PRE-CLEAR event count: ${preCleanConv?.a2aEvents?.length ?? 0}`, preCleanConv?.a2aEvents?.map((e: any) => `${e.type}/${e.artifact?.name || 'n/a'}`));
    clearA2AEvents(convId);
    const postCleanConv = useChatStore.getState().conversations.find((c: any) => c.id === convId);
    console.log(`[A2A-DEBUG] 🧹 POST-CLEAR event count: ${postCleanConv?.a2aEvents?.length ?? 0}`);

    // Add user message - generate turnId for this request/response pair
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    addMessage(convId, {
      role: "user",
      content: messageToSend,
      // Stamp sender identity so shared conversations attribute messages correctly
      senderEmail: session?.user?.email ?? undefined,
      senderName: session?.user?.name ?? undefined,
      senderImage: session?.user?.image ?? undefined,
    }, turnId);

    // Add assistant message placeholder with same turnId
    const assistantMsgId = addMessage(convId, { role: "assistant", content: "" }, turnId);

    // Create A2A SDK client for this request
    // Include user email so agents know who is making the request
    const client = new A2ASDKClient({
      endpoint,
      accessToken,
      userEmail: session?.user?.email ?? undefined,
    });

    // ═══════════════════════════════════════════════════════════════
    // AGENT-FORGE PATTERN: Use local variables for streaming state
    // ═══════════════════════════════════════════════════════════════
    let accumulatedText = ""; // Matches agent-forge's accumulatedText
    let rawStreamContent = ""; // Accumulates ALL streaming content (never reset)
    let eventCounter = 0;
    let hasReceivedCompleteResult = false;
    let lastUIUpdate = 0;
    let capturedTaskId: string | undefined; // Capture taskId from first event for crash recovery
    const UI_UPDATE_INTERVAL = 100; // Throttle UI updates to max 10/sec
    // Buffer A2A events locally and flush on the same throttle as UI updates.
    // Previously, addA2AEvent was called on EVERY token, causing a Zustand set()
    // per token — hundreds of store updates/sec that saturated React's render pipeline.
    const eventBuffer: Parameters<typeof addA2AEvent>[0][] = [];

    // Mark this conversation as streaming
    setConversationStreaming(convId, {
      conversationId: convId,
      messageId: assistantMsgId,
      client: { abort: () => client.abort() } as ReturnType<typeof setConversationStreaming> extends void ? never : Parameters<typeof setConversationStreaming>[1] extends { client: infer C } ? C : never,
    });

    try {
      // ═══════════════════════════════════════════════════════════════
      // AGENT-FORGE PATTERN: for await loop over async generator
      // ═══════════════════════════════════════════════════════════════
      for await (const event of client.sendMessageStream(messageToSend, convId)) {
        eventCounter++;
        const eventNum = eventCounter;

        const artifactName = event.artifactName || "";
        const newContent = event.displayContent;

        // LEVEL 2 CRASH RECOVERY: Capture taskId from the first event that has one.
        // This is persisted on the assistant message so that if the tab crashes,
        // we can poll tasks/get on reload to recover the final result.
        if (!capturedTaskId && event.taskId) {
          capturedTaskId = event.taskId;
          updateMessage(convId!, assistantMsgId, { taskId: capturedTaskId });
        }

        // Buffer event for batched store update (flushed on UI_UPDATE_INTERVAL)
        const storeEvent = toStoreEvent(event, `event-${eventNum}-${Date.now()}`);
        eventBuffer.push(storeEvent as Parameters<typeof addA2AEvent>[0]);

        // Flush buffer immediately for important events that update the Tasks panel
        // (execution plans, tool notifications, final results, user input forms)
        const isImportantArtifact =
          artifactName === "execution_plan_update" ||
          artifactName === "execution_plan_status_update" ||
          artifactName === "tool_notification_start" ||
          artifactName === "tool_notification_end" ||
          artifactName === "partial_result" ||
          artifactName === "final_result" ||
          artifactName === "complete_result" ||
          artifactName === "UserInputMetaData";

        // Log important artifacts in detail
        if (isImportantArtifact) {
          // Access artifact from the raw A2A event (ParsedA2AEvent wraps it)
          const rawArtifact = (event.raw as any)?.artifact;
          const artifactText = rawArtifact?.parts?.[0]?.text?.substring(0, 200) || event.displayContent?.substring(0, 200) || '';
          console.log(`[A2A-DEBUG] ⚡ IMPORTANT ARTIFACT #${eventNum}: ${artifactName}`, {
            convId,
            artifactId: rawArtifact?.artifactId,
            text: artifactText,
            bufferSize: eventBuffer.length,
            taskId: event.taskId,
          });
        }

        if (isImportantArtifact && eventBuffer.length > 0) {
          console.log(`[A2A-DEBUG] 📤 FLUSH buffer (${eventBuffer.length} events) for important artifact: ${artifactName}`);
          for (const bufferedEvent of eventBuffer) {
            addA2AEvent(bufferedEvent, convId!);
          }
          eventBuffer.length = 0;
          // Log store state right after flush
          const storeConv = useChatStore.getState().conversations.find((c: any) => c.id === convId);
          console.log(`[A2A-DEBUG] 📊 POST-FLUSH store event count: ${storeConv?.a2aEvents?.length ?? 0}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // DETECT USER INPUT FORM REQUEST
        // ═══════════════════════════════════════════════════════════════
        if (artifactName === "UserInputMetaData" && event.metadata) {
          console.log(`[ChatPanel] 📝 USER INPUT FORM REQUESTED - Event #${eventNum}`);
          const metadata = event.metadata as UserInputMetadata;
          if (metadata.input_fields && metadata.input_fields.length > 0) {
            console.log(`[ChatPanel] 📝 Form has ${metadata.input_fields.length} fields:`, metadata.input_fields.map(f => f.field_name));
            setPendingUserInput({
              messageId: assistantMsgId,
              metadata,
              contextId: event.contextId || convId,
            });
          }
        }

        // 🔍 DEBUG: Condensed logging
        const isImportantEvent = artifactName === "final_result" || artifactName === "partial_result" ||
                                  artifactName === "complete_result" || event.type === "status" || artifactName === "UserInputMetaData";
        if (isImportantEvent || eventNum % 50 === 0) {
          console.log(`[A2A SDK] #${eventNum} ${event.type}/${artifactName} len=${newContent?.length || 0} final=${event.isFinal} buf=${accumulatedText.length}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 1: Handle final/complete results IMMEDIATELY
        // (Agent-forge pattern)
        //
        // The backend sends different artifact names depending on the scenario:
        //   - "final_result": multi-agent synthesis or explicit completion
        //   - "partial_result": partial/streaming result
        //   - "complete_result": single sub-agent completed (backend dedup
        //     skips sending a separate final_result because the sub-agent's
        //     complete_result IS the final answer)
        //
        // All three must be treated identically: replace accumulatedText,
        // set isFinal=true, and guard against subsequent events corrupting
        // the content via hasReceivedCompleteResult.
        // ═══════════════════════════════════════════════════════════════
        if (artifactName === "partial_result" || artifactName === "final_result" || artifactName === "complete_result") {
          console.log(`\n${'🎉'.repeat(20)}`);
          console.log(`[A2A SDK] 🎉 ${artifactName.toUpperCase()} RECEIVED! Event #${eventNum}`);
          console.log(`[A2A SDK] 📄 Content: ${newContent.length} chars`);
          console.log(`[A2A SDK] 📝 Preview: "${newContent.substring(0, 150)}..."`);
          console.log(`${'🎉'.repeat(20)}\n`);

          if (newContent) {
            // Replace accumulated text with complete final text (agent-forge pattern)
            accumulatedText = newContent;
            // Append final result to raw stream content
            rawStreamContent += `\n\n[${artifactName}]\n${newContent}`;
            hasReceivedCompleteResult = true;
            updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent, isFinal: true });
            // Don't break - continue to receive status-update event
          } else if (accumulatedText.length > 0) {
            // Fallback: use accumulated content
            console.log(`[A2A SDK] ⚠️ ${artifactName} empty - using accumulated content`);
            rawStreamContent += `\n\n[${artifactName}] (using accumulated content)`;
            hasReceivedCompleteResult = true;
            updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent, isFinal: true });
            // Don't break - continue to receive status-update event
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 2: Handle status events (completion signals)
        // ═══════════════════════════════════════════════════════════════
        if (event.type === "status" && event.isFinal) {
          console.log(`[A2A SDK] 🏁 Stream complete (final status) - Event #${eventNum}`);
          setConversationStreaming(convId!, null);
          break;
        }

        // Skip events without content
        if (!newContent) continue;

        // ═══════════════════════════════════════════════════════════════
        // ACCUMULATE RAW STREAM CONTENT (always append, never reset)
        // This captures streaming output for the "Streaming Output" view
        // NOTE: Tool notifications and execution plans are shown in the Tasks panel,
        // so we exclude them from raw stream to avoid duplication
        // ═══════════════════════════════════════════════════════════════
        const isToolOrPlanArtifact =
          artifactName === "tool_notification_start" ||
          artifactName === "tool_notification_end" ||
          artifactName === "execution_plan_update" ||
          artifactName === "execution_plan_status_update";

        if ((event.type === "message" || event.type === "artifact") && !isToolOrPlanArtifact) {
          // Only accumulate actual streaming content (not tool notifications)
          rawStreamContent += newContent;
        }

        // Skip tool notifications and execution plans from FINAL content (shown in Tasks panel)
        if (isToolOrPlanArtifact) {
          continue;
        }

        // GUARD: Don't accumulate to final content after receiving complete result
        if (hasReceivedCompleteResult) continue;

        // ═══════════════════════════════════════════════════════════════
        // ACCUMULATE FINAL CONTENT (Agent-forge pattern)
        // ═══════════════════════════════════════════════════════════════
        if (event.type === "message" || event.type === "artifact") {
          if (event.shouldAppend === false) {
            // append=false means start fresh for final content
            console.log(`[A2A SDK] append=false - starting fresh with new content`);
            accumulatedText = newContent;
          } else {
            // Default: append to accumulated text
            accumulatedText += newContent;
          }

          // Throttle UI updates — flush event buffer + update message together
          // so the store only gets ONE batched update per interval, not per token.
          const now = Date.now();
          if (now - lastUIUpdate >= UI_UPDATE_INTERVAL) {
            // Flush buffered A2A events first
            if (eventBuffer.length > 0) {
              console.log(`[A2A-DEBUG] 📤 THROTTLE-FLUSH buffer (${eventBuffer.length} events) at interval`);
            }
            for (const bufferedEvent of eventBuffer) {
              addA2AEvent(bufferedEvent, convId!);
            }
            eventBuffer.length = 0;
            updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent });
            lastUIUpdate = now;
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // FINALIZE (Agent-forge's finishStreamingMessage pattern)
      // ═══════════════════════════════════════════════════════════════

      // Flush any remaining buffered events
      if (eventBuffer.length > 0) {
        console.log(`[A2A-DEBUG] 📤 FINAL-FLUSH remaining buffer (${eventBuffer.length} events)`);
      }
      for (const bufferedEvent of eventBuffer) {
        addA2AEvent(bufferedEvent, convId!);
      }
      eventBuffer.length = 0;

      // Log final event state
      const finalConv = useChatStore.getState().conversations.find((c: any) => c.id === convId);
      const finalEvents = finalConv?.a2aEvents || [];
      const execPlanEvents = finalEvents.filter((e: any) => e.artifact?.name === 'execution_plan_update' || e.artifact?.name === 'execution_plan_status_update');
      const toolStartEvents = finalEvents.filter((e: any) => e.artifact?.name === 'tool_notification_start');
      const toolEndEvents = finalEvents.filter((e: any) => e.artifact?.name === 'tool_notification_end');
      console.log(`[A2A-DEBUG] 🏁 STREAM COMPLETE - total events in store: ${finalEvents.length}`, {
        execution_plans: execPlanEvents.length,
        tool_starts: toolStartEvents.length,
        tool_ends: toolEndEvents.length,
        exec_plan_texts: execPlanEvents.map((e: any) => e.artifact?.parts?.[0]?.text?.substring(0, 150)),
      });

      console.log(`[A2A SDK] 🏁 STREAM COMPLETE - ${eventCounter} events, hasResult=${hasReceivedCompleteResult}`);
      console.log(`[A2A SDK] 📊 Final content: ${accumulatedText.length} chars, Raw stream: ${rawStreamContent.length} chars`);

      if (!hasReceivedCompleteResult) {
        if (accumulatedText.length > 0) {
          console.log(`[A2A SDK] ⚠️ No final_result - using accumulated content (${accumulatedText.length} chars)`);
          updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent, isFinal: true });
        } else {
          console.log(`[A2A SDK] ⚠️ Stream ended with no content`);
          updateMessage(convId!, assistantMsgId, { rawStreamContent, isFinal: true });
        }
      } else {
        // Ensure rawStreamContent is saved even when we received final_result
        updateMessage(convId!, assistantMsgId, { rawStreamContent });
      }

      // Always clear streaming state
      setConversationStreaming(convId!, null);

    } catch (error) {
      console.error("[A2A SDK] Stream error:", error);
      appendToMessage(convId, assistantMsgId, `\n\n**Error:** ${(error as Error).message || "Failed to connect to A2A endpoint"}`);
      setConversationStreaming(convId, null);
    }
  }, [isThisConversationStreaming, activeConversationId, endpoint, accessToken, createConversation, clearA2AEvents, addMessage, appendToMessage, updateMessage, addEventToMessage, addA2AEvent, setConversationStreaming]);

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
        // Queue is full - show feedback or prevent action
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

    // Send message as-is (users can use @agent syntax naturally)
    const message = input.trim();

    setInput("");

    await submitMessage(message);
  }, [input, submitMessage, isThisConversationStreaming, queuedMessages]);

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

  // Stable callback for feedback changes (avoids creating new function refs on each render)
  const handleFeedbackChange = useCallback((messageId: string, feedback: Feedback) => {
    if (activeConversationId) {
      updateMessageFeedback(activeConversationId, messageId, feedback);
    }
  }, [activeConversationId, updateMessageFeedback]);

  // Stable callback for feedback submission
  const handleFeedbackSubmit = useCallback(async (messageId: string, feedback: Feedback) => {
    console.log("Feedback submitted:", { messageId, feedback });
    // Future: Send to /api/feedback endpoint
  }, []);

  // Handle user input form submission via HITL resume (not plain text)
  const handleUserInputSubmit = useCallback(async (formData: Record<string, string>) => {
    if (!pendingUserInput || !activeConversationId) return;

    console.log("[ChatPanel] 📝 HITL form submitted:", formData);

    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    addMessage(activeConversationId, { role: "user", content: "Form submitted." }, turnId);
    const assistantMsgId = addMessage(activeConversationId, { role: "assistant", content: "" }, turnId);

    const contextId = pendingUserInput.contextId || activeConversationId;
    dismissedInputForMessageRef.current.add(pendingUserInput.messageId);
    setPendingUserInput(null);
    clearA2AEvents(activeConversationId);

    const client = new A2ASDKClient({ endpoint, accessToken });

    // Build HITL decision with form values for the backend executor's resume handler
    const inputFieldsWithValues = (pendingUserInput.metadata.input_fields || []).map(field => ({
      ...field,
      value: formData[field.field_name] || '',
    }));

    const decision: HITLDecision = {
      type: 'edit',
      actionName: 'CAIPEAgentResponse',
      args: {
        args: {
          metadata: { input_fields: inputFieldsWithValues },
          user_inputs: formData,
        },
      },
    };

    setConversationStreaming(activeConversationId, {
      conversationId: activeConversationId,
      messageId: assistantMsgId,
      client: { abort: () => client.abort() } as ReturnType<typeof setConversationStreaming> extends void ? never : Parameters<typeof setConversationStreaming>[1] extends { client: infer C } ? C : never,
    });

    let accumulatedText = "";
    let rawStreamContent = "";
    let eventCounter = 0;
    let hasReceivedCompleteResult = false;

    try {
      for await (const event of client.sendHITLResponse(contextId, [decision])) {
        eventCounter++;
        const artifactName = event.artifactName || "";
        const newContent = event.displayContent;

        const storeEvent = toStoreEvent(event, `event-${eventCounter}-${Date.now()}`);
        addA2AEvent(storeEvent as Parameters<typeof addA2AEvent>[0], activeConversationId);

        if (artifactName === "partial_result" || artifactName === "final_result") {
          if (newContent) {
            accumulatedText = newContent;
            hasReceivedCompleteResult = true;
            updateMessage(activeConversationId, assistantMsgId, {
              content: accumulatedText,
              rawStreamContent,
              isFinal: true,
            });
          }
        }

        if (event.type === "status" && event.isFinal) {
          setConversationStreaming(activeConversationId, null);
          break;
        }

        if (newContent && !hasReceivedCompleteResult) {
          accumulatedText += newContent;
          rawStreamContent += newContent;
          updateMessage(activeConversationId, assistantMsgId, { content: accumulatedText, rawStreamContent });
        }
      }

      if (!hasReceivedCompleteResult && accumulatedText.length > 0) {
        updateMessage(activeConversationId, assistantMsgId, {
          content: accumulatedText,
          rawStreamContent,
          isFinal: true,
        });
      }
      setConversationStreaming(activeConversationId, null);
    } catch (error) {
      console.error("[ChatPanel] HITL resume error:", error);
      appendToMessage(activeConversationId, assistantMsgId,
        `\n\n**Error:** ${(error as Error).message || "Failed to resume"}`);
      setConversationStreaming(activeConversationId, null);
    }
  }, [pendingUserInput, activeConversationId, endpoint, accessToken, addMessage, updateMessage,
      appendToMessage, addA2AEvent, clearA2AEvents, setConversationStreaming]);

  // Handle @mention detection
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInput(newValue);

    // Check for @ mention trigger
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');

    if (lastAtSymbol !== -1) {
      // Check if @ is at start of word (preceded by space or at beginning)
      const charBeforeAt = lastAtSymbol > 0 ? textBeforeCursor[lastAtSymbol - 1] : ' ';
      const isAtWordStart = charBeforeAt === ' ' || charBeforeAt === '\n';

      if (isAtWordStart) {
        const textAfterAt = textBeforeCursor.slice(lastAtSymbol + 1);
        // Only show if no space after @ (still typing the mention)
        if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
          setMentionFilter(textAfterAt.toLowerCase());
          setShowMentionMenu(true);
          return;
        }
      }
    }

    setShowMentionMenu(false);
  }, []);

  // Handle mention selection
  const handleMentionSelect = useCallback((agent: CustomCall) => {
    if (!inputRef.current) return;

    const cursorPos = inputRef.current.selectionStart;
    const textBeforeCursor = input.slice(0, cursorPos);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');

    if (lastAtSymbol !== -1) {
      const textBeforeAt = input.slice(0, lastAtSymbol);
      const textAfterCursor = input.slice(cursorPos);
      const newText = textBeforeAt + agent.prompt + ' ' + textAfterCursor;

      setInput(newText);
      setShowMentionMenu(false);

      // Set cursor position after the mention
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = textBeforeAt.length + agent.prompt.length + 1;
          inputRef.current.selectionStart = newCursorPos;
          inputRef.current.selectionEnd = newCursorPos;
          inputRef.current.focus();
        }
      }, 0);
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Close mention menu on Escape
    if (e.key === "Escape" && showMentionMenu) {
      setShowMentionMenu(false);
      return;
    }

    // Force send: Cmd/Ctrl + Enter
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(true); // Force send
      return;
    }
    // Normal send: Enter (only if not streaming, otherwise queue)
    // Don't send if mention menu is open
    if (e.key === "Enter" && !e.shiftKey && !showMentionMenu) {
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
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Welcome to {getConfig('appName')}</h2>
                <p className="text-muted-foreground max-w-md mx-auto mb-1">
                  {getConfig('tagline')}
                </p>
                <p className="text-sm text-muted-foreground/80 max-w-lg mx-auto">
                  {getConfig('description')}
                </p>
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
                onSubmit={handleUserInputSubmit}
                onCancel={() => {
                  if (pendingUserInput) {
                    dismissedInputForMessageRef.current.add(pendingUserInput.messageId);
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
            {/* @mention autocomplete menu */}
            <AnimatePresence>
              {showMentionMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50"
                >
                  <div className="p-2 border-b border-border">
                    <p className="text-xs text-muted-foreground font-medium">Select an agent:</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {DEFAULT_AGENTS
                      .filter(agent =>
                        agent.label.toLowerCase().includes(mentionFilter) ||
                        agent.id.toLowerCase().includes(mentionFilter)
                      )
                      .map((agent) => {
                        const agentLogo = AGENT_LOGOS[agent.id];
                        return (
                          <button
                            key={agent.id}
                            onClick={() => handleMentionSelect(agent)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/80 transition-colors text-left"
                          >
                            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-white dark:bg-gray-200 p-1 shrink-0">
                              {agentLogo?.icon || <span className="text-sm font-bold">{agent.label.charAt(0)}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{agent.label}</p>
                              <p className="text-xs text-muted-foreground">{agent.prompt}</p>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

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
                    : `Ask ${getConfig('appName')} anything or type @ to mention an agent...`
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
            {getConfig('appName')} can make mistakes. Verify important information.
          </p>
        </div>
      </div>
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
  // Ref for auto-scrolling the Thinking container to the bottom on new content.
  // Safe because content is truncated to 2000 chars during streaming.
  const thinkingRef = useRef<HTMLDivElement>(null);

  // ═══════════════════════════════════════════════════════════════
  // THINKING SECTION: Light auto-scroll to bottom on new content.
  // Safe because content is truncated to 2000 chars during streaming.
  // ═══════════════════════════════════════════════════════════════
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

      {/* Raw streaming output - collapsible - shows accumulated stream content.
          PERFORMANCE: During streaming, only display the tail of rawStreamContent
          to prevent the browser from re-rendering 80K+ chars on every token. */}
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
                    // During streaming, only show the last 2000 chars to prevent freezes
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

/** Number of recent turns to keep fully rendered. Older turns are collapsed. */
const VISIBLE_TURN_COUNT = 2;
/** Minimum total turns before auto-collapsing kicks in. */
const COLLAPSE_THRESHOLD = 2;

/** A "turn" is a user message + its assistant response (or a lone message). */
interface Turn {
  userMsg?: ChatMessageType;
  assistantMsg?: ChatMessageType;
  /** Short preview text for the collapsed summary row. */
  preview: string;
  /** Timestamp of the turn (user message timestamp). */
  timestamp: Date;
}

/**
 * Group a flat message list into turns (user+assistant pairs).
 * Messages are paired by order: each user message is followed by an assistant
 * message to form a turn. Unpaired messages become solo turns.
 */
function groupMessagesIntoTurns(messages: ChatMessageType[]): Turn[] {
  const turns: Turn[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user" && i + 1 < messages.length && messages[i + 1].role === "assistant") {
      // Paired turn
      const assistantMsg = messages[i + 1];
      turns.push({
        userMsg: msg,
        assistantMsg,
        preview: msg.content.slice(0, 80).trim() + (msg.content.length > 80 ? "..." : ""),
        timestamp: msg.timestamp,
      });
      i += 2;
    } else {
      // Solo message (orphan user or assistant)
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
 * CollapsedTurnsBanner — lightweight summary for older turns that are hidden.
 * Clicking it expands the old messages. Shows turn count, first query preview,
 * and time range. Renders ~5 DOM nodes vs hundreds for full messages.
 */
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
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <MessageSquare className="h-4 w-4 text-primary/70" />
      </div>

      {/* Content */}
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

      {/* Time range */}
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

      {/* Expand hint */}
      <ChevronDown className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors shrink-0" />
    </motion.button>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ChatMessage Component
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessageProps {
  message: ChatMessageType;
  onCopy: (content: string, id: string) => void;
  isCopied: boolean;
  isStreaming?: boolean;
  // Whether this is the latest answer (should be expanded by default)
  isLatestAnswer?: boolean;
  // Stop handler for streaming messages
  onStop?: () => void;
  // Retry prompt - called to regenerate the response
  onRetry?: () => void;
  // Feedback props
  feedback?: Feedback;
  onFeedbackChange?: (feedback: Feedback) => void;
  onFeedbackSubmit?: (feedback: Feedback) => void;
  // Conversation ID for Langfuse feedback tracking
  conversationId?: string;
  // Crash recovery: true when polling tasks/get for this message's interrupted task
  isRecovering?: boolean;
  // Display name for user messages (first name from session, falls back to "You")
  userDisplayName?: string;
}

/**
 * ChatMessage — wrapped in React.memo to prevent re-renders of older messages
 * when only the latest streaming message is updating (every 100ms).
 */
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
}: ChatMessageProps) {
  const isUser = message.role === "user";
  // Show Thinking expanded by default — content is truncated to 2000 chars during
  // streaming to prevent freezes, so it's safe to keep expanded.
  const [showRawStream, setShowRawStream] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  // Collapse final answer for assistant messages - auto-collapse older answers, keep latest expanded
  const [isCollapsed, setIsCollapsed] = useState(() => {
    // Auto-collapse older answers, but keep latest answer expanded
    if (isUser) return false;
    return !isLatestAnswer && message.content && message.content.length > 300;
  });

  // Display all streamed content as-is
  const displayContent = message.content;

  // Get a preview of the streaming content (last 200 chars)
  const streamPreview = message.content.slice(-200).trim();

  // Get preview for collapsed view (first 300 chars)
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
      {/* Avatar */}
      <div
        className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm overflow-hidden",
          isUser
            ? "bg-primary"
            : "gradient-primary-br",
          isStreaming && "animate-pulse"
        )}
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

      {/* Message Content */}
      <div className={cn(
        "flex-1 min-w-0",
        isUser ? "max-w-[85%] text-right ml-auto" : "max-w-full"
      )}>
        {/* Role label with collapse button and stop button for assistant messages */}
        <div className={cn(
          "flex items-center mb-1.5",
          isUser
            ? "text-primary justify-end"
            : "text-muted-foreground justify-between"
        )}>
          {isUser ? (
            <span className="text-xs font-medium">
              {/* Priority: message-level senderName (from MongoDB, the actual sender)
                  → session-based userDisplayName (backward compat for legacy messages)
                  → "You" (no session / no data) */}
              {message.senderName
                ? message.senderName.split(" ")[0]
                : userDisplayName}
            </span>
          ) : (
            <>
              <span className="text-xs font-medium">{getConfig('appName')}</span>
              <div className="flex items-center gap-2">
                {/* Collapse button - shown when not streaming and content is long */}
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

        {/* Streaming state - Cursor/OpenAI style */}
        {/* Keep StreamingView visible for the entire duration of isStreaming.
            Previously, isFinal=true (set when final_result artifact arrives) caused
            an immediate jump to the markdown renderer even though the stream hadn't
            closed yet — producing the jarring "cut over" layout shift.
            Now we only switch to final markdown once isStreaming is false. */}
        {isStreaming && message.role === "assistant" ? (
          <StreamingView
            message={message}
            showRawStream={showRawStream}
            setShowRawStream={setShowRawStream}
            isStreaming={isStreaming}
          />
        ) : (
          /* Final output - rendered as Markdown */
          <>
            {/* ═══════════════════════════════════════════════════════════
                CRASH RECOVERY INDICATORS
                Show when a message was interrupted or is being recovered.
                ═══════════════════════════════════════════════════════════ */}
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
                      <p className="text-xs opacity-70 mt-0.5">
                        Checking if the backend task completed. This may take a moment.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Activity className="h-4 w-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Response was interrupted</p>
                      <p className="text-xs opacity-70 mt-0.5">
                        The page crashed or was reloaded while this response was streaming.
                        {message.taskId
                          ? " The backend task could not be recovered."
                          : " No task ID was captured before the crash."}
                      </p>
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
                  ? "inline-block bg-primary text-primary-foreground px-4 py-3 rounded-tr-sm max-w-full"
                  : "bg-card/50 border border-border/50 px-4 py-3",
                // Improved text selection styles
                "selection:bg-primary/30 selection:text-foreground"
              )}
            >
              {isUser ? (
                <div>
                  <p className="whitespace-pre-wrap break-words text-sm selection:bg-white/30 selection:text-white" style={{ overflowWrap: 'anywhere' }}>{message.content}</p>
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
                      // Headings
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
                      // Paragraphs
                      p: ({ children }) => (
                        <p className="text-sm leading-relaxed text-foreground/90 mb-2 last:mb-0">
                          {children}
                        </p>
                      ),
                      // Lists
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
                      // Code - handles both inline and fenced code blocks
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      code({ className, children, node, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        // Check if this is a code block (has newlines or language) vs inline code
                        const codeContent = String(children).replace(/\n$/, "");
                        const hasNewlines = codeContent.includes("\n");
                        const isCodeBlock = match || hasNewlines || className;

                        if (!isCodeBlock) {
                          // Inline code
                          return (
                            <code
                              className="bg-muted/80 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono break-all"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }

                        // Fenced code block
                        const language = match ? match[1] : "";
                        // Shell/CLI commands look better without syntax highlighting —
                        // the colorization of flags, env vars, pipes etc. is distracting
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
                      // Blockquotes
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-primary/50 pl-4 my-3 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      ),
                      // Tables
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
                      // Links
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
                      // Horizontal rule
                      hr: () => (
                        <hr className="my-6 border-border/50" />
                      ),
                      // Strong/Bold
                      strong: ({ children }) => (
                        <strong className="font-semibold text-foreground">{children}</strong>
                      ),
                      // Emphasis/Italic
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

            {/* Actions for user messages */}
            {isUser && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isHovered ? 1 : 0.6 }}
                className="flex items-center gap-1 mt-2 justify-end"
              >
                {/* Retry button */}
                {onRetry && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary/20"
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

                {/* Copy button */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary/20"
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

            {/* Actions for assistant messages */}
            {!isUser && displayContent && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isHovered ? 1 : 0.6 }}
                className="flex items-center gap-1 mt-2"
              >
                {/* Collapse button - bottom right */}
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

                {/* Retry button */}
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

                {/* Copy button */}
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

                {/* Divider */}
                <div className="h-4 w-px bg-border/50" />

                {/* Feedback buttons */}
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

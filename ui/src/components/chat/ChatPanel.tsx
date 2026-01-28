"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, RotateCcw, Gitlab, Slack, Video, Activity } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { A2ASDKClient, type ParsedA2AEvent, toStoreEvent } from "@/lib/a2a-sdk-client";
import { cn } from "@/lib/utils";
import { ChatMessage as ChatMessageType } from "@/types/a2a";
import { getConfig } from "@/lib/config";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { InlineAgentSelector, DEFAULT_AGENTS, CustomCall } from "./CustomCallButtons";
import { SubAgentCard, groupEventsByAgent, getAgentDisplayOrder, isRealSubAgent } from "./SubAgentCard";
import { AgentStreamBox } from "./AgentStreamBox";

interface ChatPanelProps {
  endpoint: string;
}

export function ChatPanel({ endpoint }: ChatPanelProps) {
  const { data: session } = useSession();
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedAgentPrompt, setSelectedAgentPrompt] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll state
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAutoScrollingRef = useRef(false);

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

    const threshold = 100; // pixels from bottom
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, []);

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

  // Auto-scroll during streaming when content updates (only if user hasn't scrolled up)
  useEffect(() => {
    if (isThisConversationStreaming && !isUserScrolledUp) {
      // Use instant scroll during streaming for smoother experience
      scrollToBottom("instant");
    }
  }, [conversation?.messages?.at(-1)?.content, isThisConversationStreaming, isUserScrolledUp, scrollToBottom]);

  // Reset scroll state when conversation changes
  useEffect(() => {
    setIsUserScrolledUp(false);
    setShowScrollButton(false);
    // Scroll to bottom when switching conversations
    setTimeout(() => scrollToBottom("instant"), 50);
  }, [activeConversationId, scrollToBottom]);

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
    clearA2AEvents(convId);

    // Add user message - generate turnId for this request/response pair
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    addMessage(convId, { role: "user", content: messageToSend }, turnId);

    // Add assistant message placeholder with same turnId
    const assistantMsgId = addMessage(convId, { role: "assistant", content: "" }, turnId);

    // Create A2A SDK client for this request
    const client = new A2ASDKClient({
      endpoint,
      accessToken,
    });

    // ═══════════════════════════════════════════════════════════════
    // AGENT-FORGE PATTERN: Use local variables for streaming state
    // ═══════════════════════════════════════════════════════════════
    let accumulatedText = ""; // Matches agent-forge's accumulatedText
    let rawStreamContent = ""; // Accumulates ALL streaming content (never reset)
    let eventCounter = 0;
    let hasReceivedCompleteResult = false;
    let lastUIUpdate = 0;
    const UI_UPDATE_INTERVAL = 100; // Throttle UI updates
    const EVENT_BATCH_SIZE = 20; // Batch events for storage

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

        // Store ALL events in A2A Debug (no batching)
        const storeEvent = toStoreEvent(event, `event-${eventNum}-${Date.now()}`);
        addA2AEvent(storeEvent as Parameters<typeof addA2AEvent>[0], convId!);

        // 🔍 DEBUG: Condensed logging
        const isImportantEvent = artifactName === "final_result" || artifactName === "partial_result" ||
                                  event.type === "status";
        if (isImportantEvent || eventNum % 50 === 0) {
          console.log(`[A2A SDK] #${eventNum} ${event.type}/${artifactName} len=${newContent?.length || 0} final=${event.isFinal} buf=${accumulatedText.length}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // PRIORITY 1: Handle final_result/partial_result IMMEDIATELY
        // (Agent-forge pattern)
        // ═══════════════════════════════════════════════════════════════
        if (artifactName === "partial_result" || artifactName === "final_result") {
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

          // Throttle UI updates
          const now = Date.now();
          if (now - lastUIUpdate >= UI_UPDATE_INTERVAL) {
            updateMessage(convId!, assistantMsgId, { content: accumulatedText, rawStreamContent });
            lastUIUpdate = now;
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // FINALIZE (Agent-forge's finishStreamingMessage pattern)
      // ═══════════════════════════════════════════════════════════════
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
      const baseMessage = input.trim();
      const message = selectedAgentPrompt
        ? `${selectedAgentPrompt} ${baseMessage}`
        : baseMessage;
      
      // Add to queue if under limit
      if (queuedMessages.length < 3) {
        setQueuedMessages(prev => [...prev, message]);
        setInput("");
        setSelectedAgentPrompt(null);
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

    // Prepend agent prompt if selected
    const baseMessage = input.trim();
    const message = selectedAgentPrompt
      ? `${selectedAgentPrompt} ${baseMessage}`
      : baseMessage;

    setInput("");
    setSelectedAgentPrompt(null); // Clear after sending

    await submitMessage(message);
  }, [input, selectedAgentPrompt, submitMessage, isThisConversationStreaming, queuedMessages]);

  // Auto-submit pending message from use case selection
  useEffect(() => {
    const pendingMessage = consumePendingMessage();
    if (pendingMessage) {
      submitMessage(pendingMessage);
    }
  }, [activeConversationId, consumePendingMessage, submitMessage]);

  const handleStop = () => {
    if (activeConversationId) {
      cancelConversationRequest(activeConversationId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Force send: Cmd/Ctrl + Enter
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(true); // Force send
      return;
    }
    // Normal send: Enter (only if not streaming, otherwise queue)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Messages Area */}
      <ScrollArea className="flex-1" viewportRef={scrollViewportRef}>
        <div className="max-w-7xl mx-auto pl-1 pr-1 py-4 space-y-6">
          {!conversation?.messages.length && (
            <div className="text-center py-20">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Welcome to CAIPE</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Ask anything about your platform. I can help with ArgoCD, AWS, GitHub, Jira, and more.
              </p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {conversation?.messages.map((msg, index) => {
              const isLastMessage = index === conversation.messages.length - 1;
              const isAssistantStreaming = isThisConversationStreaming && msg.role === "assistant" && isLastMessage;

              // For retry: if user message, use its content; if assistant, find preceding user message
              const getRetryContent = () => {
                if (msg.role === "user") return msg.content;
                // Find the user message right before this assistant message
                for (let i = index - 1; i >= 0; i--) {
                  if (conversation.messages[i].role === "user") {
                    return conversation.messages[i].content;
                  }
                }
                return null;
              };

              // Check if this is the last assistant message (latest answer)
              const isLastAssistantMessage = msg.role === "assistant" && 
                index === conversation.messages.length - 1;

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
                  onFeedbackChange={(feedback) => {
                    if (activeConversationId) {
                      updateMessageFeedback(activeConversationId, msg.id, feedback);
                    }
                  }}
                  onFeedbackSubmit={async (feedback) => {
                    // TODO: Send feedback to backend
                    console.log("Feedback submitted:", { messageId: msg.id, feedback });
                    // Future: Send to /api/feedback endpoint
                  }}
                />
              );
            })}
          </AnimatePresence>

          {/* Invisible marker for scroll-to-bottom */}
          <div ref={messagesEndRef} className="h-px" />
        </div>
      </ScrollArea>

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

      {/* Input Area */}
      <div className="border-t border-border p-3">
        <div className="max-w-7xl mx-auto space-y-2">
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

          <div className="relative flex items-center gap-3 bg-card rounded-xl border border-border p-3 focus-within:ring-2 focus-within:ring-primary focus-within:border-primary focus-within:shadow-lg focus-within:shadow-primary/20 transition-all duration-200">
            {/* Agent Selector */}
            <div className="border-r border-border pr-2">
              <InlineAgentSelector
                value={selectedAgentPrompt}
                onChange={setSelectedAgentPrompt}
              />
            </div>

            <TextareaAutosize
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedAgentPrompt
                ? `Ask ${DEFAULT_AGENTS.find(a => a.prompt === selectedAgentPrompt)?.label || 'agent'}...`
                : isThisConversationStreaming
                  ? queuedMessages.length >= 3
                    ? "Queue full (3/3). Send or cancel messages to queue more, or Cmd+Enter to force send..."
                    : `Type to queue message (${queuedMessages.length}/3), or Cmd+Enter to force send...`
                  : "Ask CAIPE anything..."
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

          {/* Selected agent indicator */}
          {selectedAgentPrompt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Targeting:</span>
              <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                {DEFAULT_AGENTS.find(a => a.prompt === selectedAgentPrompt)?.label || selectedAgentPrompt}
              </span>
              <button
                onClick={() => setSelectedAgentPrompt(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            CAIPE can make mistakes. Verify important information.
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
  // Feature flag for sub-agent cards (experimental)
  const enableSubAgentCards = getConfig('enableSubAgentCards');

  // ═══════════════════════════════════════════════════════════════
  // AUTO-SCROLL with user override
  // ═══════════════════════════════════════════════════════════════
  const streamingOutputRef = useRef<HTMLDivElement>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const isAutoScrollingRef = useRef(false);

  // Detect when user scrolls up (takes control)
  const handleScroll = useCallback(() => {
    const container = streamingOutputRef.current;
    if (!container || isAutoScrollingRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    // If not at bottom, assume user is reviewing history -> disable auto-scroll
    // If at bottom, resume auto-scroll
    setIsUserScrolled(!isAtBottom);
  }, []);

  // Auto-scroll when content updates (if user hasn't taken control)
  useEffect(() => {
    const container = streamingOutputRef.current;
    if (!container || isUserScrolled) return;

    // Mark as auto-scrolling to prevent handleScroll from triggering
    isAutoScrollingRef.current = true;
    container.scrollTop = container.scrollHeight;

    // Reset flag after scroll completes
    requestAnimationFrame(() => {
      isAutoScrollingRef.current = false;
    });
  }, [message.content, message.rawStreamContent, isUserScrolled]);

  // Reset user scroll state when message changes (new response)
  useEffect(() => {
    setIsUserScrolled(false);
  }, [message.id]);

  // Group events by source agent (including supervisor)
  const eventGroups = useMemo(() => {
    const groups = groupEventsByAgent(message.events);
    // Also include supervisor events if present
    const supervisorEvents = message.events.filter(e => !e.sourceAgent || e.sourceAgent.toLowerCase() === "supervisor");
    if (supervisorEvents.length > 0) {
      groups.set("supervisor", supervisorEvents);
    }
    return groups;
  }, [message.events]);

  // Get display order - include all agents (supervisor + sub-agents)
  const agentOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();

    // Add supervisor first if present
    if (eventGroups.has("supervisor")) {
      order.push("supervisor");
      seen.add("supervisor");
    }

    // Add other agents
    for (const event of message.events) {
      const agent = (event.sourceAgent || "supervisor").toLowerCase();
      if (!seen.has(agent) && agent !== "supervisor") {
        // Include all agents, not just "real sub-agents"
        seen.add(agent);
        order.push(agent);
      }
    }

    return order;
  }, [message.events, eventGroups]);

  // Always show agent stream boxes if we have agents
  const hasAgents = agentOrder.length > 0;

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

      {/* Individual Agent Stream Boxes - Intuitive per-agent streaming */}
      {hasAgents && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Agent Streams
            </span>
            <div className="flex-1 h-px bg-border/50" />
            <span className="text-xs text-muted-foreground/60">
              {agentOrder.length} {agentOrder.length === 1 ? 'agent' : 'agents'}
            </span>
          </div>

          {/* Individual streaming boxes for each agent */}
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {agentOrder.map(agentName => {
                const events = eventGroups.get(agentName) || [];
                // Show box if has events, is streaming, or has content
                const hasContent = events.some(e => e.displayContent && e.displayContent.trim().length > 0);
                if (events.length === 0 && !isStreaming && !hasContent) return null;

                return (
                  <AgentStreamBox
                    key={agentName}
                    agentName={agentName}
                    events={events}
                    isStreaming={isStreaming}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Raw streaming output - collapsible - shows accumulated stream content */}
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
                ref={streamingOutputRef}
                onScroll={handleScroll}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 rounded-lg bg-card/80 border border-border/50 max-h-64 overflow-y-auto scroll-smooth"
              >
                <pre className="text-sm text-foreground/80 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {/* Show rawStreamContent if available, otherwise fall back to content */}
                  {message.rawStreamContent || message.content}
                </pre>
                {/* Scroll indicator when user has scrolled up */}
                {isUserScrolled && (
                  <button
                    onClick={() => {
                      setIsUserScrolled(false);
                      const container = streamingOutputRef.current;
                      if (container) {
                        container.scrollTop = container.scrollHeight;
                      }
                    }}
                    className="sticky bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors"
                  >
                    <ArrowDown className="h-3 w-3" />
                    <span>Resume auto-scroll</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

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
}

function ChatMessage({
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
}: ChatMessageProps) {
  const isUser = message.role === "user";
  // Show raw stream expanded by default during streaming, hide after final output
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
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
          isUser
            ? "bg-primary"
            : "bg-gradient-to-br from-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)]",
          isStreaming && "animate-pulse"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
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
            <span className="text-xs font-medium">You</span>
          ) : (
            <>
              <span className="text-xs font-medium">CAIPE</span>
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
        {/* Show streaming view only if: streaming is active AND message is not final */}
        {/* Once isFinal is true, ALWAYS show markdown regardless of streaming state */}
        {isStreaming && !message.isFinal && message.role === "assistant" ? (
          <StreamingView
            message={message}
            showRawStream={showRawStream}
            setShowRawStream={setShowRawStream}
            isStreaming={isStreaming}
          />
        ) : (
          /* Final output - rendered as Markdown */
          <>
            <div
              className={cn(
                "rounded-xl relative",
                isUser
                  ? "inline-block bg-primary text-primary-foreground px-4 py-3 rounded-tr-sm"
                  : "bg-card/50 border border-border/50 px-4 py-3",
                // Improved text selection styles
                "selection:bg-primary/30 selection:text-foreground"
              )}
            >
              {isUser ? (
                <div>
                  <p className="whitespace-pre-wrap text-sm selection:bg-white/30 selection:text-white">{message.content}</p>
                </div>
              ) : (
                <div className="prose-container">
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
                              className="bg-muted/80 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }

                        // Fenced code block
                        const language = match ? match[1] : "";
                        const shouldHighlight = match && language !== "text";

                        return (
                          <div className="my-4 rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e]">
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
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  padding: "1rem 1.25rem",
                                  fontSize: "13px",
                                  lineHeight: "1.6",
                                  background: "transparent"
                                }}
                              >
                                {codeContent}
                              </SyntaxHighlighter>
                            ) : (
                              <pre className="p-4 overflow-x-auto">
                                <code className="text-[13px] leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap">
                                  {codeContent}
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
                className="flex items-center gap-2 mt-2 justify-end"
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
                className="flex items-center gap-2 mt-2"
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
}

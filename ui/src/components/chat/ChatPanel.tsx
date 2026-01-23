"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { A2AClient } from "@/lib/a2a-client";
import { cn } from "@/lib/utils";
import { ChatMessage as ChatMessageType } from "@/types/a2a";
import { config } from "@/lib/config";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { InlineAgentSelector, DEFAULT_AGENTS, CustomCall } from "./CustomCallButtons";
import { SubAgentCard, groupEventsByAgent, getAgentDisplayOrder, isRealSubAgent } from "./SubAgentCard";

interface ChatPanelProps {
  endpoint: string;
}

export function ChatPanel({ endpoint }: ChatPanelProps) {
  const { data: session } = useSession();
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedAgentPrompt, setSelectedAgentPrompt] = useState<string | null>(null);
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
  const accessToken = config.ssoEnabled ? session?.accessToken : undefined;

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
  const submitMessage = useCallback(async (messageToSend: string) => {
    if (!messageToSend.trim() || isThisConversationStreaming) return;

    // Create conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation();
    }

    // Clear previous turn's events (tasks, tool completions, A2A stream events)
    // Each turn should show only its own events in the right panel
    clearA2AEvents(convId);

    // Add user message - generate turnId for this request/response pair
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    addMessage(convId, { role: "user", content: messageToSend }, turnId);

    // Add assistant message placeholder with same turnId
    const assistantMsgId = addMessage(convId, { role: "assistant", content: "" }, turnId);

    // Create A2A client for this request
    // 🔧 FIX: Track completion state in a closure variable that persists across callbacks
    // This prevents race conditions where late-arriving events might overwrite final content
    let hasReceivedCompleteResult = false;

    // 🔧 DUAL-BUFFER ARCHITECTURE (matching agent-forge pattern)
    // - persistentBuffer: NEVER reset, accumulates ALL content for complete history
    // - displayContent: follows append flag, used for current display
    // This ensures no content is lost when append=false arrives mid-stream
    let persistentBuffer = "";

    // Event counter for debugging
    let eventCounter = 0;
    
    // 🔧 THROTTLING: Prevent UI freeze from 900+ rapid state updates
    // Batch event storage and throttle content updates
    let pendingEvents: typeof event[] = [];
    let lastUIUpdate = 0;
    const UI_UPDATE_INTERVAL = 100; // Update UI every 100ms max
    const EVENT_BATCH_SIZE = 20; // Batch events before storing
    let pendingContent = "";

    const client = new A2AClient({
      endpoint,
      accessToken, // Pass JWT token for Bearer authentication
      onEvent: (event) => {
        try {
        eventCounter++;
        const eventNum = eventCounter;

        const newContent = event.displayContent;
        const artifactName = event.artifact?.name || "";
        
        // 🔧 THROTTLE: Batch event storage instead of storing every single event
        // Only store every Nth event to reduce state updates
        // BUT always store important events needed for Tasks panel and final results
        const isImportantArtifact = 
          artifactName === "final_result" ||
          artifactName === "partial_result" ||
          artifactName === "execution_plan_update" ||
          artifactName === "execution_plan_status_update" ||
          artifactName === "tool_notification_start" ||
          artifactName === "tool_notification_end";
        
        if (eventNum % EVENT_BATCH_SIZE === 0 || isImportantArtifact || event.type === "tool_start" || event.type === "tool_end") {
          addA2AEvent(event, convId!);
          addEventToMessage(convId!, assistantMsgId, event);
        }

        // 🔍 DEBUG: Condensed single-line logging (prevents console buffer overflow)
        // Only log every 50th event for streaming_result, always log important events
        const isImportantEvent = artifactName === "final_result" || artifactName === "partial_result" || 
                                  event.type === "status" || event.type === "tool_start" || event.type === "tool_end";
        if (isImportantEvent || eventNum % 50 === 0) {
          console.log(`[A2A] #${eventNum} ${event.type}/${artifactName} len=${newContent?.length || 0} lastChunk=${event.isLastChunk} buf=${persistentBuffer.length}`);
        }

        // 🔧 PRIORITY 1: Handle final_result/partial_result IMMEDIATELY
        // These events signal the definitive final content and must take precedence
        const isCompleteResult = artifactName === "partial_result" || artifactName === "final_result";
        
        if (isCompleteResult) {
          console.log(`[A2A] 🔍 FINAL_RESULT detected! newContent=${newContent?.length || 0} chars`);
          console.log(`[A2A] 🔍 event.displayContent:`, event.displayContent);
          console.log(`[A2A] 🔍 event.artifact:`, JSON.stringify(event.artifact, null, 2).substring(0, 500));
          
          if (newContent) {
            console.log(`\n${'🎉'.repeat(20)}`);
            console.log(`[A2A] 🎉 FINAL RESULT RECEIVED! Event #${eventNum}`);
            console.log(`[A2A] 📄 ${artifactName}: ${newContent.length} chars`);
            console.log(`[A2A] 📝 Preview: "${newContent.substring(0, 150)}..."`);
            console.log(`${'🎉'.repeat(20)}\n`);
            // CRITICAL: Set flag BEFORE updating to prevent race conditions
            hasReceivedCompleteResult = true;
            updateMessage(convId!, assistantMsgId, { content: newContent, isFinal: true });
            // Clear streaming state immediately so UI shows markdown AND tasks complete
            setConversationStreaming(convId!, null);
            return; // Exit immediately, don't process any other logic
          } else {
            console.error(`[A2A] ❌ FINAL_RESULT has no content! Check artifact.parts parsing`);
          }
        }

        // Handle status events (they signal stream end)
        if (event.type === "status" && event.isFinal) {
          console.log(`[A2A] 🏁 Stream complete (final status received) - Event #${eventNum}`);
          updateMessage(convId!, assistantMsgId, { isFinal: true });
          // Also ensure streaming state is cleared
          setConversationStreaming(convId!, null);
          return;
        }

        // Skip events without content (silent skip)
        if (!newContent) return;

        // Skip tool notifications - they're handled separately in UI (logged above)
        if (event.type === "tool_start" || event.type === "tool_end") return;

        // Skip tool notification artifacts and execution plans (shown in Tasks panel)
        if (artifactName === "tool_notification_start" ||
            artifactName === "tool_notification_end" ||
            artifactName === "execution_plan_update" ||
            artifactName === "execution_plan_status_update") {
          return;
        }

        // GUARD: If we've already received a complete result, ignore subsequent content events
        // This prevents late-arriving streaming chunks from overwriting the final result
        const currentMessage = conversation?.messages.find(m => m.id === assistantMsgId);
        if (hasReceivedCompleteResult || currentMessage?.isFinal) {
          return; // Silent ignore - already have final result
        }

        // Handle content based on event type
        // Note: final_result/partial_result are already handled above with priority
        if (event.type === "message") {
          // Message events from agents contain actual content - accumulate it
          pendingContent += newContent;
        } else if (event.type === "artifact") {
          // Handle streaming_result and complete_result (from sub-agents)
          if (artifactName === "streaming_result" || artifactName === "complete_result") {
            // Handle append flag properly to avoid duplicates
            if (event.shouldAppend) {
              persistentBuffer += newContent;
            } else {
              // append=false means this is a fresh start or replacement
              persistentBuffer = newContent;
            }
            pendingContent = persistentBuffer;
          } else {
            // For other artifacts, accumulate
            pendingContent += newContent;
          }
        }
        
        // 🔧 THROTTLE: Only update UI every UI_UPDATE_INTERVAL ms
        const now = Date.now();
        if (pendingContent && (now - lastUIUpdate >= UI_UPDATE_INTERVAL)) {
          updateMessage(convId!, assistantMsgId, { content: pendingContent });
          lastUIUpdate = now;
        }

        // Mark message as final when stream ends (backup check)
        // Note: lastChunk with final_result/partial_result is already handled above
        if (event.isLastChunk && artifactName !== "final_result" && artifactName !== "partial_result") {
          console.log(`[A2A] lastChunk received on ${artifactName} - marking message complete`);
          // Flush any pending content before marking final
          if (pendingContent) {
            updateMessage(convId!, assistantMsgId, { content: pendingContent, isFinal: true });
          } else {
            updateMessage(convId!, assistantMsgId, { isFinal: true });
          }
        }
        } catch (err) {
          // Catch any exceptions in event processing to prevent stream interruption
          console.error(`[A2A] ❌ EXCEPTION in onEvent handler at event #${eventCounter}:`, err);
          console.error(`[A2A] ❌ Event that caused exception:`, JSON.stringify(event, null, 2).substring(0, 500));
        }
      },
      onError: (error) => {
        console.error("A2A Error:", error);
        appendToMessage(convId!, assistantMsgId, `\n\n**Error:** ${error.message}`);
        setConversationStreaming(convId!, null);
      },
      onComplete: () => {
        console.log(`[A2A] 🏁 STREAM COMPLETE - ${eventCounter} events, hasResult=${hasReceivedCompleteResult}`);

        // 🔧 Flush any pending content that wasn't sent due to throttling
        const finalContent = pendingContent || persistentBuffer;
        
        // 🔧 If we didn't receive a complete_result but have content,
        // use the accumulated content as the final content
        if (!hasReceivedCompleteResult && finalContent.length > 0) {
          console.log(`[A2A] ⚠️ No final_result - using accumulated content (${finalContent.length} chars)`);
          updateMessage(convId!, assistantMsgId, { content: finalContent, isFinal: true });
        } else if (hasReceivedCompleteResult) {
          updateMessage(convId!, assistantMsgId, { isFinal: true });
        } else {
          updateMessage(convId!, assistantMsgId, { isFinal: true });
        }
        setConversationStreaming(convId!, null);
      },
    });

    // Mark this conversation as streaming with its client
    setConversationStreaming(convId, {
      conversationId: convId,
      messageId: assistantMsgId,
      client,
    });

    try {
      // Pass convId as contextId/threadId for multi-turn conversation
      const reader = await client.sendMessage(messageToSend, convId);

      // Consume the stream
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      appendToMessage(convId, assistantMsgId, `\n\n**Error:** Failed to connect to A2A endpoint`);
      setConversationStreaming(convId, null);
    }
  }, [isThisConversationStreaming, activeConversationId, endpoint, accessToken, createConversation, clearA2AEvents, addMessage, appendToMessage, updateMessage, addEventToMessage, addA2AEvent, setConversationStreaming]);

  // Retry handler - re-sends the message content
  const handleRetry = useCallback((content: string) => {
    if (isThisConversationStreaming) return; // Don't retry while streaming
    submitMessage(content);
  }, [isThisConversationStreaming, submitMessage]);

  // Wrapper for form submission that uses input state
  const handleSubmit = useCallback(async () => {
    if (!input.trim()) return;

    // Prepend agent prompt if selected
    const baseMessage = input.trim();
    const message = selectedAgentPrompt
      ? `${selectedAgentPrompt} ${baseMessage}`
      : baseMessage;

    setInput("");
    setSelectedAgentPrompt(null); // Clear after sending

    await submitMessage(message);
  }, [input, selectedAgentPrompt, submitMessage]);

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Messages Area */}
      <ScrollArea className="flex-1" viewportRef={scrollViewportRef}>
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
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

              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onCopy={handleCopy}
                  isCopied={copiedId === msg.id}
                  isStreaming={isAssistantStreaming}
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
      <div className="border-t border-border p-4">
        <div className="max-w-4xl mx-auto space-y-2">
          <div className="relative flex items-end gap-2 bg-card rounded-xl border border-border p-2">
            {/* Agent Selector */}
            <div className="border-r border-border pr-1">
              <InlineAgentSelector
                value={selectedAgentPrompt}
                onChange={setSelectedAgentPrompt}
              />
            </div>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedAgentPrompt
                ? `Ask ${DEFAULT_AGENTS.find(a => a.prompt === selectedAgentPrompt)?.label || 'agent'}...`
                : "Ask CAIPE anything..."
              }
              className="flex-1 bg-transparent resize-none outline-none min-h-[44px] max-h-[200px] px-3 py-2 text-sm"
              rows={1}
              disabled={isThisConversationStreaming}
            />
            {isThisConversationStreaming ? (
              <Button
                size="icon"
                variant="destructive"
                onClick={handleStop}
                className="shrink-0"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="shrink-0"
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
}

function StreamingView({ message, showRawStream, setShowRawStream }: StreamingViewProps) {
  // Feature flag for sub-agent cards (experimental)
  const enableSubAgentCards = config.enableSubAgentCards;

  // Group events by source agent
  const eventGroups = useMemo(() => {
    return groupEventsByAgent(message.events);
  }, [message.events]);

  // Get display order - only real sub-agents (not internal tools)
  const agentOrder = useMemo(() => {
    return getAgentDisplayOrder(message.events);
  }, [message.events]);

  // Check if we have any real sub-agents to display
  const hasSubAgents = enableSubAgentCards && agentOrder.length > 0;

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

      {/* Sub-agent cards - shown when feature flag enabled and we have real sub-agents */}
      {hasSubAgents && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          {/* Grid layout for parallel agents */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agentOrder.map(agentName => {
              const events = eventGroups.get(agentName) || [];
              if (events.length === 0) return null;

              return (
                <SubAgentCard
                  key={agentName}
                  agentName={agentName}
                  events={events}
                  isStreaming={true}
                />
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Raw streaming output - collapsible */}
      {message.content && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {hasSubAgents ? "Supervisor Output" : "Streaming Output"}
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
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 rounded-lg bg-card/80 border border-border/50 max-h-64 overflow-y-auto"
              >
                <pre className="text-sm text-foreground/80 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {message.content}
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
// ChatMessage Component
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessageProps {
  message: ChatMessageType;
  onCopy: (content: string, id: string) => void;
  isCopied: boolean;
  isStreaming?: boolean;
  // Retry prompt
  onRetry?: (content: string) => void;
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
  onRetry,
  feedback,
  onFeedbackChange,
  onFeedbackSubmit,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  // Show raw stream expanded by default during streaming, hide after final output
  const [showRawStream, setShowRawStream] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  // Display all streamed content as-is
  const displayContent = message.content;

  // Get a preview of the streaming content (last 200 chars)
  const streamPreview = message.content.slice(-200).trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn(
        "flex gap-4 group",
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
        isUser ? "max-w-[70%] text-right" : "max-w-full"
      )}>
        {/* Role label */}
        <div className={cn(
          "text-xs font-medium mb-1.5",
          isUser ? "text-primary" : "text-muted-foreground"
        )}>
          {isUser ? "You" : "CAIPE"}
        </div>

        {/* Streaming state - Cursor/OpenAI style */}
        {/* Show streaming view only if: streaming is active AND message is not final */}
        {/* Once isFinal is true, ALWAYS show markdown regardless of streaming state */}
        {isStreaming && !message.isFinal && message.role === "assistant" ? (
          <StreamingView
            message={message}
            showRawStream={showRawStream}
            setShowRawStream={setShowRawStream}
          />
        ) : (
          /* Final output - rendered as Markdown */
          <>
            <div
              className={cn(
                "rounded-xl relative",
                isUser
                  ? "inline-block bg-primary text-primary-foreground px-4 py-3 rounded-tr-sm"
                  : "bg-card/50 border border-border/50 px-5 py-4",
                // Improved text selection styles
                "selection:bg-primary/30 selection:text-foreground"
              )}
            >
              {isUser ? (
                <div className="relative">
                  <p className="whitespace-pre-wrap text-sm selection:bg-white/30 selection:text-white">{message.content}</p>
                  {/* Action buttons for user messages - shows on hover */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="absolute -left-2 top-1/2 -translate-y-1/2 -translate-x-full flex gap-1"
                      >
                        {/* Retry button */}
                        {onRetry && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 bg-card/80 border border-border/50 shadow-sm hover:bg-card"
                                  onClick={() => onRetry(message.content)}
                                >
                                  <RotateCcw className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left">
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
                                className="h-7 w-7 bg-card/80 border border-border/50 shadow-sm hover:bg-card"
                                onClick={() => onCopy(message.content, message.id)}
                              >
                                {isCopied ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3 text-muted-foreground" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              {isCopied ? "Copied!" : "Copy message"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="prose-container">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Headings
                      h1: ({ children }) => (
                        <h1 className="text-xl font-bold text-foreground mb-4 mt-6 first:mt-0 pb-2 border-b border-border/50">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg font-semibold text-foreground mb-3 mt-5 first:mt-0">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-semibold text-foreground mb-2 mt-4 first:mt-0">
                          {children}
                        </h3>
                      ),
                      // Paragraphs
                      p: ({ children }) => (
                        <p className="text-sm leading-relaxed text-foreground/90 mb-3 last:mb-0">
                          {children}
                        </p>
                      ),
                      // Lists
                      ul: ({ children }) => (
                        <ul className="list-disc list-outside ml-5 mb-3 space-y-1.5 text-sm text-foreground/90">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-outside ml-5 mb-3 space-y-1.5 text-sm text-foreground/90">
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
                        <blockquote className="border-l-4 border-primary/50 pl-4 my-4 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      ),
                      // Tables
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-4 rounded-lg border border-border/50">
                          <table className="min-w-full text-sm">
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => (
                        <thead className="bg-muted/50">{children}</thead>
                      ),
                      th: ({ children }) => (
                        <th className="px-4 py-2.5 text-left font-semibold text-foreground border-b border-border/50">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-4 py-2.5 border-b border-border/30 text-foreground/90">
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
                </div>
              )}
            </div>

            {/* Actions */}
            {!isUser && displayContent && !isStreaming && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isHovered ? 1 : 0.6 }}
                className="flex items-center gap-2 mt-2"
              >
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

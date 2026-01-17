"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp } from "lucide-react";
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

interface ChatPanelProps {
  endpoint: string;
}

export function ChatPanel({ endpoint }: ChatPanelProps) {
  const { data: session } = useSession();
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedAgentPrompt, setSelectedAgentPrompt] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    activeConversationId,
    getActiveConversation,
    createConversation,
    addMessage,
    updateMessage,
    appendToMessage,
    addEventToMessage,
    addA2AEvent,
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages]);

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

    // Add user message
    addMessage(convId, { role: "user", content: messageToSend });

    // Add assistant message placeholder
    const assistantMsgId = addMessage(convId, { role: "assistant", content: "" });

    // Create A2A client for this request
    const client = new A2AClient({
      endpoint,
      accessToken, // Pass JWT token for Bearer authentication
      onEvent: (event) => {
        addA2AEvent(event);
        addEventToMessage(convId!, assistantMsgId, event);

        // Handle streaming content from A2A artifacts
        if (event.type === "artifact" && event.displayContent) {
          const newContent = event.displayContent;
          const artifactName = event.artifact?.name || "";
          
          // Check if this is a complete/final result that should replace all content
          // A2A uses append=false or specific artifact names to indicate replacement
          const isCompleteResult = artifactName === "complete_result" || 
                                   artifactName === "final_result" ||
                                   event.isLastChunk;
          
          if (isCompleteResult) {
            // Complete result - replace message content entirely
            updateMessage(convId!, assistantMsgId, { content: newContent });
          } else {
            // Streaming/partial result - append if not duplicate
            const currentConv = useChatStore.getState().conversations.find(c => c.id === convId);
            const currentMsg = currentConv?.messages.find(m => m.id === assistantMsgId);
            const currentContent = currentMsg?.content || "";
            
            if (!currentContent.includes(newContent)) {
              appendToMessage(convId!, assistantMsgId, newContent);
            }
          }
        }

        // Mark message as final when stream ends
        if (event.isLastChunk || event.isFinal) {
          updateMessage(convId!, assistantMsgId, { isFinal: true });
        }
      },
      onError: (error) => {
        console.error("A2A Error:", error);
        appendToMessage(convId!, assistantMsgId, `\n\n**Error:** ${error.message}`);
        setConversationStreaming(convId!, null);
      },
      onComplete: () => {
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
  }, [isThisConversationStreaming, activeConversationId, endpoint, accessToken, createConversation, addMessage, appendToMessage, updateMessage, addEventToMessage, addA2AEvent, setConversationStreaming]);

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
    <div className="h-full flex flex-col bg-background">
      {/* Messages Area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
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

              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onCopy={handleCopy}
                  isCopied={copiedId === msg.id}
                  isStreaming={isAssistantStreaming}
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
        </div>
      </ScrollArea>

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

interface ChatMessageProps {
  message: ChatMessageType;
  onCopy: (content: string, id: string) => void;
  isCopied: boolean;
  isStreaming?: boolean;
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

  // Extract tools from events with their status (active or completed)
  const toolsWithStatus = React.useMemo(() => {
    if (message.isFinal) return [];

    const toolStarts: Map<string, { description: string; startTime: Date; order: number }> = new Map();
    const toolEnds = new Set<string>();
    let order = 0;

    for (const event of message.events) {
      if (event.type === "tool_start") {
        // Use displayContent for the actual tool description
        // Remove leading 🔧 emoji if present to avoid duplication
        let toolDescription = event.displayContent || event.displayName || "Processing...";
        toolDescription = toolDescription.replace(/^🔧\s*/g, "").trim();
        toolStarts.set(event.id, { description: toolDescription, startTime: event.timestamp, order: order++ });
      } else if (event.type === "tool_end") {
        // Match tool_end to tool_start by finding the most recent unmatched start
        for (const [id] of toolStarts) {
          if (!toolEnds.has(id)) {
            toolEnds.add(id);
            break;
          }
        }
      }
    }

    // Return tools with their status
    return Array.from(toolStarts.entries())
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, tool]) => ({
        id,
        description: tool.description,
        isCompleted: toolEnds.has(id),
      }))
      .slice(-5); // Show max 5 recent tools
  }, [message.events, message.isFinal]);

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
        {isStreaming && !message.isFinal ? (
          <div className="space-y-2">
            {/* Tool notifications - fixed position list */}
            <div className="space-y-1.5">
              {/* Show tools with their status */}
              {toolsWithStatus.length > 0 ? (
                toolsWithStatus.map((tool) => (
                  <motion.div
                    key={tool.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-2 rounded-lg border",
                      tool.isCompleted
                        ? "bg-green-500/10 border-green-500/30 text-green-400"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    )}
                  >
                    <span className="text-sm">{tool.isCompleted ? "✅" : "🔧"}</span>
                    <span className={cn(
                      "text-xs font-medium",
                      tool.isCompleted && "line-through opacity-70"
                    )}>
                      {tool.description}
                    </span>
                    {!tool.isCompleted && <Loader2 className="h-3 w-3 animate-spin" />}
                  </motion.div>
                ))
              ) : (
                /* Thinking indicator when no tools are active */
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
            </div>

            {/* Streaming output - expanded by default */}
            {message.content && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">Streaming Output</span>
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
                  {/* Copy button for user messages - shows on hover */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="absolute -left-2 top-1/2 -translate-y-1/2 -translate-x-full"
                      >
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
                      // Code
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const isInline = !match && !className;

                        if (isInline) {
                          return (
                            <code
                              className="bg-muted/80 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }

                        return (
                          <div className="my-4 rounded-lg overflow-hidden border border-border/50">
                            {match && (
                              <div className="bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground border-b border-border/50 font-mono">
                                {match[1]}
                              </div>
                            )}
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match ? match[1] : "text"}
                              PreTag="div"
                              customStyle={{
                                margin: 0,
                                borderRadius: 0,
                                padding: "1rem",
                                fontSize: "13px",
                                lineHeight: "1.5",
                                background: "hsl(var(--muted) / 0.3)"
                              }}
                            >
                              {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
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

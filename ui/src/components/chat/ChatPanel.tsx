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
import { useChatStore } from "@/store/chat-store";
import { A2AClient } from "@/lib/a2a-client";
import { cn, extractFinalAnswer } from "@/lib/utils";
import { ChatMessage as ChatMessageType } from "@/types/a2a";
import { config } from "@/lib/config";

interface ChatPanelProps {
  endpoint: string;
}

export function ChatPanel({ endpoint }: ChatPanelProps) {
  const { data: session } = useSession();
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isThisConversationStreaming) return;

    const message = input.trim();
    setInput("");

    // Create conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation();
    }

    // Add user message
    addMessage(convId, { role: "user", content: message });

    // Add assistant message placeholder
    const assistantMsgId = addMessage(convId, { role: "assistant", content: "" });

    // Create A2A client for this request
    const client = new A2AClient({
      endpoint,
      accessToken, // Pass JWT token for Bearer authentication
      onEvent: (event) => {
        addA2AEvent(event);
        addEventToMessage(convId!, assistantMsgId, event);

        // Handle streaming content
        if (event.type === "artifact" && event.displayContent) {
          appendToMessage(convId!, assistantMsgId, event.displayContent);
        }

        // Handle final result
        if (event.isLastChunk || event.isFinal) {
          const currentConv = useChatStore.getState().conversations.find(c => c.id === convId);
          const currentMsg = currentConv?.messages.find(m => m.id === assistantMsgId);
          if (currentMsg) {
            const { hasFinalAnswer, content } = extractFinalAnswer(currentMsg.content);
            if (hasFinalAnswer) {
              updateMessage(convId!, assistantMsgId, {
                content,
                isFinal: true
              });
            }
          }
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
      const reader = await client.sendMessage(message, convId);

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
  }, [input, isThisConversationStreaming, activeConversationId, endpoint, accessToken, createConversation, addMessage, appendToMessage, updateMessage, addEventToMessage, addA2AEvent, setConversationStreaming]);

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
                />
              );
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        <div className="max-w-4xl mx-auto">
          <div className="relative flex items-end gap-2 bg-card rounded-xl border border-border p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask CAIPE anything..."
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
          <p className="text-xs text-muted-foreground text-center mt-2">
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
}

function ChatMessage({ message, onCopy, isCopied, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === "user";
  // Show raw stream expanded by default during streaming, hide after final output
  const [showRawStream, setShowRawStream] = useState(true);

  // Extract final answer if present, otherwise use content
  const { hasFinalAnswer, content: finalContent } = extractFinalAnswer(message.content);
  const displayContent = hasFinalAnswer ? finalContent : message.content;

  // Get a preview of the streaming content (last 200 chars)
  const streamPreview = message.content.slice(-200).trim();

  // Extract active tools from events (tool_start without matching tool_end)
  const activeTools = React.useMemo(() => {
    if (!isStreaming || message.isFinal) return [];

    const toolStarts: Map<string, { description: string; startTime: Date }> = new Map();
    const toolEnds = new Set<string>();

    for (const event of message.events) {
      if (event.type === "tool_start") {
        // Use displayContent for the actual tool description (e.g., "Calling Agent Search...")
        // Fall back to displayName or a generic label
        const toolDescription = event.displayContent || event.displayName || "Processing...";
        toolStarts.set(event.id, { description: toolDescription, startTime: event.timestamp });
      } else if (event.type === "tool_end") {
        // Match tool_end to tool_start by finding the most recent unmatched start
        const endDescription = event.displayContent || "";
        for (const [id, tool] of toolStarts) {
          // Match by similar description or just mark the oldest unmatched
          if (!toolEnds.has(id)) {
            toolEnds.add(id);
            break;
          }
        }
      }
    }

    // Return tools that have started but not ended
    return Array.from(toolStarts.entries())
      .filter(([id]) => !toolEnds.has(id))
      .map(([, tool]) => tool.description)
      .slice(-3); // Show max 3 active tools
  }, [message.events, isStreaming, message.isFinal]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn(
        "flex gap-4",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
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
            {/* Tool/Thinking indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="inline-flex flex-col gap-1.5"
            >
              {/* Active tools */}
              <AnimatePresence mode="popLayout">
                {activeTools.length > 0 ? (
                  activeTools.map((toolDescription, idx) => (
                    <motion.div
                      key={`${toolDescription}-${idx}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400"
                    >
                      <span className="text-sm">🔧</span>
                      <span className="text-xs font-medium">{toolDescription}</span>
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </motion.div>
                  ))
                ) : (
                  <motion.div
                    key="thinking"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border/50"
                  >
                    <div className="relative">
                      <div className="w-2 h-2 bg-primary rounded-full animate-ping absolute" />
                      <div className="w-2 h-2 bg-primary rounded-full" />
                    </div>
                    <span className="text-sm text-muted-foreground">Thinking...</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

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
                "rounded-xl",
                isUser
                  ? "inline-block bg-primary text-primary-foreground px-4 py-3 rounded-tr-sm"
                  : "bg-card/50 border border-border/50 px-5 py-4"
              )}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap text-sm">{message.content}</p>
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
              <div className="flex items-center gap-1 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onCopy(displayContent, message.id)}
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3 w-3 mr-1 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

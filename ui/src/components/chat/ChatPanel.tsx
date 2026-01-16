"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
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

interface ChatPanelProps {
  endpoint: string;
}

export function ChatPanel({ endpoint }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<A2AClient | null>(null);

  const {
    activeConversationId,
    getActiveConversation,
    createConversation,
    addMessage,
    updateMessage,
    appendToMessage,
    addEventToMessage,
    addA2AEvent,
    setStreaming,
    isStreaming,
  } = useChatStore();

  const conversation = getActiveConversation();

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
    if (!input.trim() || isStreaming) return;

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

    setStreaming(true);

    try {
      clientRef.current = new A2AClient({
        endpoint,
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
        },
        onComplete: () => {
          setStreaming(false);
        },
      });

      const reader = await clientRef.current.sendMessage(message);

      // Consume the stream
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      appendToMessage(convId, assistantMsgId, `\n\n**Error:** Failed to connect to A2A endpoint`);
      setStreaming(false);
    }
  }, [input, isStreaming, activeConversationId, endpoint, createConversation, addMessage, appendToMessage, updateMessage, addEventToMessage, addA2AEvent, setStreaming]);

  const handleStop = () => {
    clientRef.current?.abort();
    setStreaming(false);
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
        <div className="max-w-4xl mx-auto p-4 space-y-6">
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
              const isAssistantStreaming = isStreaming && msg.role === "assistant" && isLastMessage;

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
              disabled={isStreaming}
            />
            {isStreaming ? (
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
  const [showRawStream, setShowRawStream] = useState(false);

  // Extract final answer if present, otherwise use content
  const { hasFinalAnswer, content: finalContent } = extractFinalAnswer(message.content);
  const displayContent = hasFinalAnswer ? finalContent : message.content;

  // Get a preview of the streaming content (last 200 chars)
  const streamPreview = message.content.slice(-200).trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn("flex gap-4", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          isUser ? "bg-primary" : "bg-gradient-to-br from-purple-500 to-pink-500",
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

      <div className={cn("flex-1 max-w-[80%]", isUser && "text-right")}>
        {/* Streaming state - Cursor/OpenAI style */}
        {isStreaming && !message.isFinal ? (
          <div className="space-y-2">
            {/* Thinking indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl rounded-tl-sm bg-card border border-border"
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="w-2 h-2 bg-primary rounded-full animate-ping absolute" />
                  <div className="w-2 h-2 bg-primary rounded-full" />
                </div>
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </motion.div>

            {/* Collapsible stream preview */}
            {streamPreview && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-2"
              >
                <button
                  onClick={() => setShowRawStream(!showRawStream)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showRawStream ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span>{showRawStream ? "Hide" : "Show"} raw stream</span>
                </button>

                <AnimatePresence>
                  {showRawStream && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 p-3 rounded-lg bg-muted/50 border border-border/50 max-h-40 overflow-y-auto"
                    >
                      <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words">
                        {message.content || "Waiting for response..."}
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
                "inline-block rounded-2xl px-4 py-3 text-sm",
                isUser
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-card border border-border rounded-tl-sm"
              )}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const isInline = !match;
                        return isInline ? (
                          <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
                            {children}
                          </code>
                        ) : (
                          <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{ margin: 0, borderRadius: "0.5rem" }}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        );
                      },
                      table({ children }) {
                        return (
                          <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-border">
                              {children}
                            </table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return (
                          <th className="border border-border px-3 py-2 bg-muted text-left">
                            {children}
                          </th>
                        );
                      },
                      td({ children }) {
                        return (
                          <td className="border border-border px-3 py-2">{children}</td>
                        );
                      },
                      a({ href, children }) {
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {displayContent || "..."}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {!isUser && displayContent && !isStreaming && (
              <div className="flex items-center gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onCopy(displayContent, message.id)}
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3 w-3 mr-1" />
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

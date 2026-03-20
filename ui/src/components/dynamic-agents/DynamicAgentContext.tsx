"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle,
  ChevronLeft,
  Bot,
  Info,
  ListTodo,
  Activity,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";
import { getGradientStyle } from "@/lib/gradient-themes";
import {
  SSEAgentEvent,
  EMPTY_SSE_EVENTS,
} from "./sse-types";
import type { SubAgentRef } from "@/types/dynamic-agent";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "next-auth/react";
import { FileTree } from "./FileTree";

// Todo item from todo_update events
interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface DynamicAgentContextProps {
  agentId?: string;
  agentName?: string;
  agentDescription?: string;
  agentModel?: string;
  agentVisibility?: string;
  /** Agent gradient theme (e.g., "ocean", "sunset") */
  agentGradient?: string | null;
  /** Map of server_id -> tool names (empty array = all tools from server) */
  allowedTools?: Record<string, string[]>;
  /** Configured subagents for delegation */
  subagents?: SubAgentRef[];
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  /** Whether the agent is disabled */
  agentDisabled?: boolean;
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

/**
 * Simplified context panel for Dynamic Agents.
 * Shows tool calls and agent info - no A2A debug panel.
 */
export function DynamicAgentContext({
  agentId,
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  agentGradient,
  allowedTools,
  subagents,
  agentNotFound,
  agentDisabled,
  collapsed = false,
  onCollapse,
}: DynamicAgentContextProps) {
  const { data: session } = useSession();
  const { isStreaming, activeConversationId, clearSSEEvents } = useChatStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      activeConversationId: s.activeConversationId,
      clearSSEEvents: s.clearSSEEvents,
    }))
  );

  const conversations = useChatStore((s) => s.conversations);

  // Derive conversation SSE events (Dynamic Agents use sseEvents, not a2aEvents)
  const conversationEvents = useMemo(() => {
    if (!activeConversationId) return EMPTY_SSE_EVENTS;
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.sseEvents || EMPTY_SSE_EVENTS;
  }, [activeConversationId, conversations]);

  // Get the active conversation
  const conversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [activeConversationId, conversations]);

  const [activeTab, setActiveTab] = useState<"events" | "info">("events");

  // Todos fetched from API (single source of truth)
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todosFetchKey, setTodosFetchKey] = useState(0);
  const [todosLoading, setTodosLoading] = useState(true);
  
  // Track which conversation's todos we've initiated fetching to prevent Strict Mode duplicates
  const todosFetchedForRef = useRef<{ conversationId: string; fetchKey: number } | null>(null);

  // Detect write_todos tool events and trigger a fetch
  useEffect(() => {
    const hasWriteTodosEvent = conversationEvents.some(
      (e) => e.type === "tool_start" && e.toolData?.tool_name === "write_todos"
    );
    if (hasWriteTodosEvent) {
      setTodosFetchKey((k) => k + 1);
    }
  }, [conversationEvents]);

  // Fetch todos from API when conversation changes or write_todos event occurs
  useEffect(() => {
    if (!activeConversationId || !agentId) {
      setTodos([]);
      setTodosLoading(false);
      todosFetchedForRef.current = null;
      return;
    }

    // Skip if we've already started fetching for this exact combination
    // (prevents duplicate requests from Strict Mode double-invocation)
    const currentFetchState = { conversationId: activeConversationId, fetchKey: todosFetchKey };
    if (
      todosFetchedForRef.current?.conversationId === currentFetchState.conversationId &&
      todosFetchedForRef.current?.fetchKey === currentFetchState.fetchKey
    ) {
      return;
    }
    
    // Mark as fetching BEFORE async to prevent duplicates
    todosFetchedForRef.current = currentFetchState;

    const fetchTodos = async () => {
      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${activeConversationId}/todos?agent_id=${encodeURIComponent(agentId)}`,
          {
            headers: {
              ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          const fetchedTodos: TodoItem[] = (data.todos || []).map(
            (todo: { content?: string; status?: string }, idx: number) => ({
              id: `todo-${idx}`,
              content: todo.content || "",
              status: (todo.status as "pending" | "in_progress" | "completed") || "pending",
            })
          );
          setTodos(fetchedTodos);
        }
      } catch {
        // Silently ignore fetch errors - todos are optional
      } finally {
        setTodosLoading(false);
      }
    };

    fetchTodos();
  }, [activeConversationId, agentId, todosFetchKey, session?.accessToken]);

  // Files fetched from API (single source of truth)
  const [files, setFiles] = useState<string[]>([]);
  const [filesFetchKey, setFilesFetchKey] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);
  const [isDownloadingFile, setIsDownloadingFile] = useState(false);
  const [downloadingFilePath, setDownloadingFilePath] = useState<string | undefined>();
  
  // Track which conversation's files we've initiated fetching to prevent Strict Mode duplicates
  const filesFetchedForRef = useRef<{ conversationId: string; fetchKey: number } | null>(null);

  // Reset loading states when conversation changes
  useEffect(() => {
    setTodosLoading(true);
    setFilesLoading(true);
  }, [activeConversationId]);

  // Detect write_file or edit_file tool events and trigger a fetch
  useEffect(() => {
    const hasFileWriteEvent = conversationEvents.some(
      (e) =>
        e.type === "tool_start" &&
        (e.toolData?.tool_name === "write_file" || e.toolData?.tool_name === "edit_file")
    );
    if (hasFileWriteEvent) {
      setFilesFetchKey((k) => k + 1);
    }
  }, [conversationEvents]);

  // Fetch files from API when conversation changes or file write event occurs
  useEffect(() => {
    if (!activeConversationId || !agentId) {
      setFiles([]);
      setFilesLoading(false);
      filesFetchedForRef.current = null;
      return;
    }

    // Skip if we've already started fetching for this exact combination
    // (prevents duplicate requests from Strict Mode double-invocation)
    const currentFetchState = { conversationId: activeConversationId, fetchKey: filesFetchKey };
    if (
      filesFetchedForRef.current?.conversationId === currentFetchState.conversationId &&
      filesFetchedForRef.current?.fetchKey === currentFetchState.fetchKey
    ) {
      return;
    }
    
    // Mark as fetching BEFORE async to prevent duplicates
    filesFetchedForRef.current = currentFetchState;

    const fetchFiles = async () => {
      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${activeConversationId}/files/list?agent_id=${encodeURIComponent(agentId)}`,
          {
            headers: {
              ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          setFiles(data.files || []);
        }
      } catch {
        // Silently ignore fetch errors - files are optional
      } finally {
        setFilesLoading(false);
      }
    };

    fetchFiles();
  }, [activeConversationId, agentId, filesFetchKey, session?.accessToken]);

  // Handle file download
  const handleFileDownload = useCallback(
    async (path: string) => {
      if (!activeConversationId || !agentId || isDownloadingFile) return;

      setIsDownloadingFile(true);
      setDownloadingFilePath(path);

      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${activeConversationId}/files/content?agent_id=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}`,
          {
            headers: {
              ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
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
          // Use just the filename for download
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
    [activeConversationId, agentId, session?.accessToken, isDownloadingFile]
  );

  // Handle file delete
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [deletingFilePath, setDeletingFilePath] = useState<string | undefined>();

  const handleFileDelete = useCallback(
    async (path: string) => {
      if (!activeConversationId || !agentId || isDeletingFile) return;

      setIsDeletingFile(true);
      setDeletingFilePath(path);

      try {
        const response = await fetch(
          `/api/dynamic-agents/conversations/${activeConversationId}/files/content?agent_id=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}`,
          {
            method: "DELETE",
            headers: {
              ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            },
          }
        );

        if (response.ok) {
          // Refresh files list after deletion
          setFilesFetchKey((k) => k + 1);
        }
      } catch {
        // Silently ignore delete errors
      } finally {
        setIsDeletingFile(false);
        setDeletingFilePath(undefined);
      }
    },
    [activeConversationId, agentId, session?.accessToken, isDeletingFile]
  );

  // Extract error messages from error events
  const errorMessages = useMemo(() => {
    return conversationEvents
      .filter((e) => e.type === "error")
      .map((e) => e.displayContent || e.content || "An unknown error occurred");
  }, [conversationEvents]);

  // Extract warning messages from warning events
  const warningMessages = useMemo(() => {
    return conversationEvents
      .filter((e) => e.type === "warning")
      .map((e) => e.displayContent || e.warningData?.message || "An unknown warning occurred");
  }, [conversationEvents]);

  // Restart runtime handler
  const [isRestarting, setIsRestarting] = useState(false);
  const [runtimeRestarted, setRuntimeRestarted] = useState(false);

  // Clear restart notification when new events arrive
  useEffect(() => {
    if (runtimeRestarted && conversationEvents.length > 0) {
      setRuntimeRestarted(false);
    }
  }, [runtimeRestarted, conversationEvents.length]);

  const handleRestartRuntime = useCallback(async () => {
    if (!agentId || !activeConversationId || isRestarting) return;
    
    setIsRestarting(true);
    try {
      const response = await fetch("/api/dynamic-agents/chat/restart-runtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        },
        body: JSON.stringify({
          agent_id: agentId,
          session_id: activeConversationId,
        }),
      });
      
      if (response.ok) {
        // Clear SSE events on restart
        clearSSEEvents(activeConversationId);
        // Show restart notification
        setRuntimeRestarted(true);
      } else {
        console.error("Failed to restart runtime:", await response.text());
      }
    } catch (error) {
      console.error("Failed to restart runtime:", error);
    } finally {
      setIsRestarting(false);
    }
  }, [agentId, activeConversationId, session?.accessToken, isRestarting, clearSSEEvents]);

  // Activity count now only includes todos and files (tools/subagents shown inline in chat)
  const totalActivityCount = todos.length + files.length;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 340 }}
      transition={{ duration: 0.2 }}
      className="relative h-full flex flex-col bg-card/30 backdrop-blur-sm border-l border-border/50 shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="border-b border-border/50">
        <div
          className={cn(
            "flex items-center py-2",
            collapsed ? "justify-center px-2" : "justify-between px-3"
          )}
        >
          {collapsed ? (
            onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCollapse(!collapsed)}
                className="h-8 w-8 hover:bg-muted shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )
          ) : (
            <>
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "events" | "info")}
              >
                <TabsList className="h-8 bg-muted/50">
                  <TabsTrigger
                    value="events"
                    className={cn(
                      "text-xs gap-1.5 h-7 px-3",
                      activeTab === "events" && "text-purple-400"
                    )}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Context
                    {totalActivityCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1 h-4 px-1 text-[10px] bg-purple-500/20 text-purple-400"
                      >
                        {totalActivityCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="info"
                    className={cn(
                      "text-xs gap-1.5 h-7 px-3",
                      activeTab === "info" && "text-blue-400"
                    )}
                  >
                    <Info className="h-3.5 w-3.5" />
                    Agent
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {onCollapse && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onCollapse(!collapsed)}
                  className="h-8 w-8 hover:bg-muted shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            {/* Agent Not Found Warning */}
            {agentNotFound && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border-2 border-amber-500/60 bg-gradient-to-br from-amber-500/15 to-orange-600/10 p-4 shadow-lg shadow-amber-500/10"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-full bg-amber-500/20 shrink-0">
                    <Trash2 className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-400 mb-1">
                      Agent No Longer Exists
                    </p>
                    <p className="text-xs text-amber-300/80 leading-relaxed">
                      This agent has been deleted. You can view the conversation history, but new messages cannot be sent.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "events" && (
              <EventsContent
                todos={todos}
                files={files}
                onFileClick={handleFileDownload}
                onFileDelete={handleFileDelete}
                isDownloadingFile={isDownloadingFile}
                downloadingFilePath={downloadingFilePath}
                isDeletingFile={isDeletingFile}
                deletingFilePath={deletingFilePath}
                errorMessages={errorMessages}
                warningMessages={warningMessages}
                runtimeRestarted={runtimeRestarted}
                isLoading={todosLoading || filesLoading}
              />
            )}

            {activeTab === "info" && (
              <AgentInfoContent
                agentName={agentName}
                agentDescription={agentDescription}
                agentModel={agentModel}
                agentVisibility={agentVisibility}
                agentGradient={agentGradient}
                allowedTools={allowedTools}
                subagents={subagents}
                agentId={agentId}
                sessionId={activeConversationId}
                onRestartRuntime={handleRestartRuntime}
                isRestarting={isRestarting}
                agentNotFound={agentNotFound}
                agentDisabled={agentDisabled}
              />
            )}
          </div>
        </ScrollArea>
      )}

      {/* Collapsed state indicator */}
      {collapsed && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Activity className="h-5 w-5" />
          {totalActivityCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {totalActivityCount}
            </Badge>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Events Content
// ═══════════════════════════════════════════════════════════════

interface EventsContentProps {
  todos: TodoItem[];
  files: string[];
  onFileClick?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  isDownloadingFile?: boolean;
  downloadingFilePath?: string;
  isDeletingFile?: boolean;
  deletingFilePath?: string;
  errorMessages: string[];
  warningMessages: string[];
  /** Whether the runtime was just restarted */
  runtimeRestarted?: boolean;
  /** Whether initial data (todos/files) is loading */
  isLoading?: boolean;
}

function EventsContent({
  todos,
  files,
  onFileClick,
  onFileDelete,
  isDownloadingFile,
  downloadingFilePath,
  isDeletingFile,
  deletingFilePath,
  errorMessages,
  warningMessages,
  runtimeRestarted,
  isLoading = false,
}: EventsContentProps) {
  // Show loading state while fetching initial data
  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Loader2 className="h-8 w-8 mx-auto mb-3 opacity-40 animate-spin" />
        <p className="text-sm">Loading context...</p>
      </div>
    );
  }

  const hasNoActivity =
    todos.length === 0 &&
    files.length === 0 &&
    errorMessages.length === 0 &&
    warningMessages.length === 0 &&
    !runtimeRestarted;

  if (hasNoActivity) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No events yet</p>
        <p className="text-xs mt-1 opacity-70">
          Events will appear here as the agent runs
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Runtime Restarted Notification */}
      {runtimeRestarted && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border-2 border-blue-500/60 bg-gradient-to-br from-blue-500/15 to-blue-600/10 p-3 shadow-lg shadow-blue-500/10"
        >
          <div className="flex items-start gap-2.5">
            <div className="p-1.5 rounded-full bg-blue-500/20 shrink-0">
              <RefreshCw className="h-4 w-4 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1.5">
                Runtime Restarted
              </p>
              <p className="text-sm text-blue-300 leading-relaxed">
                Send a message to create the runtime and reconnect to MCP servers.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Error Messages */}
      {errorMessages.length > 0 && (
        <div className="space-y-2">
          {errorMessages.map((message, idx) => (
            <motion.div
              key={`error-${idx}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border-2 border-red-500/60 bg-gradient-to-br from-red-500/15 to-red-600/10 p-3 shadow-lg shadow-red-500/10"
            >
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-full bg-red-500/20 shrink-0">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1.5">
                    Agent Error
                  </p>
                  <p className="text-sm text-red-300 leading-relaxed break-words">
                    {message}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Warning Messages (ephemeral, from server) */}
      {warningMessages.length > 0 && (
        <div className="space-y-2">
          {warningMessages.map((message, idx) => (
            <motion.div
              key={`warning-${idx}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border-2 border-amber-500/60 bg-gradient-to-br from-amber-500/15 to-amber-600/10 p-3 shadow-lg shadow-amber-500/10"
            >
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-full bg-amber-500/20 shrink-0">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-1.5">
                    Agent Warning
                  </p>
                  <p className="text-sm text-amber-300 leading-relaxed break-words">
                    {message}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Todos (replaces Execution Plan) */}
      {todos.length > 0 && (
        <div className="space-y-2">
          {/* Progress Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <ListTodo className="h-4 w-4 text-sky-400 shrink-0" />
              <span className="font-medium whitespace-nowrap">Tasks</span>
            </div>
            <span className="text-xs font-medium text-foreground/80 whitespace-nowrap">
              {todos.filter((t) => t.status === "completed").length}/{todos.length}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{
                width: `${(todos.filter((t) => t.status === "completed").length / todos.length) * 100}%`,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
            />
          </div>

          {/* Todo Items */}
          <div className="space-y-1.5">
            <AnimatePresence mode="popLayout">
              {todos.map((todo, idx) => (
                <motion.div
                  key={todo.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-lg border text-xs transition-all",
                    todo.status === "completed" && "bg-emerald-500/10 border-emerald-500/30",
                    todo.status === "in_progress" && "bg-sky-500/10 border-sky-500/30",
                    todo.status === "pending" && "bg-muted/30 border-border/50",
                  )}
                >
                  {/* Status Indicator */}
                  <div className="mt-0.5 shrink-0">
                    {todo.status === "completed" ? (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    ) : todo.status === "in_progress" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/40" />
                    )}
                  </div>

                  {/* Todo Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "leading-relaxed line-clamp-2",
                        todo.status === "completed" && "text-muted-foreground line-through opacity-60",
                        todo.status === "in_progress" && "text-foreground font-medium",
                        todo.status === "pending" && "text-foreground/80",
                      )}
                    >
                      {todo.content}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Files Tree */}
      <FileTree
        files={files}
        onFileClick={onFileClick}
        onFileDelete={onFileDelete}
        isDownloading={isDownloadingFile}
        downloadingPath={downloadingFilePath}
        isDeleting={isDeletingFile}
        deletingPath={deletingFilePath}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Agent Info Content
// ═══════════════════════════════════════════════════════════════

interface AgentInfoContentProps {
  agentName?: string;
  agentDescription?: string;
  agentModel?: string;
  agentVisibility?: string;
  agentGradient?: string | null;
  allowedTools?: Record<string, string[]>;
  subagents?: SubAgentRef[];
  /** Agent ID for restart runtime */
  agentId?: string;
  /** Session ID for restart runtime */
  sessionId?: string;
  /** Callback to restart the runtime */
  onRestartRuntime?: () => void;
  /** Whether a restart is in progress */
  isRestarting?: boolean;
  /** Whether the agent has been deleted */
  agentNotFound?: boolean;
  /** Whether the agent is disabled */
  agentDisabled?: boolean;
}

function AgentInfoContent({
  agentName,
  agentDescription,
  agentModel,
  agentVisibility,
  agentGradient,
  allowedTools,
  subagents,
  agentId,
  sessionId,
  onRestartRuntime,
  isRestarting,
  agentNotFound,
  agentDisabled,
}: AgentInfoContentProps) {
  // Count total tools across all MCP servers
  const toolCount = allowedTools
    ? Object.entries(allowedTools).reduce((sum, [, tools]) => {
        // Empty array means "all tools" from that server
        return sum + (tools.length > 0 ? tools.length : 1);
      }, 0)
    : 0;

  const serverCount = allowedTools ? Object.keys(allowedTools).length : 0;

  // Format visibility for display
  const visibilityDisplay = agentVisibility
    ? agentVisibility.charAt(0).toUpperCase() + agentVisibility.slice(1)
    : "Private";

  return (
    <div className="space-y-4">
      {/* Agent header */}
      <div className="flex items-center gap-3">
        {(() => {
          const gradientStyle = agentGradient ? getGradientStyle(agentGradient) : null;
          return (
            <div 
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                !gradientStyle && "bg-gradient-to-br from-purple-500 to-pink-600"
              )}
              style={gradientStyle || undefined}
            >
              <Bot className="h-5 w-5 text-white" />
            </div>
          );
        })()}
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{agentName || "Custom Agent"}</h3>
          <p className="text-xs text-muted-foreground">Custom Agent</p>
        </div>
      </div>

      {/* Description */}
      {agentDescription && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Description
          </h4>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {agentDescription}
          </p>
        </div>
      )}

      {/* Agent details */}
      <div className="space-y-2 pt-2 border-t border-border/50">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Configuration
        </h4>

        <div className="grid grid-cols-2 gap-2 text-sm">
          {/* Model */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Model</span>
            <p className="font-medium truncate" title={agentModel || "Default"}>
              {agentModel || "Default"}
            </p>
          </div>

          {/* Visibility */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Visibility</span>
            <p className="font-medium">{visibilityDisplay}</p>
          </div>

          {/* MCP Servers */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">MCP Servers</span>
            <p className="font-medium">{serverCount}</p>
          </div>

          {/* Tools */}
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">Tools</span>
            <p className="font-medium">
              {serverCount > 0
                ? toolCount > 0
                  ? `${toolCount}+`
                  : "All"
                : "None"}
            </p>
          </div>

          {/* Conversation ID */}
          {sessionId && (
            <div className="space-y-0.5 col-span-2">
              <span className="text-xs text-muted-foreground">Conversation ID</span>
              <p className="font-mono text-xs truncate" title={sessionId}>
                {sessionId}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* MCP Server list */}
      {serverCount > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            MCP Servers
          </h4>
          <div className="space-y-1">
            {Object.keys(allowedTools || {}).map((serverId) => (
              <div
                key={serverId}
                className="flex items-center gap-2 text-xs px-2 py-1.5 rounded font-mono bg-muted/30 border border-border/50"
              >
                <span className="truncate">{serverId}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configured Subagents */}
      {subagents && subagents.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Configured Subagents
          </h4>
          <div className="space-y-1.5">
            {subagents.map((subagent) => (
              <div
                key={subagent.agent_id}
                className="rounded-lg border border-border/50 bg-muted/30 p-2"
              >
                <div className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="text-xs font-medium truncate" title={subagent.name}>
                    {subagent.name}
                  </span>
                </div>
                {subagent.description && (
                  <p className="text-[10px] text-muted-foreground mt-1 pl-5.5 line-clamp-2">
                    {subagent.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advanced Section */}
      {agentId && sessionId && onRestartRuntime && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Advanced
          </h4>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRestartRuntime}
              disabled={isRestarting || agentNotFound || agentDisabled}
              className="w-full justify-center gap-2 text-xs"
            >
              {isRestarting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isRestarting ? "Restarting..." : "Restart Agent Session"}
            </Button>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              This will restart the session. MCP servers will be checked again. Chat history will be preserved.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

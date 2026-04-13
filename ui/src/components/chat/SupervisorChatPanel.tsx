"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, User, Bot, Sparkles, Copy, Check, Loader2, ChevronDown, ChevronUp, ArrowDown, ArrowLeft, RotateCcw, Activity, MessageSquare, Clock, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { assistantMarkdownComponents, assistantProseClassName } from "./MarkdownComponents";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chat-store";
import { isFeatureEnabled, useFeatureFlagStore } from "@/store/feature-flag-store";
import { cn, deduplicateByKey } from "@/lib/utils";
import { ChatMessage as ChatMessageType, SupervisorTimelineSegment } from "@/types/a2a";
import { SupervisorTimelineManager } from "@/lib/supervisor-timeline-manager";
import { SupervisorTimeline } from "./SupervisorTimeline";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import { FeedbackButton, Feedback } from "./FeedbackButton";
import { DEFAULT_AGENTS, CustomCall } from "./CustomCallButtons";
import { AGENT_LOGOS } from "@/components/shared/AgentLogos";
import { MetadataInputForm, type UserInputMetadata, type InputField } from "./MetadataInputForm";
import { SlashCommandMenu, getFilteredCommands, type SlashCommand } from "./SlashCommandMenu";
import { useSlashCommands } from "./useSlashCommands";

type ReadOnlyReason = 'admin_audit' | 'shared_readonly' | 'agent_deleted' | 'agent_disabled';

interface SupervisorChatPanelProps {
  endpoint: string;
  conversationId?: string; // MongoDB conversation UUID
  conversationTitle?: string;
  readOnly?: boolean;
  readOnlyReason?: ReadOnlyReason;
  /** Which admin tab the user navigated from (audit-logs or feedback) */
  adminOrigin?: "audit-logs" | "feedback" | null;
  /** Whether the backend is disconnected */
  isDisconnected?: boolean;
}

export function SupervisorChatPanel({ endpoint, conversationId, conversationTitle, readOnly, readOnlyReason, adminOrigin, isDisconnected }: SupervisorChatPanelProps) {
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
  // PE path: resume via sendMessage
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
    setConversationStreaming,
    isConversationStreaming,
    cancelConversationRequest,
    updateMessageFeedback,
    consumePendingMessage,
    evictOldMessageContent,
    loadTurnsFromServer,
    updateConversationTitle,
    sendMessage,
  } = useChatStore();

  // Slash command registry (built-in + skills + agents)
  const slashCommands = useSlashCommands();

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
    // For very large conversations the DOM paint can take >50ms, so a
    // fixed timeout is unreliable.
    const raf = requestAnimationFrame(() => {
      scrollToBottom("instant");
    });
    return () => cancelAnimationFrame(raf);
  }, [activeConversationId, scrollToBottom]);

  // ═══════════════════════════════════════════════════════════════
  // LEVEL 2 CRASH RECOVERY: On mount / conversation change, check for
  // interrupted messages and attempt to recover the result via tasks/get.
  // ═══════════════════════════════════════════════════════════════
  const [recoveringMessageId, setRecoveringMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeConversationId || !conversation) return;
    if (isThisConversationStreaming) return; // Don't recover while streaming

    // With AG-UI, there's no A2A taskId-based recovery. Interrupted messages
    // show a retry banner directly — the user re-sends the message.
    // This effect is kept as a no-op placeholder for future server-side recovery.
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

    // Don't restore if the assistant message completed (isFinal=true means the
    // workflow finished; any HITL form in the events is from an earlier turn).
    if (lastMsg.isFinal) {
      console.log(`[ChatPanel] 📝 HITL restore skipped: last assistant message is final (workflow completed)`);
      return;
    }

    // Don't restore if user explicitly dismissed the form for this message
    if (dismissedInputForMessageRef.current.has(lastMsg.id)) return;

    // HITL restore is now handled by the inputRequiredConversations set in the store.
    // The set is populated by the AG-UI onInputRequired callback during streaming.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, conversation?.messages?.length, isThisConversationStreaming]);

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Core submit function that accepts a message directly
  const submitMessage = useCallback(async (messageToSend: string) => {
    if (!messageToSend.trim() || isThisConversationStreaming) return;

    // Delegate entirely to the store's sendMessage (AG-UI streaming path)
    await sendMessage({
      message: messageToSend,
      conversationId: activeConversationId ?? undefined,
      endpoint,
      accessToken,
      userEmail: session?.user?.email ?? undefined,
      userName: session?.user?.name ?? undefined,
      userImage: session?.user?.image ?? undefined,
    });
  }, [isThisConversationStreaming, activeConversationId, endpoint, accessToken, session, sendMessage]);

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
      convId = createConversation();
    }

    // Add user message showing the command
    const turnId = `turn-${Date.now()}`;
    addMessage(convId, { role: "user", content: "/skills" }, turnId);

    // Set a descriptive title instead of "/skills"
    updateConversationTitle(convId, "Skills Catalog");

    // Add placeholder assistant message
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
      convId = createConversation();
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
    // Create a fresh conversation (effectively clearing the current one)
    createConversation();
  }, [createConversation]);

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

  // Stable callback for feedback changes (avoids creating new function refs on each render)
  const handleFeedbackChange = useCallback((messageId: string, feedback: Feedback) => {
    if (activeConversationId) {
      updateMessageFeedback(activeConversationId, messageId, feedback);
    }
  }, [activeConversationId, updateMessageFeedback]);

  // Stable callback for feedback submission — persist to MongoDB alongside Langfuse
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

  // Handle user input form submission via HITL resume (Platform Engineer / SSE path)
  // Formats form data as a user message and delegates to the store's sendMessage,
  // which owns the full SSE streaming loop (including HITL continuation).
  const handleUserInputSubmit = useCallback(async (formData: Record<string, string>) => {
    if (!pendingUserInput || !activeConversationId) return;

    console.log("[ChatPanel] HITL form submitted:", formData);

    const prevMessageId = pendingUserInput.messageId;
    dismissedInputForMessageRef.current.add(prevMessageId);
    setPendingUserInput(null);

    const selectionSummary = Object.entries(formData)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const userMessage = selectionSummary || "Form submitted.";

    await sendMessage({
      message: userMessage,
      conversationId: activeConversationId,
      endpoint,
      accessToken,
      userEmail: session?.user?.email ?? undefined,
      userName: session?.user?.name ?? undefined,
      userImage: session?.user?.image ?? undefined,
    });
  }, [pendingUserInput, activeConversationId, endpoint, accessToken, session, sendMessage]);

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
      // Execute commands (e.g., /skills, /help, /clear)
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
                  // Re-load turns from server to restore evicted content
                  if (activeConversationId) {
                    loadTurnsFromServer(activeConversationId);
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
              href={adminOrigin === 'audit-logs' ? '/admin?tab=audit-logs' : '/admin?tab=feedback'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600/20 text-amber-700 dark:text-amber-300 hover:bg-amber-600/30 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              {adminOrigin === 'audit-logs' ? 'Back to Audit Logs' : 'Back to Feedback'}
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

            <div
              className={cn(
                "relative flex items-center gap-3 bg-card rounded-xl border border-border p-3 transition-all duration-200",
                isDisconnected && "opacity-50 cursor-not-allowed"
              )}
              title={isDisconnected ? `Disconnected from ${getConfig('appName')}` : undefined}
            >
              <TextareaAutosize
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isDisconnected}
                placeholder={
                  isThisConversationStreaming
                    ? queuedMessages.length >= 3
                      ? "Queue full (3/3). Send or cancel messages to queue more, or Cmd+Enter to force send..."
                      : `Type to queue message (${queuedMessages.length}/3), or Cmd+Enter to force send...`
                    : `Ask ${getConfig('appName')} anything, or type / to see commands, skills, and agents...`
                }
                className={cn("flex-1 bg-transparent resize-none outline-none px-3 py-2.5 text-sm", isDisconnected && "cursor-not-allowed")}
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
                disabled={isDisconnected || !input.trim()}
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
// ─────────────────────────────────────────────────────────────────────────────
// Message Window: Auto-collapse old turns for performance
// ─────────────────────────────────────────────────────────────────────────────

/** Number of recent turns to keep fully rendered. Older turns are collapsed. */
const VISIBLE_TURN_COUNT = 5;
/** Minimum total turns before auto-collapsing kicks in. */
const COLLAPSE_THRESHOLD = 5;

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
  showTimestamp = false,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const showThinkingDefault = useFeatureFlagStore((s) => s.flags.showThinking ?? true);
  const [showRawStream, setShowRawStream] = useState(() => {
    if (message.isFinal) return false;
    return showThinkingDefault;
  });
  const [isHovered, setIsHovered] = useState(false);
  // Collapse final answer for assistant messages - auto-collapse older answers, keep latest expanded
  const [isCollapsed, setIsCollapsed] = useState(() => {
    // Auto-collapse older answers, but keep latest answer expanded
    if (isUser) return false;
    return !isLatestAnswer && message.content && message.content.length > 300;
  });

  // Split content into pre-timeline and post-timeline text so that the
  // visual order is: initial text → tools/plan → final answer text.
  const offset = message.timelineTextOffset;
  const hasTimelineContent = !isUser && message.timelineSegments?.some(
    (s: SupervisorTimelineSegment) => s.type === "tool_call" || s.type === "execution_plan"
  );
  const preTimelineText = (hasTimelineContent && offset != null && offset > 0)
    ? message.content.slice(0, offset).trim()
    : undefined;
  const postTimelineText = (hasTimelineContent && offset != null)
    ? message.content.slice(offset).trim()
    : undefined;
  // When there's no timeline split, show everything as a single block
  const displayContent = (preTimelineText !== undefined) ? postTimelineText : message.content;

  // Get preview for collapsed view (first 300 chars of the post-timeline / full text)
  const collapsedPreview = (displayContent || "").slice(0, 300).trim();

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
                <span className="text-xs font-medium">{getConfig('appName')}</span>
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

        {/* ═══════════════════════════════════════════════════════════
            AG-UI SEQUENTIAL RENDERING:
            1. Pre-timeline text (initial assistant commentary)
            2. Timeline (tools / execution plan)
            3. Post-timeline text (final answer)
            ═══════════════════════════════════════════════════════════ */}

        {/* Pre-timeline text: rendered before tools/plan (no border, matches prod) */}
        {preTimelineText && (
          <div className="prose-container overflow-hidden break-words overflow-wrap-anywhere mb-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={assistantMarkdownComponents}
            >
              {preTimelineText}
            </ReactMarkdown>
          </div>
        )}

        {/* Timeline: only show when there are tool/plan segments */}
        {hasTimelineContent && (
          <SupervisorTimeline
            segments={message.timelineSegments!.filter((s: SupervisorTimelineSegment) => s.type === "tool_call" || s.type === "execution_plan")}
            isStreaming={isStreaming}
            isCollapsed={isCollapsed}
          />
        )}

        {/* Crash recovery indicators */}
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
                    The page was reloaded while this response was streaming. Click Retry to resend.
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

        {/* Message content — post-timeline text (or full content when no timeline split) */}
        {displayContent && (
          <div
              className={cn(
                "rounded-xl relative overflow-hidden",
                isUser
                  ? "inline-block bg-primary text-primary-foreground px-4 py-3 rounded-tr-sm max-w-full selection:bg-primary-foreground selection:text-primary"
                  : ""
              )}
            >
              {isUser ? (
                <div className="overflow-hidden break-words text-left" style={{ overflowWrap: 'anywhere' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => (
                        <h1 className="text-base font-bold text-primary-foreground mb-2 mt-3 first:mt-0 pb-1 border-b border-white/20">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-sm font-semibold text-primary-foreground mb-1.5 mt-3 first:mt-0">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-sm font-semibold text-primary-foreground mb-1 mt-2 first:mt-0">{children}</h3>
                      ),
                      p: ({ children }) => (
                        <p className="text-sm leading-relaxed text-primary-foreground/90 mb-1.5 last:mb-0">{children}</p>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc list-outside ml-6 mb-1.5 space-y-0.5 text-sm text-primary-foreground/90">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-outside ml-6 mb-1.5 space-y-0.5 text-sm text-primary-foreground/90">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="leading-relaxed">{children}</li>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-primary-foreground">{children}</strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic text-primary-foreground/90">{children}</em>
                      ),
                      code: ({ className, children, ...props }) => {
                        const isBlock = /language-/.test(className || "") || String(children).includes("\n");
                        if (isBlock) {
                          return (
                            <pre className="my-2 p-2.5 rounded-md bg-black/20 overflow-x-auto">
                              <code className="text-xs font-mono text-primary-foreground/90 whitespace-pre-wrap break-words" {...props}>{children}</code>
                            </pre>
                          );
                        }
                        return (
                          <code className="bg-black/20 text-primary-foreground px-1 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>
                        );
                      },
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-white/30 pl-3 my-2 italic text-primary-foreground/80">{children}</blockquote>
                      ),
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary-foreground hover:text-white">{children}</a>
                      ),
                      hr: () => <hr className="my-3 border-white/20" />,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-2 rounded border border-white/20">
                          <table className="w-full text-xs">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-black/10">{children}</thead>,
                      th: ({ children }) => <th className="px-2 py-1 text-left font-semibold text-primary-foreground border-b border-white/20">{children}</th>,
                      td: ({ children }) => <td className="px-2 py-1 border-b border-white/10 text-primary-foreground/90">{children}</td>,
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
                    <>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={assistantMarkdownComponents}
                      >
                        {displayContent || "..."}
                      </ReactMarkdown>
                      {/* Streaming cursor */}
                      {isStreaming && (
                        <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
                      )}
                    </>
                  )}
                </div>
              )}
          </div>
        )}

        {/* Actions for user messages */}
        {isUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isHovered ? 1 : 0.8 }}
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

            {/* Copy button */}
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

        {/* Actions for assistant messages */}
        {!isUser && displayContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isHovered ? 1 : 0.8 }}
            className="flex items-center gap-1 mt-2"
          >
            {/* Collapse button */}
            {!isStreaming && displayContent.length > 300 && (
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
      </div>
    </motion.div>
  );
});

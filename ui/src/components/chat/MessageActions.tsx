"use client";

import { Button } from "@/components/ui/button";
import { Tooltip,TooltipContent,TooltipProvider,TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Check,Copy,RotateCcw } from "lucide-react";
import React,{ useState } from "react";

import { FeedbackButton,type Feedback } from "./FeedbackButton";

/**
 * Shared message action row: copy-to-clipboard, optional retry, and optional
 * thumbs up/down feedback (Langfuse + the `feedback` Mongo collection via
 * `FeedbackButton`). Used by both the main Dynamic Agent chat
 * (`DynamicAgentChatPanel`) and the Tome project chat (`components/tome/ChatPanel`)
 * so every chat surface gets identical copy/feedback behavior without
 * duplicating the button markup or clipboard/timeout logic per surface.
 *
 * Deliberately has no opinion on layout chrome (hover fade, spacing) beyond
 * `className` — callers wrap it however fits their message bubble.
 */
interface MessageActionsProps {
  /** Text copied to the clipboard. */
  content: string;
  /** Stable id for this message — used as the feedback/Langfuse key. */
  messageId: string;
  /** Conversation/session id for feedback grouping (Langfuse trace + Mongo doc). */
  conversationId?: string;
  /** Tooltip + aria label for the copy button. */
  copyLabel?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Render the thumbs up/down control. Only assistant turns should set this. */
  showFeedback?: boolean;
  feedback?: Feedback;
  onFeedbackChange?: (feedback: Feedback) => void;
  disabled?: boolean;
  className?: string;
}

export function MessageActions({
  content,
  messageId,
  conversationId,
  copyLabel = "Copy message",
  onRetry,
  retryLabel = "Retry",
  showFeedback = false,
  feedback,
  onFeedbackChange,
  disabled = false,
  className,
}: MessageActionsProps) {
  const [isCopied,setIsCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {onRetry && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={onRetry}
                disabled={disabled}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{retryLabel}</TooltipContent>
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
              onClick={handleCopy}
              disabled={disabled}
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isCopied ? "Copied!" : copyLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showFeedback && (
        <>
          <div className="h-4 w-px bg-border/50" />
          <FeedbackButton
            messageId={messageId}
            conversationId={conversationId}
            feedback={feedback}
            onFeedbackChange={onFeedbackChange}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}

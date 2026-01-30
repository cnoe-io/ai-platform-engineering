"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FeedbackType = "like" | "dislike" | null;

export interface Feedback {
  type: FeedbackType;
  reason?: string;
  additionalFeedback?: string;
  submitted?: boolean;
  showFeedbackOptions?: boolean;
}

interface FeedbackButtonProps {
  messageId: string;
  feedback?: Feedback;
  onFeedbackChange?: (feedback: Feedback) => void;
  onFeedbackSubmit?: (feedback: Feedback) => void;
  disabled?: boolean;
}

// Feedback reasons matching agent-forge
const LIKE_REASONS = ["Very Helpful", "Accurate", "Simplified My Task", "Other"];
const DISLIKE_REASONS = ["Inaccurate", "Poorly Formatted", "Incomplete", "Off-topic", "Other"];

export function FeedbackButton({
  messageId,
  feedback,
  onFeedbackChange,
  onFeedbackSubmit,
  disabled = false,
}: FeedbackButtonProps) {
  const [additionalFeedback, setAdditionalFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleThumbClick = (type: FeedbackType) => {
    if (disabled) return;

    // If same type clicked, deselect (clear feedback)
    if (feedback?.type === type) {
      onFeedbackChange?.({
        type: null,
        showFeedbackOptions: false,
        submitted: false,
        reason: undefined,
        additionalFeedback: undefined,
      });
      setPopoverOpen(false);
    } else {
      // New selection or changing feedback - open popover for reason selection
      onFeedbackChange?.({
        type,
        showFeedbackOptions: true,
        submitted: false,
        reason: undefined,
        additionalFeedback: undefined,
      });
      setPopoverOpen(true);
    }
  };

  const handleReasonClick = (reason: string) => {
    onFeedbackChange?.({
      ...feedback,
      type: feedback?.type || null,
      reason,
      showFeedbackOptions: true,
    });

    // Clear additional feedback if not "Other"
    if (reason !== "Other") {
      setAdditionalFeedback("");
    }
  };

  const handleSubmitFeedback = async () => {
    if (!feedback?.reason) return;

    setIsSubmitting(true);

    const finalFeedback: Feedback = {
      ...feedback,
      additionalFeedback: feedback.reason === "Other" ? additionalFeedback : undefined,
      submitted: true,
      showFeedbackOptions: false,
    };

    onFeedbackChange?.(finalFeedback);
    await onFeedbackSubmit?.(finalFeedback);

    setIsSubmitting(false);
    setAdditionalFeedback("");
    setPopoverOpen(false);
  };

  const isLiked = feedback?.type === "like";
  const isDisliked = feedback?.type === "dislike";
  const reasons = isLiked ? LIKE_REASONS : DISLIKE_REASONS;
  const showOtherInput = feedback?.reason === "Other";

  return (
    <>
      {/* Thumbs Up Button - always visible */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 hover:bg-muted",
          isLiked
            ? "text-green-500 hover:text-green-600"
            : "text-muted-foreground hover:text-foreground"
        )}
        disabled={disabled}
        onClick={() => handleThumbClick("like")}
        title="Helpful"
      >
        <ThumbsUp className={cn("h-3.5 w-3.5", isLiked && "fill-current")} />
      </Button>

      {/* Thumbs Down Button - always visible */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 hover:bg-muted",
              isDisliked
                ? "text-red-500 hover:text-red-600"
                : "text-muted-foreground hover:text-foreground"
            )}
            disabled={disabled}
            onClick={() => handleThumbClick("dislike")}
            title="Not helpful"
          >
            <ThumbsDown className={cn("h-3.5 w-3.5", isDisliked && "fill-current")} />
          </Button>
        </PopoverTrigger>

        {/* Feedback Options Popover */}
        <PopoverContent side="top" align="end" className="p-3 w-72">
          <div className="text-xs text-muted-foreground mb-3">
            {isLiked ? "What did you like?" : "What went wrong?"}
          </div>

          {/* Reason Chips */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {reasons.map((reason) => (
              <button
                key={reason}
                onClick={() => handleReasonClick(reason)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-all",
                  feedback?.reason === reason
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {reason}
              </button>
            ))}
          </div>

          {/* Additional Feedback Text Area (for "Other") */}
          <AnimatePresence>
            {showOtherInput && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-3"
              >
                <textarea
                  value={additionalFeedback}
                  onChange={(e) => setAdditionalFeedback(e.target.value)}
                  placeholder="Provide additional feedback"
                  className="w-full h-20 px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit Button */}
          <Button
            size="sm"
            onClick={handleSubmitFeedback}
            disabled={!feedback?.reason || isSubmitting}
            className="w-full gap-2"
          >
            {isSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Submit Feedback
          </Button>
        </PopoverContent>
      </Popover>
    </>
  );
}

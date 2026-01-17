"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const handleThumbClick = (type: FeedbackType) => {
    if (disabled || feedback?.submitted) return;

    // Toggle feedback - if same type clicked, deselect
    if (feedback?.type === type) {
      onFeedbackChange?.({
        type: null,
        showFeedbackOptions: false
      });
    } else {
      onFeedbackChange?.({
        type,
        showFeedbackOptions: true,
        reason: undefined,
        additionalFeedback: undefined,
      });
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
  };

  const isLiked = feedback?.type === "like";
  const isDisliked = feedback?.type === "dislike";
  const showFeedbackOptions = feedback?.showFeedbackOptions && !feedback?.submitted;
  const reasons = isLiked ? LIKE_REASONS : DISLIKE_REASONS;
  const showOtherInput = feedback?.reason === "Other";

  return (
    <div className="space-y-2">
      {/* Thumbs Up/Down Buttons - Inline style matching agent-forge */}
      <div className="flex items-center gap-1">
        {/* Thumbs Up */}
        <button
          onClick={() => handleThumbClick("like")}
          disabled={disabled || feedback?.submitted}
          className={cn(
            "p-1 rounded transition-all",
            isLiked
              ? "opacity-100"
              : "opacity-60 hover:opacity-100",
            (disabled || feedback?.submitted) && "cursor-not-allowed opacity-50"
          )}
          title="Thumb up"
        >
          <ThumbsUp
            className={cn(
              "h-[18px] w-[18px]",
              isLiked ? "fill-current text-green-500" : "text-muted-foreground"
            )}
          />
        </button>

        {/* Thumbs Down */}
        <button
          onClick={() => handleThumbClick("dislike")}
          disabled={disabled || feedback?.submitted}
          className={cn(
            "p-1 rounded transition-all",
            isDisliked
              ? "opacity-100"
              : "opacity-60 hover:opacity-100",
            (disabled || feedback?.submitted) && "cursor-not-allowed opacity-50"
          )}
          title="Thumb down"
        >
          <ThumbsDown
            className={cn(
              "h-[18px] w-[18px]",
              isDisliked ? "fill-current text-red-500" : "text-muted-foreground"
            )}
          />
        </button>

        {/* Submitted indicator */}
        {feedback?.submitted && (
          <span className="text-xs text-muted-foreground ml-2">
            Thank you for your feedback!
          </span>
        )}
      </div>

      {/* Feedback Options Panel - Inline below message, matching agent-forge */}
      <AnimatePresence>
        {showFeedbackOptions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 bg-card rounded-lg border border-border"
          >
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
              className="gap-2"
            >
              {isSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
              Submit Feedback
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThumbsUp, ThumbsDown, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FeedbackType = "positive" | "negative" | null;

export interface Feedback {
  type: FeedbackType;
  reason?: string;
  additionalFeedback?: string;
  submitted?: boolean;
}

interface FeedbackButtonProps {
  messageId: string;
  feedback?: Feedback;
  onFeedbackChange?: (feedback: Feedback) => void;
  onFeedbackSubmit?: (feedback: Feedback) => void;
  disabled?: boolean;
}

const NEGATIVE_REASONS = [
  "Incorrect information",
  "Not helpful",
  "Too verbose",
  "Missing details",
  "Confusing response",
  "Other",
];

export function FeedbackButton({
  messageId,
  feedback,
  onFeedbackChange,
  onFeedbackSubmit,
  disabled = false,
}: FeedbackButtonProps) {
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [additionalFeedback, setAdditionalFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleThumbsUp = () => {
    if (disabled) return;
    const newFeedback: Feedback = { type: "positive", submitted: true };
    onFeedbackChange?.(newFeedback);
    onFeedbackSubmit?.(newFeedback);
  };

  const handleThumbsDown = () => {
    if (disabled) return;
    onFeedbackChange?.({ type: "negative" });
    setShowReasonDialog(true);
  };

  const handleSubmitNegative = async () => {
    setIsSubmitting(true);
    const newFeedback: Feedback = {
      type: "negative",
      reason: selectedReason,
      additionalFeedback: additionalFeedback.trim() || undefined,
      submitted: true,
    };

    onFeedbackChange?.(newFeedback);
    await onFeedbackSubmit?.(newFeedback);

    setIsSubmitting(false);
    setShowReasonDialog(false);
    setSelectedReason("");
    setAdditionalFeedback("");
  };

  const handleClose = () => {
    setShowReasonDialog(false);
    setSelectedReason("");
    setAdditionalFeedback("");
    // Reset feedback if dialog is closed without submitting
    if (feedback?.type === "negative" && !feedback.submitted) {
      onFeedbackChange?.({ type: null });
    }
  };

  const isPositive = feedback?.type === "positive";
  const isNegative = feedback?.type === "negative";
  const isSubmitted = feedback?.submitted;

  return (
    <>
      <div className="flex items-center gap-0.5">
        {/* Thumbs Up */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-lg transition-all",
            isPositive
              ? "text-green-500 bg-green-500/10 hover:bg-green-500/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          onClick={handleThumbsUp}
          disabled={disabled || isSubmitted}
          title="Helpful"
        >
          <ThumbsUp className={cn("h-3.5 w-3.5", isPositive && "fill-current")} />
        </Button>

        {/* Thumbs Down */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-lg transition-all",
            isNegative
              ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          onClick={handleThumbsDown}
          disabled={disabled || isSubmitted}
          title="Not helpful"
        >
          <ThumbsDown className={cn("h-3.5 w-3.5", isNegative && "fill-current")} />
        </Button>

        {/* Submitted indicator */}
        {isSubmitted && (
          <span className="text-xs text-muted-foreground ml-1">
            Thanks!
          </span>
        )}
      </div>

      {/* Negative Feedback Dialog */}
      <AnimatePresence>
        {showReasonDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={handleClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-foreground">What went wrong?</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleClose}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                {/* Reason buttons */}
                <div className="flex flex-wrap gap-2">
                  {NEGATIVE_REASONS.map((reason) => (
                    <button
                      key={reason}
                      onClick={() => setSelectedReason(reason)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        selectedReason === reason
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80 text-foreground"
                      )}
                    >
                      {reason}
                    </button>
                  ))}
                </div>

                {/* Additional feedback */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">
                    Additional feedback (optional)
                  </label>
                  <textarea
                    value={additionalFeedback}
                    onChange={(e) => setAdditionalFeedback(e.target.value)}
                    placeholder="Tell us more about what went wrong..."
                    className="w-full h-24 px-3 py-2 bg-muted/50 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted/30">
                <Button variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitNegative}
                  disabled={!selectedReason || isSubmitting}
                  className="gap-2"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Submit Feedback
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

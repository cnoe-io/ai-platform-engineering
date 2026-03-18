"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Square,
  Terminal,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config";
import {
  createTicketViaAgent,
  type FeedbackContext,
  type TicketResult,
} from "@/lib/ticket-client";

type DialogStatus = "idle" | "submitting" | "success" | "error";

interface ReportProblemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-populated feedback context for the combo flow */
  feedbackContext?: FeedbackContext;
}

export function ReportProblemDialog({
  open,
  onOpenChange,
  feedbackContext,
}: ReportProblemDialogProps) {
  const { data: session } = useSession();
  const pathname = usePathname();

  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<DialogStatus>("idle");
  const [ticketResult, setTicketResult] = useState<TicketResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debugEndRef = useRef<HTMLDivElement>(null);

  const provider = getConfig("ticketProvider");
  const providerLabel = provider === "jira" ? "Jira" : provider === "github" ? "GitHub" : "";

  const contextUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${pathname}`
      : "";

  useEffect(() => {
    if (showDebug && debugEndRef.current) {
      debugEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [debugLog, showDebug]);

  const resetState = useCallback(() => {
    setDescription("");
    setStatus("idle");
    setTicketResult(null);
    setErrorMessage("");
    setDebugLog([]);
    setShowDebug(false);
    abortControllerRef.current = null;
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        if (status === "submitting") {
          abortControllerRef.current?.abort();
        }
        resetState();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetState, status]
  );

  const appendLog = useCallback((line: string) => {
    setDebugLog((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${line}`,
    ]);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!description.trim() && !feedbackContext) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus("submitting");
    setDebugLog([]);
    setErrorMessage("");
    setTicketResult(null);

    const userEmail = session?.user?.email || "unknown";

    appendLog(`Creating ${providerLabel} ticket...`);
    appendLog(`Reporter: ${userEmail}`);
    appendLog(`Context: ${contextUrl}`);

    try {
      const result = await createTicketViaAgent({
        request: {
          description: feedbackContext
            ? `${feedbackContext.reason}: ${feedbackContext.additionalFeedback || description || "(no additional details)"}`
            : description,
          userEmail,
          contextUrl,
          feedbackContext,
        },
        accessToken: (session as any)?.accessToken,
        signal: controller.signal,
        onEvent: (_event, logLine) => {
          appendLog(logLine);
        },
        onResult: (r) => {
          appendLog(`Ticket created: ${r.id} ${r.url}`);
        },
      });

      if (controller.signal.aborted) return;

      if (result) {
        setTicketResult(result);
        setStatus("success");
      } else {
        setErrorMessage("No ticket ID was returned. The agent may not have created the ticket successfully.");
        setStatus("error");
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        appendLog("Cancelled by user.");
        resetState();
        return;
      }
      appendLog(`Error: ${err.message || "Unknown error"}`);
      setErrorMessage(err.message || "Failed to create ticket");
      setStatus("error");
    }
  }, [
    description,
    feedbackContext,
    session,
    contextUrl,
    providerLabel,
    appendLog,
    resetState,
  ]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    resetState();
  }, [resetState]);

  const handleCopyDescription = useCallback(() => {
    const text = feedbackContext
      ? `${feedbackContext.reason}: ${feedbackContext.additionalFeedback || description}`
      : description;
    navigator.clipboard.writeText(text);
  }, [description, feedbackContext]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {status === "success"
              ? "Ticket Created"
              : status === "error"
                ? "Something Went Wrong"
                : `Report a Problem${providerLabel ? ` via ${providerLabel}` : ""}`}
          </DialogTitle>
          <DialogDescription>
            {status === "idle" &&
              "Describe the issue briefly. A ticket will be created and assigned to the team."}
            {status === "submitting" && "Creating your ticket..."}
            {status === "success" && "Your ticket has been created successfully."}
            {status === "error" && "We couldn't create the ticket. You can retry or copy your description."}
          </DialogDescription>
        </DialogHeader>

        {/* Idle: input form */}
        {status === "idle" && (
          <div className="space-y-3">
            {feedbackContext && (
              <div className="rounded-md bg-muted/50 border border-border/50 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium">Feedback:</span>{" "}
                {feedbackContext.feedbackType === "dislike" ? "👎" : "👍"}{" "}
                {feedbackContext.reason}
                {feedbackContext.additionalFeedback && (
                  <> &mdash; {feedbackContext.additionalFeedback}</>
                )}
              </div>
            )}

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                feedbackContext
                  ? "Add more details for the ticket (optional)"
                  : "What went wrong? Be as specific as you can."
              }
              className="w-full h-24 px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />

            <p className="text-[10px] text-muted-foreground/60 text-center break-words">
              The current page URL and your email will be included in the ticket.
            </p>

            <Button
              onClick={handleSubmit}
              disabled={!description.trim() && !feedbackContext}
              className="w-full gap-2"
            >
              Submit Report
            </Button>
          </div>
        )}

        {/* Submitting: progress */}
        {status === "submitting" && (
          <div className="space-y-4">
            <div className="flex items-center justify-center py-2">
              <div className="relative w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              </div>
            </div>

            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary via-primary/60 to-primary rounded-full"
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                style={{ width: "50%" }}
              />
            </div>

            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-xs h-7"
                onClick={handleCancel}
              >
                <Square className="h-3 w-3" />
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs h-7 text-muted-foreground"
                onClick={() => setShowDebug(!showDebug)}
              >
                <Terminal className="h-3 w-3" />
                {showDebug ? "Hide" : "Show"} Details
                {showDebug ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>
            </div>

            <AnimatePresence>
              {showDebug && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-border/50 bg-zinc-950 overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 bg-zinc-900">
                      <Terminal className="h-3 w-3 text-green-400" />
                      <span className="text-xs font-mono text-green-400">
                        A2A Stream
                      </span>
                      <span className="ml-auto text-xs font-mono text-muted-foreground">
                        {debugLog.length} event{debugLog.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-2 font-mono text-xs leading-relaxed">
                      {debugLog.length === 0 ? (
                        <p className="text-muted-foreground/50 italic">
                          Waiting for events...
                        </p>
                      ) : (
                        debugLog.map((line, i) => (
                          <p key={i} className="text-green-300/80 break-all">
                            {line}
                          </p>
                        ))
                      )}
                      <div ref={debugEndRef} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Success */}
        {status === "success" && ticketResult && (
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">{ticketResult.id}</p>
              {ticketResult.url && (
                <a
                  href={ticketResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  Open in {providerLabel}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleOpenChange(false)}
            >
              Done
            </Button>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>

            {debugLog.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs h-7 text-muted-foreground"
                onClick={() => setShowDebug(!showDebug)}
              >
                <Terminal className="h-3 w-3" />
                {showDebug ? "Hide" : "Show"} Details
              </Button>
            )}

            <AnimatePresence>
              {showDebug && debugLog.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-border/50 bg-zinc-950 overflow-hidden text-left">
                    <div className="max-h-32 overflow-y-auto p-2 font-mono text-xs leading-relaxed">
                      {debugLog.map((line, i) => (
                        <p key={i} className="text-red-300/80 break-all">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-1"
                onClick={handleCopyDescription}
              >
                <Copy className="h-3 w-3" />
                Copy Description
              </Button>
              <Button className="flex-1 gap-1" onClick={handleSubmit}>
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

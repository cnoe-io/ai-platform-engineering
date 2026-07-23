"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

export interface TomeFeedbackDetail {
  submitted_by: string;
  submitted_at?: string;
  rating: "positive" | "negative";
  reason?: string;
  trace_id?: string | null;
  message_id?: string;
  conversation_id?: string | null;
  tome_project_slug?: string | null;
  tome_session_id?: string | null;
  tome_user_question?: string | null;
  tome_assistant_response?: string | null;
  tome_project_name?: string | null;
  tome_project_domain?: string | null;
  tome_bhags?: string[];
  tome_areas?: string[];
}

interface TomeFeedbackInfoDialogProps {
  entry: TomeFeedbackDetail | null;
  onClose: () => void;
}

function DetailRow({
  label,
  value,
  mono,
  copyValue,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const handleCopy = async () => {
    const text = copyValue ?? value;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-start gap-2">
        <div
          className={`flex-1 text-sm break-all ${mono ? "font-mono text-xs" : ""}`}
        >
          {value}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => void handleCopy()}
          title={`Copy ${label.toLowerCase()}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function TomeFeedbackInfoDialog({
  entry,
  onClose,
}: TomeFeedbackInfoDialogProps) {
  const langfuseTraceId =
    entry?.tome_session_id || entry?.conversation_id || entry?.trace_id || null;

  return (
    <Dialog open={entry != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tome feedback details</DialogTitle>
          <DialogDescription>
            Session UUID matches the Langfuse trace for this Tome chat turn.
          </DialogDescription>
        </DialogHeader>
        {entry ? (
          <ScrollArea className="max-h-[min(70vh,32rem)] pr-3">
            <div className="space-y-4 pb-1">
              <DetailRow
                label="Langfuse trace / session UUID"
                value={langfuseTraceId}
                mono
                copyValue={langfuseTraceId ?? undefined}
              />
              <DetailRow
                label="Project"
                value={
                  entry.tome_project_name
                    ? `${entry.tome_project_name}${entry.tome_project_slug ? ` (/projects/${entry.tome_project_slug}/tome)` : ""}`
                    : entry.tome_project_slug
                      ? `/projects/${entry.tome_project_slug}/tome`
                      : null
                }
              />
              <DetailRow label="Domain" value={entry.tome_project_domain} />
              <DetailRow
                label="BHAG / Initiative"
                value={entry.tome_bhags && entry.tome_bhags.length > 0 ? entry.tome_bhags.join(", ") : null}
              />
              <DetailRow
                label="Area / Swim lane"
                value={entry.tome_areas && entry.tome_areas.length > 0 ? entry.tome_areas.join(", ") : null}
              />
              <DetailRow label="Submitted by" value={entry.submitted_by} />
              <DetailRow
                label="Submitted at"
                value={
                  entry.submitted_at
                    ? new Date(entry.submitted_at).toLocaleString()
                    : null
                }
              />
              <DetailRow
                label="Rating"
                value={entry.rating === "positive" ? "Positive" : "Negative"}
              />
              <DetailRow label="Feedback reason" value={entry.reason} />
              <DetailRow label="Message ID (client)" value={entry.message_id} mono />
              {entry.trace_id && entry.trace_id !== langfuseTraceId ? (
                <DetailRow label="Trace ID" value={entry.trace_id} mono />
              ) : null}
              <DetailRow label="User question" value={entry.tome_user_question} />
              <DetailRow label="Assistant response" value={entry.tome_assistant_response} />
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

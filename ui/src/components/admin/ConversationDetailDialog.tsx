"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, User, Bot, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, Tag, Share2, ExternalLink, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Message, Conversation } from "@/types/mongodb";

interface ConversationDetailDialogProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ConversationDetail {
  conversation: Pick<
    Conversation,
    "_id" | "title" | "owner_id" | "created_at" | "updated_at" | "tags" | "sharing" | "is_archived" | "deleted_at"
  >;
  messages: {
    items: Message[];
    total: number;
    page: number;
    page_size: number;
    has_more: boolean;
  };
}

export function ConversationDetailDialog({
  conversationId,
  open,
  onOpenChange,
}: ConversationDetailDialogProps) {
  const [data, setData] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    if (!conversationId) return;
    navigator.clipboard.writeText(conversationId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fetchMessages = useCallback(async (id: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/audit-logs/${encodeURIComponent(id)}/messages?page=${p}&page_size=50`,
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load messages");
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && conversationId) {
      setPage(1);
      fetchMessages(conversationId, 1);
    } else {
      setData(null);
      setError(null);
    }
  }, [open, conversationId, fetchMessages]);

  const handlePageChange = (newPage: number) => {
    if (!conversationId) return;
    setPage(newPage);
    fetchMessages(conversationId, newPage);
  };

  const conv = data?.conversation;
  const msgs = data?.messages;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden" style={{ display: "flex", flexDirection: "column" }}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8">
            {conv?.title || "Loading..."}
          </DialogTitle>
          <DialogDescription>
            {conv ? `Conversation by ${conv.owner_id}` : "Loading conversation details..."}
          </DialogDescription>
        </DialogHeader>

        {conv && (
          <div className="shrink-0 flex flex-wrap gap-2 text-xs text-muted-foreground border-b pb-3">
            <span>Owner: <strong className="text-foreground">{conv.owner_id}</strong></span>
            <span className="text-border">|</span>
            <span className="inline-flex items-center gap-1">
              ID: <code className="font-mono text-foreground">{conv._id}</code>
              <button onClick={copyId} className="p-0.5 rounded hover:bg-muted" title="Copy ID">
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </button>
              <a
                href={`/chat/${conv._id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-0.5 rounded hover:bg-muted text-primary"
                title="Open in chat"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </span>
            <span className="text-border">|</span>
            <span>Created: {new Date(conv.created_at).toLocaleString()}</span>
            <span className="text-border">|</span>
            <span>Updated: {new Date(conv.updated_at).toLocaleString()}</span>
            {conv.is_archived && (
              <>
                <span className="text-border">|</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Archived</Badge>
              </>
            )}
            {conv.deleted_at && (
              <>
                <span className="text-border">|</span>
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Deleted</Badge>
              </>
            )}
            {conv.tags?.length > 0 && (
              <>
                <span className="text-border">|</span>
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {conv.tags.join(", ")}
                </span>
              </>
            )}
            {conv.sharing?.shared_with?.length > 0 && (
              <>
                <span className="text-border">|</span>
                <span className="inline-flex items-center gap-1">
                  <Share2 className="h-3 w-3" />
                  Shared with {conv.sharing.shared_with.length} user(s)
                </span>
              </>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && !data && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-destructive text-sm">{error}</div>
          )}

          {msgs && msgs.items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No messages in this conversation.
            </div>
          )}

          {msgs && msgs.items.length > 0 && (
            <div className="space-y-3 pr-2">
              {msgs.items.map((msg, idx) => (
                <div
                  key={msg.message_id || msg._id?.toString() || idx}
                  className="rounded-lg border p-3 space-y-1.5"
                >
                  <div className="flex items-center gap-2 text-xs">
                    {msg.role === "user" ? (
                      <User className="h-3.5 w-3.5 text-blue-500" />
                    ) : msg.role === "assistant" ? (
                      <Bot className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 inline-block" />
                    )}
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 capitalize"
                    >
                      {msg.role}
                    </Badge>
                    {msg.sender_email && (
                      <span className="text-muted-foreground">{msg.sender_email}</span>
                    )}
                    {msg.metadata?.agent_name && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {msg.metadata.agent_name}
                      </Badge>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {new Date(msg.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words pl-5">
                    {msg.content}
                  </div>
                  {msg.feedback && (
                    <div className="flex items-center gap-1.5 pl-5 pt-1">
                      {msg.feedback.rating === "positive" ? (
                        <ThumbsUp className="h-3 w-3 text-green-500" />
                      ) : (
                        <ThumbsDown className="h-3 w-3 text-red-500" />
                      )}
                      {msg.feedback.comment && (
                        <span className="text-xs text-muted-foreground italic">
                          {msg.feedback.comment}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {msgs && msgs.total > msgs.page_size && (
          <div className="shrink-0 flex items-center justify-between border-t pt-3 text-sm">
            <span className="text-muted-foreground">
              Page {msgs.page} of {Math.ceil(msgs.total / msgs.page_size)} ({msgs.total} messages)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page + 1)}
                disabled={!msgs.has_more || loading}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

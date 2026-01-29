"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getChatAPI, type ShareStatus, type SharedUser } from "@/lib/chat-api";
import { X, Share2, Loader2, Copy, Check, UserMinus, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
}

export function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
}: ShareDialogProps) {
  const { data: session } = useSession();
  const [email, setEmail] = useState("");
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharingEmail, setSharingEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load share status when dialog opens
  useEffect(() => {
    if (open && conversationId) {
      loadShareStatus();
    }
  }, [open, conversationId]);

  const loadShareStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const chatAPI = getChatAPI(session?.accessToken as string);
      const status = await chatAPI.getShareStatus(conversationId);
      setShareStatus(status);
    } catch (err) {
      console.error("Failed to load share status:", err);
      setError(err instanceof Error ? err.message : "Failed to load share status");
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sharingEmail) return;

    try {
      setSharingEmail(true);
      setError(null);
      const chatAPI = getChatAPI(session?.accessToken as string);
      
      const newStatus = await chatAPI.shareConversation(conversationId, {
        user_emails: [email.trim()],
        permissions: ["read"],
      });

      setShareStatus(newStatus);
      setEmail("");
    } catch (err) {
      console.error("Failed to share conversation:", err);
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharingEmail(false);
    }
  };

  const handleRemoveShare = async (userId: string) => {
    try {
      setError(null);
      const chatAPI = getChatAPI(session?.accessToken as string);
      await chatAPI.removeShare(conversationId, userId);
      
      // Reload share status
      await loadShareStatus();
    } catch (err) {
      console.error("Failed to remove share:", err);
      setError(err instanceof Error ? err.message : "Failed to remove access");
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/chat/${conversationId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Conversation
          </DialogTitle>
          <DialogDescription>
            Share "{conversationTitle}" with other users
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Copy Link */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Shareable Link</label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={`${window.location.origin}/chat/${conversationId}`}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with access can view this conversation
            </p>
          </div>

          {/* Share with user */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Share with user</label>
            <form onSubmit={handleShare} className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sharingEmail}
              />
              <Button
                type="submit"
                disabled={!email.trim() || sharingEmail}
                className="shrink-0"
              >
                {sharingEmail ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Share"
                )}
              </Button>
            </form>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Shared with list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : shareStatus && shareStatus.shared_with.length > 0 ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Shared with ({shareStatus.shared_with.length})
              </label>
              <ScrollArea className="h-[200px] rounded-md border">
                <div className="p-4 space-y-3">
                  {shareStatus.shared_with.map((sharedUser) => (
                    <div
                      key={sharedUser.user_id}
                      className="flex items-start justify-between gap-4 pb-3 border-b last:border-0 last:pb-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">
                            {sharedUser.user_email}
                          </p>
                          <Badge variant="secondary" className="text-xs">
                            {sharedUser.permissions.join(", ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>Shared {formatDate(sharedUser.shared_at)}</span>
                        </div>
                      </div>
                      {shareStatus.is_owner && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleRemoveShare(sharedUser.user_id)}
                        >
                          <UserMinus className="h-4 w-4 text-muted-foreground hover:text-red-600" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Not shared with anyone yet
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

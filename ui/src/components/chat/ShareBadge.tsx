"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getChatAPI, type ShareStatus } from "@/lib/chat-api";
import { Share2, Lock, Users, Loader2 } from "lucide-react";
import { ShareDialog } from "./ShareDialog";

interface ShareBadgeProps {
  conversationId: string;
  conversationTitle: string;
  variant?: "inline" | "button";
}

export function ShareBadge({
  conversationId,
  conversationTitle,
  variant = "inline",
}: ShareBadgeProps) {
  const { data: session } = useSession();
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadShareStatus();
  }, [conversationId]);

  const loadShareStatus = async () => {
    try {
      setLoading(true);
      const chatAPI = getChatAPI(session?.accessToken as string);
      const status = await chatAPI.getShareStatus(conversationId);
      setShareStatus(status);
    } catch (err) {
      console.error("Failed to load share status:", err);
      // Fail silently for badge
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return variant === "button" ? (
      <Button variant="ghost" size="sm" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    ) : (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    );
  }

  if (!shareStatus) return null;

  const isShared = shareStatus.shared_with.length > 0;
  const isOwner = shareStatus.is_owner;
  const sharedCount = shareStatus.shared_with.length;

  if (variant === "button") {
    return (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(true)}
                className="gap-2"
              >
                {isShared ? (
                  <>
                    <Users className="h-4 w-4" />
                    <span className="text-xs">
                      Shared ({sharedCount})
                    </span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    <span className="text-xs">Share</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isShared
                ? `Shared with ${sharedCount} user${sharedCount > 1 ? "s" : ""}`
                : "Share this conversation"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <ShareDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              // Reload status when dialog closes
              loadShareStatus();
            }
          }}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
        />
      </>
    );
  }

  // Inline badge variant
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={isShared ? "default" : "secondary"}
              className="gap-1.5 cursor-pointer"
              onClick={() => setDialogOpen(true)}
            >
              {isShared ? (
                <>
                  <Users className="h-3 w-3" />
                  <span>Shared ({sharedCount})</span>
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3" />
                  <span>Private</span>
                </>
              )}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {isShared ? (
              <div className="space-y-1">
                <p className="font-semibold">Shared Conversation</p>
                <p className="text-xs">
                  {isOwner ? "You" : shareStatus.shared_with[0]?.user_email} shared with {sharedCount} user{sharedCount > 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground">Click to manage sharing</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold">Private Conversation</p>
                <p className="text-xs text-muted-foreground">Click to share with others</p>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <ShareDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            // Reload status when dialog closes
            loadShareStatus();
          }
        }}
        conversationId={conversationId}
        conversationTitle={conversationTitle}
      />
    </>
  );
}

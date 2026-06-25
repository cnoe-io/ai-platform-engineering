"use client";

import { Button } from "@/components/ui/button";
import {
Tooltip,
TooltipContent,
TooltipProvider,
TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check,Share2 } from "lucide-react";
import React,{ useState } from "react";
import { ShareDialog } from "./ShareDialog";

interface ShareButtonProps {
  conversationId: string;
  conversationTitle?: string;
  isOwner?: boolean;
  isSharedWithViewer?: boolean;
  sharedBy?: string;
}

export function ShareButton({ 
  conversationId, 
  conversationTitle = "Conversation",
  isOwner = true,
  isSharedWithViewer = false,
  sharedBy,
}: ShareButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleQuickCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    const shareUrl = `${window.location.origin}/chat/${conversationId}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleOpenDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDialog(true);
  };

  const sharedByText = sharedBy?.trim() ? `Shared by ${sharedBy.trim()}` : "Shared conversation";
  const shouldShowButton = isOwner || isSharedWithViewer;

  return (
    <>
      <TooltipProvider>
        {shouldShowButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={isOwner ? handleOpenDialog : handleQuickCopy}
                className="h-6 w-6"
                aria-label={isOwner ? "Share conversation" : sharedByText}
              >
                {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isOwner ? (
                <p>Share</p>
              ) : (
                <>
                  {/* assisted-by Codex Codex-sonnet-4-6 */}
                  <p>{copied ? "Link copied" : sharedByText}</p>
                  {!copied && <p className="text-xs text-muted-foreground">Click to copy link</p>}
                </>
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>

      {/* Share dialog */}
      {isOwner && (
        <ShareDialog
          conversationId={conversationId}
          conversationTitle={conversationTitle}
          open={showDialog}
          onOpenChange={setShowDialog}
        />
      )}
    </>
  );
}

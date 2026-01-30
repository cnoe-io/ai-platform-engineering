"use client";

import React, { useState } from "react";
import { Share2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "./ShareDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ShareButtonProps {
  conversationId: string;
  conversationTitle?: string;
  isOwner?: boolean;
}

export function ShareButton({ 
  conversationId, 
  conversationTitle = "Conversation",
  isOwner = true 
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

  return (
    <>
      <TooltipProvider>
        {/* Single share button that opens dialog */}
        {isOwner && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleOpenDialog}
                className="h-6 w-6"
              >
                <Share2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Share</p>
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

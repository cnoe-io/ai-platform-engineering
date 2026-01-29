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
        <div className="flex items-center gap-1">
          {/* Quick copy link button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleQuickCopy}
                className="h-8 px-2"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{copied ? "Link copied!" : "Copy link"}</p>
            </TooltipContent>
          </Tooltip>

          {/* Share settings button (owner only) */}
          {isOwner && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenDialog}
                  className="h-8 px-2"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Share settings</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
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

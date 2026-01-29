"use client";

import React, { useState, useEffect } from "react";
import { X, UserPlus, Copy, Check, Mail, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { UserPublicInfo } from "@/types/mongodb";

interface ShareDialogProps {
  conversationId: string;
  conversationTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({
  conversationId,
  conversationTitle,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const [emailInput, setEmailInput] = useState("");
  const [searchResults, setSearchResults] = useState<UserPublicInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/chat/${conversationId}`;

  // Load current sharing info
  useEffect(() => {
    if (open) {
      loadSharingInfo();
    }
  }, [open, conversationId]);

  const loadSharingInfo = async () => {
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}/share`);
      if (response.ok) {
        const data = await response.json();
        setSharedWith(data.data?.sharing?.shared_with || []);
      }
    } catch (err) {
      console.error("Failed to load sharing info:", err);
    }
  };

  // Search users as they type
  useEffect(() => {
    const searchUsers = async () => {
      if (emailInput.length < 2) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const users = await apiClient.searchUsers(emailInput);
        // Filter out already shared users
        setSearchResults(users.filter(u => !sharedWith.includes(u.email)));
      } catch (err) {
        console.error("Search failed:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    };

    const timer = setTimeout(searchUsers, 300);
    return () => clearTimeout(timer);
  }, [emailInput, sharedWith]);

  const handleShare = async (email: string) => {
    setLoading(true);
    try {
      await apiClient.shareConversation(conversationId, {
        user_emails: [email],
        permission: "view",
      });

      setSharedWith([...sharedWith, email]);
      setEmailInput("");
      setSearchResults([]);
    } catch (err) {
      console.error("Failed to share:", err);
      alert("Failed to share conversation");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-6 m-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Share Conversation</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {conversationTitle}
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Copy link section */}
        <div className="mb-6">
          <label className="text-sm font-medium mb-2 block">Share Link</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted"
            />
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Add people section */}
        <div className="mb-6">
          <label className="text-sm font-medium mb-2 block">
            Add People
          </label>
          <div className="relative">
            <input
              type="email"
              placeholder="Search by email..."
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md"
            />
            
            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto z-10">
                {searchResults.map((user) => (
                  <button
                    key={user.email}
                    onClick={() => handleShare(user.email)}
                    disabled={loading}
                    className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm"
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {user.email}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searching && (
              <div className="absolute right-3 top-2.5">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}
          </div>
        </div>

        {/* People with access */}
        {sharedWith.length > 0 && (
          <div>
            <label className="text-sm font-medium mb-2 block">
              People with Access ({sharedWith.length})
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {sharedWith.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between py-2 px-3 bg-muted rounded-md"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                      {email.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-sm">{email}</div>
                  </div>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      // TODO: Implement remove access
                      setSharedWith(sharedWith.filter(e => e !== email));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm border rounded-md hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

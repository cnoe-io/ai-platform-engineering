"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { apiClient } from "@/lib/api-client";

function ChatPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(true);

  useEffect(() => {
    async function createNewConversation() {
      try {
        // Create new conversation in MongoDB
        const conversation = await apiClient.createConversation({
          title: "New Conversation",
        });

        // Redirect to UUID-based URL
        router.push(`/chat/${conversation._id}`);
      } catch (error) {
        console.error("Failed to create conversation:", error);
        setCreating(false);
      }
    }

    createNewConversation();
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Creating new conversation...</p>
      </div>
    </div>
  );
}

export default function Chat() {
  return (
    <AuthGuard>
      <ChatPage />
    </AuthGuard>
  );
}

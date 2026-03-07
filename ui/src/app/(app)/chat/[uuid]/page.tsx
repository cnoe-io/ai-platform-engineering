"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { PlatformEngineerChatView } from "@/components/chat/PlatformEngineerChatView";
import { DynamicAgentChatView } from "@/components/dynamic-agents/DynamicAgentChatView";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import { useChatStore } from "@/store/chat-store";
import { getStorageMode } from "@/lib/storage-config";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import type { Conversation } from "@/types/mongodb";
import type { Conversation as LocalConversation } from "@/types/a2a";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

function ChatUUIDPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const uuid = params.uuid as string;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [agentIdInitialized, setAgentIdInitialized] = useState(false);
  const [agentInfo, setAgentInfo] = useState<{ name?: string; description?: string } | null>(null);

  // Only subscribe to stable functions — NOT to `conversations`.
  // Subscribing to `conversations` caused this effect to re-run on every
  // Zustand update (every streamed token, every A2A event), which triggered
  // excessive loadMessagesFromServer calls that could overwrite correct
  // in-memory state with stale MongoDB data. Instead, we read conversations
  // imperatively inside the effect via useChatStore.getState().
  const { setActiveConversation, loadMessagesFromServer } = useChatStore();
  const caipeUrl = getConfig('caipeUrl');
  const dynamicAgentsUrl = getConfig('dynamicAgentsUrl');
  const dynamicAgentsEnabled = getConfig('dynamicAgentsEnabled');

  // Compute the endpoint based on selected agent
  const chatEndpoint = useMemo(() => {
    if (selectedAgentId && dynamicAgentsEnabled) {
      // Dynamic agent uses the dynamic agents server with the agent ID
      return `${dynamicAgentsUrl}/agents/${selectedAgentId}/chat`;
    }
    // Default supervisor
    return caipeUrl;
  }, [selectedAgentId, dynamicAgentsEnabled, dynamicAgentsUrl, caipeUrl]);

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge" | "admin") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/use-cases");
    } else if (tab === "admin") {
      router.push("/admin");
    } else {
      router.push("/knowledge-bases");
    }
  };

  const storageMode = getStorageMode();

  // Reactive selector: true when the store has messages for this UUID.
  // This survives races with Sidebar's loadConversationsFromServer —
  // even if the Sidebar temporarily wipes messages, the selector will
  // flip back to false and the spinner will stay/reappear.
  const storeHasMessages = useChatStore(
    (s) => {
      const conv = s.conversations.find((c) => c.id === uuid);
      return !!(conv?.messages && conv.messages.length > 0);
    }
  );

  const existingConv = useChatStore.getState().conversations.find((c) => c.id === uuid);

  const [conversation, setConversation] = useState<Conversation | LocalConversation | null>(existingConv || null);
  const [accessLevel, setAccessLevel] = useState<string | null>(null);
  // Track whether the async fetch is still in flight.
  const [fetchInProgress, setFetchInProgress] = useState(
    storageMode === 'mongodb' && !storeHasMessages
  );
  // Track whether the fetch has completed at least once — used to distinguish
  // "still loading" from "genuinely empty / new conversation".
  const [fetchDone, setFetchDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load conversation from MongoDB or localStorage
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') {
      return;
    }

    async function loadConversation() {
      // Validate UUID format before making request
      if (!uuid || typeof uuid !== 'string') {
        setError("Invalid conversation ID");
        setFetchInProgress(false);
        setFetchDone(true);
        return;
      }

      // Check Zustand store first.
      // Read imperatively — this effect must NOT depend on `conversations`
      // to avoid re-running on every store update during streaming.
      const localConv = useChatStore.getState().conversations.find((c) => c.id === uuid);
      if (localConv) {
        setConversation(localConv);
        setActiveConversation(uuid);

        // Derive access level from store data when the conversation was loaded
        // by loadConversationsFromServer (which skips the per-conversation API
        // call that normally returns access_level). Without this, shared/public
        // conversations appear writable — users can send A2A requests with the
        // shared conversation's UUID as context_id even though MongoDB rejects
        // the subsequent message save (403 shared_readonly).
        if (localConv.owner_id && session?.user?.email && localConv.owner_id !== session.user.email) {
          if (localConv.sharing?.is_public) {
            setAccessLevel('shared_readonly');
          } else if (localConv.sharing?.shared_with?.includes(session.user.email) ||
                     (localConv.sharing?.shared_with_teams?.length ?? 0) > 0) {
            setAccessLevel('shared_readonly');
          }
        }

        const hasMessages = localConv.messages && localConv.messages.length > 0;

        if (hasMessages) {
          // Messages already in memory — render immediately, sync in background
          console.log("[ChatUUID] Found conversation in store with messages, loading instantly");
          setFetchInProgress(false);
          setFetchDone(true);

          if (storageMode === 'mongodb') {
            loadMessagesFromServer(uuid).catch((err) => {
              console.warn('[ChatUUID] Failed to sync messages from server:', err);
            });
          }
        } else if (storageMode === 'mongodb') {
          // Metadata-only stub (e.g. Sidebar's loadConversationsFromServer
          // replaced full objects with list-API entries that have no messages).
          // Keep the spinner visible until messages arrive from MongoDB.
          console.log("[ChatUUID] Found conversation in store but no messages, loading from MongoDB...");
          try {
            await loadMessagesFromServer(uuid, { force: true });
          } catch (err) {
            console.warn('[ChatUUID] Failed to load messages from server:', err);
          } finally {
            setFetchInProgress(false);
            setFetchDone(true);
          }
        } else {
          // localStorage mode with empty conversation — nothing to wait for
          setFetchInProgress(false);
          setFetchDone(true);
        }
        return;
      }

      console.log("[ChatUUID] Conversation not in store, loading from backend...");

      try {
        if (storageMode === 'mongodb') {
          // Try to load from MongoDB
          console.log("[ChatUUID] Loading from MongoDB...");
          try {
            const conv = await apiClient.getConversation(uuid);
            // Capture access level from API response for readonly enforcement
            if ((conv as any).access_level) {
              setAccessLevel((conv as any).access_level);
            }
            // Convert MongoDB conversation to local format
            const localConv: LocalConversation = {
              id: conv._id,
              title: conv.title,
              createdAt: new Date(conv.created_at),
              updatedAt: new Date(conv.updated_at),
              messages: [], // Will be loaded below via loadMessagesFromServer
              a2aEvents: [],
            };

            // Add to Zustand store so ContextPanel can find it
            useChatStore.setState((state) => ({
              conversations: [localConv, ...state.conversations.filter(c => c.id !== uuid)],
            }));

            setConversation(localConv);

            // Load messages from MongoDB before dismissing the spinner.
            // For lengthy chats this can take seconds — keeping the spinner
            // visible prevents the blank-screen gap.
            try {
              await loadMessagesFromServer(uuid);
            } catch (err) {
              console.warn('[ChatUUID] Failed to load messages from server:', err);
            }
          } catch (apiErr: any) {
            // Check store again - it might have been added while we were fetching
            const storeConv = useChatStore.getState().conversations.find(c => c.id === uuid);
            if (storeConv) {
              console.log("[ChatUUID] Conversation appeared in store during fetch");
              setConversation(storeConv);
              return;
            }

            // Conversation doesn't exist in MongoDB (404) - this is expected for new conversations
            if (apiErr.message?.includes('not found') || apiErr.message?.includes('404')) {
              console.log("[ChatUUID] Conversation not found in MongoDB (expected for new conversations)");
            } else {
              console.warn("[ChatUUID] Failed to load from MongoDB:", apiErr.message);
            }
            // Create empty conversation for both cases
            const newConv: LocalConversation = {
              id: uuid,
              title: "New Conversation",
              createdAt: new Date(),
              updatedAt: new Date(),
              messages: [],
              a2aEvents: [],
            };

            // Add to Zustand store
            useChatStore.setState((state) => ({
              conversations: [newConv, ...state.conversations.filter(c => c.id !== uuid)],
            }));

            setConversation(newConv);
          }
        } else {
          // MongoDB not available, show empty conversation
          console.log("[ChatUUID] MongoDB unavailable, showing empty conversation");
          const newConv: LocalConversation = {
            id: uuid,
            title: "New Conversation",
            createdAt: new Date(),
            updatedAt: new Date(),
            messages: [],
            a2aEvents: [],
          };

          // Add to Zustand store
          useChatStore.setState((state) => ({
            conversations: [newConv, ...state.conversations.filter(c => c.id !== uuid)],
          }));

          setConversation(newConv);
        }
      } catch (err) {
        console.error("[ChatUUID] Unexpected error:", err);
        // Fallback to empty conversation
        const newConv: LocalConversation = {
          id: uuid,
          title: "New Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          a2aEvents: [],
        };

        // Add to Zustand store
        useChatStore.setState((state) => ({
          conversations: [newConv, ...state.conversations.filter(c => c.id !== uuid)],
        }));

        setConversation(newConv);
      } finally {
        // CRITICAL: Always set the active conversation, even when loading from MongoDB
        // This ensures the ContextPanel can display Tasks and A2A Debug
        setActiveConversation(uuid);
        setFetchInProgress(false);
        setFetchDone(true);
      }
    }

    loadConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally omit conversations.
    // We read useChatStore.getState() imperatively to avoid re-running on every
    // store update, which caused excessive loadMessagesFromServer calls that
    // overwrote correct final content with stale MongoDB data during streaming.
  }, [uuid, storageMode, setActiveConversation, loadMessagesFromServer]);

  // Initialize selectedAgentId from conversation's agent_id once loaded
  useEffect(() => {
    if (!conversation || agentIdInitialized) return;

    // Extract agent_id from conversation (works for both MongoDB and local types)
    const agentId = ('agent_id' in conversation) ? conversation.agent_id : undefined;
    setSelectedAgentId(agentId);
    setAgentIdInitialized(true);
  }, [conversation, agentIdInitialized]);

  // Fetch agent info when a dynamic agent is selected
  useEffect(() => {
    if (!selectedAgentId || !dynamicAgentsEnabled) {
      setAgentInfo(null);
      return;
    }

    async function fetchAgentInfo() {
      try {
        const response = await fetch(`/api/dynamic-agents/agents/${selectedAgentId}`);
        if (response.ok) {
          const data = await response.json();
          const agent = data.data as DynamicAgentConfig;
          setAgentInfo({
            name: agent.name,
            description: agent.description,
          });
        }
      } catch (err) {
        console.error("Failed to fetch agent info:", err);
      }
    }

    fetchAgentInfo();
  }, [selectedAgentId, dynamicAgentsEnabled]);

  // Show loading spinner when:
  // 1. The async fetch is still in flight, OR
  // 2. The fetch completed but a concurrent Sidebar refresh wiped the messages
  //    out of the store (race condition). `storeHasMessages` is a reactive
  //    Zustand selector so the spinner auto-dismisses as soon as messages
  //    re-appear. We only guard this in mongodb mode and only when the fetch
  //    hasn't just created a genuinely new/empty conversation (fetchDone + no messages
  //    + not a new conversation with title "New Conversation").
  const showSpinner = fetchInProgress
    || (storageMode === 'mongodb' && fetchDone && !storeHasMessages && conversation?.title !== "New Conversation");

  if (showSpinner) {
    return (
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab="chat"
          onTabChange={handleTabChange}
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
        <div className="flex-1 flex items-center justify-center">
          <CAIPESpinner size="lg" message="Loading conversation..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab="chat"
          onTabChange={handleTabChange}
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => router.push("/chat")}
              className="text-sm text-primary hover:underline"
            >
              Go to new conversation
            </button>
          </div>
        </div>
      </div>
    );
  }

  const conversationTitle = conversation
    ? ('_id' in conversation ? conversation.title : conversation.title)
    : undefined;

  const isReadOnly = accessLevel === 'admin_audit' || accessLevel === 'shared_readonly';
  const readOnlyReason = accessLevel === 'admin_audit' ? 'admin_audit' : accessLevel === 'shared_readonly' ? 'shared_readonly' : undefined;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar - with conversation history */}
      <Sidebar
        activeTab="chat"
        onTabChange={handleTabChange}
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
      />

      {/* Chat View - different component based on agent type */}
      {selectedAgentId && dynamicAgentsEnabled ? (
        <DynamicAgentChatView
          endpoint={chatEndpoint}
          conversationId={uuid}
          conversationTitle={conversationTitle}
          selectedAgentId={selectedAgentId}
          agentName={agentInfo?.name}
          agentDescription={agentInfo?.description}
          readOnly={isReadOnly}
          readOnlyReason={readOnlyReason}
        />
      ) : (
        <PlatformEngineerChatView
          endpoint={chatEndpoint}
          conversationId={uuid}
          conversationTitle={conversationTitle}
          readOnly={isReadOnly}
          readOnlyReason={readOnlyReason}
        />
      )}
    </div>
  );
}

export default function ChatUUID() {
  return (
    <AuthGuard>
      <ChatUUIDPage />
    </AuthGuard>
  );
}

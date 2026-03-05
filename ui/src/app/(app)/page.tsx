"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AuthGuard } from "@/components/auth-guard";
import { WelcomeBanner } from "@/components/home/WelcomeBanner";
import { CapabilityCards } from "@/components/home/CapabilityCards";
import { RecentChats } from "@/components/home/RecentChats";
import { SharedConversations } from "@/components/home/SharedConversations";
import { InsightsWidget } from "@/components/home/InsightsWidget";
import { apiClient } from "@/lib/api-client";
import { config } from "@/lib/config";
import { getStorageMode } from "@/lib/storage-config";
import { useChatStore } from "@/store/chat-store";
import type { Conversation as MongoConversation } from "@/types/mongodb";
import type { UserStats } from "@/types/mongodb";

export default function HomePage() {
  const { data: session, status } = useSession();
  const { conversations: localConversations, loadConversationsFromServer } = useChatStore();

  const [recentChats, setRecentChats] = useState<
    Array<{ id: string; title: string; updatedAt: Date | string; totalMessages?: number; isShared?: boolean }>
  >([]);
  const [sharedWithMe, setSharedWithMe] = useState<
    Array<{ id: string; title: string; updatedAt: Date | string; totalMessages?: number; sharedBy?: string }>
  >([]);
  const [sharedWithTeam, setSharedWithTeam] = useState<
    Array<{ id: string; title: string; updatedAt: Date | string; totalMessages?: number; teamName?: string }>
  >([]);
  const [sharedWithEveryone, setSharedWithEveryone] = useState<
    Array<{ id: string; title: string; updatedAt: Date | string; totalMessages?: number }>
  >([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingShared, setLoadingShared] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);

  const storageMode = getStorageMode();
  const isMongoMode = storageMode === "mongodb";
  const isAuthenticated = status === "authenticated";

  const mapMongoConversation = useCallback(
    (conv: MongoConversation) => ({
      id: conv._id,
      title: conv.title,
      updatedAt: conv.updated_at,
      totalMessages: conv.metadata?.total_messages,
      isShared:
        conv.sharing?.is_public ||
        (conv.sharing?.shared_with?.length ?? 0) > 0 ||
        (conv.sharing?.shared_with_teams?.length ?? 0) > 0,
      sharedBy: conv.owner_id,
      isPublic: conv.sharing?.is_public,
    }),
    []
  );

  // Load recent chats
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadRecent = async () => {
      setLoadingChats(true);
      try {
        if (isMongoMode) {
          const response = await apiClient.getConversations({ page_size: 8 });
          setRecentChats(
            response.items.map(mapMongoConversation)
          );
        } else {
          // localStorage mode: use chat store conversations
          await loadConversationsFromServer();
          const sorted = [...localConversations]
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 8);
          setRecentChats(
            sorted.map((c) => ({
              id: c.id,
              title: c.title,
              updatedAt: c.updatedAt,
              totalMessages: c.messages.length,
            }))
          );
        }
      } catch (err) {
        console.error("[HomePage] Failed to load recent chats:", err);
      } finally {
        setLoadingChats(false);
      }
    };

    loadRecent();
  }, [isAuthenticated, isMongoMode]);

  // Load shared conversations (MongoDB only)
  useEffect(() => {
    if (!isAuthenticated || !isMongoMode) {
      setLoadingShared(false);
      return;
    }

    const loadShared = async () => {
      setLoadingShared(true);
      try {
        const response = await apiClient.getSharedConversations({ page_size: 20 });
        const all = response.items.map(mapMongoConversation);

        setSharedWithMe(all);

        const teamShared = response.items
          .filter((c) => (c.sharing?.shared_with_teams?.length ?? 0) > 0)
          .map((c) => ({
            ...mapMongoConversation(c),
            teamName: undefined,
          }));
        setSharedWithTeam(teamShared);

        const publicShared = response.items
          .filter((c) => c.sharing?.is_public)
          .map(mapMongoConversation);
        setSharedWithEveryone(publicShared);
      } catch (err) {
        console.error("[HomePage] Failed to load shared conversations:", err);
      } finally {
        setLoadingShared(false);
      }
    };

    loadShared();
  }, [isAuthenticated, isMongoMode]);

  // Load user stats (MongoDB only)
  useEffect(() => {
    if (!isAuthenticated || !isMongoMode) {
      setLoadingStats(false);
      return;
    }

    const loadStats = async () => {
      setLoadingStats(true);
      try {
        const userStats = await apiClient.getUserStats();
        setStats(userStats);
      } catch (err) {
        console.error("[HomePage] Failed to load user stats:", err);
      } finally {
        setLoadingStats(false);
      }
    };

    loadStats();
  }, [isAuthenticated, isMongoMode]);

  return (
    <AuthGuard>
      <ScrollArea className="flex-1" data-testid="home-page">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <WelcomeBanner userName={session?.user?.name} />

          <CapabilityCards ragEnabled={config.ragEnabled} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <RecentChats
                conversations={recentChats}
                loading={loadingChats}
              />
            </div>
            {isMongoMode && (
              <div className="lg:col-span-1">
                <InsightsWidget stats={stats} loading={loadingStats} />
              </div>
            )}
          </div>

          {isMongoMode && (
            <SharedConversations
              sharedWithMe={sharedWithMe}
              sharedWithTeam={sharedWithTeam}
              sharedWithEveryone={sharedWithEveryone}
              loading={loadingShared}
            />
          )}

          <p className="text-center text-xs text-muted-foreground/50 pt-4 pb-2">
            ⚡ Powered by{" "}
            <a
              href="https://caipe.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground/70 transition-colors"
            >
              caipe.io
            </a>
          </p>
        </div>
      </ScrollArea>
    </AuthGuard>
  );
}

"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  MessageSquare,
  Trash2,
  Loader2,
  RefreshCw,
  Search,
  User,
  Bot,
  AlertCircle,
  Archive,
} from "lucide-react";
import { getGradientStyle } from "@/lib/gradient-themes";
import type { AgentUIConfig } from "@/types/dynamic-agent";

interface ConversationItem {
  id: string;
  title: string;
  owner_id: string;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  checkpoint_count: number;
  is_archived: boolean;
  deleted_at: string | null;
}

interface AgentInfo {
  _id: string;
  name: string;
  ui?: AgentUIConfig;
}

interface PaginatedResponse {
  items: ConversationItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export function ConversationsTab() {
  const [conversations, setConversations] = React.useState<ConversationItem[]>([]);
  const [agents, setAgents] = React.useState<Map<string, AgentInfo>>(new Map());
  const [agentsList, setAgentsList] = React.useState<AgentInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [agentFilter, setAgentFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [clearingId, setClearingId] = React.useState<string | null>(null);
  const { toast } = useToast();

  // Fetch agents once on mount to build lookup map
  React.useEffect(() => {
    async function fetchAgents() {
      try {
        const response = await fetch("/api/dynamic-agents?page_size=100");
        const data = await response.json();
        if (data.success && data.data?.items) {
          const items = data.data.items as AgentInfo[];
          const agentMap = new Map<string, AgentInfo>();
          for (const agent of items) {
            agentMap.set(agent._id, agent);
          }
          setAgents(agentMap);
          setAgentsList(items);
        }
      } catch {
        // Silently fail - we'll just show agent IDs
      }
    }
    fetchAgents();
  }, []);

  const fetchConversations = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });
      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (agentFilter) {
        params.set("agent_id", agentFilter);
      }

      const response = await fetch(`/api/dynamic-agents/conversations?${params}`);
      const data = await response.json();

      if (data.success && data.data) {
        const paginated = data.data as PaginatedResponse;
        setConversations(paginated.items || []);
        setTotalPages(paginated.total_pages || 1);
        setTotal(paginated.total || 0);
      } else {
        setError(data.error || "Failed to fetch conversations");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch conversations";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, agentFilter]);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const getAgentName = (agentId: string | null): string => {
    if (!agentId) return "Unknown";
    const agent = agents.get(agentId);
    return agent?.name || agentId;
  };

  const getAgentGradient = (agentId: string | null): string | null => {
    if (!agentId) return null;
    const agent = agents.get(agentId);
    return agent?.ui?.gradient_theme || null;
  };

  const handleClear = async (conversationId: string) => {
    if (!confirm("Are you sure you want to clear this conversation's checkpoint data? This will remove all messages but keep the conversation record.")) {
      return;
    }

    setClearingId(conversationId);
    try {
      const response = await fetch(`/api/dynamic-agents/conversations/${conversationId}/clear`, {
        method: "POST",
      });
      const data = await response.json();

      if (data.success) {
        toast("Conversation cleared successfully", "success");
        fetchConversations();
      } else {
        toast(data.error || "Failed to clear conversation", "error");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to clear conversation";
      toast(message, "error");
    } finally {
      setClearingId(null);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchConversations();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Conversations</CardTitle>
            <CardDescription>
              View and manage Dynamic Agent conversations. Clear checkpoint data to remove message history.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchConversations} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search and Filters */}
        <div className="flex items-center gap-4 mb-4">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, title, or owner..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              value={agentFilter}
              onChange={(e) => {
                setAgentFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 text-sm rounded-md border border-input bg-background px-3 py-1 text-foreground"
            >
              <option value="">All Agents</option>
              {agentsList.map((agent) => (
                <option key={agent._id} value={agent._id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>
        </div>

        {/* Results count */}
        <div className="text-sm text-muted-foreground mb-4">
          {total} conversation{total !== 1 ? "s" : ""} found
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <p className="text-destructive">{error}</p>
            <Button variant="outline" className="mt-4" onClick={fetchConversations}>
              Retry
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Conversations Found</h3>
            <p className="text-muted-foreground">
              {search ? "No conversations match your search criteria." : "No conversations have been created yet."}
            </p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="space-y-3">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground px-2">
                <div className="col-span-4">Conversation</div>
                <div className="col-span-2">Owner</div>
                <div className="col-span-2">Agent</div>
                <div className="col-span-1">Checkpoints</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1">Updated</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {/* Rows */}
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`grid grid-cols-12 gap-4 py-3 px-2 rounded-lg hover:bg-muted/50 items-center ${
                    conv.deleted_at ? "opacity-60" : ""
                  }`}
                >
                  <div className="col-span-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                        <MessageSquare className="h-5 w-5 text-blue-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{conv.title}</div>
                        <div className="text-xs text-muted-foreground font-mono break-all">
                          {conv.id}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm truncate">{conv.owner_id}</span>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center gap-1.5">
                      {(() => {
                        const gradient = getAgentGradient(conv.agent_id);
                        const gradientStyle = gradient ? getGradientStyle(gradient) : null;
                        return gradientStyle ? (
                          <div 
                            className="h-4 w-4 rounded-full flex items-center justify-center shrink-0"
                            style={gradientStyle}
                          >
                            <Bot className="h-2.5 w-2.5 text-white" />
                          </div>
                        ) : (
                          <Bot className="h-3 w-3 text-purple-500" />
                        );
                      })()}
                      <span className="text-sm truncate">{getAgentName(conv.agent_id)}</span>
                    </div>
                  </div>

                  <div className="col-span-1">
                    <span className="text-sm text-muted-foreground">
                      {conv.checkpoint_count}
                    </span>
                  </div>

                  <div className="col-span-1">
                    {conv.deleted_at ? (
                      <Badge variant="outline" className="gap-1 text-orange-600 border-orange-300">
                        <Archive className="h-3 w-3" />
                        Trash
                      </Badge>
                    ) : conv.is_archived ? (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <Archive className="h-3 w-3" />
                        Archived
                      </Badge>
                    ) : (
                      <span className="text-sm text-green-600">Active</span>
                    )}
                  </div>

                  <div className="col-span-1">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(conv.updated_at)}
                    </span>
                  </div>

                  <div className="col-span-1 flex items-center justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleClear(conv.id)}
                      disabled={clearingId === conv.id}
                      title="Clear checkpoint data"
                    >
                      {clearingId === conv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

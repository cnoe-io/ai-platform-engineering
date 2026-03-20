"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Users, MessageSquare, TrendingUp, Activity, Database, Share2, ShieldCheck, ShieldOff, UserPlus, Trash2, UsersIcon, Loader2, Bot, ThumbsUp, ThumbsDown, Clock, Zap, CheckCircle2, AlertCircle, Layers, Eye, Star, Filter, ExternalLink, Plus, Calendar, X, FileText, Shield } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { SimpleLineChart } from "@/components/admin/SimpleLineChart";
import { MetricsTab } from "@/components/admin/MetricsTab";
import { HealthTab } from "@/components/admin/HealthTab";
import {
  VisibilityBreakdown,
  CategoryBreakdown,
  RunStatsTable,
  OverallRunStatsCard,
  TopCreatorsCard,
} from "@/components/admin/SkillMetricsCards";
import { CreateTeamDialog } from "@/components/admin/CreateTeamDialog";
import { TeamDetailsDialog } from "@/components/admin/TeamDetailsDialog";
import { AuditLogsTab } from "@/components/admin/AuditLogsTab";
import { PolicyTab } from "@/components/admin/PolicyTab";
import { CheckpointStatsSection } from "@/components/admin/CheckpointStatsSection";
import { SkillHubsSection } from "@/components/admin/SkillHubsSection";
import { useAdminRole } from "@/hooks/use-admin-role";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import type { Team as TeamType } from "@/types/teams";
import type { SkillMetricsAdmin } from "@/types/agent-config";

interface AdminStats {
  overview: {
    total_users: number;
    total_conversations: number;
    total_messages: number;
    shared_conversations: number;
    dau: number;
    mau: number;
    conversations_today: number;
    messages_today: number;
    avg_messages_per_conversation: number;
  };
  daily_activity: Array<{
    date: string;
    active_users: number;
    conversations: number;
    messages: number;
  }>;
  top_users: {
    by_conversations: Array<{ _id: string; count: number }>;
    by_messages: Array<{ _id: string; count: number }>;
  };
  top_agents: Array<{ _id: string; count: number }>;
  feedback_summary: {
    positive: number;
    negative: number;
    total: number;
  };
  response_time: {
    avg_ms: number;
    min_ms: number;
    max_ms: number;
    sample_count: number;
  };
  hourly_heatmap: Array<{ hour: number; count: number }>;
  completed_workflows: {
    total: number;
    today: number;
    interrupted: number;
    completion_rate: number;
    avg_messages_per_workflow: number;
  };
}

interface FeedbackEntry {
  message_id: string;
  conversation_id: string;
  conversation_title?: string;
  content_snippet: string;
  role: string;
  rating: 'positive' | 'negative';
  reason?: string;
  submitted_by: string;
  submitted_at: string;
}

interface FeedbackData {
  entries: FeedbackEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

interface NPSCampaign {
  _id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  created_by: string;
  created_at: string;
  response_count: number;
  status: 'active' | 'ended' | 'scheduled';
}

interface NPSData {
  nps_score: number;
  total_responses: number;
  campaigns?: NPSCampaign[];
  breakdown: {
    promoters: number;
    passives: number;
    detractors: number;
    promoter_pct: number;
    passive_pct: number;
    detractor_pct: number;
  };
  trend: Array<{
    date: string;
    avg_score: number | null;
    count: number;
    nps: number | null;
  }>;
  recent_responses: Array<{
    user_email: string;
    score: number;
    comment?: string;
    created_at: string;
  }>;
}

interface UserInfo {
  email: string;
  name: string;
  role: string;
  created_at: Date;
  last_login: Date;
  last_activity: Date;
  stats: {
    conversations: number;
    messages: number;
  };
}

interface Team {
  _id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: Date;
  members: Array<{
    user_id: string;
    role: string;
    added_at: Date;
  }>;
}

const VALID_TABS = ['users', 'teams', 'stats', 'skills', 'feedback', 'nps', 'metrics', 'health', 'policy', 'audit-logs'];

function AdminPage() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const { isAdmin } = useAdminRole();
  const auditLogsEnabled = getConfig('auditLogsEnabled');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [skillStats, setSkillStats] = useState<SkillMetricsAdmin | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    initialTab && VALID_TABS.includes(initialTab) ? initialTab : 'users'
  );
  const [createTeamDialogOpen, setCreateTeamDialogOpen] = useState(false);
  const [teamDetailsOpen, setTeamDetailsOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamType | null>(null);
  const [teamDialogMode, setTeamDialogMode] = useState<"details" | "members">("details");
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const [feedbackData, setFeedbackData] = useState<FeedbackData | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'positive' | 'negative'>('all');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [npsData, setNpsData] = useState<NPSData | null>(null);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignStartDate, setCampaignStartDate] = useState("");
  const [campaignEndDate, setCampaignEndDate] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [npsLoading, setNpsLoading] = useState(false);
  const [stoppingCampaign, setStoppingCampaign] = useState<string | null>(null);
  const [confirmStopCampaign, setConfirmStopCampaign] = useState<string | null>(null);
  const [statsRange, setStatsRange] = useState<"1d" | "7d" | "30d" | "90d">("30d");
  const rangeLabel = statsRange === "1d" ? "24 Hours" : statsRange === "7d" ? "7 Days" : statsRange === "90d" ? "90 Days" : "30 Days";

  useEffect(() => {
    // Only fetch admin data once the user is authenticated
    if (status === "authenticated") {
      loadAdminData();
    }
  }, [status]);

  // Re-fetch stats when range changes (lightweight — only refetch stats endpoint)
  const statsRangeRef = React.useRef(statsRange);
  useEffect(() => {
    if (statsRangeRef.current === statsRange) return; // skip initial
    statsRangeRef.current = statsRange;
    if (status !== "authenticated") return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/stats?range=${statsRange}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) setStats(json.data);
        }
      } catch {
        // keep existing stats on failure
      }
    })();
  }, [statsRange, status]);

  const loadAdminData = async () => {
    setLoading(true);
    setError(null);

    try {
      const feedbackOn = getConfig('feedbackEnabled');
      const npsOn = getConfig('npsEnabled');
      // Fetch stats, users, teams, skill metrics, feedback, and NPS in parallel
      const [statsRes, usersRes, teamsRes, skillStatsRes, feedbackRes, npsRes] = await Promise.all([
        fetch(`/api/admin/stats?range=${statsRange}`),
        fetch('/api/admin/users'),
        fetch('/api/admin/teams').catch(() => null),
        fetch('/api/admin/stats/skills').catch(() => null),
        feedbackOn ? fetch('/api/admin/feedback').catch(() => null) : null,
        npsOn ? fetch('/api/admin/nps').catch(() => null) : null,
      ]);

      if (statsRes.status === 401 || usersRes.status === 401) {
        setError('Not authenticated. Please sign in via SSO first.');
        setLoading(false);
        return;
      }

      const [statsResponse, usersResponse, teamsResponse] = await Promise.all([
        statsRes.json(),
        usersRes.json(),
        teamsRes ? teamsRes.json().catch(() => ({ success: true, data: { teams: [] } })) : { success: true, data: { teams: [] } },
      ]);

      if (statsResponse.success) {
        setStats(statsResponse.data);
      } else {
        throw new Error(statsResponse.error || 'Failed to load stats');
      }

      if (usersResponse.success) {
        setUsers(usersResponse.data.users);
      } else {
        throw new Error(usersResponse.error || 'Failed to load users');
      }

      if (teamsResponse.success) {
        setTeams(teamsResponse.data.teams || []);
      }

      if (skillStatsRes?.ok) {
        const skillStatsResponse = await skillStatsRes.json().catch(() => ({ success: false }));
        if (skillStatsResponse.success) {
          setSkillStats(skillStatsResponse.data);
        }
      }

      if (feedbackRes?.ok) {
        const feedbackResponse = await feedbackRes.json().catch(() => ({ success: false }));
        if (feedbackResponse.success) {
          setFeedbackData(feedbackResponse.data);
        }
      }

      if (npsRes?.ok) {
        const npsResponse = await npsRes.json().catch(() => ({ success: false }));
        if (npsResponse.success) {
          setNpsData(npsResponse.data);
        }
      }
    } catch (err: any) {
      console.error('[Admin] Failed to load data:', err);
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const loadFeedback = async (rating?: 'positive' | 'negative' | 'all', page = 1) => {
    setFeedbackLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (rating && rating !== 'all') params.set('rating', rating);
      const res = await fetch(`/api/admin/feedback?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) setFeedbackData(data.data);
      }
    } catch (err) {
      console.error('[Admin] Failed to load feedback:', err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleFeedbackFilterChange = (filter: 'all' | 'positive' | 'negative') => {
    setFeedbackFilter(filter);
    loadFeedback(filter);
  };

  const loadNpsData = async (campaignId?: string | null) => {
    setNpsLoading(true);
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set('campaign_id', campaignId);
      const res = await fetch(`/api/admin/nps?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) setNpsData(data.data);
      }
    } catch (err) {
      console.error('[Admin] Failed to load NPS data:', err);
    } finally {
      setNpsLoading(false);
    }
  };

  const handleCampaignSelect = (campaignId: string) => {
    if (selectedCampaignId === campaignId) {
      setSelectedCampaignId(null);
      loadNpsData();
    } else {
      setSelectedCampaignId(campaignId);
      loadNpsData(campaignId);
    }
  };

  const handleCreateCampaign = async () => {
    if (!campaignName.trim() || !campaignStartDate || !campaignEndDate) return;
    setCreatingCampaign(true);
    try {
      const res = await fetch('/api/admin/nps/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim(),
          starts_at: new Date(campaignStartDate).toISOString(),
          ends_at: new Date(campaignEndDate).toISOString(),
        }),
      });
      const result = await res.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to create campaign');
      }
      setCampaignName("");
      setCampaignStartDate("");
      setCampaignEndDate("");
      setShowCampaignForm(false);
      setSelectedCampaignId(null);
      await loadNpsData();
    } catch (err: any) {
      console.error('[Admin] Failed to create campaign:', err);
      alert(`Failed to create campaign: ${err.message}`);
    } finally {
      setCreatingCampaign(false);
    }
  };

  const handleStopCampaign = async (campaignId: string) => {
    setStoppingCampaign(campaignId);
    setConfirmStopCampaign(null);
    try {
      const res = await fetch('/api/admin/nps/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to stop campaign');
      }
      await loadNpsData(selectedCampaignId);
    } catch (err: any) {
      console.error('[Admin] Failed to stop campaign:', err);
      alert(`Failed to stop campaign: ${err.message}`);
    } finally {
      setStoppingCampaign(null);
    }
  };

  const handleRoleChange = async (email: string, newRole: 'admin' | 'user') => {
    if (!confirm(`Are you sure you want to change ${email} to ${newRole}?`)) {
      return;
    }

    setUpdatingRole(email);

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update role');
      }

      // Update local state
      setUsers(users.map(u =>
        u.email === email ? { ...u, role: newRole } : u
      ));

      console.log(`[Admin] Successfully changed ${email} to ${newRole}`);
    } catch (err: any) {
      console.error('[Admin] Failed to update role:', err);
      alert(`Failed to update role: ${err.message}`);
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    if (!confirm(`Are you sure you want to delete the team "${team.name}"? This cannot be undone.`)) {
      return;
    }

    setDeletingTeam(team._id);
    try {
      const response = await fetch(`/api/admin/teams/${team._id}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete team');
      }

      // Remove from local state
      setTeams(teams.filter(t => t._id !== team._id));
      console.log(`[Admin] Team deleted: ${team.name}`);
    } catch (err: any) {
      console.error('[Admin] Failed to delete team:', err);
      alert(`Failed to delete team: ${err.message}`);
    } finally {
      setDeletingTeam(null);
    }
  };

  const openTeamDialog = (team: Team, mode: "details" | "members") => {
    setSelectedTeam(team as TeamType);
    setTeamDialogMode(mode);
    setTeamDetailsOpen(true);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <CAIPESpinner size="lg" message="Loading admin data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <button
            onClick={loadAdminData}
            className="text-sm text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <ScrollArea className="h-full">
          <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                {!isAdmin && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <Eye className="h-3.5 w-3.5" />
                    Read-Only
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                {isAdmin
                  ? 'Manage users, teams, monitor usage, and track platform metrics'
                  : 'View platform usage, users, teams, and metrics (read-only access)'}
              </p>
            </div>

            {/* Overview Stats */}
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.overview.total_users}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      DAU: {stats.overview.dau} | MAU: {stats.overview.mau}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Conversations</CardTitle>
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.overview.total_conversations}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Today: +{stats.overview.conversations_today}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Messages</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.overview.total_messages}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Today: +{stats.overview.messages_today}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Shared</CardTitle>
                    <Share2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.overview.shared_conversations}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {((stats.overview.shared_conversations / stats.overview.total_conversations) * 100).toFixed(1)}% of all conversations
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tabbed Content */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className={`grid w-full ${(() => {
                const n = 6
                  + (getConfig('feedbackEnabled') ? 1 : 0)
                  + (getConfig('npsEnabled') ? 1 : 0)
                  + (auditLogsEnabled && isAdmin ? 1 : 0)
                  + (isAdmin ? 1 : 0);
                const cols: Record<number, string> = { 6: 'grid-cols-6', 7: 'grid-cols-7', 8: 'grid-cols-8', 9: 'grid-cols-9', 10: 'grid-cols-10' };
                return cols[n] ?? 'grid-cols-6';
              })()}`}>
                <TabsTrigger value="users" className="gap-2">
                  <Users className="h-4 w-4" />
                  Users
                </TabsTrigger>
                <TabsTrigger value="teams" className="gap-2">
                  <UsersIcon className="h-4 w-4" />
                  Teams
                </TabsTrigger>
                <TabsTrigger value="skills" className="gap-2">
                  <Layers className="h-4 w-4" />
                  Skills
                </TabsTrigger>
                {getConfig('feedbackEnabled') && (
                <TabsTrigger value="feedback" className="gap-2">
                  <ThumbsUp className="h-4 w-4" />
                  Feedback
                </TabsTrigger>
                )}
                {getConfig('npsEnabled') && (
                <TabsTrigger value="nps" className="gap-2">
                  <Star className="h-4 w-4" />
                  NPS
                </TabsTrigger>
                )}
                <TabsTrigger value="stats" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Statistics
                </TabsTrigger>
                <TabsTrigger value="metrics" className="gap-2">
                  <Activity className="h-4 w-4" />
                  Metrics
                </TabsTrigger>
                <TabsTrigger value="health" className="gap-2">
                  <Database className="h-4 w-4" />
                  Health
                </TabsTrigger>
                {auditLogsEnabled && isAdmin && (
                  <TabsTrigger value="audit-logs" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Audit Logs
                  </TabsTrigger>
                )}
                {isAdmin && (
                  <TabsTrigger value="policy" className="gap-2">
                    <Shield className="h-4 w-4" />
                    Policy
                  </TabsTrigger>
                )}
              </TabsList>

              {/* User Management Tab */}
              <TabsContent value="users" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>
                      {isAdmin ? 'Manage user access, roles, and view activity' : 'View user access, roles, and activity'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className={`grid gap-4 pb-2 border-b text-xs font-medium text-muted-foreground ${isAdmin ? 'grid-cols-6' : 'grid-cols-5'}`}>
                        <div>Email</div>
                        <div>Name</div>
                        <div>Role</div>
                        <div>Activity</div>
                        <div>Stats</div>
                        {isAdmin && <div className="text-right">Actions</div>}
                      </div>
                      {users.map((user) => (
                        <div key={user.email} className={`grid gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center ${isAdmin ? 'grid-cols-6' : 'grid-cols-5'}`}>
                          <div className="truncate">{user.email}</div>
                          <div className="truncate">{user.name}</div>
                          <div>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              user.role === 'admin'
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            }`}>
                              {user.role}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(user.last_activity).toLocaleDateString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {user.stats.conversations} chats, {user.stats.messages} msgs
                          </div>
                          {isAdmin && (
                            <div className="flex justify-end gap-1">
                              {user.role === 'user' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRoleChange(user.email, 'admin')}
                                  disabled={updatingRole === user.email}
                                  className="h-7 text-xs gap-1"
                                >
                                  <ShieldCheck className="h-3 w-3" />
                                  Make Admin
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRoleChange(user.email, 'user')}
                                  disabled={updatingRole === user.email}
                                  className="h-7 text-xs gap-1"
                                >
                                  <ShieldOff className="h-3 w-3" />
                                  Remove Admin
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Team Management Tab */}
              <TabsContent value="teams" className="space-y-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Team Management</CardTitle>
                      <CardDescription>
                        {isAdmin ? 'Create and manage teams for collaboration and conversation sharing' : 'View teams and their members'}
                      </CardDescription>
                    </div>
                    {isAdmin && (
                      <Button className="gap-2" onClick={() => setCreateTeamDialogOpen(true)}>
                        <UserPlus className="h-4 w-4" />
                        Create Team
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    {teams.length === 0 ? (
                      <div className="text-center py-12">
                        <UsersIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No Teams Yet</h3>
                        <p className="text-muted-foreground mb-4">
                          {isAdmin
                            ? 'Create teams to enable collaboration and conversation sharing'
                            : 'No teams have been created yet'}
                        </p>
                        {isAdmin && (
                          <Button className="gap-2" onClick={() => setCreateTeamDialogOpen(true)}>
                            <UserPlus className="h-4 w-4" />
                            Create Your First Team
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {teams.map((team) => (
                          <Card key={team._id}>
                            <CardHeader>
                              <div className="flex items-center justify-between">
                                <div>
                                  <CardTitle className="text-lg">{team.name}</CardTitle>
                                  {team.description && (
                                    <CardDescription>{team.description}</CardDescription>
                                  )}
                                </div>
                                {isAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteTeam(team)}
                                    disabled={deletingTeam === team._id}
                                  >
                                    {deletingTeam === team._id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">Members:</span>
                                  <span>{team.members.length}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">Owner:</span>
                                  <span>{team.owner_id}</span>
                                </div>
                                <div className="flex gap-2 mt-4">
                                  {isAdmin && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="flex-1"
                                      onClick={() => openTeamDialog(team, "members")}
                                    >
                                      Manage Members
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => openTeamDialog(team, "details")}
                                  >
                                    View Details
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Skills Tab */}
              <TabsContent value="skills" className="space-y-4">
                {skillStats ? (
                  <>
                    {/* Overview Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Total Skills</CardTitle>
                          <Layers className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{skillStats.total_skills}</div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {skillStats.system_skills} system, {skillStats.user_skills} user-created
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">User Skills</CardTitle>
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{skillStats.user_skills}</div>
                          <p className="text-xs text-muted-foreground mt-1">
                            by {skillStats.top_creators.length} creator{skillStats.top_creators.length !== 1 ? "s" : ""}
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Total Runs</CardTitle>
                          <Zap className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{skillStats.overall_run_stats.total_runs}</div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {skillStats.overall_run_stats.success_rate}% success rate
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Categories</CardTitle>
                          <Activity className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{skillStats.by_category.length}</div>
                          <p className="text-xs text-muted-foreground mt-1">
                            unique categories
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Visibility + Category Breakdown */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Visibility Breakdown</CardTitle>
                          <CardDescription>User-created skills by sharing scope</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <VisibilityBreakdown
                            byVisibility={skillStats.by_visibility}
                            total={skillStats.user_skills}
                          />
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Skills by Category</CardTitle>
                          <CardDescription>Distribution across categories</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <CategoryBreakdown byCategory={skillStats.by_category} />
                        </CardContent>
                      </Card>
                    </div>

                    {/* Creation Timeline */}
                    {skillStats.daily_created.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Skills Created (Last 30 Days)</CardTitle>
                          <CardDescription>New user-created skills per day</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <SimpleLineChart
                            data={skillStats.daily_created.map((d) => ({
                              label: new Date(d.date).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              }),
                              value: d.count,
                            }))}
                            height={200}
                            color="rgb(139, 92, 246)"
                          />
                        </CardContent>
                      </Card>
                    )}

                    {/* Top Creators + Run Performance */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <TopCreatorsCard creators={skillStats.top_creators} />
                      <OverallRunStatsCard stats={skillStats.overall_run_stats} />
                    </div>

                    {/* Top Skills by Runs */}
                    <RunStatsTable
                      runStats={skillStats.top_skills_by_runs}
                      title="Top Skills by Usage"
                      description="Most frequently executed skills across the platform"
                    />
                  </>
                ) : (
                  <Card>
                    <CardContent className="pt-6 text-center py-12">
                      <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">No Skill Data</h3>
                      <p className="text-muted-foreground">
                        Skill metrics will appear once users start creating skills.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Skill Hubs Management */}
                <SkillHubsSection isAdmin={isAdmin} />
              </TabsContent>

              {/* Feedback Tab */}
              {getConfig('feedbackEnabled') && <TabsContent value="feedback" className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <ThumbsUp className="h-5 w-5" />
                          User Feedback
                        </CardTitle>
                        <CardDescription>
                          All feedback submitted by users on assistant responses
                        </CardDescription>
                      </div>
                      <div className="flex gap-1">
                        {(['all', 'positive', 'negative'] as const).map((f) => (
                          <Button
                            key={f}
                            size="sm"
                            variant={feedbackFilter === f ? 'default' : 'outline'}
                            onClick={() => handleFeedbackFilterChange(f)}
                            className="gap-1.5 h-8 text-xs capitalize"
                          >
                            {f === 'positive' && <ThumbsUp className="h-3 w-3" />}
                            {f === 'negative' && <ThumbsDown className="h-3 w-3" />}
                            {f === 'all' && <Filter className="h-3 w-3" />}
                            {f}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {feedbackLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : feedbackData?.entries?.length > 0 ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-7 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                          <div>User</div>
                          <div>Rating</div>
                          <div>Reason</div>
                          <div className="col-span-2">Message Preview</div>
                          <div>Date</div>
                          <div>Chat</div>
                        </div>
                        {feedbackData.entries.map((entry, i) => (
                          <div key={`${entry.message_id}-${i}`} className="grid grid-cols-7 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center">
                            <div className="truncate text-xs">{entry.submitted_by}</div>
                            <div>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                                entry.rating === 'positive'
                                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
                              }`}>
                                {entry.rating === 'positive' ? (
                                  <ThumbsUp className="h-3 w-3" />
                                ) : (
                                  <ThumbsDown className="h-3 w-3" />
                                )}
                                {entry.rating}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {entry.reason || '—'}
                            </div>
                            <div className="col-span-2 text-xs text-muted-foreground truncate">
                              {entry.content_snippet || '—'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {entry.submitted_at
                                ? new Date(entry.submitted_at).toLocaleDateString()
                                : '—'}
                            </div>
                            <div>
                              {entry.conversation_id ? (
                                <a
                                  href={`/chat/${entry.conversation_id}?from=feedback`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  title={entry.conversation_title || 'View conversation'}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  {entry.conversation_title
                                    ? entry.conversation_title.length > 20
                                      ? entry.conversation_title.slice(0, 20) + '…'
                                      : entry.conversation_title
                                    : 'View'}
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </div>
                        ))}
                        {feedbackData.pagination.total_pages > 1 && (
                          <div className="flex justify-center gap-2 pt-4">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={feedbackData.pagination.page <= 1}
                              onClick={() => loadFeedback(feedbackFilter, feedbackData.pagination.page - 1)}
                            >
                              Previous
                            </Button>
                            <span className="text-sm text-muted-foreground flex items-center">
                              Page {feedbackData.pagination.page} of {feedbackData.pagination.total_pages}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={feedbackData.pagination.page >= feedbackData.pagination.total_pages}
                              onClick={() => loadFeedback(feedbackFilter, feedbackData.pagination.page + 1)}
                            >
                              Next
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <ThumbsUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No Feedback Yet</h3>
                        <p className="text-muted-foreground">
                          User feedback will appear here once users start rating assistant responses.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>}

              {/* NPS Tab */}
              {getConfig('npsEnabled') && <TabsContent value="nps" className="space-y-4">
                {/* Campaign Management */}
                {isAdmin && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Calendar className="h-5 w-5" />
                            NPS Campaigns
                          </CardTitle>
                          <CardDescription>Create and manage NPS survey campaigns</CardDescription>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => setShowCampaignForm(!showCampaignForm)}
                          className="gap-1"
                        >
                          <Plus className="h-4 w-4" />
                          Launch Campaign
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {/* Create Campaign Form */}
                      {showCampaignForm && (
                        <div className="mb-4 p-4 border border-border rounded-lg bg-muted/30 space-y-3">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Campaign Name</label>
                            <input
                              type="text"
                              value={campaignName}
                              onChange={(e) => setCampaignName(e.target.value)}
                              placeholder="e.g. Q1 2026 NPS"
                              className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                              maxLength={100}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                              <input
                                type="datetime-local"
                                value={campaignStartDate}
                                onChange={(e) => setCampaignStartDate(e.target.value)}
                                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">End Date</label>
                              <input
                                type="datetime-local"
                                value={campaignEndDate}
                                onChange={(e) => setCampaignEndDate(e.target.value)}
                                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowCampaignForm(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleCreateCampaign}
                              disabled={!campaignName.trim() || !campaignStartDate || !campaignEndDate || creatingCampaign}
                              className="gap-1"
                            >
                              {creatingCampaign && <Loader2 className="h-3 w-3 animate-spin" />}
                              Create Campaign
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Campaign List */}
                      {npsData?.campaigns && npsData.campaigns.length > 0 ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-6 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                            <div>Campaign</div>
                            <div>Start</div>
                            <div>End</div>
                            <div>Responses</div>
                            <div>Status</div>
                            {isAdmin && <div></div>}
                          </div>
                          {npsData.campaigns.map((c) => (
                            <div
                              key={c._id}
                              className={`grid grid-cols-6 gap-4 py-2 text-sm rounded px-2 items-center w-full transition-colors ${
                                selectedCampaignId === c._id
                                  ? 'bg-primary/10 ring-1 ring-primary/30'
                                  : 'hover:bg-muted/50'
                              }`}
                            >
                              <button
                                onClick={() => handleCampaignSelect(c._id)}
                                className="font-medium truncate text-left"
                              >
                                {c.name}
                              </button>
                              <button onClick={() => handleCampaignSelect(c._id)} className="text-xs text-muted-foreground text-left">
                                {new Date(c.starts_at).toLocaleDateString()}
                              </button>
                              <button onClick={() => handleCampaignSelect(c._id)} className="text-xs text-muted-foreground text-left">
                                {new Date(c.ends_at).toLocaleDateString()}
                              </button>
                              <button onClick={() => handleCampaignSelect(c._id)} className="text-xs text-left">
                                {c.response_count}
                              </button>
                              <div>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  c.status === 'active'
                                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                    : c.status === 'scheduled'
                                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    : 'bg-muted text-muted-foreground'
                                }`}>
                                  {c.status === 'active' ? 'Active' : c.status === 'scheduled' ? 'Scheduled' : 'Ended'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                {isAdmin && c.status !== 'ended' && (
                                  stoppingCampaign === c._id ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Stopping…
                                    </span>
                                  ) : confirmStopCampaign === c._id ? (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={(e) => { e.stopPropagation(); handleStopCampaign(c._id); }}
                                      >
                                        Confirm
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={(e) => { e.stopPropagation(); setConfirmStopCampaign(null); }}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={(e) => { e.stopPropagation(); setConfirmStopCampaign(c._id); }}
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Stop
                                    </Button>
                                  )
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No campaigns created yet. Launch your first NPS campaign to start collecting feedback.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Campaign filter indicator */}
                {selectedCampaignId && npsData?.campaigns && (
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-sm text-muted-foreground">
                      Viewing results for:
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                      {npsData.campaigns.find((c) => c._id === selectedCampaignId)?.name || 'Campaign'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => { setSelectedCampaignId(null); loadNpsData(); }}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear filter
                    </Button>
                  </div>
                )}

                {npsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : npsData && npsData.total_responses > 0 ? (
                  <>
                    {/* NPS Score + Breakdown */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* NPS Score Card */}
                      <Card className="lg:col-span-1">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Star className="h-5 w-5" />
                            NPS Score
                          </CardTitle>
                          <CardDescription>Net Promoter Score (-100 to +100)</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="text-center">
                            <p className={`text-6xl font-bold ${
                              npsData.nps_score >= 50 ? 'text-green-500' :
                              npsData.nps_score >= 0 ? 'text-amber-500' :
                              'text-red-500'
                            }`}>
                              {npsData.nps_score > 0 ? '+' : ''}{npsData.nps_score}
                            </p>
                            <p className="text-sm text-muted-foreground mt-2">
                              Based on {npsData.total_responses} response{npsData.total_responses !== 1 ? 's' : ''}
                            </p>
                            <p className={`text-xs mt-1 ${
                              npsData.nps_score >= 50 ? 'text-green-500' :
                              npsData.nps_score >= 0 ? 'text-amber-500' :
                              'text-red-500'
                            }`}>
                              {npsData.nps_score >= 70 ? 'Excellent' :
                               npsData.nps_score >= 50 ? 'Great' :
                               npsData.nps_score >= 0 ? 'Good' :
                               npsData.nps_score >= -50 ? 'Needs Improvement' :
                               'Critical'}
                            </p>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Breakdown Card */}
                      <Card className="lg:col-span-2">
                        <CardHeader>
                          <CardTitle>Response Breakdown</CardTitle>
                          <CardDescription>Promoters (9-10), Passives (7-8), Detractors (0-6)</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {/* Stacked bar */}
                            <div className="h-8 flex rounded-full overflow-hidden">
                              {npsData.breakdown.promoter_pct > 0 && (
                                <div
                                  className="bg-green-500 flex items-center justify-center text-white text-xs font-medium"
                                  style={{ width: `${npsData.breakdown.promoter_pct}%` }}
                                >
                                  {npsData.breakdown.promoter_pct}%
                                </div>
                              )}
                              {npsData.breakdown.passive_pct > 0 && (
                                <div
                                  className="bg-amber-500 flex items-center justify-center text-white text-xs font-medium"
                                  style={{ width: `${npsData.breakdown.passive_pct}%` }}
                                >
                                  {npsData.breakdown.passive_pct}%
                                </div>
                              )}
                              {npsData.breakdown.detractor_pct > 0 && (
                                <div
                                  className="bg-red-500 flex items-center justify-center text-white text-xs font-medium"
                                  style={{ width: `${npsData.breakdown.detractor_pct}%` }}
                                >
                                  {npsData.breakdown.detractor_pct}%
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-4 text-center">
                              <div className="p-3 rounded-lg bg-green-500/10">
                                <p className="text-2xl font-bold text-green-500">{npsData.breakdown.promoters}</p>
                                <p className="text-xs text-muted-foreground">Promoters (9-10)</p>
                              </div>
                              <div className="p-3 rounded-lg bg-amber-500/10">
                                <p className="text-2xl font-bold text-amber-500">{npsData.breakdown.passives}</p>
                                <p className="text-xs text-muted-foreground">Passives (7-8)</p>
                              </div>
                              <div className="p-3 rounded-lg bg-red-500/10">
                                <p className="text-2xl font-bold text-red-500">{npsData.breakdown.detractors}</p>
                                <p className="text-xs text-muted-foreground">Detractors (0-6)</p>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* NPS Trend Chart */}
                    {(() => {
                      const trendWithData = npsData.trend.filter((d) => d.count > 0);
                      return trendWithData.length > 0 ? (
                        <Card>
                          <CardHeader>
                            <CardTitle>NPS Trend (Last 30 Days)</CardTitle>
                            <CardDescription>Daily average score and response count</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <SimpleLineChart
                              data={npsData.trend
                                .filter((d) => d.avg_score !== null)
                                .map((d) => ({
                                  label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                                  value: d.avg_score!,
                                }))}
                              height={200}
                              color="rgb(234, 179, 8)"
                            />
                            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                              <div>
                                <p className="text-lg font-bold">
                                  {(trendWithData.reduce((sum, d) => sum + (d.avg_score || 0), 0) / trendWithData.length).toFixed(1)}
                                </p>
                                <p className="text-xs text-muted-foreground">Avg Score (30d)</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold">
                                  {trendWithData.reduce((sum, d) => sum + d.count, 0)}
                                </p>
                                <p className="text-xs text-muted-foreground">Responses (30d)</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold">
                                  {(trendWithData.reduce((sum, d) => sum + d.count, 0) / 30).toFixed(1)}
                                </p>
                                <p className="text-xs text-muted-foreground">Avg/Day</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ) : null;
                    })()}

                    {/* Recent NPS Responses */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Recent Responses</CardTitle>
                        <CardDescription>Latest NPS survey submissions</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="grid grid-cols-4 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                            <div>User</div>
                            <div>Score</div>
                            <div>Comment</div>
                            <div>Date</div>
                          </div>
                          {npsData.recent_responses.map((resp, i) => (
                            <div key={`${resp.user_email}-${i}`} className="grid grid-cols-4 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center">
                              <div className="truncate text-xs">{resp.user_email}</div>
                              <div>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  resp.score >= 9 ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
                                  resp.score >= 7 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                                  'bg-red-500/10 text-red-600 dark:text-red-400'
                                }`}>
                                  {resp.score}/10
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {resp.comment || '—'}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(resp.created_at).toLocaleDateString()}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card>
                    <CardContent className="pt-6 text-center py-12">
                      <Star className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">
                        {selectedCampaignId ? 'No Responses for This Campaign' : 'No NPS Data'}
                      </h3>
                      <p className="text-muted-foreground">
                        {selectedCampaignId
                          ? 'This campaign has not received any NPS responses yet.'
                          : 'NPS survey responses will appear here once users start submitting them.'}
                      </p>
                      {selectedCampaignId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          onClick={() => { setSelectedCampaignId(null); loadNpsData(); }}
                        >
                          View All Results
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>}

              {/* Usage Statistics Tab */}
              <TabsContent value="stats" className="space-y-4">
                {/* Range Selector */}
                <div className="flex items-center justify-end">
                  <div className="flex rounded-md border overflow-hidden">
                    {([["1d", "24h"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setStatsRange(value)}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                          statsRange === value
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {stats && (
                  <>
                    {/* DAU and MAU Trend Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Daily Active Users (DAU)</CardTitle>
                          <CardDescription>Active users per day ({rangeLabel})</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <SimpleLineChart
                            data={stats.daily_activity.map((day) => ({
                              label: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                              value: day.active_users,
                            }))}
                            height={250}
                            color="rgb(59, 130, 246)"
                          />
                          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                            <div>
                              <p className="text-2xl font-bold text-blue-500">{stats.overview.dau}</p>
                              <p className="text-xs text-muted-foreground">Today</p>
                            </div>
                            <div>
                              <p className="text-2xl font-bold">{stats.overview.mau}</p>
                              <p className="text-xs text-muted-foreground">This Month</p>
                            </div>
                            <div>
                              <p className="text-2xl font-bold text-green-500">
                                {Math.round((stats.daily_activity.reduce((sum, d) => sum + d.active_users, 0) / stats.daily_activity.length))}
                              </p>
                              <p className="text-xs text-muted-foreground">Avg/Day</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Conversation Activity</CardTitle>
                          <CardDescription>New conversations created daily</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <SimpleLineChart
                            data={stats.daily_activity.map((day) => ({
                              label: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                              value: day.conversations,
                            }))}
                            height={250}
                            color="rgb(34, 197, 94)"
                          />
                          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                            <div>
                              <p className="text-2xl font-bold text-green-500">{stats.overview.conversations_today}</p>
                              <p className="text-xs text-muted-foreground">Today</p>
                            </div>
                            <div>
                              <p className="text-2xl font-bold">{stats.overview.total_conversations}</p>
                              <p className="text-xs text-muted-foreground">Total</p>
                            </div>
                            <div>
                              <p className="text-2xl font-bold text-purple-500">
                                {Math.round((stats.daily_activity.reduce((sum, d) => sum + d.conversations, 0) / stats.daily_activity.length))}
                              </p>
                              <p className="text-xs text-muted-foreground">Avg/Day</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Messages Activity Chart */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Message Activity ({rangeLabel})</CardTitle>
                        <CardDescription>Messages sent per day</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <SimpleLineChart
                          data={stats.daily_activity.map((day) => ({
                            label: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                            value: day.messages,
                          }))}
                          height={200}
                          color="rgb(168, 85, 247)"
                        />
                        <div className="mt-4 grid grid-cols-4 gap-4 text-center">
                          <div>
                            <p className="text-2xl font-bold text-purple-500">{stats.overview.messages_today}</p>
                            <p className="text-xs text-muted-foreground">Today</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold">{stats.overview.total_messages}</p>
                            <p className="text-xs text-muted-foreground">Total</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-orange-500">
                              {Math.round((stats.daily_activity.reduce((sum, d) => sum + d.messages, 0) / stats.daily_activity.length))}
                            </p>
                            <p className="text-xs text-muted-foreground">Avg/Day</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-blue-500">
                              {(stats.overview.total_messages / stats.overview.total_conversations).toFixed(1)}
                            </p>
                            <p className="text-xs text-muted-foreground">Msgs/Chat</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Top Users */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Top Users by Conversations</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {stats.top_users.by_conversations.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
                            ) : stats.top_users.by_conversations.map((u, i) => (
                              <div key={u._id} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                                  <div className="text-sm truncate max-w-[200px]">{u._id}</div>
                                </div>
                                <div className="text-sm font-medium">{u.count} chats</div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Top Users by Messages</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {stats.top_users.by_messages.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
                            ) : stats.top_users.by_messages.map((u, i) => (
                              <div key={u._id} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                                  <div className="text-sm truncate max-w-[200px]">{u._id}</div>
                                </div>
                                <div className="text-sm font-medium">{u.count} messages</div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Top Agents and Feedback */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Bot className="h-5 w-5" />
                            Top Agents by Usage
                          </CardTitle>
                          <CardDescription>Most frequently used AI agents</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {(!stats.top_agents || stats.top_agents.length === 0) ? (
                              <p className="text-sm text-muted-foreground text-center py-4">No agent data yet</p>
                            ) : stats.top_agents.map((agent, i) => {
                              const maxCount = stats.top_agents[0].count;
                              const pct = maxCount > 0 ? (agent.count / maxCount) * 100 : 0;
                              return (
                                <div key={agent._id}>
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                                      <div className="text-sm font-medium capitalize">{agent._id}</div>
                                    </div>
                                    <div className="text-sm text-muted-foreground">{agent.count}</div>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden ml-8">
                                    <div
                                      className="h-full bg-primary rounded-full transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <ThumbsUp className="h-5 w-5" />
                            Feedback Summary
                          </CardTitle>
                          <CardDescription>User satisfaction across all conversations</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {stats.feedback_summary && stats.feedback_summary.total > 0 ? (
                            <div className="space-y-4">
                              <div className="grid grid-cols-3 gap-4 text-center">
                                <div>
                                  <div className="flex items-center justify-center gap-1 mb-1">
                                    <ThumbsUp className="h-4 w-4 text-green-500" />
                                  </div>
                                  <p className="text-2xl font-bold text-green-500">{stats.feedback_summary.positive}</p>
                                  <p className="text-xs text-muted-foreground">Positive</p>
                                </div>
                                <div>
                                  <div className="flex items-center justify-center gap-1 mb-1">
                                    <ThumbsDown className="h-4 w-4 text-red-500" />
                                  </div>
                                  <p className="text-2xl font-bold text-red-500">{stats.feedback_summary.negative}</p>
                                  <p className="text-xs text-muted-foreground">Negative</p>
                                </div>
                                <div>
                                  <p className="text-2xl font-bold text-primary mt-5">
                                    {Math.round((stats.feedback_summary.positive / stats.feedback_summary.total) * 100)}%
                                  </p>
                                  <p className="text-xs text-muted-foreground">Satisfaction</p>
                                </div>
                              </div>
                              {/* Satisfaction bar */}
                              <div className="h-3 bg-red-100 dark:bg-red-900/30 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full transition-all"
                                  style={{
                                    width: `${(stats.feedback_summary.positive / stats.feedback_summary.total) * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">No feedback data yet</p>
                          )}

                          {/* Response time stats */}
                          {stats.response_time && stats.response_time.sample_count > 0 && (
                            <div className="mt-6 pt-4 border-t border-border">
                              <div className="flex items-center gap-2 mb-3">
                                <Zap className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Response Time</span>
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-center">
                                <div>
                                  <p className="text-lg font-bold">{(stats.response_time.avg_ms / 1000).toFixed(1)}s</p>
                                  <p className="text-xs text-muted-foreground">Average</p>
                                </div>
                                <div>
                                  <p className="text-lg font-bold text-green-500">{(stats.response_time.min_ms / 1000).toFixed(1)}s</p>
                                  <p className="text-xs text-muted-foreground">Fastest</p>
                                </div>
                                <div>
                                  <p className="text-lg font-bold text-orange-500">{(stats.response_time.max_ms / 1000).toFixed(1)}s</p>
                                  <p className="text-xs text-muted-foreground">Slowest</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    {/* Completed Workflows */}
                    {stats.completed_workflows && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5" />
                            Completed Workflows
                          </CardTitle>
                          <CardDescription>
                            Agentic task completion tracking — conversations with at least one completed assistant response
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-center">
                            <div className="p-3 rounded-lg bg-green-500/10">
                              <p className="text-2xl font-bold text-green-500">{stats.completed_workflows.total}</p>
                              <p className="text-xs text-muted-foreground">Completed</p>
                            </div>
                            <div className="p-3 rounded-lg bg-blue-500/10">
                              <p className="text-2xl font-bold text-blue-500">{stats.completed_workflows.today}</p>
                              <p className="text-xs text-muted-foreground">Today</p>
                            </div>
                            <div className="p-3 rounded-lg bg-orange-500/10">
                              <div className="flex items-center justify-center gap-1">
                                <AlertCircle className="h-4 w-4 text-orange-500" />
                              </div>
                              <p className="text-2xl font-bold text-orange-500">{stats.completed_workflows.interrupted}</p>
                              <p className="text-xs text-muted-foreground">Interrupted</p>
                            </div>
                            <div className="p-3 rounded-lg bg-primary/10">
                              <p className="text-2xl font-bold text-primary">{stats.completed_workflows.completion_rate}%</p>
                              <p className="text-xs text-muted-foreground">Completion Rate</p>
                            </div>
                            <div className="p-3 rounded-lg bg-purple-500/10">
                              <p className="text-2xl font-bold text-purple-500">{stats.completed_workflows.avg_messages_per_workflow}</p>
                              <p className="text-xs text-muted-foreground">Avg Msgs/Workflow</p>
                            </div>
                          </div>
                          {/* Completion rate bar */}
                          {(stats.completed_workflows.total + stats.completed_workflows.interrupted) > 0 && (
                            <div className="mt-4">
                              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>Completion Rate</span>
                                <span>{stats.completed_workflows.completion_rate}%</span>
                              </div>
                              <div className="h-2.5 bg-orange-100 dark:bg-orange-900/20 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full transition-all"
                                  style={{
                                    width: `${stats.completed_workflows.completion_rate}%`,
                                  }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                <span>{stats.completed_workflows.total} completed</span>
                                <span>{stats.completed_workflows.interrupted} interrupted</span>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Hourly Activity Heatmap */}
                    {stats.hourly_heatmap && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Activity by Hour ({rangeLabel})
                          </CardTitle>
                          <CardDescription>Message volume distribution across hours of the day (UTC, {rangeLabel})</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-end gap-1 h-32">
                            {stats.hourly_heatmap.map((h) => {
                              const maxCount = Math.max(...stats.hourly_heatmap.map((x) => x.count), 1);
                              const pct = (h.count / maxCount) * 100;
                              const isPeak = h.count === maxCount && h.count > 0;
                              return (
                                <div
                                  key={h.hour}
                                  className="flex-1 flex flex-col items-center gap-1"
                                  title={`${h.hour}:00 — ${h.count} messages`}
                                >
                                  <div
                                    className={`w-full rounded-t transition-all ${
                                      isPeak ? 'bg-primary' : h.count > 0 ? 'bg-primary/50' : 'bg-muted'
                                    }`}
                                    style={{ height: `${Math.max(pct, 2)}%` }}
                                  />
                                  <span className="text-[9px] text-muted-foreground">{h.hour}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                            <span>12am</span>
                            <span>6am</span>
                            <span>12pm</span>
                            <span>6pm</span>
                            <span>11pm</span>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {/* Checkpoint Persistence */}
                    <CheckpointStatsSection range={statsRange} onRangeChange={setStatsRange} />
                  </>
                )}
              </TabsContent>

              {/* Agent Metrics Tab (Prometheus) */}
              <TabsContent value="metrics" className="space-y-4">
                <MetricsTab />
              </TabsContent>

              {/* System Health Tab (live Prometheus + static services) */}
              <TabsContent value="health" className="space-y-4">
                <HealthTab />
              </TabsContent>

              {/* Audit Logs Tab (optional, gated by AUDIT_LOGS_ENABLED + full admin role) */}
              {auditLogsEnabled && isAdmin && (
                <TabsContent value="audit-logs" className="space-y-4">
                  <AuditLogsTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              {/* Policy Tab (admin only) */}
              {isAdmin && (
                <TabsContent value="policy" className="space-y-4">
                  <PolicyTab isAdmin={isAdmin} />
                </TabsContent>
              )}
            </Tabs>
          </div>
        </ScrollArea>

      {/* Create Team Dialog */}
      <CreateTeamDialog
        open={createTeamDialogOpen}
        onOpenChange={setCreateTeamDialogOpen}
        onSuccess={loadAdminData}
      />

      {/* Team Details / Member Management Dialog */}
      <TeamDetailsDialog
        team={selectedTeam}
        mode={teamDialogMode}
        open={teamDetailsOpen}
        onOpenChange={setTeamDetailsOpen}
        onTeamUpdated={loadAdminData}
      />
    </div>
  );
}

export default function Admin() {
  return (
    <AuthGuard>
      <AdminPage />
    </AuthGuard>
  );
}

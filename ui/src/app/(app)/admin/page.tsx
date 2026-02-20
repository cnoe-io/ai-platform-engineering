"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Users, MessageSquare, TrendingUp, Activity, Database, Share2, ShieldCheck, ShieldOff, UserPlus, Trash2, UsersIcon, Loader2, Bot, ThumbsUp, ThumbsDown, Clock, Zap, CheckCircle2, AlertCircle, Layers } from "lucide-react";
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

function AdminPage() {
  const { status } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [skillStats, setSkillStats] = useState<SkillMetricsAdmin | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [createTeamDialogOpen, setCreateTeamDialogOpen] = useState(false);
  const [teamDetailsOpen, setTeamDetailsOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamType | null>(null);
  const [teamDialogMode, setTeamDialogMode] = useState<"details" | "members">("details");
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch admin data once the user is authenticated
    if (status === "authenticated") {
      loadAdminData();
    }
  }, [status]);

  const loadAdminData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch stats, users, teams, and skill metrics in parallel
      const [statsRes, usersRes, teamsRes, skillStatsRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users'),
        fetch('/api/admin/teams').catch(() => null),
        fetch('/api/admin/stats/skills').catch(() => null),
      ]);

      // Check for auth errors first (401/403)
      if (statsRes.status === 401 || usersRes.status === 401) {
        setError('Not authenticated. Please sign in via SSO first.');
        setLoading(false);
        return;
      }
      if (statsRes.status === 403 || usersRes.status === 403) {
        setError('Admin access required. Your account must be a member of the OIDC admin group.');
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
    } catch (err: any) {
      console.error('[Admin] Failed to load data:', err);
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
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
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
              <p className="text-muted-foreground">
                Manage users, teams, monitor usage, and track platform metrics
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
              <TabsList className="grid w-full grid-cols-5">
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
              </TabsList>

              {/* User Management Tab */}
              <TabsContent value="users" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>Manage user access, roles, and view activity</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="grid grid-cols-6 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                        <div>Email</div>
                        <div>Name</div>
                        <div>Role</div>
                        <div>Activity</div>
                        <div>Stats</div>
                        <div className="text-right">Actions</div>
                      </div>
                      {users.map((user) => (
                        <div key={user.email} className="grid grid-cols-6 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center">
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
                      <CardDescription>Create and manage teams for collaboration and conversation sharing</CardDescription>
                    </div>
                    <Button className="gap-2" onClick={() => setCreateTeamDialogOpen(true)}>
                      <UserPlus className="h-4 w-4" />
                      Create Team
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {teams.length === 0 ? (
                      <div className="text-center py-12">
                        <UsersIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No Teams Yet</h3>
                        <p className="text-muted-foreground mb-4">
                          Create teams to enable collaboration and conversation sharing
                        </p>
                        <Button className="gap-2" onClick={() => setCreateTeamDialogOpen(true)}>
                          <UserPlus className="h-4 w-4" />
                          Create Your First Team
                        </Button>
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
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => openTeamDialog(team, "members")}
                                  >
                                    Manage Members
                                  </Button>
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
              </TabsContent>

              {/* Usage Statistics Tab */}
              <TabsContent value="stats" className="space-y-4">
                {stats && (
                  <>
                    {/* DAU and MAU Trend Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Daily Active Users (DAU)</CardTitle>
                          <CardDescription>Active users per day over the last 30 days</CardDescription>
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
                        <CardTitle>Message Activity (Last 30 Days)</CardTitle>
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
                            Activity by Hour (Last 30 Days)
                          </CardTitle>
                          <CardDescription>Message volume distribution across hours of the day (UTC)</CardDescription>
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

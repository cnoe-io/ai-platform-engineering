"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, MessageSquare, TrendingUp, Activity, Database, Share2, ShieldCheck, ShieldOff, UserPlus, Trash2, UsersIcon, Loader2 } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { SimpleLineChart } from "@/components/admin/SimpleLineChart";
import { CreateTeamDialog } from "@/components/admin/CreateTeamDialog";
import { apiClient } from "@/lib/api-client";

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
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [createTeamDialogOpen, setCreateTeamDialogOpen] = useState(false);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch stats, users, and teams in parallel
      const [statsResponse, usersResponse, teamsResponse] = await Promise.all([
        fetch('/api/admin/stats').then(r => r.json()),
        fetch('/api/admin/users').then(r => r.json()),
        fetch('/api/admin/teams').then(r => r.json()).catch(() => ({ success: true, data: { teams: [] } })),
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
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="users" className="gap-2">
                  <Users className="h-4 w-4" />
                  Users
                </TabsTrigger>
                <TabsTrigger value="teams" className="gap-2">
                  <UsersIcon className="h-4 w-4" />
                  Teams
                </TabsTrigger>
                <TabsTrigger value="stats" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Statistics
                </TabsTrigger>
                <TabsTrigger value="health" className="gap-2">
                  <Database className="h-4 w-4" />
                  System Health
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
                                <Button variant="ghost" size="sm" className="text-destructive">
                                  <Trash2 className="h-4 w-4" />
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
                                  <Button size="sm" variant="outline" className="flex-1">
                                    Manage Members
                                  </Button>
                                  <Button size="sm" variant="outline" className="flex-1">
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
                            {stats.top_users.by_conversations.map((u, i) => (
                              <div key={u._id} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                                  <div className="text-sm">{u._id}</div>
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
                            {stats.top_users.by_messages.map((u, i) => (
                              <div key={u._id} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                                  <div className="text-sm">{u._id}</div>
                                </div>
                                <div className="text-sm font-medium">{u.count} messages</div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* System Health Tab */}
              <TabsContent value="health" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>System Health</CardTitle>
                    <CardDescription>Monitor system status and performance</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">MongoDB Status</p>
                          <p className="text-xs text-muted-foreground">Database connection</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500"></div>
                          <span className="text-sm">Connected</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Authentication</p>
                          <p className="text-xs text-muted-foreground">OIDC SSO</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500"></div>
                          <span className="text-sm">Active</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">RAG Server</p>
                          <p className="text-xs text-muted-foreground">Knowledge base operations</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500"></div>
                          <span className="text-sm">Operational</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

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
    </div>
  );
}

export default function Admin() {
  return <AdminPage />;
}

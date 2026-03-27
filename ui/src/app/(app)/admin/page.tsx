"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Users, MessageSquare, TrendingUp, Activity, Database, Share2, ShieldCheck, ShieldOff, UserPlus, Trash2, UsersIcon, Loader2, Bot, ThumbsUp, ThumbsDown, Clock, Zap, CheckCircle2, AlertCircle, Layers, Eye, Star, Filter, ExternalLink, Plus, Calendar, X, FileText, Shield, HelpCircle, Globe, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { MultiSelect, TagInput } from "@/components/ui/multi-select";
import { SimpleLineChart } from "@/components/admin/SimpleLineChart";
import { MetricsTab } from "@/components/admin/MetricsTab";
import { HealthTab } from "@/components/admin/HealthTab";
import {
  VisibilityBreakdown,
  CategoryBreakdown,
  RunStatsTable,
  TopCreatorsCard,
} from "@/components/admin/SkillMetricsCards";
import { CreateTeamDialog } from "@/components/admin/CreateTeamDialog";
import { TeamDetailsDialog } from "@/components/admin/TeamDetailsDialog";
import { AuditLogsTab } from "@/components/admin/AuditLogsTab";
import { UnifiedAuditTab } from "@/components/admin/UnifiedAuditTab";
import { PolicyTab } from "@/components/admin/PolicyTab";
import { AgMcpPoliciesEditor } from "@/components/admin/AgMcpPoliciesEditor";
import { RolesAccessTab } from "@/components/admin/RolesAccessTab";
import { SlackUsersTab } from "@/components/admin/SlackUsersTab";
import { SlackChannelMappingTab } from "@/components/admin/SlackChannelMappingTab";
import { TeamKbAssignmentPanel } from "@/components/admin/TeamKbAssignmentPanel";
import { CheckpointStatsSection } from "@/components/admin/CheckpointStatsSection";
import { SlackStatsSection } from "@/components/admin/SlackStatsSection";
import { DateRangeFilter, type DateRangePreset, type DateRange, presetToRange } from "@/components/admin/DateRangeFilter";
import { SkillHubsSection } from "@/components/admin/SkillHubsSection";
import { UserDetailPanel } from "@/components/admin/UserDetailPanel";
import { SupervisorSkillsStatusSection } from "@/components/admin/SupervisorSkillsStatusSection";
import { UserManagementTab } from "@/components/admin/UserManagementTab";
import { UserDetailModal } from "@/components/admin/UserDetailModal";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useAdminTabGates } from "@/hooks/useAdminTabGates";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import type { Team as TeamType } from "@/types/teams";
import type { SkillMetricsAdmin } from "@/types/agent-skill";

interface AdminStats {
  platform_summary?: {
    satisfaction_rate: number;
    estimated_hours_automated: number;
  };
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
    satisfaction_rate?: number;
    by_source?: Record<string, { positive: number; negative: number }>;
    categories?: Array<{ category: string; count: number }>;
    daily?: Array<{ date: string; positive: number; negative: number }>;
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
  slack?: {
    channels: { total: number; qanda_enabled: number; alerts_enabled: number; ai_enabled: number };
    total_interactions: number;
    unique_users: number;
    resolution: {
      total_threads: number;
      resolved_threads: number;
      resolution_rate: number;
      estimated_hours_saved: number;
    };
    daily: Array<{ date: string; interactions: number; unique_users: number; resolved: number; escalated: number }>;
    top_channels: Array<{ channel_name: string; interactions: number; resolved: number; resolution_rate: number }>;
  };
}

interface FeedbackEntry {
  message_id: string;
  conversation_id?: string;
  conversation_title?: string;
  source?: 'web' | 'slack';
  channel_name?: string | null;
  content_snippet?: string;
  role?: string;
  rating: 'positive' | 'negative';
  reason?: string;
  submitted_by: string;
  submitted_at: string;
  trace_id?: string | null;
  slack_permalink?: string | null;
}

interface FeedbackData {
  entries: FeedbackEntry[];
  channels?: string[];
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

const VALID_TABS = ['users', 'teams', 'stats', 'skills', 'feedback', 'nps', 'metrics', 'health', 'policy', 'audit-logs', 'action-audit', 'roles', 'slack', 'ag-policies'] as const;

type CategoryKey = 'people' | 'insights' | 'platform' | 'security';

interface Category {
  key: CategoryKey;
  label: string;
  icon: LucideIcon;
  tabs: Array<{
    value: string;
    label: string;
    icon: LucideIcon;
    gateKey: string;
  }>;
}

const CATEGORIES: Category[] = [
  {
    key: 'people',
    label: 'People & Access',
    icon: Users,
    tabs: [
      { value: 'users', label: 'Users', icon: Users, gateKey: 'users' },
      { value: 'teams', label: 'Teams', icon: UsersIcon, gateKey: 'teams' },
      { value: 'roles', label: 'Roles', icon: Shield, gateKey: 'roles' },
      { value: 'slack', label: 'Slack', icon: MessageSquare, gateKey: 'slack' },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    icon: TrendingUp,
    tabs: [
      { value: 'skills', label: 'Skills', icon: Layers, gateKey: 'skills' },
      { value: 'feedback', label: 'Feedback', icon: ThumbsUp, gateKey: 'feedback' },
      { value: 'nps', label: 'NPS', icon: Star, gateKey: 'nps' },
      { value: 'stats', label: 'Statistics', icon: TrendingUp, gateKey: 'stats' },
    ],
  },
  {
    key: 'platform',
    label: 'Platform',
    icon: Activity,
    tabs: [
      { value: 'metrics', label: 'Metrics', icon: Activity, gateKey: 'metrics' },
      { value: 'health', label: 'Health', icon: Database, gateKey: 'health' },
    ],
  },
  {
    key: 'security',
    label: 'Security & Policy',
    icon: Shield,
    tabs: [
      { value: 'audit-logs', label: 'Audits', icon: FileText, gateKey: 'audit_logs' },
      { value: 'action-audit', label: 'Action Audit', icon: Shield, gateKey: 'action_audit' },
      { value: 'policy', label: 'Policy', icon: Shield, gateKey: 'policy' },
      { value: 'ag-policies', label: 'AG MCP Policies', icon: Shield, gateKey: 'ag_policies' },
    ],
  },
];

function categoryForTab(tab: string): CategoryKey {
  for (const cat of CATEGORIES) {
    if (cat.tabs.some((t) => t.value === tab)) return cat.key;
  }
  return 'people';
}

function AdminPage() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin } = useAdminRole();
  const { gates, loading: gatesLoading } = useAdminTabGates();
  const auditLogsEnabled = getConfig('auditLogsEnabled');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [globalOverview, setGlobalOverview] = useState<AdminStats['overview'] | null>(null);
  const [skillStats, setSkillStats] = useState<SkillMetricsAdmin | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>(
    initialTab && (VALID_TABS as readonly string[]).includes(initialTab) ? initialTab : 'users'
  );
  const initialCat = searchParams.get('cat') as CategoryKey | null;
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(
    initialCat && CATEGORIES.some((c) => c.key === initialCat)
      ? initialCat
      : categoryForTab(activeTab)
  );

  const visibleCategories = useMemo(
    () =>
      CATEGORIES.filter((cat) =>
        cat.tabs.some((t) => (gates as Record<string, boolean>)[t.gateKey])
      ),
    [gates]
  );

  const visibleTabsForCategory = useMemo(
    () =>
      (CATEGORIES.find((c) => c.key === activeCategory)?.tabs ?? []).filter(
        (t) => (gates as Record<string, boolean>)[t.gateKey]
      ),
    [activeCategory, gates]
  );

  const handleCategoryChange = useCallback(
    (catKey: CategoryKey) => {
      setActiveCategory(catKey);
      const cat = CATEGORIES.find((c) => c.key === catKey);
      if (!cat) return;
      const firstVisible = cat.tabs.find(
        (t) => (gates as Record<string, boolean>)[t.gateKey]
      );
      if (firstVisible) {
        setActiveTab(firstVisible.value);
        const params = new URLSearchParams(searchParams.toString());
        params.set('cat', catKey);
        params.set('tab', firstVisible.value);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    },
    [gates, searchParams, router, pathname]
  );
  const [createTeamDialogOpen, setCreateTeamDialogOpen] = useState(false);
  const [teamDetailsOpen, setTeamDetailsOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamType | null>(null);
  const [teamDialogMode, setTeamDialogMode] = useState<"details" | "members">("details");
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  // ── Shared filters (source, users, date range) across feedback + stats tabs ──
  const initSource = searchParams.get('source') as 'all' | 'web' | 'slack' | null;
  const initUsers = searchParams.get('users');
  const initDatePreset = searchParams.get('dateRange') as DateRangePreset | null;
  const initFrom = searchParams.get('from');
  const initTo = searchParams.get('to');

  const [sourceFilter, setSourceFilter] = useState<'all' | 'web' | 'slack'>(
    initSource && ['all', 'web', 'slack'].includes(initSource) ? initSource : 'all'
  );
  const [userFilter, setUserFilter] = useState<string[]>(
    initUsers ? initUsers.split(',').filter(Boolean) : []
  );
  const [datePreset, setDatePreset] = useState<DateRangePreset>(
    initDatePreset && ['1h', '12h', '24h', '7d', '30d', '90d', 'custom'].includes(initDatePreset) ? initDatePreset : '30d'
  );
  const [dateRange, setDateRange] = useState<DateRange>(
    initFrom ? { from: initFrom, to: initTo || new Date().toISOString() } : presetToRange(initDatePreset || '30d')
  );

  // Helper to sync shared filters to URL
  const updateSharedFilterUrl = (overrides: Record<string, string | null> = {}) => {
    const params = new URLSearchParams(searchParams.toString());
    const shared: Record<string, string | null> = {
      source: sourceFilter !== 'all' ? sourceFilter : null,
      users: userFilter.length > 0 ? userFilter.join(',') : null,
      dateRange: datePreset !== '30d' ? datePreset : null,
      from: datePreset === 'custom' ? dateRange.from : null,
      to: datePreset === 'custom' ? dateRange.to : null,
      ...overrides,
    };
    for (const [key, val] of Object.entries(shared)) {
      if (val) { params.set(key, val); } else { params.delete(key); }
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // ── Feedback-only filters ──
  const initRating = searchParams.get('rating') as 'all' | 'positive' | 'negative' | null;
  const initChannels = searchParams.get('channels');
  const initSearch = searchParams.get('search');

  const [feedbackData, setFeedbackData] = useState<FeedbackData | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'positive' | 'negative'>(
    initRating && ['all', 'positive', 'negative'].includes(initRating) ? initRating : 'all'
  );
  const [feedbackChannelFilter, setFeedbackChannelFilter] = useState<string[]>(
    initChannels ? initChannels.split(',').filter(Boolean) : []
  );
  const [feedbackChannels, setFeedbackChannels] = useState<string[]>([]);
  const [feedbackSearchTags, setFeedbackSearchTags] = useState<string[]>(
    initSearch ? initSearch.split(',').filter(Boolean) : []
  );
  const [feedbackUsers, setFeedbackUsers] = useState<string[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Sync feedback-only filters to URL
  const updateFeedbackUrl = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    const defaults: Record<string, string | null> = {
      tab: activeTab,
      rating: feedbackFilter !== 'all' ? feedbackFilter : null,
      channels: feedbackChannelFilter.length > 0 ? feedbackChannelFilter.join(',') : null,
      search: feedbackSearchTags.length > 0 ? feedbackSearchTags.join(',') : null,
    };
    const merged = { ...defaults, ...overrides };
    for (const [key, val] of Object.entries(merged)) {
      if (val) { params.set(key, val); } else { params.delete(key); }
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
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
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const rangeLabel = datePreset === "1h" ? "1 Hour" : datePreset === "12h" ? "12 Hours" : datePreset === "24h" ? "24 Hours" : datePreset === "7d" ? "7 Days" : datePreset === "90d" ? "90 Days" : datePreset === "custom" ? "Custom Range" : "30 Days";
  const [slackSubTab, setSlackSubTab] = useState<"slack-users" | "slack-channels">("slack-users");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch admin data when authenticated or when SSO is disabled (local dev)
    if (status === "authenticated" || !getConfig('ssoEnabled')) {
      loadAdminData();
    }
  }, [status]);

  // Expand team: prefixed selections to member emails
  const expandStatsUsers = (selected: string[]): string[] => {
    const emails = new Set<string>();
    for (const s of selected) {
      if (s.startsWith('team:')) {
        const team = teams.find((t) => t.name === s.slice(5));
        if (team) team.members.forEach((m) => emails.add(m.user_id));
      } else {
        emails.add(s);
      }
    }
    return [...emails];
  };

  // Re-fetch stats when filters change (lightweight — only refetch stats endpoint)
  const statsFilterRef = React.useRef({ range: dateRange, source: sourceFilter, users: userFilter });
  const fetchStatsWithFilters = async (range?: DateRange, source?: 'all' | 'web' | 'slack', userEmails?: string[]) => {
    if (status !== "authenticated" && getConfig('ssoEnabled')) return;
    setStatsRefreshing(true);
    try {
      const r = range ?? dateRange;
      const s = source ?? sourceFilter;
      const u = userEmails ?? expandStatsUsers(userFilter);
      const params = new URLSearchParams({ from: r.from, to: r.to });
      if (s !== 'all') params.set('source', s);
      if (u.length > 0) params.set('user', u.join(','));
      const res = await fetch(`/api/admin/stats?${params}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setStats(json.data);
      }
    } catch {
      // keep existing stats on failure
    } finally {
      setStatsRefreshing(false);
    }
  };
  useEffect(() => {
    const current = { range: dateRange, source: sourceFilter, users: userFilter };
    if (statsFilterRef.current.range === current.range
      && statsFilterRef.current.source === current.source
      && statsFilterRef.current.users === current.users) return; // skip initial
    statsFilterRef.current = current;
    fetchStatsWithFilters();
  }, [dateRange, sourceFilter, userFilter, status]);

  const loadAdminData = async () => {
    setLoading(true);
    setError(null);

    try {
      const feedbackOn = getConfig('feedbackEnabled');
      const npsOn = getConfig('npsEnabled');
      // Fetch stats, users, teams, skill metrics, feedback, and NPS in parallel
      // Always fetch unfiltered stats for the global overview cards
      const hasStatsFilters = sourceFilter !== 'all' || userFilter.length > 0;
      const [statsRes, globalStatsRes, usersRes, teamsRes, skillStatsRes, feedbackRes, npsRes] = await Promise.all([
        (() => {
          const p = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
          if (sourceFilter !== 'all') p.set('source', sourceFilter);
          if (userFilter.length > 0) p.set('user', userFilter.join(','));
          return fetch(`/api/admin/stats?${p}`);
        })(),
        hasStatsFilters ? fetch('/api/admin/stats') : null,
        fetch('/api/admin/users'),
        fetch('/api/admin/teams').catch(() => null),
        fetch('/api/admin/stats/skills').catch(() => null),
        feedbackOn ? fetch('/api/admin/feedback').catch(() => null) : null,
        npsOn ? fetch('/api/admin/nps').catch(() => null) : null,
      ]);

      if (statsRes.status === 401) {
        setError('Not authenticated. Please sign in via SSO first.');
        setLoading(false);
        return;
      }

      if (statsRes.status === 403) {
        setError('Access denied. Try signing out and back in to refresh your session.');
        setLoading(false);
        return;
      }

      const [statsResponse, globalStatsResponse, usersResponse, teamsResponse] = await Promise.all([
        statsRes.json(),
        globalStatsRes ? globalStatsRes.json().catch(() => null) : null,
        usersRes.json(),
        teamsRes ? teamsRes.json().catch(() => ({ success: true, data: { teams: [] } })) : { success: true, data: { teams: [] } },
      ]);

      if (statsResponse.success) {
        setStats(statsResponse.data);
        // Use unfiltered response for global overview, or the main response if no filters were applied
        const overviewData = globalStatsResponse?.success ? globalStatsResponse.data.overview : statsResponse.data.overview;
        setGlobalOverview(overviewData);
      } else {
        throw new Error(statsResponse.error || 'Failed to load stats');
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
          if (feedbackResponse.data.channels) setFeedbackChannels(feedbackResponse.data.channels);
          if (feedbackResponse.data.users) setFeedbackUsers(feedbackResponse.data.users);
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

  const loadFeedback = async (
    rating?: 'positive' | 'negative' | 'all',
    page = 1,
    source?: 'all' | 'web' | 'slack',
    channels?: string[],
    searchTags?: string[],
    users?: string[],
    range?: DateRange,
  ) => {
    setFeedbackLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (rating && rating !== 'all') params.set('rating', rating);
      const src = source ?? sourceFilter;
      if (src !== 'all') params.set('source', src);
      const chs = channels ?? feedbackChannelFilter;
      if (src === 'slack' && chs.length > 0) {
        params.set('channel', chs.join(','));
      }
      const tags = searchTags ?? feedbackSearchTags;
      if (tags.length > 0) params.set('search', tags.join(','));
      const usrs = users ?? userFilter;
      if (usrs.length > 0) params.set('user', usrs.join(','));
      const dr = range ?? dateRange;
      if (dr.from) params.set('from', dr.from);
      if (dr.to) params.set('to', dr.to);
      const res = await fetch(`/api/admin/feedback?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setFeedbackData(data.data);
          if (data.data.channels) setFeedbackChannels(data.data.channels);
          if (data.data.users) setFeedbackUsers(data.data.users);
        }
      }
    } catch (err) {
      console.error('[Admin] Failed to load feedback:', err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleFeedbackFilterChange = (filter: 'all' | 'positive' | 'negative') => {
    setFeedbackFilter(filter);
    loadFeedback(filter, 1);
    updateFeedbackUrl({ rating: filter !== 'all' ? filter : null });
  };

  const handleFeedbackSourceChange = (source: 'all' | 'web' | 'slack') => {
    setSourceFilter(source);
    setFeedbackChannelFilter([]);
    loadFeedback(feedbackFilter, 1, source, [], undefined, undefined);
    updateSharedFilterUrl({ source: source !== 'all' ? source : null });
    updateFeedbackUrl({ channels: null });
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

            {/* Overview Stats — always shows unfiltered global totals */}
            {globalOverview && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{globalOverview.total_users}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      DAU: {globalOverview.dau} | MAU: {globalOverview.mau}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Conversations</CardTitle>
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{globalOverview.total_conversations}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Today: +{globalOverview.conversations_today}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Messages</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{globalOverview.total_messages}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Today: +{globalOverview.messages_today}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Shared (Web)</CardTitle>
                    <Share2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{globalOverview.shared_conversations}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {globalOverview.total_conversations > 0 ? ((globalOverview.shared_conversations / globalOverview.total_conversations) * 100).toFixed(1) : '0.0'}% of all conversations
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tabbed Content */}
            <Tabs value={activeTab} onValueChange={(tab) => {
              setActiveTab(tab);
              setActiveCategory(categoryForTab(tab));
              const params = new URLSearchParams(searchParams.toString());
              params.set('cat', categoryForTab(tab));
              params.set('tab', tab);
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }} className="space-y-4">
              {/* Category selector */}
              <div className="flex flex-wrap gap-1.5">
                {visibleCategories.map((cat) => {
                  const Icon = cat.icon;
                  const isActive = activeCategory === cat.key;
                  return (
                    <button
                      key={cat.key}
                      onClick={() => handleCategoryChange(cat.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {/* Filtered sub-tabs for the active category */}
              <TabsList className="flex w-full justify-start gap-0">
                {visibleTabsForCategory.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger key={t.value} value={t.value} className="gap-1.5 shrink-0">
                      <Icon className="h-4 w-4" />
                      {t.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {/* User Management Tab */}
              <TabsContent value="users" className="space-y-4">
                <UserManagementTab onSelectUser={(id) => setSelectedUserId(id)} />
                {selectedUserId && (
                  <UserDetailModal
                    userId={selectedUserId}
                    onClose={() => setSelectedUserId(null)}
                    onSaved={() => {}}
                  />
                )}
              </TabsContent>

              {/* Team Management Tab */}
              <TabsContent value="teams" className="space-y-4">
                {isAdmin && (
                  <div className="flex justify-end">
                    <Button className="gap-2" onClick={() => setCreateTeamDialogOpen(true)}>
                      <UserPlus className="h-4 w-4" />
                      Create Team
                    </Button>
                  </div>
                )}
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                              <span className="text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(team.owner_id)}>{team.owner_id}</span>
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
                            <div className="mt-4">
                              <TeamKbAssignmentPanel
                                teamId={team._id}
                                teamName={team.name}
                                isAdmin={isAdmin}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
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

                    {/* Top Creators */}
                    <TopCreatorsCard creators={skillStats.top_creators} onUserClick={setSelectedUserEmail} />

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

                {/* Supervisor skills + Skill Hubs */}
                <SupervisorSkillsStatusSection isAdmin={isAdmin} />
                <SkillHubsSection isAdmin={isAdmin} />
              </TabsContent>

              {/* Feedback Tab */}
              {getConfig('feedbackEnabled') && <TabsContent value="feedback" className="space-y-4">
                {/* Filters */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
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
                    <div className="h-5 w-px bg-border" />
                    <select
                      value={sourceFilter}
                      onChange={(e) => handleFeedbackSourceChange(e.target.value as 'all' | 'web' | 'slack')}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="all">All Sources</option>
                      <option value="web">Web</option>
                      <option value="slack">Slack</option>
                    </select>
                    {sourceFilter === 'slack' && feedbackChannels.length > 0 && (
                      <>
                        <div className="h-5 w-px bg-border" />
                        <MultiSelect
                          options={feedbackChannels}
                          selected={feedbackChannelFilter}
                          onChange={(channels) => {
                            setFeedbackChannelFilter(channels);
                            loadFeedback(feedbackFilter, 1, sourceFilter, channels);
                            updateFeedbackUrl({ channels: channels.length > 0 ? channels.join(',') : null });
                          }}
                          placeholder="All Channels"
                          searchPlaceholder="Search channels..."
                          emptyLabel="No channels found"
                          badgeLabel="channels"
                        />
                      </>
                    )}
                    <div className="h-5 w-px bg-border" />
                    <TagInput
                      tags={feedbackSearchTags}
                      onChange={(tags) => {
                        setFeedbackSearchTags(tags);
                        loadFeedback(feedbackFilter, 1, undefined, undefined, tags);
                        updateFeedbackUrl({ search: tags.length > 0 ? tags.join(',') : null });
                      }}
                      placeholder="Search reasons..."
                      badgeLabel="filters"
                    />
                    {(feedbackUsers.length > 0 || teams.length > 0) && (
                      <>
                        <div className="h-5 w-px bg-border" />
                        <MultiSelect
                          options={[
                            ...teams.map((t) => `team:${t.name}`),
                            ...feedbackUsers,
                          ]}
                          selected={userFilter}
                          onChange={(selected) => {
                            setUserFilter(selected);
                            const emails = new Set<string>();
                            for (const s of selected) {
                              if (s.startsWith('team:')) {
                                const team = teams.find((t) => t.name === s.slice(5));
                                if (team) team.members.forEach((m) => emails.add(m.user_id));
                              } else {
                                emails.add(s);
                              }
                            }
                            const emailList = [...emails];
                            loadFeedback(feedbackFilter, 1, undefined, undefined, undefined, emailList);
                            updateSharedFilterUrl({ users: selected.length > 0 ? selected.join(',') : null });
                          }}
                          placeholder="All Users & Teams"
                          searchPlaceholder="Search users or teams..."
                          emptyLabel="No users found"
                          badgeLabel="selected"
                        />
                      </>
                    )}
                  </div>
                  <DateRangeFilter
                    value={datePreset}
                    customRange={datePreset === 'custom' ? dateRange : undefined}
                    onChange={(preset, range) => {
                      setDatePreset(preset);
                      setDateRange(range);
                      loadFeedback(feedbackFilter, 1, sourceFilter, feedbackChannelFilter.length > 0 ? feedbackChannelFilter : undefined, undefined, undefined, range);
                      updateSharedFilterUrl({
                        dateRange: preset !== '30d' ? preset : null,
                        from: preset === 'custom' ? range.from : null,
                        to: preset === 'custom' ? range.to : null,
                      });
                    }}
                  />
                </div>

                {/* Feedback entries */}
                {feedbackLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : feedbackData?.entries?.length > 0 ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-7 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                      <div>User</div>
                      <div>Source</div>
                      <div>Rating</div>
                      <div>Reason</div>
                      <div>Date</div>
                      <div className="col-span-2">Link</div>
                    </div>
                    {feedbackData.entries.map((entry, i) => (
                      <div key={`${entry.message_id}-${i}`} className="grid grid-cols-7 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center">
                        <div className="truncate text-xs text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(entry.submitted_by)}>{entry.submitted_by}</div>
                        <div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                            entry.source === 'slack'
                              ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          }`}>
                            {entry.source === 'slack' ? `Slack${entry.channel_name ? ` · ${entry.channel_name}` : ''}` : 'Web'}
                          </span>
                        </div>
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
                        <div
                          className="text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground"
                          title={entry.reason || undefined}
                          onClick={(e) => {
                            const el = e.currentTarget;
                            el.classList.toggle('truncate');
                            el.classList.toggle('whitespace-normal');
                          }}
                        >
                          {entry.reason || '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.submitted_at
                            ? new Date(entry.submitted_at).toLocaleDateString()
                            : '—'}
                        </div>
                        <div className="col-span-2">
                          {entry.slack_permalink ? (
                            <a
                              href={entry.slack_permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              title="View Slack thread"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Slack thread
                            </a>
                          ) : entry.conversation_id ? (
                            <a
                              href={`/chat/${entry.conversation_id}?from=feedback${entry.message_id ? `&message=${entry.message_id}` : ''}`}
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
                                : 'View chat'}
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
              </TabsContent>}

              {/* NPS Tab */}
              {gates.nps && <TabsContent value="nps" className="space-y-4">
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
                              <div className="truncate text-xs text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(resp.user_email)}>{resp.user_email}</div>
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
                {/* Stats Filters */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <select
                      value={sourceFilter}
                      onChange={(e) => {
                        const src = e.target.value as 'all' | 'web' | 'slack';
                        setSourceFilter(src);
                        fetchStatsWithFilters(undefined, src);
                        updateSharedFilterUrl({ source: src !== 'all' ? src : null });
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="all">All Sources</option>
                      <option value="web">Web</option>
                      <option value="slack">Slack</option>
                    </select>
                    <MultiSelect
                      options={[
                        ...teams.map((t) => `team:${t.name}`),
                        ...users.map((u) => u.email),
                      ]}
                      selected={userFilter}
                      onChange={(selected) => {
                        const emails = new Set<string>();
                        for (const s of selected) {
                          if (s.startsWith('team:')) {
                            const teamName = s.slice(5);
                            const team = teams.find((t) => t.name === teamName);
                            if (team) team.members.forEach((m) => emails.add(m.user_id));
                          } else {
                            emails.add(s);
                          }
                        }
                        const emailList = [...emails];
                        setUserFilter(selected);
                        fetchStatsWithFilters(undefined, undefined, emailList);
                        updateSharedFilterUrl({ users: selected.length > 0 ? selected.join(',') : null });
                      }}
                      placeholder="All Users & Teams"
                      searchPlaceholder="Search users or teams..."
                      emptyLabel="No users found"
                      badgeLabel="selected"
                    />
                    <DateRangeFilter
                      value={datePreset}
                      customRange={datePreset === 'custom' ? dateRange : undefined}
                      onChange={(preset, range) => {
                        setDatePreset(preset);
                        setDateRange(range);
                        fetchStatsWithFilters(range);
                        updateSharedFilterUrl({
                          dateRange: preset !== '30d' ? preset : null,
                          from: preset === 'custom' ? range.from : null,
                          to: preset === 'custom' ? range.to : null,
                        });
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={statsRefreshing}
                    onClick={() => fetchStatsWithFilters()}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", statsRefreshing && "animate-spin")} />
                    Refresh
                  </Button>
                </div>

                {stats && (
                  <>
                    {/* Platform Summary Cards */}
                    {stats.platform_summary && (
                      <div className="grid grid-cols-2 gap-4">
                        <Card>
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="flex items-center justify-center gap-1 mb-1">
                                <ThumbsUp className="h-4 w-4 text-green-500" />
                              </div>
                              <p className={`text-2xl font-bold ${
                                stats.platform_summary.satisfaction_rate >= 80 ? 'text-green-500' :
                                stats.platform_summary.satisfaction_rate >= 60 ? 'text-yellow-500' :
                                'text-red-500'
                              }`}>
                                {stats.platform_summary.satisfaction_rate}%
                              </p>
                              <p className="text-xs text-muted-foreground">Satisfaction Rate</p>
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="flex items-center justify-center gap-1 mb-1">
                                <Clock className="h-4 w-4 text-orange-500" />
                              </div>
                              <p className="text-2xl font-bold text-orange-500">
                                {stats.platform_summary.estimated_hours_automated}h
                              </p>
                              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                                Hours Automated (Estimated)
                                <span className="relative group">
                                  <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2 rounded bg-popover border border-border text-[10px] text-popover-foreground shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 text-left">
                                    This is an estimate based on:
                                    <ul className="list-disc pl-3 mt-1 space-y-0.5">
                                      <li>Slack thread interactions</li>
                                      <li>Agents used to automate tasks</li>
                                    </ul>
                                  </span>
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}

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
                                  <div className="text-sm truncate max-w-[200px] text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(u._id)}>{u._id}</div>
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
                                  <div className="text-sm truncate max-w-[200px] text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(u._id)}>{u._id}</div>
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
                          <CardDescription>User satisfaction across all platforms</CardDescription>
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
                                    {stats.feedback_summary.satisfaction_rate ?? Math.round((stats.feedback_summary.positive / stats.feedback_summary.total) * 100)}%
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

                              {/* Source breakdown */}
                              {stats.feedback_summary.by_source && Object.keys(stats.feedback_summary.by_source).length > 1 && (
                                <div className="mt-4 pt-3 border-t border-border">
                                  <p className="text-xs font-medium text-muted-foreground mb-2">By Source</p>
                                  <div className="grid grid-cols-2 gap-3">
                                    {Object.entries(stats.feedback_summary.by_source).map(([source, data]) => (
                                      <div key={source} className="text-center p-2 rounded-lg bg-muted/50">
                                        <p className="text-xs font-medium capitalize">{source}</p>
                                        <p className="text-sm">
                                          <span className="text-green-500">{data.positive}</span>
                                          {' / '}
                                          <span className="text-red-500">{data.negative}</span>
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Negative feedback categories */}
                              {stats.feedback_summary.categories && stats.feedback_summary.categories.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-border">
                                  <p className="text-xs font-medium text-muted-foreground mb-2">Negative Feedback Breakdown</p>
                                  <div className="space-y-2">
                                    {stats.feedback_summary.categories.slice(0, 5).map((cat) => {
                                      const maxCat = stats.feedback_summary.categories![0].count;
                                      const pct = maxCat > 0 ? (cat.count / maxCat) * 100 : 0;
                                      return (
                                        <div key={cat.category}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-xs capitalize">{cat.category.replace(/_/g, ' ')}</span>
                                            <span className="text-xs text-muted-foreground">{cat.count}</span>
                                          </div>
                                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">No feedback data yet</p>
                          )}

                        </CardContent>
                      </Card>
                    </div>

                    {/* Feedback Trend Chart */}
                    {stats.feedback_summary?.daily && stats.feedback_summary.daily.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Feedback Trend ({rangeLabel})</CardTitle>
                          <CardDescription>Daily positive vs negative feedback</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <SimpleLineChart
                            data={stats.feedback_summary.daily.map((day) => ({
                              label: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                              value: day.positive + day.negative,
                            }))}
                            height={180}
                            color="rgb(34, 197, 94)"
                          />
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
                          <div className="flex items-end gap-1" style={{ height: 128 }}>
                            {(() => {
                              const maxCount = Math.max(...stats.hourly_heatmap.map((x) => x.count), 1);
                              // Deep blue (low) → Green → Yellow (mid) → Orange → Red (high)
                              const heatColor = (ratio: number) => {
                                const stops = [
                                  [0,    30,  80, 220],  // deep blue
                                  [0.25, 34, 197, 94],   // green
                                  [0.5, 234, 179,   8],  // yellow
                                  [0.75,249, 115,  22],  // orange
                                  [1,   239,  68,  68],  // red
                                ];
                                let i = 0;
                                while (i < stops.length - 2 && ratio > stops[i + 1][0]) i++;
                                const [t0, r0, g0, b0] = stops[i];
                                const [t1, r1, g1, b1] = stops[i + 1];
                                const t = (ratio - t0) / (t1 - t0);
                                return `rgb(${Math.round(r0 + t * (r1 - r0))}, ${Math.round(g0 + t * (g1 - g0))}, ${Math.round(b0 + t * (b1 - b0))})`;
                              };
                              const currentHour = new Date().getUTCHours();
                              return stats.hourly_heatmap.map((h) => {
                                const ratio = h.count / maxCount;
                                const barHeight = Math.max(ratio * 100, 3);
                                const bg = h.count > 0 ? heatColor(ratio) : undefined;
                                const isCurrent = h.hour === currentHour;
                                return (
                                  <div
                                    key={h.hour}
                                    className="flex-1 flex flex-col items-center justify-end"
                                    style={{ height: 128 }}
                                    title={`${h.hour}:00 — ${h.count.toLocaleString()} messages${isCurrent ? ' (now)' : ''}`}
                                  >
                                    <div
                                      className={`w-full rounded-t transition-all ${h.count === 0 ? 'bg-muted' : ''}`}
                                      style={{
                                        height: `${barHeight}%`,
                                        backgroundColor: bg,
                                        ...(isCurrent ? { outline: '2px solid hsl(var(--foreground))', outlineOffset: -1, zIndex: 1 } : {}),
                                      }}
                                    />
                                  </div>
                                );
                              });
                            })()}
                          </div>
                          <div className="flex gap-1 mt-1">
                            {stats.hourly_heatmap.map((h) => {
                              const isCurrent = h.hour === new Date().getUTCHours();
                              return (
                                <div key={`lbl-${h.hour}`} className={`flex-1 text-center text-[9px] ${isCurrent ? 'text-foreground font-bold' : 'text-muted-foreground'}`}>
                                  {h.hour}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                            <span>12am</span>
                            <span>6am</span>
                            <span>12pm</span>
                            <span>6pm</span>
                            <span>11pm</span>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* ─── Web Section ─── */}
                    {(stats.response_time?.sample_count > 0 || stats.completed_workflows) && (
                      <>
                        <div className="flex items-center gap-2 pt-2">
                          <Globe className="h-5 w-5 text-muted-foreground" />
                          <h3 className="text-lg font-semibold">Web</h3>
                        </div>
                        <div className="h-px bg-border" />

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Response Time */}
                          {stats.response_time && stats.response_time.sample_count > 0 && (
                            <Card>
                              <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                  <Zap className="h-5 w-5" />
                                  Response Time
                                </CardTitle>
                                <CardDescription>AI response latency from web conversations</CardDescription>
                              </CardHeader>
                              <CardContent>
                                <div className="grid grid-cols-3 gap-4 text-center">
                                  <div>
                                    <p className="text-2xl font-bold">{(stats.response_time.avg_ms / 1000).toFixed(1)}s</p>
                                    <p className="text-xs text-muted-foreground">Average</p>
                                  </div>
                                  <div>
                                    <p className="text-2xl font-bold text-green-500">{(stats.response_time.min_ms / 1000).toFixed(1)}s</p>
                                    <p className="text-xs text-muted-foreground">Fastest</p>
                                  </div>
                                  <div>
                                    <p className="text-2xl font-bold text-orange-500">{(stats.response_time.max_ms / 1000).toFixed(1)}s</p>
                                    <p className="text-xs text-muted-foreground">Slowest</p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Completed Workflows */}
                          {stats.completed_workflows && (
                            <Card>
                              <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                  <CheckCircle2 className="h-5 w-5" />
                                  Completed Workflows
                                </CardTitle>
                                <CardDescription>Agentic task completion tracking</CardDescription>
                              </CardHeader>
                              <CardContent>
                                <div className="grid grid-cols-2 gap-3 text-center">
                                  <div className="p-2 rounded-lg bg-green-500/10">
                                    <p className="text-xl font-bold text-green-500">{stats.completed_workflows.total}</p>
                                    <p className="text-[10px] text-muted-foreground">Completed</p>
                                  </div>
                                  <div className="p-2 rounded-lg bg-orange-500/10">
                                    <p className="text-xl font-bold text-orange-500">{stats.completed_workflows.interrupted}</p>
                                    <p className="text-[10px] text-muted-foreground">Interrupted</p>
                                  </div>
                                  <div className="p-2 rounded-lg bg-primary/10">
                                    <p className="text-xl font-bold text-primary">{stats.completed_workflows.completion_rate}%</p>
                                    <p className="text-[10px] text-muted-foreground">Completion Rate</p>
                                  </div>
                                  <div className="p-2 rounded-lg bg-purple-500/10">
                                    <p className="text-xl font-bold text-purple-500">{stats.completed_workflows.avg_messages_per_workflow}</p>
                                    <p className="text-[10px] text-muted-foreground">Avg Msgs/Workflow</p>
                                  </div>
                                </div>
                                {(stats.completed_workflows.total + stats.completed_workflows.interrupted) > 0 && (
                                  <div className="mt-3">
                                    <div className="h-2 bg-orange-100 dark:bg-orange-900/20 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-green-500 rounded-full transition-all"
                                        style={{ width: `${stats.completed_workflows.completion_rate}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </>
                    )}

                    {/* ─── Slack Section ─── */}
                    {stats.slack && (
                      <SlackStatsSection slack={stats.slack} rangeLabel={rangeLabel} />
                    )}

                    {/* Checkpoint Persistence */}
                    <CheckpointStatsSection />
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

              {gates.audit_logs && (
                <TabsContent value="audit-logs" className="space-y-4">
                  <AuditLogsTab isAdmin={isAdmin} onUserClick={setSelectedUserEmail} />
                </TabsContent>
              )}

              {gates.action_audit && (
                <TabsContent value="action-audit" className="space-y-4">
                  <UnifiedAuditTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              <TabsContent value="policy" className="space-y-4">
                <PolicyTab isAdmin={isAdmin} />
              </TabsContent>

              <TabsContent value="ag-policies" className="space-y-4">
                <AgMcpPoliciesEditor isAdmin={isAdmin} />
              </TabsContent>

              <TabsContent value="roles" className="space-y-4">
                <RolesAccessTab isAdmin={isAdmin} />
              </TabsContent>

              <TabsContent value="slack" className="space-y-4">
                <Tabs value={slackSubTab} onValueChange={(v) => setSlackSubTab(v as "slack-users" | "slack-channels")} className="space-y-4">
                  <TabsList className="w-full sm:w-auto justify-start">
                    <TabsTrigger value="slack-users" className="gap-1.5">
                      <Users className="h-4 w-4" />
                      Slack users
                    </TabsTrigger>
                    <TabsTrigger value="slack-channels" className="gap-1.5">
                      <Layers className="h-4 w-4" />
                      Channel mappings
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="slack-users" className="mt-4">
                    <SlackUsersTab isAdmin={isAdmin} />
                  </TabsContent>
                  <TabsContent value="slack-channels" className="mt-4">
                    <SlackChannelMappingTab isAdmin={isAdmin} />
                  </TabsContent>
                </Tabs>
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

      {/* User Detail Sliding Panel */}
      <UserDetailPanel
        email={selectedUserEmail}
        onClose={() => setSelectedUserEmail(null)}
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

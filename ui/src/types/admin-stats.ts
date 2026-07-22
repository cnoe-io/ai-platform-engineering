export const ADMIN_STATS_SECTIONS = [
  'overview',
  'filters',
  'activity',
  'top_users',
  'top_agents',
  'feedback',
  'response_time',
  'hourly_heatmap',
  'completed_workflows',
  'slack',
] as const;

export type AdminStatsSection = typeof ADMIN_STATS_SECTIONS[number];

export type AdminStatsOwnerType = 'service_account' | 'slack_bot' | 'linked' | 'unlinked_slack';

export interface AdminSlackStats {
  channels: {
    total: number;
    qanda_enabled: number;
    alerts_enabled: number;
    ai_enabled: number;
  };
  total_interactions: number;
  unique_users: number;
  configured_channels?: number;
  configured_channels_daily?: Array<{
    date: string;
    total: number;
  }>;
  daily: Array<{
    date: string;
    interactions: number;
    unique_users: number;
    escalated: number;
  }>;
  top_channels: Array<{
    channel_name: string;
    interactions: number;
  }>;
}

export interface AdminStats {
  platform_summary: {
    satisfaction_rate: number;
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
    by_conversations: Array<{
      _id: string;
      count: number;
      name?: string;
      owner_type?: AdminStatsOwnerType;
    }>;
    by_messages: Array<{
      _id: string;
      count: number;
      name?: string;
      owner_type?: AdminStatsOwnerType;
    }>;
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
    samples?: Array<{ ts: string; latency_ms: number }>;
  };
  hourly_heatmap: Array<{ hour: number; count: number }>;
  completed_workflows: {
    total: number;
    today: number;
    failed: number;
    completion_rate: number;
    avg_steps_per_workflow: number;
  };
  slack: AdminSlackStats;
  available_channels: string[];
  available_agents: Array<{ id: string; name: string }>;
}

export type AdminStatsData = Partial<AdminStats>;

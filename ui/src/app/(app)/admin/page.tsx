"use client";

// assisted-by Codex Codex-sonnet-4-6

import {
CategoryBreakdown,
RunStatsTable,
TopCreatorsCard,
VisibilityBreakdown,
} from "@/components/admin/insights/SkillMetricsCards";
import { CheckpointStatsSection } from "@/components/admin/platform/CheckpointStatsSection";
import { CrawlConsoleDialog } from "@/components/admin/platform/CrawlConsoleDialog";
import { CrawlConsoleHeaderPill } from "@/components/admin/platform/CrawlConsoleHeaderPill";
import { HealthTab } from "@/components/admin/platform/HealthTab";
import { MetricsTab } from "@/components/admin/platform/MetricsTab";
import { SkillHubsSection } from "@/components/admin/platform/SkillHubsSection";
import { SlackStatsSection } from "@/components/admin/platform/SlackStatsSection";
import { CasInsightsTab } from "@/components/admin/CasInsightsTab";
import { PermissionsToolTab } from "@/components/admin/PermissionsToolTab";
import { RagTeamAccessPanel } from "@/components/admin/rebac/RagTeamAccessPanel";
import { SlackChannelRebacPanel } from "@/components/admin/rebac/SlackChannelRebacPanel";
import { WebexSpaceRebacPanel } from "@/components/admin/rebac/WebexSpaceRebacPanel";
import { AuditLogsTab } from "@/components/admin/security/AuditLogsTab";
import { KeycloakMigrationHealthPanel } from "@/components/admin/security/KeycloakMigrationHealthPanel";
import { MigrationTab } from "@/components/admin/security/MigrationTab";
import { OpenFgaRebacTab } from "@/components/admin/security/OpenFgaRebacTab";
import { UnifiedAuditTab } from "@/components/admin/security/UnifiedAuditTab";
import { PlatformSettingsTab } from "@/components/admin/settings/PlatformSettingsTab";
import { ReleaseNotesSettingsTab } from "@/components/admin/settings/ReleaseNotesSettingsTab";
import { ReviewConfigsTab } from "@/components/admin/settings/ReviewConfigsTab";
import { DateRangeFilter,presetToRange,type DateRange,type DateRangePreset } from "@/components/admin/shared/DateRangeFilter";
import { SimpleLineChart } from "@/components/admin/shared/SimpleLineChart";
import { CreateTeamDialog } from "@/components/admin/teams/CreateTeamDialog";
import { IdentitySyncPanel } from "@/components/admin/teams/IdentitySyncPanel";
import { TeamDetailsDialog,type DialogMode as TeamDialogMode } from "@/components/admin/teams/TeamDetailsDialog";
import { UserDetailModal } from "@/components/admin/teams/UserDetailModal";
import { ServiceAccountsTab } from "@/components/admin/ServiceAccountsTab";
import { UserDetailPanel } from "@/components/admin/teams/UserDetailPanel";
import { UserManagementTab } from "@/components/admin/teams/UserManagementTab";
import { AuthGuard } from "@/components/auth-guard";
import { AdminCredentialManagementPanel } from "@/components/credentials/AdminCredentialManagementPanel";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { MultiSelect,TagInput } from "@/components/ui/multi-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useAdminTabGates,type AdminTabGateSimulationTarget } from "@/hooks/useAdminTabGates";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import type { SkillMetricsAdmin } from "@/types/agent-skill";
import type { Team as TeamType } from "@/types/teams";
import { Activity,Bot,Bug,CheckCircle2,ChevronLeft,ChevronRight,Clock,Database,ExternalLink,Eye,FileText,Filter,Globe,Hash,HelpCircle,Layers,Loader2,MessageSquare,RefreshCw,Search,Settings,Share2,Shield,ShieldCheck,ThumbsDown,ThumbsUp,Trash2,TrendingUp,User,UserPlus,Users,UsersIcon,Wrench,X,Zap,type LucideIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import React,{ useCallback,useEffect,useMemo,useRef,useState } from "react";

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
    by_conversations: Array<{ _id: string; count: number; name?: string }>;
    by_messages: Array<{ _id: string; count: number; name?: string }>;
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
  available_channels?: string[];
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

interface Team {
  _id: string;
  name: string;
  slug?: string;
  description?: string;
  owner_id: string;
  created_at: Date;
  // Commit 5/8 of the canonical-team-membership refactor (spec
  // 2026-05-26-canonical-team-membership): `member_count` is now the
  // authoritative source for the Members badge, aggregated server-side
  // from `team_membership_sources`. `members[]` remains optional during
  // the migration window (commit 6/8 stops the dual write entirely)
  // and is no longer read by the page badge — only kept on the type
  // so older fixtures and dialog state shapes continue to compile.
  member_count?: number;
  // Server-decorated count of distinct KBs assigned to the team, sourced
  // from the canonical `team_kb_ownership` collection (see
  // GET /api/admin/teams). The legacy `resources.knowledge_bases` array on
  // the team document is almost always empty, so the team-card KBs badge
  // must prefer this field.
  kb_count?: number;
  // Distinct IdP membership source types (okta / oidc_claim / ...) present on
  // the team, server-decorated from team_membership_sources. Drives the
  // "synced from <IdP>" badge so synced teams are distinguishable from manual.
  idp_source_types?: string[];
  // Per-row management gate, server-decorated from OpenFGA. True for org/super
  // admins on every team and for team admins on the teams they own. Drives
  // the "Manage team" vs "View team" affordance on the team card so that team
  // admins (without admin_ui#view) still get the manage entry-point.
  can_manage?: boolean;
  members?: Array<{
    user_id: string;
    role: string;
    added_at: Date;
  }>;
  // Spec 104 — surfaced on the team card via StatChip counts. Optional
  // because legacy team docs may not have been migrated yet.
  resources?: {
    agents?: string[];
    agent_admins?: string[];
    tools?: string[];
    knowledge_bases?: string[];
    tool_wildcard?: boolean;
  };
  // Spec 098 US9 — denormalised channel count for the team-card StatChip.
  // Source of truth is `channel_team_mappings`, but we mirror a thin array
  // onto the team document so the card doesn't need an extra round-trip.
  slack_channels?: Array<{ slack_channel_id: string }>;
  webex_spaces?: Array<{ space_id: string; space_name?: string; workspace_id?: string }>;
}

interface SimulationUserOption {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

interface SimulationTeamOption {
  _id?: string;
  id?: string;
  slug?: string;
  name: string;
  description?: string;
}

const VALID_TABS = ['users', 'teams', 'identity-sync', 'stats', 'skills', 'feedback', 'metrics', 'health', 'cas-insights', 'credentials', 'audit-logs', 'action-audit', 'cas-permissions-tool', 'openfga', 'keycloak', 'migrations', 'ai-review', 'settings', 'slack', 'webex', 'rag-access', 'service-accounts'] as const;
const VALID_OPENFGA_SUBTABS = ['builder', 'explorer', 'graph', 'tuples', 'access', 'baseline', 'diagnostics'] as const;
const MOVED_ADMIN_TAB_MAP = {
  insights: 'stats',
} as const;
const MOVED_OPENFGA_DEEPLINK_TAB_MAP = {
  slack: 'slack',
  webex: 'webex',
  rag: 'rag-access',
} as const;

type CategoryKey = 'settings' | 'people' | 'integrations' | 'insights' | 'platform' | 'security';
const DEFAULT_ADMIN_CATEGORY: CategoryKey = 'settings';
const DEFAULT_ADMIN_TAB = 'settings';
const DEFAULT_READONLY_TAB = 'users';

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
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    tabs: [
      { value: 'settings', label: 'General', icon: Settings, gateKey: 'settings' },
      { value: 'ai-review', label: 'AI Review', icon: ShieldCheck, gateKey: 'ai_review' },
      { value: 'credentials', label: 'Credentials', icon: Shield, gateKey: 'credentials' },
      { value: 'rag-access', label: 'Knowledge Bases', icon: Database, gateKey: 'openfga' },
      { value: 'skills', label: 'Skills', icon: Layers, gateKey: 'skills' },
      { value: 'service-accounts', label: 'Service Accounts', icon: Bot, gateKey: 'service_accounts' },
    ],
  },
  {
    key: 'people',
    label: 'Teams & Users',
    icon: Users,
    tabs: [
      { value: 'users', label: 'Users', icon: User, gateKey: 'users' },
      { value: 'teams', label: 'Teams', icon: UsersIcon, gateKey: 'teams' },
      { value: 'identity-sync', label: 'Identity Sync', icon: RefreshCw, gateKey: 'identity_sync' },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    icon: Globe,
    tabs: [
      { value: 'slack', label: 'Slack', icon: Hash, gateKey: 'slack' },
      { value: 'webex', label: 'Webex', icon: MessageSquare, gateKey: 'webex' },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    icon: TrendingUp,
    tabs: [
      { value: 'stats', label: 'Statistics', icon: TrendingUp, gateKey: 'stats' },
      { value: 'feedback', label: 'Feedback', icon: ThumbsUp, gateKey: 'feedback' },
    ],
  },
  {
    key: 'platform',
    label: 'Metrics & Health',
    icon: Activity,
    tabs: [
      { value: 'metrics', label: 'Metrics', icon: Activity, gateKey: 'metrics' },
      { value: 'health', label: 'Health', icon: Database, gateKey: 'health' },
      { value: 'cas-insights', label: 'Authorization Insights', icon: Activity, gateKey: 'metrics' },
    ],
  },
  {
    key: 'security',
    label: 'Security & Policy',
    icon: Shield,
    tabs: [
      { value: 'cas-permissions-tool', label: 'Permissions Tool', icon: Bug, gateKey: 'openfga' },
      { value: 'action-audit', label: 'RBAC Audit', icon: Shield, gateKey: 'action_audit' },
      { value: 'openfga', label: 'OpenFGA ReBAC', icon: Shield, gateKey: 'openfga' },
      { value: 'audit-logs', label: 'Chat Audit', icon: FileText, gateKey: 'audit_logs' },
      { value: 'keycloak', label: 'Keycloak', icon: ShieldCheck, gateKey: 'migrations' },
      { value: 'migrations', label: 'Migrations', icon: Database, gateKey: 'migrations' },
    ],
  },
];

function categoryForTab(tab: string): CategoryKey {
  for (const cat of CATEGORIES) {
    if (cat.tabs.some((t) => t.value === tab)) return cat.key;
  }
  return DEFAULT_ADMIN_CATEGORY;
}

// Admin Teams grid page size. The grid is server-paginated (`?page=`) so the
// browser only ever holds one page of teams regardless of directory size.
// 12 fills the 3-column layout in 4 clean rows.
const TEAMS_PAGE_SIZE = 12;

// IdP membership source types (okta / oidc_claim / active_directory) → display
// label + optional logo asset, for the "synced from <IdP>" team badge.
const IDP_SOURCE_META: Record<string, { label: string; logo?: string }> = {
  okta: { label: 'Okta', logo: '/provider-logos/okta.svg' },
  oidc_claim: { label: 'OIDC' },
  active_directory: { label: 'Active Directory' },
};

// Badges shown on a team card when its membership was synced from an IdP. A
// team can be synced from more than one source (e.g. some members from Okta,
// others from a raw OIDC claim), so we render one pill PER source type rather
// than collapsing them into a single combined label. Each pill shows the
// provider logo (e.g. Okta) when available plus its label, with a
// "Synced with <IdP>" tooltip.
function IdpSyncedBadge({ sourceTypes }: { sourceTypes: string[] }) {
  // Dedupe defensively — the backend $addToSet already returns distinct types,
  // but a stray duplicate would otherwise render two identical pills.
  const seen = new Set<string>();
  const types = sourceTypes.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {types.map((t) => {
        const meta = IDP_SOURCE_META[t] ?? { label: t };
        const title = `Synced with ${meta.label}`;
        return (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 border border-border"
            title={title}
            aria-label={title}
          >
            {meta.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.logo} alt="" aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            <span className="text-[10px] font-medium text-muted-foreground">
              {meta.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function isValidTab(tab: string | null): tab is typeof VALID_TABS[number] {
  return Boolean(tab && (VALID_TABS as readonly string[]).includes(tab));
}

function isValidCategory(category: string | null): category is CategoryKey {
  return Boolean(category && CATEGORIES.some((c) => c.key === category));
}

function isValidOpenFgaSubtab(tab: string | null): tab is typeof VALID_OPENFGA_SUBTABS[number] {
  return Boolean(tab && (VALID_OPENFGA_SUBTABS as readonly string[]).includes(tab));
}

function movedAdminTab(tab: string | null): typeof VALID_TABS[number] | null {
  if (!tab) return null;
  return (MOVED_ADMIN_TAB_MAP as Record<string, typeof VALID_TABS[number]>)[tab] ?? null;
}

function OverviewStatsCards({ overview }: { overview: AdminStats['overview'] | null }) {
  if (!overview) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Users</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview.total_users}</div>
          <p className="text-xs text-muted-foreground mt-1">
            DAU: {overview.dau} | MAU: {overview.mau}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Conversations</CardTitle>
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview.total_conversations}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Today: +{overview.conversations_today}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Messages</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview.total_messages}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Today: +{overview.messages_today}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Shared (Web)</CardTitle>
          <Share2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview.shared_conversations}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {overview.total_conversations > 0
              ? ((overview.shared_conversations / overview.total_conversations) * 100).toFixed(1)
              : '0.0'}
            % of all conversations
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function movedOpenFgaDeepLinkTab(tab: string | null): typeof VALID_TABS[number] | null {
  if (!tab) return null;
  return (MOVED_OPENFGA_DEEPLINK_TAB_MAP as Record<string, typeof VALID_TABS[number]>)[tab] ?? null;
}

function simulationTargetFromParams(searchParams: { get(name: string): string | null }): AdminTabGateSimulationTarget | null {
  const type = searchParams.get("simulate_type");
  const id = searchParams.get("simulate_id")?.trim();
  const relation = searchParams.get("simulate_relation");
  if ((type !== "user" && type !== "team") || !id) return null;
  return {
    type,
    id,
    ...(type === "team" && (relation === "member" || relation === "admin") ? { relation } : {}),
  };
}

function AdminPage() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin, loading: adminRoleLoading } = useAdminRole();
  const simulationTarget = useMemo(() => simulationTargetFromParams(searchParams), [searchParams]);
  const { gates, integrationPanelModes, loading: adminTabGatesLoading, simulation } = useAdminTabGates(simulationTarget);
  const isSimulationActive = Boolean(simulationTarget);
  const auditLogsEnabled = getConfig('auditLogsEnabled');
  const feedbackEnabled = getConfig('feedbackEnabled');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [globalOverview, setGlobalOverview] = useState<AdminStats['overview'] | null>(null);
  const [skillStats, setSkillStats] = useState<SkillMetricsAdmin | null>(null);
  // `teams` is the FULL team list, used only by the shared Stats/Feedback
  // team-filter dropdowns and the access-simulation team picker (which need
  // every team available for selection). The Teams grid below does NOT read
  // from this — it has its own server-paginated state (`gridTeams`) so the
  // grid only ever renders one page of cards.
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  // Server-paginated Teams grid state. `gridTeams` holds only the current
  // page; `gridSearch` is the debounced query sent to the server.
  const [gridTeams, setGridTeams] = useState<Team[]>([]);
  const [gridTotal, setGridTotal] = useState(0);
  const [gridPage, setGridPage] = useState(1);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridLoaded, setGridLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [simulationType, setSimulationType] = useState<"user" | "team">(simulationTarget?.type ?? "user");
  const [simulationId, setSimulationId] = useState(simulationTarget?.id ?? "");
  const [simulationRelation, setSimulationRelation] = useState<"member" | "admin">(
    simulationTarget?.relation ?? "admin"
  );
  const [simulationDialogOpen, setSimulationDialogOpen] = useState(false);
  const [simulationSearch, setSimulationSearch] = useState(simulationTarget?.id ?? "");
  const [simulationUsers, setSimulationUsers] = useState<SimulationUserOption[]>([]);
  const [simulationTeams, setSimulationTeams] = useState<SimulationTeamOption[]>([]);
  const [simulationSearchLoading, setSimulationSearchLoading] = useState(false);
  const userSelectedAdminTabRef = useRef(false);
  const initialTab = searchParams.get('tab');
  const defaultTab = isAdmin ? DEFAULT_ADMIN_TAB : DEFAULT_READONLY_TAB;
  const [activeTab, setActiveTab] = useState<string>(
    isValidTab(initialTab) ? initialTab : defaultTab
  );
  const initialCat = searchParams.get('cat') as CategoryKey | null;
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(
    isValidCategory(initialCat)
      ? initialCat
      : categoryForTab(activeTab)
  );

  const tabGateValues = useMemo<Record<string, boolean>>(
    () => ({
      ...gates,
      feedback: Boolean(gates.feedback && feedbackEnabled),
      audit_logs: Boolean(gates.audit_logs && auditLogsEnabled),
      credentials: Boolean(gates.credentials && getConfig('credentialsEnabled')),
      settings: !isSimulationActive,
      ai_review: isAdmin && !isSimulationActive,
      // Identity Sync tab: superadmin-only (reuses the identity_group_sync
      // OpenFGA surface) AND only when an IdP directory connector is enabled.
      identity_sync: Boolean(gates.identity_group_sync && getConfig('oktaSyncEnabled')),
    }),
    [auditLogsEnabled, feedbackEnabled, gates, isAdmin, isSimulationActive]
  );

  const visibleCategories = useMemo(
    () =>
      CATEGORIES.filter((cat) =>
        cat.tabs.some((t) => tabGateValues[t.gateKey])
      ),
    [tabGateValues]
  );

  const visibleTabsForCategory = useMemo(
    () =>
      (CATEGORIES.find((c) => c.key === activeCategory)?.tabs ?? []).filter(
        (t) => tabGateValues[t.gateKey]
      ),
    [activeCategory, tabGateValues]
  );

  useEffect(() => {
    if (adminRoleLoading || adminTabGatesLoading) return;
    if (visibleCategories.length === 0) return;

    const requestedTab = searchParams.get('tab');
    const requestedCategory = searchParams.get('cat');
    const requestedOpenFgaSubtab = searchParams.get('subtab') ?? searchParams.get('openfgaTab');
    const shouldOpenOpenFgaDeepLink = isValidOpenFgaSubtab(requestedOpenFgaSubtab);
    const movedDeepLinkTab = movedOpenFgaDeepLinkTab(requestedOpenFgaSubtab);
    const movedTab = movedAdminTab(requestedTab);
    const tabFromUrl = shouldOpenOpenFgaDeepLink
      ? 'openfga'
      : movedDeepLinkTab ?? movedTab ?? (isValidTab(requestedTab) ? requestedTab : null);
    const categoryFromUrl = isValidCategory(requestedCategory) ? requestedCategory : null;
    const defaultCategory = categoryForTab(defaultTab);

    if (
      !requestedTab &&
      !requestedCategory &&
      userSelectedAdminTabRef.current &&
      (activeTab !== defaultTab || activeCategory !== defaultCategory)
    ) {
      return;
    }

    let nextCategory: CategoryKey | undefined;
    let nextTab: string | undefined;
    const tabConfig = tabFromUrl
      ? CATEGORIES.flatMap((category) => category.tabs).find((tab) => tab.value === tabFromUrl)
      : undefined;

    if (tabFromUrl && tabConfig && tabGateValues[tabConfig.gateKey]) {
      nextTab = tabFromUrl;
      nextCategory = categoryForTab(tabFromUrl);
    } else {
      const preferredCategory =
        categoryFromUrl && visibleCategories.some((category) => category.key === categoryFromUrl)
          ? categoryFromUrl
          : defaultCategory;
      const fallbackCategory = visibleCategories.some((category) => category.key === preferredCategory)
        ? preferredCategory
        : visibleCategories[0].key;
      nextCategory = fallbackCategory;
      nextTab = CATEGORIES.find((category) => category.key === fallbackCategory)?.tabs.find(
        (tab) => tabGateValues[tab.gateKey]
      )?.value;
    }

    if (!nextCategory || !nextTab) return;

    if (activeCategory !== nextCategory) setActiveCategory(nextCategory);
    if (activeTab !== nextTab) setActiveTab(nextTab);

    if (requestedCategory !== nextCategory || requestedTab !== nextTab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('cat', nextCategory);
      params.set('tab', nextTab);
      if (nextTab !== 'openfga') {
        params.delete('subtab');
        params.delete('openfgaTab');
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [
    activeCategory,
    activeTab,
    adminTabGatesLoading,
    adminRoleLoading,
    defaultTab,
    pathname,
    router,
    searchParams,
    tabGateValues,
    visibleCategories,
  ]);

  const handleCategoryChange = useCallback(
    (catKey: CategoryKey) => {
      userSelectedAdminTabRef.current = true;
      setActiveCategory(catKey);
      const cat = CATEGORIES.find((c) => c.key === catKey);
      if (!cat) return;
      const firstVisible = cat.tabs.find((t) => tabGateValues[t.gateKey]);
      if (firstVisible) {
        setActiveTab(firstVisible.value);
        const params = new URLSearchParams(searchParams.toString());
        params.set('cat', catKey);
        params.set('tab', firstVisible.value);
        if (firstVisible.value !== 'openfga') {
          params.delete('subtab');
          params.delete('openfgaTab');
        }
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    },
    [pathname, router, searchParams, tabGateValues]
  );

  useEffect(() => {
    setSimulationType(simulationTarget?.type ?? "user");
    setSimulationId(simulationTarget?.id ?? "");
    setSimulationSearch(simulationTarget?.id ?? "");
    setSimulationRelation(simulationTarget?.relation ?? "admin");
  }, [simulationTarget]);

  useEffect(() => {
    if (!simulationDialogOpen) return;
    const query = simulationSearch.trim();
    if (query.length < 2) {
      setSimulationUsers([]);
      setSimulationTeams([]);
      setSimulationSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSimulationSearchLoading(true);

    async function loadSimulationSubjects() {
      try {
        if (simulationType === "user") {
          const response = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}&pageSize=20`);
          const payload = await response.json();
          const users = (payload.users ?? payload.data?.users ?? []) as SimulationUserOption[];
          if (!cancelled) setSimulationUsers(users);
        } else {
          const response = await fetch("/api/admin/teams");
          const payload = await response.json();
          const rows = (payload.data?.teams ?? payload.teams ?? []) as SimulationTeamOption[];
          const normalizedQuery = query.toLowerCase();
          const matching = rows.filter((team) =>
            [team.slug, team.name, team.description, team.id, team._id]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedQuery))
          );
          if (!cancelled) setSimulationTeams(matching);
        }
      } catch {
        if (!cancelled) {
          setSimulationUsers([]);
          setSimulationTeams([]);
        }
      } finally {
        if (!cancelled) setSimulationSearchLoading(false);
      }
    }

    void loadSimulationSubjects();
    return () => {
      cancelled = true;
    };
  }, [simulationDialogOpen, simulationSearch, simulationType]);

  const applySimulationTarget = useCallback(() => {
    const trimmedId = simulationId.trim();
    if (!trimmedId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("simulate_type", simulationType);
    params.set("simulate_id", trimmedId);
    if (simulationType === "team") {
      params.set("simulate_relation", simulationRelation);
    } else {
      params.delete("simulate_relation");
    }
    userSelectedAdminTabRef.current = false;
    setSimulationDialogOpen(false);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, simulationId, simulationRelation, simulationType]);

  const clearSimulationTarget = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("simulate_type");
    params.delete("simulate_id");
    params.delete("simulate_relation");
    userSelectedAdminTabRef.current = false;
    setSimulationDialogOpen(false);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const [createTeamDialogOpen, setCreateTeamDialogOpen] = useState(false);
  const [teamDetailsOpen, setTeamDetailsOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamType | null>(null);
  const [teamDialogMode, setTeamDialogMode] = useState<TeamDialogMode>("details");
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const [teamPendingDelete, setTeamPendingDelete] = useState<Team | null>(null);
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
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsChannelFilter, setStatsChannelFilter] = useState<string[]>([]);
  const [statsChannels, setStatsChannels] = useState<string[]>([]);
  const rangeLabel = datePreset === "1h" ? "1 Hour" : datePreset === "12h" ? "12 Hours" : datePreset === "24h" ? "24 Hours" : datePreset === "7d" ? "7 Days" : datePreset === "90d" ? "90 Days" : datePreset === "custom" ? "Custom Range" : "30 Days";
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const visitedTabsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (status === "authenticated" || !getConfig('ssoEnabled')) {
      loadTabData(activeTab);
    }
  }, [status]);

  // Load data for newly-visited tabs
  useEffect(() => {
    if (status !== "authenticated" && getConfig('ssoEnabled')) return;
    loadTabData(activeTab);
  }, [activeTab, status]);

  const fetchTeamsFromDb = async (): Promise<Team[]> => {
    const response = await fetch(`/api/admin/teams?fresh=${Date.now()}`, {
      cache: 'no-store',
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to load teams');
    }

    return result.data?.teams || [];
  };

  // Refresh the FULL team list backing the shared filter dropdowns. The Teams
  // grid has its own paginated loader (`fetchTeamsGridPage`) and does not use
  // this. Runs quietly in the background — no visible spinner.
  const loadTeams = async () => {
    try {
      setTeams(await fetchTeamsFromDb());
    } catch (err: any) {
      console.error('[Admin] Failed to refresh teams:', err);
    }
  };

  // Fetch one page of the Teams grid from the server. Search is applied
  // server-side so the browser never holds more than a page of rows. The
  // request is the source of truth for `gridTotal`, which drives the pager.
  const fetchTeamsGridPage = useCallback(async (page: number, search: string) => {
    setGridLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(TEAMS_PAGE_SIZE),
        fresh: String(Date.now()),
      });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/admin/teams?${params.toString()}`, {
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load teams');
      }
      setGridTeams(result.data?.teams ?? []);
      setGridTotal(result.data?.total ?? 0);
      setGridPage(result.data?.page ?? page);
      setGridLoaded(true);
    } catch (err: any) {
      console.error('[Admin] Failed to load teams page:', err);
    } finally {
      setGridLoading(false);
    }
  }, []);

  // Debounced server-side search for the Teams grid. Typing resets to page 1
  // and re-queries the server (~250ms after the last keystroke), matching the
  // discovery-search pattern used elsewhere in the admin dialogs. We only run
  // this while the Teams tab is active so other tabs don't trigger team
  // queries on every keystroke.
  useEffect(() => {
    if (activeTab !== 'teams') return;
    const handle = setTimeout(() => {
      void fetchTeamsGridPage(1, teamSearch);
    }, 250);
    return () => clearTimeout(handle);
  }, [teamSearch, activeTab, fetchTeamsGridPage]);

  const gridTotalPages = Math.max(1, Math.ceil(gridTotal / TEAMS_PAGE_SIZE));
  const gridHasMore = gridPage * TEAMS_PAGE_SIZE < gridTotal;

  const goToTeamsPage = (page: number) => {
    const clamped = Math.min(Math.max(1, page), gridTotalPages);
    void fetchTeamsGridPage(clamped, teamSearch);
  };

  // Refresh after a team mutation (create/edit/delete/member change). Always
  // re-fetches the visible grid page. Also refreshes the full team list — but
  // only when it has already been loaded — so the shared filter dropdowns stay
  // current without forcing a full fetch for users who never opened those tabs.
  const refreshAfterTeamMutation = (page?: number) => {
    void fetchTeamsGridPage(page ?? gridPage, teamSearch);
    if (visitedTabsRef.current.has('_teams-loaded')) {
      void loadTeams();
    }
  };

  // Expand team: prefixed selections to member emails
  // See `filteredTeams` above for the canonical-team-membership refactor note —
  // same defensive guard applies here.
  const expandStatsUsers = (selected: string[]): string[] => {
    const emails = new Set<string>();
    for (const s of selected) {
      if (s.startsWith('team:')) {
        const team = teams.find((t) => t.name === s.slice(5));
        if (team) (team.members ?? []).forEach((m) => emails.add(m.user_id));
      } else {
        emails.add(s);
      }
    }
    return [...emails];
  };

  // Re-fetch stats when filters change (lightweight — only refetch stats endpoint)
  const statsFilterRef = React.useRef({ range: dateRange, source: sourceFilter, users: userFilter, channels: statsChannelFilter });
  const fetchStatsWithFilters = async (range?: DateRange, source?: 'all' | 'web' | 'slack', userEmails?: string[], channels?: string[]) => {
    if (status !== "authenticated" && getConfig('ssoEnabled')) return;
    setStatsRefreshing(true);
    try {
      const r = range ?? dateRange;
      const s = source ?? sourceFilter;
      const u = userEmails ?? expandStatsUsers(userFilter);
      const ch = channels ?? statsChannelFilter;
      const params = new URLSearchParams({ from: r.from, to: r.to });
      if (s !== 'all') params.set('source', s);
      if (u.length > 0) params.set('user', u.join(','));
      if (s === 'slack' && ch.length > 0) params.set('channel', ch.join(','));
      const res = await fetch(`/api/admin/stats?${params}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setStats(json.data);
          if (json.data.available_channels) setStatsChannels(json.data.available_channels);
        }
      }
    } catch {
      // keep existing stats on failure
    } finally {
      setStatsRefreshing(false);
    }
  };
  useEffect(() => {
    const current = { range: dateRange, source: sourceFilter, users: userFilter, channels: statsChannelFilter };
    if (statsFilterRef.current.range === current.range
      && statsFilterRef.current.source === current.source
      && statsFilterRef.current.users === current.users
      && statsFilterRef.current.channels === current.channels) return; // skip initial
    statsFilterRef.current = current;
    fetchStatsWithFilters();
  }, [dateRange, sourceFilter, userFilter, status]);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const hasStatsFilters = sourceFilter !== 'all' || userFilter.length > 0;
      const p = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      if (sourceFilter !== 'all') p.set('source', sourceFilter);
      if (userFilter.length > 0) p.set('user', userFilter.join(','));
      const [statsRes, globalStatsRes] = await Promise.all([
        fetch(`/api/admin/stats?${p}`),
        hasStatsFilters ? fetch('/api/admin/stats') : null,
      ]);

      if (statsRes.status === 401) {
        setError('Not authenticated. Please sign in via SSO first.');
        return;
      }

      const statsForbidden = statsRes.status === 403;
      if (statsForbidden && !tabGateValues.settings) {
        setError('Access denied. Try signing out and back in to refresh your session.');
        return;
      }

      const [statsResponse, globalStatsResponse] = await Promise.all([
        statsForbidden ? Promise.resolve({ success: false }) : statsRes.json(),
        globalStatsRes ? globalStatsRes.json().catch(() => null) : null,
      ]);

      if (statsResponse.success) {
        setStats(statsResponse.data);
        if (statsResponse.data.available_channels) setStatsChannels(statsResponse.data.available_channels);
        const overviewData = globalStatsResponse?.success ? globalStatsResponse.data.overview : statsResponse.data.overview;
        setGlobalOverview(overviewData);
      } else if (!statsForbidden) {
        throw new Error(statsResponse.error || 'Failed to load stats');
      }
    } catch (err: any) {
      console.error('[Admin] Failed to load stats:', err);
      setError(err.message || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const loadTeamsData = async () => {
    try {
      setTeams(await fetchTeamsFromDb());
    } catch (err: any) {
      console.error('[Admin] Failed to load teams:', err);
    }
  };

  const loadSkillStats = async () => {
    try {
      const res = await fetch('/api/admin/stats/skills');
      if (res.ok) {
        const data = await res.json().catch(() => ({ success: false }));
        if (data.success) setSkillStats(data.data);
      }
    } catch (err) {
      console.error('[Admin] Failed to load skill stats:', err);
    }
  };

  const loadFeedbackOnce = async () => {
    if (!getConfig('feedbackEnabled')) return;
    try {
      const res = await fetch('/api/admin/feedback');
      if (res.ok) {
        const data = await res.json().catch(() => ({ success: false }));
        if (data.success) {
          setFeedbackData(data.data);
          if (data.data.channels) setFeedbackChannels(data.data.channels);
          if (data.data.users) setFeedbackUsers(data.data.users);
        }
      }
    } catch (err) {
      console.error('[Admin] Failed to load feedback:', err);
    }
  };

  const loadTabData = async (tab: string) => {
    if (visitedTabsRef.current.has(tab)) return;
    visitedTabsRef.current.add(tab);

    // Teams data is shared across stats/slack/feedback filter dropdowns.
    // Use a data-level key (not the tab name) so it isn't confused with the
    // tab-visit guard that loadTabData adds before invoking the loader.
    const loadTeamsIfNeeded = () => {
      if (visitedTabsRef.current.has('_teams-loaded')) return Promise.resolve();
      visitedTabsRef.current.add('_teams-loaded');
      return loadTeamsData();
    };

    // Stats data is shared between the stats and slack tabs. Use a separate
    // key so visiting one doesn't cause the other to re-fetch it.
    const loadStatsIfNeeded = () => {
      if (visitedTabsRef.current.has('_stats-loaded')) return Promise.resolve();
      visitedTabsRef.current.add('_stats-loaded');
      return loadStats();
    };

    // Map of tab key → loader. Tabs not listed here have no upfront data to
    // load and should not block render (loading is initialized to false).
    // The Teams tab is NOT listed here: its grid is server-paginated and
    // self-loads via a debounced effect, so it must not pull the full team
    // list. The full list (`loadTeamsIfNeeded`) is only needed by tabs whose
    // dropdowns offer every team for selection (stats/slack/feedback).
    const loaders: Record<string, () => Promise<void>> = {
      stats: async () => { await Promise.all([loadStatsIfNeeded(), loadTeamsIfNeeded()]); },
      slack: async () => { await Promise.all([loadStatsIfNeeded(), loadTeamsIfNeeded()]); },
      skills: loadSkillStats,
      feedback: async () => { await Promise.all([loadFeedbackOnce(), loadTeamsIfNeeded()]); },
    };

    const loader = loaders[tab];
    if (loader) await loader();
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


  const handleDeleteTeam = async (team: Team) => {
    setDeletingTeam(team._id);
    try {
      const response = await fetch(`/api/admin/teams/${team._id}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete team');
      }

      // Drop from both local lists, then re-fetch the grid page so a team
      // from the next page backfills the now-empty slot (and the pager total
      // stays correct). If the deletion emptied the current page, step back.
      setTeams((prev) => prev.filter((t) => t._id !== team._id));
      setGridTeams((prev) => prev.filter((t) => t._id !== team._id));
      const nextPage = gridTeams.length === 1 && gridPage > 1 ? gridPage - 1 : gridPage;
      refreshAfterTeamMutation(nextPage);
      setTeamPendingDelete(null);
      console.log(`[Admin] Team deleted: ${team.name}`);
    } catch (err: any) {
      console.error('[Admin] Failed to delete team:', err);
      alert(`Failed to delete team: ${err.message}`);
    } finally {
      setDeletingTeam(null);
    }
  };

  const openTeamDialog = (team: Team, mode: TeamDialogMode) => {
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
            onClick={() => { visitedTabsRef.current.delete(activeTab); loadTabData(activeTab); }}
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
      {/* Global Crawl Console dialog. Rendered at the page root so
          it survives admin tab switches; opens via the header pill
          or auto-opens when SkillHubsSection starts the first
          crawl of the session. */}
      <CrawlConsoleDialog />
      <ScrollArea className="h-full">
          <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">Admin</h1>
                {!isAdmin && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <Eye className="h-3.5 w-3.5" />
                    Read-Only
                  </span>
                )}
                {/* Always-visible status pill that opens the
                    Crawl Console dialog. Hidden until at least
                    one crawl has happened in this session, so
                    the header doesn't gain a permanent "0 crawls"
                    chip on freshly-loaded pages. */}
                <CrawlConsoleHeaderPill />
              </div>
              <p className="text-muted-foreground">
                {isAdmin
                  ? 'Manage access, teams, health, and platform settings'
                  : 'View access, teams, health, and platform settings'}
              </p>
            </div>

            {/* Tabbed Content */}
            <Tabs value={activeTab} onValueChange={(tab) => {
              userSelectedAdminTabRef.current = true;
              setActiveTab(tab);
              setActiveCategory(categoryForTab(tab));
              const params = new URLSearchParams(searchParams.toString());
              params.set('cat', categoryForTab(tab));
              params.set('tab', tab);
              if (tab !== 'openfga') {
                params.delete('subtab');
                params.delete('openfgaTab');
              }
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
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setSimulationDialogOpen(true)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      isSimulationActive
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View as
                    {isSimulationActive && (
                      <span className="max-w-40 truncate">
                        {simulation?.subject?.openfga_user ?? simulationTarget?.id}
                      </span>
                    )}
                  </button>
                )}
              </div>

              <Dialog open={simulationDialogOpen} onOpenChange={setSimulationDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>View As Effective Permissions</DialogTitle>
                    <DialogDescription>
                      Search for a real user or team. Preview is read-only and evaluates Admin visibility
                      against the selected OpenFGA subject.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor="simulate-type">
                          Subject type
                        </label>
                        <select
                          id="simulate-type"
                          value={simulationType}
                          onChange={(event) => {
                            const nextType = event.target.value as "user" | "team";
                            setSimulationType(nextType);
                            setSimulationId("");
                            setSimulationSearch("");
                            setSimulationUsers([]);
                            setSimulationTeams([]);
                          }}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="team">Team</option>
                          <option value="user">User</option>
                        </select>
                      </div>
                      {simulationType === "team" && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground" htmlFor="simulate-relation">
                            Role / relation
                          </label>
                          <select
                            id="simulate-relation"
                            value={simulationRelation}
                            onChange={(event) => setSimulationRelation(event.target.value as "member" | "admin")}
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="admin">Manager/Admin</option>
                            <option value="member">Reader/Member</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="simulate-search">
                        {simulationType === "team" ? "Search team, slug, or role" : "Search user, email, or sub"}
                      </label>
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="simulate-search"
                          value={simulationSearch}
                          onChange={(event) => {
                            setSimulationSearch(event.target.value);
                            setSimulationId(event.target.value.trim());
                          }}
                          placeholder={
                            simulationType === "team"
                              ? "Search team name or slug"
                              : "Search by email, name, or Keycloak sub"
                          }
                          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        You can select a search result or enter a raw OpenFGA id directly.
                      </p>
                    </div>

                    <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                      {simulationSearchLoading ? (
                        <div className="p-3 text-sm text-muted-foreground">Searching...</div>
                      ) : simulationType === "user" ? (
                        simulationUsers.length > 0 ? (
                          simulationUsers.map((user) => {
                            const label = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.email || user.id;
                            return (
                              <button
                                key={user.id}
                                type="button"
                                onClick={() => {
                                  setSimulationId(user.id);
                                  setSimulationSearch(user.email || user.username || user.id);
                                }}
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              >
                                <span className="font-medium">{label}</span>{" "}
                                {user.email && <span className="text-muted-foreground">{user.email}</span>}{" "}
                                <code className="text-xs text-muted-foreground">{user.id}</code>
                              </button>
                            );
                          })
                        ) : (
                          <div className="p-3 text-sm text-muted-foreground">Type at least 2 characters to search users.</div>
                        )
                      ) : simulationTeams.length > 0 ? (
                        simulationTeams.map((team) => {
                          const teamId = team.slug || team.id || team._id || team.name;
                          return (
                            <button
                              key={teamId}
                              type="button"
                              onClick={() => {
                                setSimulationId(teamId);
                                setSimulationSearch(team.slug || team.name);
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                            >
                              <span className="font-medium">{team.name}</span>{" "}
                              <code className="text-xs text-muted-foreground">{teamId}</code>
                            </button>
                          );
                        })
                      ) : (
                        <div className="p-3 text-sm text-muted-foreground">Type at least 2 characters to search teams.</div>
                      )}
                    </div>

                    {isSimulationActive && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                        <span className="font-medium">Active preview:</span>{" "}
                        <code>{simulation?.subject?.openfga_user ?? `${simulationTarget?.type}:${simulationTarget?.id}`}</code>
                      </div>
                    )}
                  </div>

                  <DialogFooter>
                    {isSimulationActive && (
                      <Button type="button" variant="outline" onClick={clearSimulationTarget}>
                        Exit Simulation
                      </Button>
                    )}
                    <Button type="button" onClick={applySimulationTarget} disabled={!simulationId.trim()}>
                      Preview
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

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

              {tabGateValues.settings && (
                <TabsContent value="settings" className="space-y-4">
                  <PlatformSettingsTab isAdmin={isAdmin} />
                  <ReleaseNotesSettingsTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              {tabGateValues.service_accounts && (
                <TabsContent value="service-accounts" className="space-y-4">
                  <ServiceAccountsTab />
                </TabsContent>
              )}

              {tabGateValues.ai_review && (
                <TabsContent value="ai-review" className="space-y-4">
                  <ReviewConfigsTab />
                </TabsContent>
              )}

              {tabGateValues.credentials && (
                <TabsContent value="credentials" className="space-y-4">
                  <AdminCredentialManagementPanel />
                </TabsContent>
              )}

              {tabGateValues.openfga && (
                <TabsContent value="rag-access" className="space-y-4">
                  <RagTeamAccessPanel isAdmin={isAdmin} />
                </TabsContent>
              )}

              {tabGateValues.slack && (
                <TabsContent value="slack" className="space-y-4">
                  <SlackChannelRebacPanel
                    disabled={isSimulationActive}
                    selfService={
                      integrationPanelModes.slack
                        ? integrationPanelModes.slack === "self_service"
                        : !isAdmin
                    }
                  />
                </TabsContent>
              )}

              {tabGateValues.webex && (
                <TabsContent value="webex" className="space-y-4">
                  <WebexSpaceRebacPanel
                    disabled={isSimulationActive}
                    selfService={
                      integrationPanelModes.webex
                        ? integrationPanelModes.webex === "self_service"
                        : !isAdmin
                    }
                  />
                </TabsContent>
              )}

              {/* User Management Tab */}
              <TabsContent value="users" className="space-y-4">
                <UserManagementTab onSelectUser={(id) => setSelectedUserId(id)} />
                {selectedUserId && (
                  <UserDetailModal
                    userId={selectedUserId}
                    onClose={() => setSelectedUserId(null)}
                    onSaved={() => {}}
                    readOnly={!isAdmin}
                  />
                )}
              </TabsContent>

              {/* Team Management Tab */}
              <TabsContent value="teams" className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      aria-label="Search teams"
                      value={teamSearch}
                      onChange={(event) => setTeamSearch(event.target.value)}
                      placeholder="Search teams by name, owner, or description"
                      className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    {teamSearch && (
                      <button
                        type="button"
                        aria-label="Clear search input"
                        onClick={() => setTeamSearch("")}
                        className="absolute right-2 top-1/2 rounded p-1 text-muted-foreground hover:text-foreground -translate-y-1/2"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => fetchTeamsGridPage(gridPage, teamSearch)}
                      disabled={gridLoading}
                    >
                      {gridLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Refresh Teams
                    </Button>
                    {isAdmin && (
                      <Button className="gap-2" onClick={() => setCreateTeamDialogOpen(true)}>
                        <UserPlus className="h-4 w-4" />
                        Create Team
                      </Button>
                    )}
                  </div>
                </div>
                {(!gridLoaded && gridLoading) || (gridLoading && gridTeams.length === 0) ? (
                  <div className="flex justify-center py-12">
                    <CAIPESpinner />
                  </div>
                ) : gridTeams.length === 0 && !teamSearch.trim() ? (
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
                ) : gridTeams.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-12 text-center">
                    <Search className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No teams match &quot;{teamSearch}&quot;</h3>
                    <p className="text-muted-foreground mb-4">
                      Try a team name, owner email, or description.
                    </p>
                    <Button type="button" variant="outline" onClick={() => setTeamSearch("")}>
                      Clear team search
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {gridTeams.map((team) => {
                      const chatIntegrationCount =
                        (team.slack_channels?.length ?? 0) + (team.webex_spaces?.length ?? 0);

                      return (
                      <Card key={team._id}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <CardTitle className="text-lg">{team.name}</CardTitle>
                                {(team.idp_source_types?.length ?? 0) > 0 && (
                                  <IdpSyncedBadge sourceTypes={team.idp_source_types!} />
                                )}
                              </div>
                              {team.description && (
                                <CardDescription>{team.description}</CardDescription>
                              )}
                            </div>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Delete ${team.name}`}
                                onClick={() => setTeamPendingDelete(team)}
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
                          {/* Owner row — clearly labeled, not styled like a button. */}
                          <div className="flex items-center justify-between text-sm pb-3 border-b">
                            <span className="text-muted-foreground">Owner</span>
                            <button
                              type="button"
                              className="text-sm hover:underline truncate max-w-[60%] text-right"
                              onClick={() => setSelectedUserEmail(team.owner_id)}
                              title="Open user details"
                            >
                              {team.owner_id}
                            </button>
                          </div>

                          {/* Quick stats — 5 chips give an at-a-glance summary
                              and double as deep-links into the right tab in
                              the team-management dialog. Counts that we
                              don't have on the Team object yet (KBs) just
                              hide the number and show an icon. */}
                          <div className="grid grid-cols-5 gap-1.5 mt-3">
                            <StatChip
                              icon={<Users className="h-3.5 w-3.5" />}
                              label="Members"
                              count={team.member_count ?? 0}
                              onClick={() => openTeamDialog(team, "members")}
                            />
                            <StatChip
                              icon={<Bot className="h-3.5 w-3.5" />}
                              label="Agents"
                              count={team.resources?.agents?.length ?? 0}
                              onClick={() => openTeamDialog(team, "resources")}
                            />
                            <StatChip
                              icon={<Wrench className="h-3.5 w-3.5" />}
                              label="MCP"
                              count={
                                team.resources?.tool_wildcard
                                  ? "*"
                                  : (team.resources?.tools?.length ?? 0)
                              }
                              onClick={() => openTeamDialog(team, "resources")}
                            />
                            <StatChip
                              icon={<Database className="h-3.5 w-3.5" />}
                              label="KBs"
                              count={
                                team.kb_count ??
                                team.resources?.knowledge_bases?.length ??
                                0
                              }
                              onClick={() => openTeamDialog(team, "kbs")}
                            />
                            <StatChip
                              icon={<MessageSquare className="h-3.5 w-3.5" />}
                              label="Chat"
                              count={chatIntegrationCount}
                              ariaLabel={`${chatIntegrationCount} chat integration${chatIntegrationCount === 1 ? "" : "s"}`}
                              title="Manage chat integrations"
                              onClick={() => openTeamDialog(team, "channels")}
                            />
                          </div>

                          {/* Single primary action — replaces the previous
                              two-button row. The chips above give shortcuts
                              into specific tabs; this is the catch-all. */}
                          <div className="mt-4">
                            <Button
                              size="sm"
                              variant={(isAdmin || team.can_manage) ? "default" : "outline"}
                              className="w-full gap-1.5"
                              onClick={() => openTeamDialog(team, "details")}
                            >
                              <Settings className="h-3.5 w-3.5" />
                              {(isAdmin || team.can_manage) ? "Manage team" : "View team"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                      );
                    })}
                  </div>
                )}
                {/* Pager — shown whenever the result set spans more than one
                    page. Prev/Next drive a server fetch; the page indicator
                    reflects server-reported totals. */}
                {gridTotal > TEAMS_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-2 text-sm">
                    <span className="text-muted-foreground">
                      Page {gridPage} of {gridTotalPages} · {gridTotal} team{gridTotal === 1 ? "" : "s"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToTeamsPage(gridPage - 1)}
                        disabled={gridPage <= 1 || gridLoading}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goToTeamsPage(gridPage + 1)}
                        disabled={!gridHasMore || gridLoading}
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Identity Sync Tab — IdP directory sync (Okta, etc.). Superadmin-only,
                  shown only when a directory connector is enabled. */}
              {tabGateValues.identity_sync && (
                <TabsContent value="identity-sync" className="space-y-4">
                  <IdentitySyncPanel isAdmin={isAdmin} />
                </TabsContent>
              )}

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

                {/* Skill Hubs */}
                <SkillHubsSection isAdmin={isAdmin} />
              </TabsContent>

              {/* Feedback Tab */}
              {tabGateValues.feedback && <TabsContent value="feedback" className="space-y-4">
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
                                // Defensive read — see `filteredTeams` for the
                                // canonical-team-membership refactor context.
                                if (team) (team.members ?? []).forEach((m) => emails.add(m.user_id));
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

              {/* Usage Statistics Tab */}
              <TabsContent value="stats" className="space-y-4">
                <OverviewStatsCards overview={globalOverview} />

                {/* Stats Filters */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <select
                      value={sourceFilter}
                      onChange={(e) => {
                        const src = e.target.value as 'all' | 'web' | 'slack';
                        setSourceFilter(src);
                        setStatsChannelFilter([]);
                        fetchStatsWithFilters(undefined, src, undefined, []);
                        updateSharedFilterUrl({ source: src !== 'all' ? src : null });
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="all">All Sources</option>
                      <option value="web">Web</option>
                      <option value="slack">Slack</option>
                    </select>
                    {sourceFilter === 'slack' && statsChannels.length > 0 && (
                      <MultiSelect
                        options={statsChannels}
                        selected={statsChannelFilter}
                        onChange={(channels) => {
                          setStatsChannelFilter(channels);
                          fetchStatsWithFilters(undefined, undefined, undefined, channels);
                        }}
                        placeholder="All Channels"
                        searchPlaceholder="Search channels..."
                        emptyLabel="No channels found"
                        badgeLabel="channels"
                      />
                    )}
                    <MultiSelect
                      options={[
                        ...teams.map((t) => `team:${t.name}`),
                        ...feedbackUsers,
                      ]}
                      selected={userFilter}
                      onChange={(selected) => {
                        const emails = new Set<string>();
                        for (const s of selected) {
                          if (s.startsWith('team:')) {
                            const teamName = s.slice(5);
                            const team = teams.find((t) => t.name === teamName);
                            // Defensive read — see `filteredTeams` for the
                            // canonical-team-membership refactor context.
                            if (team) (team.members ?? []).forEach((m) => emails.add(m.user_id));
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
                  <div className="relative space-y-4">
                    {statsRefreshing && (
                      <div className="absolute inset-0 bg-background/60 z-10 flex items-center justify-center rounded">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
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
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 text-sm text-muted-foreground shrink-0">#{i + 1}</div>
                                  <div className="text-sm truncate max-w-[200px] text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(u._id)} title={u._id}>{u.name || u._id}</div>
                                </div>
                                <div className="text-sm font-medium shrink-0">{u.count} chats</div>
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
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 text-sm text-muted-foreground shrink-0">#{i + 1}</div>
                                  <div className="text-sm truncate max-w-[200px] text-primary hover:underline cursor-pointer" onClick={() => setSelectedUserEmail(u._id)} title={u._id}>{u.name || u._id}</div>
                                </div>
                                <div className="text-sm font-medium shrink-0">{u.count} messages</div>
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
                  </div>
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

              {/* CAS Insights — authorization service health + decision stats */}
              {tabGateValues.metrics && (
                <TabsContent value="cas-insights" className="space-y-4">
                  <CasInsightsTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              {tabGateValues.audit_logs && (
                <TabsContent value="audit-logs" className="space-y-4">
                  <AuditLogsTab isAdmin={isAdmin} onUserClick={setSelectedUserEmail} />
                </TabsContent>
              )}

              {/* Permission Debugger — interactive OpenFGA /explain */}
              {tabGateValues.openfga && (
                <TabsContent value="cas-permissions-tool" className="space-y-4">
                  <PermissionsToolTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              {tabGateValues.action_audit && (
                <TabsContent value="action-audit" className="space-y-4">
                  <UnifiedAuditTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              {tabGateValues.openfga && (
                <TabsContent value="openfga" className="space-y-4">
                  <OpenFgaRebacTab isAdmin={isAdmin} />
                </TabsContent>
              )}

              {tabGateValues.migrations && (
                <TabsContent value="keycloak" className="space-y-4">
                  <KeycloakMigrationHealthPanel />
                </TabsContent>
              )}

              {tabGateValues.migrations && (
                <TabsContent value="migrations" className="space-y-4">
                  <MigrationTab isAdmin={tabGateValues.migrations} />
                </TabsContent>
              )}

            </Tabs>
          </div>
        </ScrollArea>

      {/* Create Team Dialog */}
      <CreateTeamDialog
        open={createTeamDialogOpen}
        onOpenChange={setCreateTeamDialogOpen}
        // New teams sort to the top (newest-first), so jump to page 1 to
        // reveal the just-created team.
        onSuccess={() => refreshAfterTeamMutation(1)}
      />

      {/* Team Details / Member Management Dialog */}
      <TeamDetailsDialog
        team={selectedTeam}
        mode={teamDialogMode}
        open={teamDetailsOpen}
        onOpenChange={setTeamDetailsOpen}
        onTeamUpdated={() => refreshAfterTeamMutation()}
        onTeamMutated={(updatedTeam) => {
          // In-place patch of the grid + full team lists so the row in the
          // background re-renders with the new member count / attributes —
          // without triggering a full dashboard reload.
          //
          // The Team shape used by this page is a structural superset
          // of the one returned by /api/admin/teams/[id]/* mutation
          // endpoints; we merge so any locally-known fields the API
          // doesn't echo back (e.g. denormalised StatChip counters)
          // survive the patch.
          const patch = (t: Team) =>
            t._id === updatedTeam._id
              ? ({ ...t, ...(updatedTeam as Partial<Team>) } as Team)
              : t;
          setGridTeams((prev) => prev.map(patch));
          setTeams((prev) => prev.map(patch));
          // Also keep `selectedTeam` (the prop the dialog reads from)
          // in sync so its `useEffect(() => setCurrentTeam(team), [team])`
          // can pick up the patched payload if the dialog re-opens
          // before the next dashboard refresh.
          setSelectedTeam((prev) =>
            prev
              ? ({ ...prev, ...(updatedTeam as Partial<TeamType>) } as TeamType)
              : (updatedTeam as TeamType),
          );
        }}
      />

      <Dialog
        open={Boolean(teamPendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingTeam) {
            setTeamPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete team?</DialogTitle>
            <DialogDescription>
              {teamPendingDelete
                ? `Are you sure you want to delete the team "${teamPendingDelete.name}"? This cannot be undone.`
                : "This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTeamPendingDelete(null)}
              disabled={Boolean(deletingTeam)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (teamPendingDelete) {
                  void handleDeleteTeam(teamPendingDelete);
                }
              }}
              disabled={Boolean(deletingTeam)}
            >
              {deletingTeam ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/**
 * Compact stat chip used inside team cards. Renders as a button so the whole
 * chip is clickable and keyboard-focusable; clicking jumps the user to the
 * matching tab in the team-management dialog. When `count` is undefined the
 * chip still renders (so the chip layout is stable across teams) but only
 * shows the icon + label, signalling "click to configure".
 */
function StatChip({
  icon,
  label,
  count,
  ariaLabel,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  // string variant supports wildcard markers like "*" for all-tool grants
  count?: number | string;
  ariaLabel?: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-0.5 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors py-2 px-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={title || `Manage ${label.toLowerCase()}`}
    >
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        {(typeof count === "number" || typeof count === "string") && (
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {count}
          </span>
        )}
      </div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </button>
  );
}

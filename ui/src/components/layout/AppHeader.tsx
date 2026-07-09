"use client";

import { ReleaseUpgradeDialog } from "@/components/release/ReleaseUpgradeDialog";
import { SettingsPanel } from "@/components/settings-panel";
import { UnsavedChangesDialog } from "@/components/shared/UnsavedChangesDialog";
import { ReportProblemDialog } from "@/components/ticket/ReportProblemDialog";
import { Button } from "@/components/ui/button";
import { GithubIcon as Github } from "@/components/ui/icons";
import {
Popover,
PopoverContent,
PopoverTrigger,
} from "@/components/ui/popover";
import { UserMenu } from "@/components/user-menu";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useAgentRuntimeHealth } from "@/hooks/use-agent-runtime-health";
import { useKeycloakHealthSummary } from "@/hooks/use-keycloak-health-summary";
import { useMigrationStatus } from "@/hooks/use-migration-status";
import { usePlatformHealthProbes } from "@/hooks/use-platform-health-probes";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { useReleaseUpgradePrompt } from "@/hooks/use-release-upgrade-prompt";
import { useVersion } from "@/hooks/use-version";
import { config,getLogoFilterClass } from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  applyTopNavConfig,
  normalizeTopNavConfig,
  type TopNavConfig,
} from "@/lib/nav/top-nav-items";
import { resolveChatNavigationPath,useChatStore } from "@/store/chat-store";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { AnimatePresence,motion } from "framer-motion";
import {
AlertTriangle,
BookOpen,
Bot,
CalendarClock,
ChevronDown,
ChevronRight,
Database,
FileText,
FolderKanban,
Home,
KeyRound,
Loader2,
Shield,
Workflow,
Zap,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname,useRouter } from "next/navigation";
import React from "react";

/**
 * Editor routes that participate in the unsaved-changes guard.
 *
 * When a user is on one of these pages AND `hasUnsavedChanges` is set,
 * `GuardedLink` intercepts clicks on top-nav links and stores the
 * requested href in the global store. Each editor decides whether to
 * render the confirm dialog itself (e.g. `/skills/workspace` owns its own
 * in-page dialog so the discard UI matches its "Back" button) or to
 * delegate it to the AppHeader (see `EDITOR_ROUTES_WITH_HEADER_DIALOG`
 * below).
 *
 * Add new editor route prefixes here when they wire into the
 * unsaved-changes store.
 */
const EDITOR_ROUTES_WITH_OWN_DISCARD_DIALOG = [
  "/workflows",
  "/skills/workspace",
  "/dynamic-agents",
];

/**
 * Subset of guarded editor routes that ask the AppHeader to render the
 * discard dialog for top-nav clicks. Editors in this list typically own
 * an in-page dialog only for their own "Back" button (e.g. the Dynamic
 * Agent editor) and rely on the header for cross-tab navigation, while
 * editors not in this list (e.g. `/skills/workspace`) render their own
 * dialog for both cases by reading `pendingNavigationHref` directly.
 */
const EDITOR_ROUTES_WITH_HEADER_DIALOG = [
  "/workflows",
  "/dynamic-agents",
];

function isOnGuardedEditor(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return EDITOR_ROUTES_WITH_OWN_DISCARD_DIALOG.some((p) =>
    pathname.startsWith(p),
  );
}

function isOnHeaderDialogEditor(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  return EDITOR_ROUTES_WITH_HEADER_DIALOG.some((p) => pathname.startsWith(p));
}

function GuardedLink({
  href,
  children,
  className,
  prefetch,
  title,
  "aria-label": ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  prefetch?: boolean;
  title?: string;
  "aria-label"?: string;
}) {
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChangesStore();
  const pathname = usePathname();

  const onGuardedEditor = isOnGuardedEditor(pathname) && hasUnsavedChanges;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onGuardedEditor && href !== pathname) {
      e.preventDefault();
      requestNavigation(href);
    }
  };

  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={className}
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

// Nav overflow is handled dynamically via ResizeObserver — no fixed breakpoints.
// Baseline breakpoint: collapse the inline nav (Home/Chat/Skills/...) into
// the "More" popover. Tuned so 8 primary nav pills + standard right-side
// cluster (status pill + settings + user menu) still fit on a typical
// laptop without overlap.
const HEADER_NAV_COLLAPSE_BASE_PX = 1180;
// Wider breakpoint used when an admin-only banner is showing on the right
// (`migrationStatus.is_blocking` / `needs_version_bootstrap` /
// `override_active`, or the Keycloak invariant alert chip). Each banner
// pill adds ~140-200px of labelled width, and combined with the
// full-text "Report a Problem" button can push the right cluster into
// the inline nav — which then silently clips the last secondary item
// (Admin) due to `overflow-hidden` on the left flex region. Collapsing
// earlier in that case prevents the overlap that hides the Admin tab on
// 1180-1500px viewports. Empirical: at 1440px with the Version metadata
// chip showing, the inline nav was clipping Admin off-screen; 1500 is
// the smallest breakpoint that gives reliable headroom for the wider
// right cluster on every layout we've reproduced.
const HEADER_NAV_COLLAPSE_BASE_PX_WITH_BANNER = 1500;

function useHeaderNavCollapsed(earlyCollapse: boolean = false, extraPx = 0): boolean {
  // Dynamic breakpoint: each pinned app/extra tab widens the inline nav, so
  // raise the collapse threshold accordingly — otherwise the nav clips the
  // last tab instead of moving items into the "More" popover.
  const base = earlyCollapse
    ? HEADER_NAV_COLLAPSE_BASE_PX_WITH_BANNER
    : HEADER_NAV_COLLAPSE_BASE_PX;
  const query = `(max-width: ${base + extraPx}px)`;

  const [collapsed, setCollapsed] = React.useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const handleChange = () => setCollapsed(media.matches);
    handleChange();
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, [query]);

  return collapsed;
}

type NavItem = {
  key: string;
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  activeClassName: string;
  disabled?: boolean;
  /** Render this glyph instead of `Icon` (used by Chat's 💬). */
  emoji?: string;
  /** Render the live conversation count badge (Chat only). */
  badge?: "chat";
};

export function AppHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isAdmin } = useAdminRole();
  const { streamingConversations, unviewedConversations, inputRequiredConversations, conversations, activeConversationId } = useChatStore();
  const chatHref = React.useMemo(
    () => resolveChatNavigationPath({ conversations, activeConversationId }),
    [conversations, activeConversationId],
  );
  const {
    hasUnsavedChanges,
    pendingNavigationHref,
    cancelNavigation,
    confirmNavigation,
    requestNavigation,
    setUnsaved,
  } = useUnsavedChangesStore();

  // Editors in EDITOR_ROUTES_WITH_HEADER_DIALOG (Workflows, Dynamic Agent
  // editor) ask the AppHeader to render the discard dialog on their behalf
  // for top-nav clicks. Other editors (e.g. /skills/workspace) own their own
  // in-page dialog and consume `pendingNavigationHref` directly — that keeps
  // the dialog visually consistent with each editor's "Back" button.
  const shouldRenderHeaderDialog =
    isOnHeaderDialogEditor(pathname) && hasUnsavedChanges;

  const handleDiscard = React.useCallback(() => {
    const href = confirmNavigation();
    if (href) {
      setUnsaved(false);
      window.location.href = href;
    }
  }, [confirmNavigation, setUnsaved]);

  const handleCancel = React.useCallback(() => {
    cancelNavigation();
  }, [cancelNavigation]);

  const [reportDialogOpen, setReportDialogOpen] = React.useState(false);
  // Controlled state for the admin alerts popover. Per-row clicks
  // navigate programmatically via `router.push()` (not via an `<a>`
  // inside the popover) because the popover's own outside-click
  // listener tears down the floating layer before the browser's
  // synthetic click on a nested `<a>` can fire — the navigation
  // visibly does nothing in that race. Programmatic navigation + an
  // explicit close-after-push is deterministic.
  const [alertsPopoverOpen, setAlertsPopoverOpen] = React.useState(false);
  const router = useRouter();

  // Debug logging for admin tab
  React.useEffect(() => {
    if (session) {
      console.log('[AppHeader] Session role:', session.role);
      // Note: groups removed from session to prevent oversized cookies
      console.log('[AppHeader] Is admin (with MongoDB check)?', isAdmin);
    }
  }, [session, isAdmin]);

  // Health check for the Dynamic Agents runtime API path (polls every 30 seconds)
  const {
    status: runtimeStatus,
  } = useAgentRuntimeHealth();
  const storageMode = config.storageMode;

  // Health check for RAG server (polls every 30 seconds)
  const {
    status: ragStatus
  } = useRAGHealth();
  const {
    status: platformProbeStatus,
    capabilities: platformCapabilities,
    secondsUntilNextCheck: platformProbeNextCheck,
  } = usePlatformHealthProbes();

  // Check if RAG is enabled in config
  const ragEnabled = config.ragEnabled;

  // Fetch version info
  const { versionInfo } = useVersion();
  const releasePrompt = useReleaseUpgradePrompt();
  const migrationStatus = useMigrationStatus();
  // Admin-only Keycloak health summary so the header chip can surface
  // invariant failures (e.g. missing OBO scope binding, AFFIRMATIVE policy
  // misconfiguration) without making the admin navigate to Security &
  // Policy → Keycloak just to notice. Gated by `isAdmin` so non-admin
  // sessions never trigger the underlying Keycloak Admin round-trip.
  const keycloakHealth = useKeycloakHealthSummary({ enabled: isAdmin });
  const noAuthConfigured = !config.ssoEnabled || config.unsafeRbacBypassEnabled;
  const noAuthStatusText = config.unsafeRbacBypassEnabled
    ? "RBAC bypass is enabled. UI authorization checks allow every operation."
    : "SSO is disabled. This deployment is not enforcing browser sign-in.";

  // Combined status: hard failures from the API path or platform
  // dependencies mark the system as disconnected; optional RAG failures are
  // degraded so the core chat/runtime path can still show separately.
  const getCombinedStatus = () => {
    if (runtimeStatus === "checking") return "checking";
    if (ragEnabled && ragStatus === "checking") return "checking";
    if (platformProbeStatus === "checking") return "checking";
    if (runtimeStatus === "disconnected") return "disconnected";
    if (platformProbeStatus === "down") return "disconnected";
    if (platformProbeStatus === "degraded") return "degraded";
    if (ragEnabled && ragStatus === "disconnected") return "rag-disconnected";
    return "connected";
  };

  const combinedStatus = getCombinedStatus();
  const combinedStatusLabel =
    combinedStatus === "connected" ? "Healthy" :
    combinedStatus === "checking" ? "Checking" :
    "Degraded";
  // assisted-by Codex Codex-sonnet-4-6
  const activeCapabilities = platformCapabilities.filter(
    (capability) => capability.status !== "disabled",
  );
  const [expandedHealthDetails, setExpandedHealthDetails] = React.useState<Set<string>>(
    () => new Set(),
  );
  const toggleHealthDetail = React.useCallback((capabilityId: string) => {
    setExpandedHealthDetails((current) => {
      const next = new Set(current);
      if (next.has(capabilityId)) {
        next.delete(capabilityId);
      } else {
        next.add(capabilityId);
      }
      return next;
    });
  }, []);
  const platformHealthLabel =
    platformProbeStatus === "healthy" ? "Ready" :
    platformProbeStatus === "degraded" ? "Degraded" :
    platformProbeStatus === "down" ? "Down" :
    "Checking";

  const getActiveTab = () => {
    if (pathname === "/") return "home";
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    if (pathname?.startsWith("/credentials")) return "credentials";
    if (pathname?.startsWith("/workflows")) return "workflows";
    if (pathname?.startsWith("/skills") || pathname?.startsWith("/use-cases")) return "skills";
    if (pathname?.startsWith("/dynamic-agents")) return "dynamic-agents";
    if (pathname?.startsWith("/schedules")) return "schedules";
    if (pathname?.startsWith("/admin")) return "admin";
    return "home";
  };

  const activeTab = getActiveTab();
  // Admin-only alerts shown in the right cluster. Sources collapse into
  // a SINGLE pill ("Alerts: <total>") to keep the header uncluttered —
  // see the rendering block further down. Severity is `red` when the
  // condition is service-down / blocking; `amber` otherwise.
  //
  // Order matters for two things:
  //   - the unified pill's deep-link picks the first entry by severity
  //     (red wins, then array order for ties), and
  //   - the title / aria-label lists alerts in the same order so the
  //     hover-text is stable.
  //
  // Counts are source-owned and additive, so the total in the unified
  // pill is a simple sum across the visible sources.
  type AdminAlertSource = {
    id: string;
    label: string;
    count: number;
    severity: "red" | "amber";
    href: string;
  };
  const keycloakSummary = keycloakHealth.summary;
  const keycloakStatus =
    keycloakSummary?.status ?? (keycloakSummary?.reachable ? "reachable" : "unreachable");
  const keycloakStatusAlert =
    keycloakSummary?.configured && keycloakStatus !== "reachable"
      ? {
          id:
            keycloakStatus === "admin_authorization_error"
              ? "keycloak_admin_authorization"
              : keycloakStatus === "reconciliation_error"
                ? "keycloak_reconciliation_error"
                : "keycloak_unreachable",
          label:
            keycloakStatus === "admin_authorization_error"
              ? `Keycloak admin API authorization failed for realm ${keycloakSummary.realm}`
              : keycloakStatus === "reconciliation_error"
                ? `Keycloak reconciliation failing for realm ${keycloakSummary.realm}`
                : `Keycloak realm ${keycloakSummary.realm} unreachable`,
          count: 1,
          severity: "red" as const,
          href: "/admin?cat=security&tab=keycloak",
        }
      : null;
  const adminAlerts: AdminAlertSource[] = isAdmin
    ? ([
        keycloakStatusAlert,
        migrationStatus.status?.is_blocking
          ? {
              id: "migrations_blocking",
              label: "Migrations required",
              count: migrationStatus.status.blocking_required_count ?? 0,
              severity: "red" as const,
              href: "/admin?cat=security&tab=migrations",
            }
          : null,
        keycloakHealth.summary?.invariants && keycloakHealth.summary.invariants.failing > 0
          ? {
              id: "keycloak_invariants",
              label: `Keycloak invariant${keycloakHealth.summary.invariants.failing === 1 ? "" : "s"} failing`,
              count: keycloakHealth.summary.invariants.failing,
              severity: "amber" as const,
              href: "/admin?cat=security&tab=keycloak",
            }
          : null,
        !migrationStatus.status?.is_blocking && migrationStatus.status?.needs_version_bootstrap
          ? {
              id: "version_bootstrap",
              label: "Version metadata needed",
              count: migrationStatus.status.version_bootstrap_required_count ?? 0,
              severity: "amber" as const,
              href: "/admin?cat=security&tab=migrations",
            }
          : null,
        !migrationStatus.status?.is_blocking && migrationStatus.status?.override_active
          ? {
              id: "migration_override",
              label: "Migration override active",
              count: 1,
              severity: "amber" as const,
              href: "/admin?cat=security&tab=migrations",
            }
          : null,
      ].filter(Boolean) as AdminAlertSource[])
    : [];

  // The early-collapse signal for the inline nav: any time the admin
  // alert pill is showing it adds ~140-200px of width to the right
  // cluster, which can push the inline nav (including the Admin tab)
  // into overflow. Keep the existing breakpoint behavior by treating
  // the unified pill the same as the old per-source banners.
  const hasMigrationBanner = adminAlerts.length > 0;
  // No pinned agentic app nav items in CAIPE (mirror-only feature).
  const pinnedAppNavItems: Array<{
    key: string;
    href: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    activeClassName: string;
  }> = [];
  // Admin-customized top-nav order + enabled/disabled set (Admin → Settings →
  // Navigation), stored in platform_config.top_nav and readable by any
  // authenticated user. Applied to the unified nav list below.
  const [topNavConfig, setTopNavConfig] = React.useState<TopNavConfig | null>(
    null,
  );
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/platform-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.data?.top_nav) return;
        setTopNavConfig(normalizeTopNavConfig(body.data.top_nav));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  // Collapse into "More" sooner when pinned-app tabs widen the inline nav
  // (~150px each) so it overflows gracefully instead of clipping the last tab.
  const headerNavCollapsed = useHeaderNavCollapsed(
    hasMigrationBanner,
    pinnedAppNavItems.length * 150,
  );
  // Primary tabs always available regardless of MongoDB/feature flags. These
  // join the secondary tabs + pinned apps into a single ordered list so the
  // admin Navigation editor can reorder/hide any of them.
  const primaryNavItems = [
    {
      key: "home",
      href: "/",
      label: "Home",
      Icon: Home,
      activeClassName: "gradient-primary text-white shadow-sm",
    },
    {
      key: "chat",
      href: "/chat",
      label: "Chat",
      Icon: Home, // unused; chat renders an emoji glyph
      emoji: "💬",
      badge: "chat" as const,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
    {
      key: "projects",
      href: "/projects",
      label: "Projects",
      Icon: FolderKanban,
      activeClassName: "bg-indigo-600 text-white shadow-sm",
    },
    {
      key: "skills",
      href: "/skills",
      label: "Skills",
      Icon: Zap,
      activeClassName: "gradient-primary text-white shadow-sm",
    },
  ];


  const secondaryNavItems = [
    config.workflowsEnabled && {
      key: "workflows",
      href: "/workflows",
      label: "Workflows",
      Icon: Workflow,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
    ragEnabled && {
      key: "knowledge",
      href: "/knowledge-bases",
      label: "Knowledge Bases",
      Icon: Database,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
    storageMode === "mongodb" && {
      key: "dynamic-agents",
      href: "/dynamic-agents",
      label: "Agents",
      Icon: Bot,
      activeClassName: "bg-purple-500 text-white shadow-sm",
    },
    storageMode === "mongodb" && config.dynamicAgentsEnabled && config.schedulerEnabled && {
      key: "schedules",
      href: "/schedules",
      label: "Schedules",
      Icon: CalendarClock,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
    storageMode === "mongodb" && config.userConnectionsEnabled && {
      key: "credentials",
      href: "/credentials#connections",
      label: "Credentials",
      Icon: KeyRound,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
    (session || isAdmin) && {
      key: "admin",
      href: "/admin",
      label: "Admin",
      Icon: Shield,
      disabled: storageMode !== "mongodb",
      activeClassName:
        activeTab === "admin" && isAdmin
          ? "bg-red-500 text-white shadow-sm"
          : "bg-primary text-primary-foreground shadow-sm",
    },
  ].filter(Boolean) as Array<NavItem>;

  // Unified, admin-ordered nav list: primary tabs + secondary tabs + pinned
  // apps, then the admin's order/hidden config applied on top.
  const navItems: NavItem[] = applyTopNavConfig(
    [...primaryNavItems, ...secondaryNavItems],
    topNavConfig,
  );
  // When collapsed, keep the first few tabs inline and push the rest into the
  // "More" popover. When not collapsed, everything renders inline.
  const INLINE_WHEN_COLLAPSED = 4;
  const inlineNavItems = headerNavCollapsed
    ? navItems.slice(0, INLINE_WHEN_COLLAPSED)
    : navItems;
  const moreNavItems = headerNavCollapsed
    ? navItems.slice(INLINE_WHEN_COLLAPSED)
    : [];

  const renderSecondaryNavItem = (
    item: NavItem,
    variant: "inline" | "menu",
  ) => {
    const Icon = item.Icon;
    const baseClassName =
      variant === "inline"
        ? "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all"
        : "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors";
    const inactiveClassName =
      variant === "inline"
        ? "text-muted-foreground hover:text-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground";
    const disabledClassName =
      variant === "inline"
        ? "text-muted-foreground/50 opacity-50 cursor-not-allowed"
        : "text-muted-foreground/50 opacity-50 cursor-not-allowed";
    const className = cn(
      // Chat's live badge is absolutely positioned, so its inline pill needs
      // `relative` for the badge to anchor correctly.
      item.badge === "chat" && variant === "inline" && "relative",
      baseClassName,
      item.disabled
        ? disabledClassName
        : activeTab === item.key
          ? item.activeClassName
          : inactiveClassName,
    );

    const content = (
      <>
        {item.emoji ? (
          <span aria-hidden className="shrink-0">
            {item.emoji}
          </span>
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0" />
        )}
        {item.label}
        {item.badge === "chat" && variant === "inline" && (
          <>
            {streamingConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-emerald-500 text-[9px] font-bold text-white">
                  {streamingConversations.size}
                </span>
              </span>
            )}
            {streamingConversations.size === 0 && inputRequiredConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-amber-500 text-[9px] font-bold text-white">
                  {inputRequiredConversations.size}
                </span>
              </span>
            )}
            {streamingConversations.size === 0 && inputRequiredConversations.size === 0 && unviewedConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-blue-500 text-[9px] font-bold text-white">
                  {unviewedConversations.size}
                </span>
              </span>
            )}
          </>
        )}
      </>
    );

    if (item.disabled) {
      return (
        <div key={item.key} className={className}>
          {content}
        </div>
      );
    }

    return (
      <GuardedLink key={item.key} href={item.href} prefetch={true} className={className}>
        {content}
      </GuardedLink>
    );
  };

  return (
    <>
    <header className="h-14 overflow-hidden border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between gap-2 px-3 sm:px-4 shrink-0 z-50">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4 overflow-hidden">
        {/* Logo - clickable to home */}
        <GuardedLink
          href="/"
          className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity shrink-0"
        >
          <img
            src={config.logoUrl}
            alt={`${config.appName} Logo`}
            className={`h-8 w-auto ${getLogoFilterClass(config.logoStyle)}`}
          />
          <span className="hidden sm:inline font-bold text-base gradient-text">{config.appName}</span>
          {config.envBadge && (
            <span className="hidden md:inline-flex px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded">
              {config.envBadge}
            </span>
          )}
        </GuardedLink>

        {/* Navigation Pills — unified, admin-ordered list (Admin → Settings →
            Navigation). Collapses overflow into a "More" popover. */}
        <div className="flex items-center flex-nowrap min-w-0 bg-muted/50 rounded-full p-1">
          {inlineNavItems.map((item) => renderSecondaryNavItem(item, "inline"))}
          {moreNavItems.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-more-btn="1"
                  aria-label="More navigation"
                  className={cn(
                    "flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-all",
                    moreNavItems.some((item) => activeTab === item.key)
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>More</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-56 p-2">
                <div className="space-y-1">
                  {moreNavItems.map((item) => renderSecondaryNavItem(item, "menu"))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Status & Actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Combined Connection Status */}
        <div className="flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label={`System status: ${combinedStatusLabel}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full text-xs font-medium cursor-pointer transition-all hover:scale-105",
                  // When connected: fixed square so the lone dot stays a perfect circle
                  combinedStatus === "connected"
                    ? "h-8 w-8 justify-center bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/20"
                    : "px-2.5 py-1",
                  combinedStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  combinedStatus === "degraded" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  combinedStatus === "rag-disconnected" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  combinedStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                )}
              >
                {combinedStatus === "checking" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <div className={cn(
                    "h-2 w-2 rounded-full shrink-0 transition-colors duration-700",
                    combinedStatus === "connected" && "bg-green-400",
                    combinedStatus === "degraded" && "bg-amber-400",
                    combinedStatus === "rag-disconnected" && "bg-amber-400",
                    combinedStatus === "disconnected" && "bg-red-400",
                  )} />
                )}
                {/* Label animates in only when not "connected" */}
                <AnimatePresence initial={false}>
                  {combinedStatus !== "connected" && (
                    <motion.span
                      key={combinedStatusLabel}
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      {combinedStatusLabel}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0 overflow-hidden">
              <div className="bg-card">
                <div className="border-b border-border/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {isAdmin ? (
                        <GuardedLink
                          href="/admin?cat=platform&tab=health"
                          className="inline-flex max-w-full items-center gap-1 rounded-sm text-sm font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Open Admin health status"
                        >
                          <span className="truncate">System Status</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        </GuardedLink>
                      ) : (
                        <div className="text-sm font-semibold text-foreground">System Status</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                      <span className={cn(
                        "h-2 w-2 rounded-full",
                        combinedStatus === "connected" && "bg-green-400",
                        combinedStatus === "checking" && "bg-amber-400",
                        combinedStatus === "degraded" && "bg-amber-400",
                        combinedStatus === "rag-disconnected" && "bg-amber-400",
                        combinedStatus === "disconnected" && "bg-red-400",
                      )} />
                      {combinedStatusLabel}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Platform
                      </div>
                      <div className="text-xs text-muted-foreground">{platformHealthLabel}</div>
                    </div>
                    {platformProbeStatus === "checking" && activeCapabilities.length === 0 ? (
                      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking capabilities
                      </div>
                    ) : activeCapabilities.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {activeCapabilities.map((capability) => {
                          const showDetail = capability.status === "degraded" || capability.status === "down";
                          const expanded = expandedHealthDetails.has(capability.id);
                          const dot = (
                            <span className={cn(
                              "mt-1 h-2 w-2 shrink-0 rounded-full",
                              capability.status === "healthy" && "bg-green-400",
                              capability.status === "degraded" && "bg-amber-400",
                              capability.status === "down" && "bg-red-400",
                            )} />
                          );

                          if (!showDetail) {
                            return (
                              <div key={capability.id} className="flex items-center justify-between gap-3">
                                <div className="min-w-0 truncate text-xs font-medium text-foreground">
                                  {capability.label}
                                </div>
                                <span className={cn(
                                  "h-2 w-2 shrink-0 rounded-full",
                                  capability.status === "healthy" && "bg-green-400",
                                )} />
                              </div>
                            );
                          }

                          return (
                            <div key={capability.id} className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-foreground">
                                  {capability.label}
                                </div>
                                <button
                                  type="button"
                                  className={cn(
                                    "mt-0.5 block max-w-full rounded-sm text-left text-[11px] leading-snug text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    expanded ? "whitespace-normal break-words" : "overflow-hidden text-ellipsis whitespace-nowrap",
                                  )}
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? "Collapse" : "Expand"} ${capability.label} details`}
                                  onClick={() => toggleHealthDetail(capability.id)}
                                >
                                  <span
                                    className={cn(
                                      "block max-w-full",
                                      expanded ? "whitespace-normal break-words" : "overflow-hidden text-ellipsis whitespace-nowrap",
                                    )}
                                  >
                                    {capability.detail}
                                  </span>
                                </button>
                              </div>
                              {dot}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-muted-foreground">
                        No active platform capabilities reported.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 border-t border-border/50 bg-muted/20 px-4 py-2.5">
                  <div className="text-right text-xs text-muted-foreground">
                    Next: {platformProbeNextCheck}s
                  </div>
                  {versionInfo && (
                    <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground font-mono">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-semibold text-primary">UI:</span>
                        <span>{versionInfo.version}</span>
                        {versionInfo.gitCommit !== "unknown" && (
                          <span className="text-muted-foreground/60">
                            ({versionInfo.gitCommit.substring(0, 7)})
                          </span>
                        )}
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent("open-changelog"))}
                          className="inline-flex items-center gap-1 text-primary hover:underline font-sans font-medium cursor-pointer"
                        >
                          <FileText className="h-3 w-3" />
                          Changelog
                        </button>
                      </div>
                      {versionInfo.buildDate && (
                        <span className="shrink-0 text-muted-foreground/60">
                          Built: {new Date(versionInfo.buildDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
          {noAuthConfigured && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  aria-label="No auth configured"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/15 text-xs font-medium text-amber-500 transition-all hover:bg-amber-500/20 hover:scale-105"
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span>No Auth</span>
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-80 p-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    No Auth Configured
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {noAuthStatusText} All operations should be treated as admin-capable. Do not use this mode in production.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {/*
            Unified admin alerts pill. A single labelled `Alerts: <total>`
            trigger keeps the header compact when multiple subsystems flag
            issues simultaneously. Trigger severity is the worst across all
            visible sources (red wins over amber).

            Clicking the pill opens a popover that lists every active alert
            as its own row, each with its own GuardedLink to the relevant
            admin tab so lower-severity items remain actionable.

            Per-row navigation uses GuardedLink so unsaved-changes
            guards still fire. The popover closes itself on row click
            via the controlled `alertsPopoverOpen` state so the
            destination doesn't see a stale open popover after route
            transition.
          */}
          {adminAlerts.length > 0 && (() => {
            const hasRed = adminAlerts.some((a) => a.severity === "red");
            const totalCount = adminAlerts.reduce((sum, a) => sum + a.count, 0);
            const breakdown = adminAlerts
              .map((a) => `${a.label}: ${a.count}`)
              .join(" · ");
            const triggerLabel = `${totalCount} admin alert${totalCount === 1 ? "" : "s"} — ${breakdown}. Click to see the list and choose which one to fix.`;
            return (
              <Popover open={alertsPopoverOpen} onOpenChange={setAlertsPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={triggerLabel}
                    aria-haspopup="dialog"
                    title={triggerLabel}
                    data-testid="header-admin-alerts-trigger"
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer hover:scale-105",
                      hasRed
                        ? "border-red-500/30 bg-red-500/15 text-red-500 hover:bg-red-500/20"
                        : "border-amber-500/30 bg-amber-500/15 text-amber-500 hover:bg-amber-500/20",
                    )}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    <span className="hidden xl:inline">Alerts:</span>
                    <span>{totalCount}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="end"
                  className="w-80 p-2"
                  data-testid="header-admin-alerts-popover"
                >
                  <div className="px-2 py-1.5 border-b mb-1">
                    <p className="text-xs font-semibold text-foreground">
                      Admin alerts ({totalCount})
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Choose an alert to open its admin tab.
                    </p>
                  </div>
                  <ul className="space-y-0.5" role="list">
                    {adminAlerts.map((alert) => {
                      const rowLabel = `${alert.label} (${alert.count}) — open ${alert.href.includes("tab=keycloak") ? "Keycloak" : "Migrations"} tab to fix`;
                      const handleAlertNavigate = () => {
                        // Honour the unsaved-changes guard the same way
                        // GuardedLink does — if the user has pending edits
                        // on the current page, defer navigation to the
                        // discard dialog; otherwise push immediately.
                        if (hasUnsavedChanges) {
                          requestNavigation(alert.href);
                        } else {
                          router.push(alert.href);
                        }
                        setAlertsPopoverOpen(false);
                      };
                      return (
                        <li key={alert.id}>
                          <button
                            type="button"
                            onClick={handleAlertNavigate}
                            aria-label={rowLabel}
                            title={rowLabel}
                            data-testid={`admin-alert-row-${alert.id}`}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                              "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                              alert.severity === "red"
                                ? "text-red-500"
                                : "text-amber-500",
                            )}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "h-2 w-2 shrink-0 rounded-full",
                                  alert.severity === "red"
                                    ? "bg-red-500"
                                    : "bg-amber-500",
                                )}
                              />
                              <span className="truncate">{alert.label}</span>
                            </span>
                            <span className="flex items-center gap-1 shrink-0">
                              <span
                                className={cn(
                                  "tabular-nums",
                                  alert.severity === "red"
                                    ? "text-red-500"
                                    : "text-amber-500",
                                )}
                              >
                                {alert.count}
                              </span>
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </PopoverContent>
              </Popover>
            );
          })()}
        </div>

        {/* Personalization, Links & User */}
        <div className="flex items-center gap-1 border-l border-border pl-1.5">
          {config.reportProblemEnabled && (
            <>
              <button
                aria-label="Report a Problem"
                title="Report a Problem"
                className="flex items-center gap-1.5 h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setReportDialogOpen(true)}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <motion.span
                  initial={false}
                  animate={{ opacity: 1, width: "auto" }}
                  className="overflow-hidden whitespace-nowrap hidden sm:block"
                >
                  Report a Problem
                </motion.span>
              </button>
              <ReportProblemDialog
                open={reportDialogOpen}
                onOpenChange={setReportDialogOpen}
              />
            </>
          )}
          <SettingsPanel />
          {config.docsUrl && (
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a href={config.docsUrl} target="_blank" rel="noopener noreferrer" title="Documentation">
                <BookOpen className="h-4 w-4" />
              </a>
            </Button>
          )}
          {config.sourceUrl && (
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" title="Source Code">
                <Github className="h-4 w-4" />
              </a>
            </Button>
          )}
          <UserMenu />
        </div>
      </div>
    </header>

    {shouldRenderHeaderDialog && pendingNavigationHref && (
      <UnsavedChangesDialog
        open={!!pendingNavigationHref}
        onDiscard={handleDiscard}
        onCancel={handleCancel}
        title="Unsaved changes"
        description="You have unsaved changes. They will be lost if you leave now."
      />
    )}
    {session && releasePrompt.releaseVersion && (
      <ReleaseUpgradeDialog
        open={releasePrompt.open}
        isAdmin={releasePrompt.isAdmin}
        releaseVersion={releasePrompt.releaseVersion}
        release={releasePrompt.release}
        releaseMarkdown={releasePrompt.releaseMarkdown}
        onSkipUntilNextLogin={releasePrompt.skipUntilNextLogin}
        onDismissPermanently={releasePrompt.dismissPermanently}
        isDismissing={releasePrompt.isDismissing}
      />
    )}
    </>
  );
}

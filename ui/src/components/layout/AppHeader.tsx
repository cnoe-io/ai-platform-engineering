"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAdminRole } from "@/hooks/use-admin-role";
import {
  BookOpen,
  Zap,
  Loader2,
  Database,
  Shield,
  FileText,
  Workflow,
  FolderKanban,
  Home,
  LayoutGrid,
  Bot,
  AlertTriangle,
  CalendarClock,
  KeyRound,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { GithubIcon as Github } from "@/components/ui/icons";
import { UserMenu } from "@/components/user-menu";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { config, getLogoFilterClass } from "@/lib/config";
import { resolveChatNavigationPath, useChatStore } from "@/store/chat-store";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { UnsavedChangesDialog } from "@/components/shared/UnsavedChangesDialog";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { useAgentRuntimeHealth } from "@/hooks/use-agent-runtime-health";
import { usePlatformHealthProbes } from "@/hooks/use-platform-health-probes";
import { useVersion } from "@/hooks/use-version";
import { useReleaseUpgradePrompt } from "@/hooks/use-release-upgrade-prompt";
import { useMigrationStatus } from "@/hooks/use-migration-status";
import { useKeycloakHealthSummary } from "@/hooks/use-keycloak-health-summary";
import { ReleaseUpgradeDialog } from "@/components/release/ReleaseUpgradeDialog";
import { ReportProblemDialog } from "@/components/ticket/ReportProblemDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  applyTopNavConfig,
  normalizeTopNavConfig,
  type TopNavConfig,
} from "@/lib/nav/top-nav-items";


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

function isOnTomeProjectSettings(
  pathname: string | null | undefined,
): boolean {
  return Boolean(pathname && /^\/projects\/[^/]+\/tome\/settings(?:\/|$)/.test(pathname));
}

function isOnGuardedEditor(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return isOnTomeProjectSettings(pathname)
    || EDITOR_ROUTES_WITH_OWN_DISCARD_DIALOG.some((p) => pathname.startsWith(p));
}

function isOnHeaderDialogEditor(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  return isOnTomeProjectSettings(pathname)
    || EDITOR_ROUTES_WITH_HEADER_DIALOG.some((p) => pathname.startsWith(p));
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

type NavItem = {
  key: string;
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  activeTextClassName: string;
  activeIndicatorClassName: string;
  disabled?: boolean;
  /** Render this glyph instead of `Icon` (used by Chat's 💬). */
  emoji?: string;
  /** Render the live conversation count badge (Chat only). */
  badge?: "chat";
};

export function calculateVisibleHeaderNavItems({
  containerWidth,
  logoWidth,
  currentActionsWidth,
  expandedActionsWidth,
  actionsCompact,
  itemWidths,
  moreWidth,
}: {
  containerWidth: number;
  logoWidth: number;
  currentActionsWidth: number;
  expandedActionsWidth: number;
  actionsCompact: boolean;
  itemWidths: number[];
  moreWidth: number;
}): number {
  // Compacting the right cluster increases the flex width available to the
  // navigation container. Subtract that reclaimed space so the fit decision
  // is always made against the expanded action width. Otherwise:
  // overflow -> compact actions -> more room -> expand actions -> overflow.
  const reclaimedActionsWidth = actionsCompact
    ? Math.max(0, expandedActionsWidth - currentActionsWidth)
    : 0;
  const available =
    containerWidth - logoWidth - 16 - reclaimedActionsWidth;

  let used = 0;
  let count = 0;
  for (let i = 0; i < itemWidths.length; i++) {
    const wouldNeedMore = i < itemWidths.length - 1;
    if (
      used +
        itemWidths[i] +
        (wouldNeedMore ? moreWidth : 0) >
      available
    ) {
      break;
    }
    used += itemWidths[i];
    count++;
  }

  return Math.max(count, 1);
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const { data: session } = useSession();
  const { isAdmin } = useAdminRole();
  const {
    isStreaming,
    streamingConversations,
    unviewedConversations,
    inputRequiredConversations,
    conversations,
    activeConversationId,
    createConversation,
  } = useChatStore();
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
      // Keep confirmed navigation inside the Next.js app. A full-page
      // window.location navigation fires beforeunload handlers and can show a
      // second, browser-owned prompt after the user already confirmed in the
      // app dialog.
      router.push(href);
    }
  }, [confirmNavigation, router, setUnsaved]);

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
  const handleReportProblemClick = React.useCallback(async () => {
    if (config.reportProblemRouting === 'dynamic-agent' && config.reportProblemDynamicAgentId) {
      const newId = await createConversation(config.reportProblemDynamicAgentId);
      router.push(`/chat/${newId}`);
    } else {
      setReportDialogOpen(true);
    }
  }, [createConversation, router]);

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

  const mongoNavEnabled =
    storageMode === "mongodb" || config.storageMode === "mongodb";

  // Health check for RAG server (polls every 30 seconds)
  const {
    status: ragStatus
  } = useRAGHealth();

  // Platform health probes (polls all platform services: dynamic agents, auth, storage, RAG, migrations)
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
    if (pathname?.startsWith("/projects")) return "projects";
    if (pathname?.startsWith("/apps")) return "apps";
    if (pathname?.startsWith("/schedules")) return "schedules";
    if (pathname?.startsWith("/admin")) return "admin";
    return "home";
  };

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
  // Pinned agentic apps: any installed app whose manifest sets
  // surfaces.showInTopNav renders as a top-nav tab (sorted by navOrder by the
  // API). Lets admins promote installed agentic apps into the nav.
  const [pinnedAppNavItems, setPinnedAppNavItems] = React.useState<
    Array<{
      key: string;
      href: string;
      label: string;
      Icon: React.ComponentType<{ className?: string }>;
      activeTextClassName: string;
      activeIndicatorClassName: string;
    }>
  >([]);
  React.useEffect(() => {
    if (!(mongoNavEnabled && config.agenticAppsEnabled)) return;
    let cancelled = false;
    fetch("/api/agentic-apps")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        const items = (body.items ?? body.data?.items ?? []) as Array<{
          appId: string;
          href?: string;
          displayName?: string;
          surfaces?: { showInTopNav?: boolean };
        }>;
        setPinnedAppNavItems(
          items
            .filter(
              (a) => a?.surfaces?.showInTopNav === true && typeof a.href === "string",
            )
            .map((a) => ({
              key: `app-${a.appId}`,
              href: a.href as string,
              label: a.displayName ?? a.appId,
              Icon: LayoutGrid,
              activeTextClassName: "text-white",
              activeIndicatorClassName: "bg-cyan-600 shadow-sm",
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mongoNavEnabled]);
  // Active tab. A pinned agentic-app tab (href like /apps/embed/ttt or
  // /apps/agentic-sdlc) must win over the generic "Apps" tab when its route is
  // open — otherwise getActiveTab()'s broad `/apps` match highlights "Apps"
  // while the user is on the pinned app. Match the longest pinned href prefix
  // first, then fall back to the keyword map.
  const activePinnedApp = pinnedAppNavItems
    .filter((it) => pathname === it.href || pathname?.startsWith(`${it.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const activeTab = activePinnedApp ? activePinnedApp.key : getActiveTab();
  // Admin-customized top-nav order + enabled/disabled set (Admin → Settings →
  // Navigation), stored in platform_config.top_nav and readable by any
  // authenticated user. Applied to the unified nav list below.
  const [topNavConfig, setTopNavConfig] = React.useState<TopNavConfig | null>(
    null,
  );
  const fetchTopNavConfig = React.useCallback(() => {
    let cancelled = false;
    fetch("/api/admin/platform-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        setTopNavConfig(normalizeTopNavConfig(body?.data?.top_nav));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    const cleanup = fetchTopNavConfig();
    const handler = () => fetchTopNavConfig();
    window.addEventListener("caipe:top-nav-config-updated", handler);
    return () => {
      cleanup();
      window.removeEventListener("caipe:top-nav-config-updated", handler);
    };
  }, [fetchTopNavConfig]);
  // Primary tabs always available regardless of MongoDB/feature flags. These
  // join the secondary tabs + pinned apps into a single ordered list so the
  // admin Navigation editor can reorder/hide any of them.
  const primaryNavItems = [
    {
      key: "home",
      href: "/",
      label: "Home",
      Icon: Home,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "gradient-primary shadow-sm",
    },
    {
      key: "chat",
      href: chatHref,
      label: "Chat",
      Icon: Home, // unused; chat renders an emoji glyph
      emoji: "💬",
      badge: "chat" as const,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-sky-600 shadow-sm",
    },
    {
      key: "projects",
      href: "/projects",
      label: "TOME",
      Icon: FolderKanban,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-indigo-600 shadow-sm",
    },
    {
      key: "skills",
      href: "/skills",
      label: "Skills",
      Icon: Zap,
      activeTextClassName: "text-amber-950",
      activeIndicatorClassName: "bg-amber-500 shadow-sm",
    },
  ];

  const secondaryNavItems = [
    config.workflowsEnabled && {
      key: "workflows",
      href: "/workflows",
      label: "Workflows",
      Icon: Workflow,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-indigo-600 shadow-sm",
    },
    ragEnabled && {
      key: "knowledge",
      href: "/knowledge-bases",
      label: "Knowledge Bases",
      Icon: Database,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-emerald-600 shadow-sm",
    },
    mongoNavEnabled && config.dynamicAgentsEnabled && {
      key: "dynamic-agents",
      href: "/dynamic-agents",
      label: "Agents",
      Icon: Bot,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-violet-600 shadow-sm",
    },
    mongoNavEnabled && config.agenticAppsEnabled && {
      key: "apps",
      href: "/apps",
      label: "Apps",
      Icon: LayoutGrid,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-cyan-600 shadow-sm",
    },
    ...pinnedAppNavItems,
    mongoNavEnabled &&
      config.dynamicAgentsEnabled &&
      config.schedulerEnabled &&
      (!config.schedulerAdminOnly || isAdmin) && {
        key: "schedules",
        href: "/schedules",
        label: "Schedules",
        Icon: CalendarClock,
        activeTextClassName: "text-white",
        activeIndicatorClassName: "bg-orange-600 shadow-sm",
      },
    mongoNavEnabled && config.userConnectionsEnabled && {
      key: "credentials",
      href: "/credentials#connections",
      label: "Credentials",
      Icon: KeyRound,
      activeTextClassName: "text-white",
      activeIndicatorClassName: "bg-blue-600 shadow-sm",
    },
    (session || isAdmin) && {
      key: "admin",
      href: "/admin",
      label: "Admin",
      Icon: Shield,
      disabled: !mongoNavEnabled,
      activeTextClassName: "text-white",
      activeIndicatorClassName: isAdmin ? "bg-red-600 shadow-sm" : "bg-rose-600 shadow-sm",
    },
  ].filter(Boolean) as Array<NavItem>;

  // Unified, admin-ordered nav list: primary tabs + secondary tabs + pinned
  // apps, then the admin's order/hidden config applied on top.
  const navItems: NavItem[] = applyTopNavConfig(
    [...primaryNavItems, ...secondaryNavItems],
    topNavConfig,
  );

  // Nav overflow: ResizeObserver-based measurement, not fixed breakpoints.
  // Items that don't fit the available strip width move into "More".
  const [visibleCount, setVisibleCount] = React.useState<number>(navItems.length);
  const navStripRef = React.useRef<HTMLDivElement>(null);
  const leftContainerRef = React.useRef<HTMLDivElement>(null);
  const logoRef = React.useRef<HTMLDivElement>(null);
  const rightActionsRef = React.useRef<HTMLDivElement>(null);
  // Cached per-item widths — read once when all items are rendered, never again.
  const cachedWidthsRef = React.useRef<number[] | null>(null);
  // Captured while the right cluster is expanded. When the cluster compacts,
  // the left flex container grows by the same amount; accounting for that
  // reclaimed width prevents the two states from toggling each other.
  const expandedActionsWidthRef = React.useRef<number | null>(null);
  const MORE_WIDTH = 88;

  // Phase 1: when item count changes, reset cache and show everything so we can measure.
  React.useLayoutEffect(() => {
    cachedWidthsRef.current = null;
    setVisibleCount(navItems.length);
  }, [navItems.length]);

  // Phase 2: after full render, cache widths; on every container resize recompute
  // using ONLY stable measurements (container width, logo width, cached item widths).
  // Never reads strip.offsetWidth or strip children — that would create a feedback loop.
  React.useLayoutEffect(() => {
    const strip = navStripRef.current;
    const container = leftContainerRef.current;
    const logo = logoRef.current;
    const rightActions = rightActionsRef.current;
    if (!strip || !container || !logo || !rightActions) return;

    const recompute = () => {
      if (!cachedWidthsRef.current) {
        // Read item widths now, while visibleCount === navItems.length
        cachedWidthsRef.current = (Array.from(strip.children) as HTMLElement[])
          .filter((c) => !c.dataset.moreBtn)
          .map((c) => c.getBoundingClientRect().width);
      }
      const widths = cachedWidthsRef.current;
      const actionsCompact =
        rightActions.dataset.headerActionsCompact === "true";
      const currentActionsWidth = rightActions.offsetWidth;
      if (!actionsCompact || expandedActionsWidthRef.current === null) {
        expandedActionsWidthRef.current = currentActionsWidth;
      }

      setVisibleCount(
        calculateVisibleHeaderNavItems({
          containerWidth: container.offsetWidth,
          logoWidth: logo.offsetWidth,
          currentActionsWidth,
          expandedActionsWidth:
            expandedActionsWidthRef.current ?? currentActionsWidth,
          actionsCompact,
          itemWidths: widths,
          moreWidth: MORE_WIDTH,
        }),
      );
    };

    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    recompute();
    return () => ro.disconnect();
  }, [navItems.length]);

  const inlineNavItems = navItems.slice(0, visibleCount);
  const moreNavItems = navItems.slice(visibleCount);
  const activeOverflowItem = moreNavItems.find((item) => activeTab === item.key);
  // Right-cluster compacting (icon-only buttons) follows the same signal
  // that pushed items into "More" — if the nav strip is already tight,
  // shrink the status/settings/user cluster too so nothing clips.
  const headerNavCollapsed = moreNavItems.length > 0;

  const renderActiveNavIndicator = (item: NavItem) => (
    <motion.span
      aria-hidden="true"
      initial={false}
      layoutId="app-header-active-nav-pill"
      className={cn(
        "app-header-active-pill pointer-events-none absolute inset-0 rounded-full",
        item.activeIndicatorClassName,
      )}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 32, mass: 0.75 }
      }
    />
  );

  const renderSecondaryNavItem = (
    item: NavItem,
    variant: "inline" | "menu",
  ) => {
    const Icon = item.Icon;
    const baseClassName =
      variant === "inline"
        ? "relative isolate flex items-center px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors"
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
          ? variant === "inline"
            ? item.activeTextClassName
            : cn(item.activeTextClassName, item.activeIndicatorClassName)
          : inactiveClassName,
    );

    const content = (
      <>
        {variant === "inline" && !item.disabled && activeTab === item.key && renderActiveNavIndicator(item)}
        <span className="relative z-10 flex items-center gap-1.5">
          {item.emoji ? (
            <span aria-hidden className="shrink-0">
              {item.emoji}
            </span>
          ) : (
            <Icon className="h-3.5 w-3.5 shrink-0" />
          )}
          {item.label}
        </span>
        {item.badge === "chat" && variant === "inline" && (
          <>
            {streamingConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 z-20 flex h-4 w-4 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-emerald-500 text-[9px] font-bold text-white">
                  {streamingConversations.size}
                </span>
              </span>
            )}
            {streamingConversations.size === 0 && inputRequiredConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 z-20 flex h-4 w-4 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-amber-500 text-[9px] font-bold text-white">
                  {inputRequiredConversations.size}
                </span>
              </span>
            )}
            {streamingConversations.size === 0 && inputRequiredConversations.size === 0 && unviewedConversations.size > 0 && (
              <span className="absolute -top-1 -right-1 z-20 flex h-4 w-4 items-center justify-center">
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
    <header className="relative h-14 border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between gap-2 px-3 sm:px-4 shrink-0 z-50">
      <div ref={leftContainerRef} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4 overflow-hidden">
        {/* Logo - clickable to home. Wrapped in div so logoRef gives a stable offsetWidth. */}
        <div ref={logoRef} className="shrink-0">
          <GuardedLink
            href="/"
            className="brand-link flex items-center gap-2.5 cursor-pointer"
          >
            <Image
              src={config.logoUrl}
              alt={`${config.appName} Logo`}
              width={32}
              height={32}
              unoptimized
              className={`h-8 w-auto ${getLogoFilterClass(config.logoStyle)}`}
            />
            <span className="brand-lockup relative hidden sm:inline-block">
              <span className="brand-name gradient-text text-base font-bold">
                {config.appName}
              </span>
              <Sparkles
                aria-hidden="true"
                className="brand-sparkle pointer-events-none absolute -right-2.5 -top-2 h-3.5 w-3.5"
                strokeWidth={1.75}
              />
            </span>
            {config.envBadge && (
              <span className="hidden md:inline-flex px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded">
                {config.envBadge}
              </span>
            )}
          </GuardedLink>
        </div>

        {/* Navigation Pills — unified, admin-ordered list (Admin → Settings →
            Navigation). Overflow-aware: items that don't fit move to More. */}
        <div ref={navStripRef} className="flex items-center flex-nowrap min-w-0 bg-muted/50 rounded-full p-1">
          {inlineNavItems.map((item) => renderSecondaryNavItem(item, "inline"))}
          {moreNavItems.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-more-btn="1"
                  aria-label="More navigation"
                  className={cn(
                    "relative isolate flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                    activeOverflowItem
                      ? activeOverflowItem.activeTextClassName
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {activeOverflowItem && renderActiveNavIndicator(activeOverflowItem)}
                  <span className="relative z-10">More</span>
                  <ChevronDown className="relative z-10 h-3.5 w-3.5 shrink-0" />
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
      <div
        ref={rightActionsRef}
        data-header-actions-compact={headerNavCollapsed}
        className={cn(
          "flex shrink-0 items-center",
          headerNavCollapsed ? "gap-1.5" : "gap-3",
        )}
      >
        {/* Combined Connection Status */}
        <div className="flex items-center gap-2">
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
                    isStreaming && "animate-pulse"
                  )} />
                )}
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
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/15 text-xs font-medium text-amber-500 transition-all hover:bg-amber-500/20 hover:scale-105",
                    headerNavCollapsed && "h-8 w-8 justify-center px-0",
                  )}
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span className={headerNavCollapsed ? "sr-only" : ""}>No Auth</span>
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
        <div className={cn("flex items-center gap-1 border-l border-border", headerNavCollapsed ? "pl-1.5" : "pl-3")}>
          {config.reportProblemEnabled && (
            <>
              <Button
                variant="ghost"
                size={headerNavCollapsed ? "icon" : "sm"}
                aria-label="Provide Feedback"
                title="Provide Feedback"
                className={cn(
                  "h-8 text-xs text-muted-foreground hover:text-foreground",
                  headerNavCollapsed ? "w-8" : "gap-1.5",
                )}
                onClick={handleReportProblemClick}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {!headerNavCollapsed && "Provide Feedback"}
              </Button>
              {!config.reportProblemDynamicAgentId && (
                <ReportProblemDialog
                  open={reportDialogOpen}
                  onOpenChange={setReportDialogOpen}
                />
              )}
            </>
          )}
          <SettingsPanel compact={headerNavCollapsed} />
          {config.docsUrl && (
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a
                href={config.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Documentation"
              >
                <BookOpen className="h-4 w-4" />
              </a>
            </Button>
          )}
          {config.sourceUrl && (
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a
                href={config.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Source Code"
              >
                <Github className="h-4 w-4" />
              </a>
            </Button>
          )}
          {/* User Menu - Only shown when SSO is enabled */}
          <UserMenu compact={headerNavCollapsed} />
        </div>
      </div>
    </header>

    {shouldRenderHeaderDialog && pendingNavigationHref && (
      <UnsavedChangesDialog
        open={!!pendingNavigationHref}
        onDiscard={handleDiscard}
        onCancel={handleCancel}
        title={isOnTomeProjectSettings(pathname) ? "Discard unsaved settings?" : "Unsaved changes"}
        description={isOnTomeProjectSettings(pathname)
          ? "Your unsaved project settings will be lost if you leave now."
          : "You have unsaved changes. They will be lost if you leave now."}
        discardLabel={isOnTomeProjectSettings(pathname) ? "Discard and leave" : undefined}
        cancelLabel={isOnTomeProjectSettings(pathname) ? "Stay" : undefined}
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

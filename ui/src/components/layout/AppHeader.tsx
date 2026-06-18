"use client";

import { ReleaseUpgradeDialog } from "@/components/release/ReleaseUpgradeDialog";
import { SettingsPanel } from "@/components/settings-panel";
import { UnsavedChangesDialog } from "@/components/task-builder/UnsavedChangesDialog";
import { ReportProblemDialog } from "@/components/ticket/ReportProblemDialog";
import { Button } from "@/components/ui/button";
import { GithubIcon as Github } from "@/components/ui/icons";
import {
Popover,
PopoverContent,
PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { UserMenu } from "@/components/user-menu";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useAgentRuntimeHealth } from "@/hooks/use-agent-runtime-health";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import { useKeycloakHealthSummary } from "@/hooks/use-keycloak-health-summary";
import { useMigrationStatus } from "@/hooks/use-migration-status";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { useReleaseUpgradePrompt } from "@/hooks/use-release-upgrade-prompt";
import { useVersion } from "@/hooks/use-version";
import { config,getLogoFilterClass } from "@/lib/config";
import { cn,formatRelativeTime } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { AnimatePresence,motion } from "framer-motion";
import {
AlertTriangle,
BookOpen,
Bot,
ChevronDown,
ChevronRight,
Database,
FileText,
Home,
KeyRound,
Loader2,
Shield,
Sparkles,
Workflow,
Zap,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname,useRouter } from "next/navigation";
import React from "react";

/** Format seconds into a human-readable interval (e.g., "3h", "30m", "45s") */
function formatInterval(seconds: number): string {
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

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
  "/task-builder",
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
  "/task-builder",
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

export function AppHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isAdmin } = useAdminRole();
  const { isStreaming, streamingConversations, unviewedConversations, inputRequiredConversations } = useChatStore();
  const {
    hasUnsavedChanges,
    pendingNavigationHref,
    cancelNavigation,
    confirmNavigation,
    requestNavigation,
    setUnsaved,
  } = useUnsavedChangesStore();

  // Editors in EDITOR_ROUTES_WITH_HEADER_DIALOG (Task Builder, Dynamic Agent
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

  // Health check for CAIPE supervisor (polls every 30 seconds)
  const {
    status: caipeStatus,
    url: caipeUrl,
    secondsUntilNextCheck: caipeNextCheck,
    agents,
    tags,
    mongoDBStatus,
    storageMode
  } = useCAIPEHealth();

  // Health check for RAG server (polls every 30 seconds)
  const {
    status: ragStatus,
    url: ragUrl,
    secondsUntilNextCheck: ragNextCheck,
    graphRagEnabled,
    cleanupConfig
  } = useRAGHealth();

  // Health check for Agent Runtime (polls every 30 seconds)
  const { status: agentRuntimeStatus } = useAgentRuntimeHealth();

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
  const { toast } = useToast();
  const noAuthConfigured = !config.ssoEnabled || config.unsafeRbacBypassEnabled;
  const noAuthStatusText = config.unsafeRbacBypassEnabled
    ? "RBAC bypass is enabled. UI authorization checks allow every operation."
    : "SSO is disabled. This deployment is not enforcing browser sign-in.";

  React.useEffect(() => {
    if (!session || !releasePrompt.toastNotification) return;
    toast(
      releasePrompt.toastNotification.message,
      "info",
      releasePrompt.toastNotification.duration,
    );
    releasePrompt.markToastShown();
  }, [releasePrompt, session, toast]);

  // Combined status: if either is checking -> checking, if supervisor is disconnected -> disconnected,
  // if only RAG is disconnected (supervisor connected) -> rag-disconnected (amber warning), else connected
  // Note: Only include RAG in status if it's enabled
  const getCombinedStatus = () => {
    if (caipeStatus === "checking") return "checking";
    if (ragEnabled && ragStatus === "checking") return "checking";
    if (caipeStatus === "disconnected") return "disconnected";
    if (ragEnabled && ragStatus === "disconnected") return "rag-disconnected";
    return "connected";
  };

  const combinedStatus = getCombinedStatus();
  const combinedStatusLabel =
    combinedStatus === "connected" ? "Connected" :
    combinedStatus === "checking" ? "Checking" :
    combinedStatus === "rag-disconnected" ? "RAG Disconnected" :
    "Disconnected";

  const getActiveTab = () => {
    if (pathname === "/") return "home";
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    if (pathname?.startsWith("/credentials")) return "credentials";
    if (pathname?.startsWith("/workflows")) return "workflows";
    if (pathname?.startsWith("/task-builder")) return "task-builder";
    if (pathname?.startsWith("/autonomous")) return "autonomous";
    if (pathname?.startsWith("/skills") || pathname?.startsWith("/use-cases")) return "skills";
    if (pathname?.startsWith("/dynamic-agents")) return "dynamic-agents";
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
  // Counts use the same numbers each individual source previously
  // displayed in its own chip, so the total in the unified pill is
  // a simple sum across the visible sources.
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
  const secondaryNavItems = [
    config.taskBuilderEnabled && {
      key: "task-builder",
      href: "/task-builder",
      label: "Task Builder",
      Icon: Workflow,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
    config.autonomousAgentsEnabled && {
      key: "autonomous",
      href: "/autonomous",
      label: "Autonomous",
      Icon: Sparkles,
      activeClassName: "bg-primary text-primary-foreground shadow-sm",
    },
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
    storageMode === "mongodb" && config.dynamicAgentsEnabled && {
      key: "dynamic-agents",
      href: "/dynamic-agents",
      label: "Agents",
      Icon: Bot,
      activeClassName: "bg-purple-500 text-white shadow-sm",
    },
    storageMode === "mongodb" && config.userConnectionsEnabled && {
      key: "credentials",
      href: "/credentials",
      label: "Connections",
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
  ].filter(Boolean) as Array<{
    key: string;
    href: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    activeClassName: string;
    disabled?: boolean;
  }>;

  // All nav items in order — primary first, then secondary.
  type NavItem = {
    key: string;
    href: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    activeClassName: string;
    disabled?: boolean;
  };
  const allNavItems: NavItem[] = [
    { key: "home", href: "/", label: "Home", Icon: Home, activeClassName: "gradient-primary text-white shadow-sm" },
    { key: "chat", href: "/chat", label: "Chat", Icon: ({ className }: { className?: string }) => <span className={className}>💬</span>, activeClassName: "bg-primary text-primary-foreground shadow-sm" },
    { key: "skills", href: "/skills", label: "Skills", Icon: Zap, activeClassName: "gradient-primary text-white shadow-sm" },
    ...secondaryNavItems,
  ];

  const [visibleCount, setVisibleCount] = React.useState<number>(allNavItems.length);
  const navStripRef = React.useRef<HTMLDivElement>(null);
  const leftContainerRef = React.useRef<HTMLDivElement>(null);
  const logoRef = React.useRef<HTMLDivElement>(null);
  // Cached per-item widths — read once when all items are rendered, never again.
  const cachedWidthsRef = React.useRef<number[] | null>(null);
  const MORE_WIDTH = 88;

  // Phase 1: when item count changes, reset cache and show everything so we can measure.
  React.useLayoutEffect(() => {
    cachedWidthsRef.current = null;
    setVisibleCount(allNavItems.length);
  }, [allNavItems.length]);

  // Phase 2: after full render, cache widths; on every container resize recompute
  // using ONLY stable measurements (container width, logo width, cached item widths).
  // Never reads strip.offsetWidth or strip children — that would create a feedback loop.
  React.useLayoutEffect(() => {
    const strip = navStripRef.current;
    const container = leftContainerRef.current;
    const logo = logoRef.current;
    if (!strip || !container || !logo) return;

    const recompute = () => {
      if (!cachedWidthsRef.current) {
        // Read item widths now, while visibleCount === allNavItems.length
        cachedWidthsRef.current = (Array.from(strip.children) as HTMLElement[])
          .filter((c) => !c.dataset.moreBtn)
          .map((c) => c.getBoundingClientRect().width);
      }
      const widths = cachedWidthsRef.current;
      // Available width = container minus logo minus the gap between them (16px).
      const available = container.offsetWidth - logo.offsetWidth - 16;
      let used = 0;
      let count = 0;
      for (let i = 0; i < widths.length; i++) {
        const wouldNeedMore = i < widths.length - 1;
        if (used + widths[i] + (wouldNeedMore ? MORE_WIDTH : 0) > available) break;
        used += widths[i];
        count++;
      }
      setVisibleCount(Math.max(count, 1));
    };

    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    recompute();
    return () => ro.disconnect();
   
  }, [allNavItems.length]);

  const overflowItems = allNavItems.slice(visibleCount);
  const visibleItems = allNavItems.slice(0, visibleCount);

  const renderSecondaryNavItem = (
    item: (typeof secondaryNavItems)[number],
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
      baseClassName,
      item.disabled
        ? disabledClassName
        : activeTab === item.key
          ? item.activeClassName
          : inactiveClassName,
    );

    const content = (
      <>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {item.label}
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
    <header className="h-14 border-b border-border/50 bg-card/50 backdrop-blur-xl flex items-center justify-between gap-2 px-3 sm:px-4 shrink-0 z-50 relative">
      <div ref={leftContainerRef} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4 overflow-hidden">
        {/* Logo - clickable to home. Wrapped in div so logoRef gives a stable offsetWidth. */}
        <div ref={logoRef} className="shrink-0">
          <GuardedLink
            href="/"
            className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
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
        </div>

        {/* Navigation Pills — overflow-aware: items that don't fit move to More */}
        <div ref={navStripRef} className="flex items-center flex-nowrap min-w-0 bg-muted/50 rounded-full p-1">
          {visibleItems.map((item) => {
            if (item.key === "chat") {
              return (
                <GuardedLink
                  key="chat"
                  href="/chat"
                  prefetch={true}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all",
                    activeTab === "chat"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  💬 Chat
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
                </GuardedLink>
              );
            }
            return renderSecondaryNavItem(item, "inline");
          })}
          {overflowItems.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-more-btn="1"
                  aria-label="More navigation"
                  className={cn(
                    "flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-all",
                    overflowItems.some((item) => activeTab === item.key)
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
                  {overflowItems.map((item) => renderSecondaryNavItem(item, "menu"))}
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
                  combinedStatus === "rag-disconnected" && "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20",
                  combinedStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                )}
              >
                {combinedStatus === "checking" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <div className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    combinedStatus === "connected" && "bg-green-400 animate-pulse",
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
            <PopoverContent side="bottom" align="end" className="w-[600px] max-w-[calc(100vw-1rem)] p-0 overflow-hidden border-2">
              <div className="bg-gradient-to-br from-card via-card to-card/95">
                {/* Header with gradient */}
                <div className="gradient-primary-br p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-base font-bold text-white mb-1">System Status</div>
                      <div className="text-xs text-white/80">{config.appName} Agents & Knowledge Services</div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full",
                        combinedStatus === "connected" ? "bg-green-400 animate-pulse" :
                        combinedStatus === "checking" ? "bg-amber-400 animate-pulse" :
                        combinedStatus === "rag-disconnected" ? "bg-amber-400" : "bg-red-400"
                      )} />
                      <span className="text-xs font-medium text-white">
                        {combinedStatus === "connected" ? "All Systems Live" :
                         combinedStatus === "checking" ? "Checking" :
                         combinedStatus === "rag-disconnected" ? "RAG Offline" :
                         "Issues Detected"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* CAIPE Supervisor Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-foreground">{config.appName} Supervisor</div>
                        <div className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold",
                          caipeStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                          caipeStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                          caipeStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
                        )}>
                          {caipeStatus === "connected" ? "ONLINE" : caipeStatus === "checking" ? "CHECKING" : "OFFLINE"}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        Next check: {caipeNextCheck}s
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono break-all bg-muted/30 rounded px-2 py-1">
                      {caipeUrl}
                    </div>

                    {/* Agent Info */}
                    {agents.length > 0 && (
                      <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg gradient-primary-br flex items-center justify-center shrink-0">
                            <span className="text-lg font-bold text-white">AI</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm text-foreground mb-1">
                              {agents[0].name}
                            </div>
                            {agents[0].description && (
                              <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                {agents[0].description}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Storage Status */}
                    <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Storage Backend
                        </div>
                        <div className={cn(
                          "flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
                          mongoDBStatus === 'connected' && "bg-green-500/10 border-green-500/20",
                          mongoDBStatus === 'disconnected' && "bg-amber-500/10 border-amber-500/20",
                          mongoDBStatus === 'checking' && "bg-muted/50 border-border"
                        )}>
                          {mongoDBStatus === 'checking' ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          ) : (
                            <span className={cn(
                              "inline-block w-1.5 h-1.5 rounded-full",
                              mongoDBStatus === 'connected' && "bg-green-400",
                              mongoDBStatus === 'disconnected' && "bg-amber-400"
                            )} />
                          )}
                          <span className={cn(
                            "text-[10px] font-bold",
                            mongoDBStatus === 'connected' && "text-green-600 dark:text-green-400",
                            mongoDBStatus === 'disconnected' && "text-amber-600 dark:text-amber-400",
                            mongoDBStatus === 'checking' && "text-muted-foreground"
                          )}>
                            {mongoDBStatus === 'checking' ? 'Checking' : mongoDBStatus === 'connected' ? 'MongoDB' : 'localStorage'}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {mongoDBStatus === 'connected' && (
                          <span>✓ Persistent storage with cross-device sync</span>
                        )}
                        {mongoDBStatus === 'disconnected' && (
                          <span>Local browser storage (no sync)</span>
                        )}
                        {mongoDBStatus === 'checking' && (
                          <span>Checking backend availability...</span>
                        )}
                      </div>
                    </div>

                    {/* Integrations */}
                    {tags.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Connected Integrations
                          </div>
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                            <span className="text-[10px] font-bold text-primary">{tags.length}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                          {tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-gradient-to-br from-primary/10 to-primary/5 text-primary border border-primary/20 hover:border-primary/40 hover:bg-primary/15 transition-all"
                            >
                              <span className="inline-block w-1 h-1 rounded-full bg-green-400" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* RAG Server Section - only show if RAG is enabled */}
                  {ragEnabled && (
                    <>
                      {/* Divider */}
                      <div className="border-t border-border/50" />

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-foreground">RAG Server</div>
                            <div className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold",
                              ragStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                              ragStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                              ragStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
                            )}>
                              {ragStatus === "connected" ? "ONLINE" : ragStatus === "checking" ? "CHECKING" : "OFFLINE"}
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            Next check: {ragNextCheck}s
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono break-all bg-muted/30 rounded px-2 py-1">
                          {ragUrl}
                        </div>

                        {/* Graph RAG Status */}
                        <div className="flex items-center justify-between bg-muted/20 rounded px-2 py-1.5">
                          <div className="text-xs text-muted-foreground">Knowledge Graph</div>
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold",
                            graphRagEnabled
                              ? "bg-green-500/15 text-green-400 border border-green-500/30"
                              : "bg-gray-500/15 text-gray-400 border border-gray-500/30"
                          )}>
                            {graphRagEnabled ? "ON" : "OFF"}
                          </div>
                        </div>

                        {/* Auto-Cleanup Status */}
                        {cleanupConfig && (
                          <div className="bg-muted/20 rounded px-2 py-1.5 space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-muted-foreground">Auto-Cleanup</div>
                              <div className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-bold",
                                cleanupConfig.enabled
                                  ? "bg-green-500/15 text-green-400 border border-green-500/30"
                                  : "bg-gray-500/15 text-gray-400 border border-gray-500/30"
                              )}>
                                {cleanupConfig.enabled ? formatInterval(cleanupConfig.interval_seconds) : "OFF"}
                              </div>
                            </div>
                            {cleanupConfig.enabled && (
                              <div className="text-[10px] text-muted-foreground">
                                {cleanupConfig.last_cleanup ? (
                                  <>
                                    <div>Last: {formatRelativeTime(cleanupConfig.last_cleanup)}</div>
                                    <div>Next: {formatRelativeTime(cleanupConfig.last_cleanup + cleanupConfig.interval_seconds)}</div>
                                  </>
                                ) : (
                                  <>Waiting for first cleanup...</>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Agent Runtime Section */}
                  <>
                    {/* Divider */}
                    <div className="border-t border-border/50" />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-bold text-foreground">Agent Runtime</div>
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold",
                            agentRuntimeStatus === "connected" && "bg-green-500/15 text-green-400 border border-green-500/30",
                            agentRuntimeStatus === "checking" && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                            agentRuntimeStatus === "disconnected" && "bg-red-500/15 text-red-400 border border-red-500/30"
                          )}>
                            {agentRuntimeStatus === "connected" ? "ONLINE" : agentRuntimeStatus === "checking" ? "CHECKING" : "OFFLINE"}
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Agents sub-item */}
                      <div className="flex items-center justify-between bg-muted/20 rounded px-2 py-1.5">
                        <div className="text-xs text-muted-foreground">CAIPE Dynamic Agents</div>
                        <div className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold",
                          agentRuntimeStatus === "connected"
                            ? "bg-green-500/15 text-green-400 border border-green-500/30"
                            : agentRuntimeStatus === "checking"
                            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                            : "bg-red-500/15 text-red-400 border border-red-500/30"
                        )}>
                          {agentRuntimeStatus === "connected" ? "ON" : agentRuntimeStatus === "checking" ? "..." : "OFF"}
                        </div>
                      </div>
                    </div>
                  </>
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span>Health checks active (30s interval)</span>
                    </div>
                    <div className="text-muted-foreground">
                      {combinedStatus === "connected" ? "All systems operational" :
                       combinedStatus === "checking" ? "Checking status..." :
                       combinedStatus === "rag-disconnected" ? "RAG server unavailable" :
                       "Check logs for details"}
                    </div>
                  </div>
                  {versionInfo && (
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">UI Version:</span>
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
                        <span className="text-muted-foreground/60">
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
            Unified admin alerts pill. Replaces four previously separate
            chips (Migrations required, Version metadata needed,
            Migration override active, Keycloak unreachable / failing
            invariants) with a single labelled `Alerts: <total>` trigger
            so the header stays compact when multiple subsystems flag
            issues simultaneously. Trigger severity is the worst across
            all visible sources (red wins over amber).

            Clicking the pill opens a popover that lists EVERY active
            alert as its own row, each with its own GuardedLink to the
            relevant admin tab. This replaces the previous "single
            deep-link to the highest-severity source" behavior which
            silently hid lower-severity items and produced confusing
            no-ops when the user was already on the destination tab.

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
        onOpenMigrationAssistant={releasePrompt.openMigrationAssistant}
        onSkipUntilNextLogin={releasePrompt.skipUntilNextLogin}
        onDismissPermanently={releasePrompt.dismissPermanently}
        showMigrationCta={releasePrompt.showMigrationCta}
        isDismissing={releasePrompt.isDismissing}
      />
    )}
    </>
  );
}

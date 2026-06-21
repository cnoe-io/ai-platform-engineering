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
import {
Tooltip,
TooltipContent,
TooltipProvider,
TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { UserMenu } from "@/components/user-menu";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useCAIPEHealth } from "@/hooks/use-caipe-health";
import { useKeycloakHealthSummary } from "@/hooks/use-keycloak-health-summary";
import { useMigrationStatus } from "@/hooks/use-migration-status";
import { usePlatformHealthProbes } from "@/hooks/use-platform-health-probes";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { useReleaseUpgradePrompt } from "@/hooks/use-release-upgrade-prompt";
import { useVersion } from "@/hooks/use-version";
import { config,getLogoFilterClass } from "@/lib/config";
import { cn } from "@/lib/utils";
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
Info,
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
  const { streamingConversations, unviewedConversations, inputRequiredConversations } = useChatStore();
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

  // Health check for the CAIPE API path (polls every 30 seconds)
  const {
    status: caipeStatus,
    storageMode
  } = useCAIPEHealth();

  // Health check for RAG server (polls every 30 seconds)
  const {
    status: ragStatus
  } = useRAGHealth();
  const {
    status: platformProbeStatus,
    probes: platformProbes,
    summary: platformProbeSummary,
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

  // Combined status: hard failures from the API path or platform
  // dependencies mark the system as disconnected; optional RAG failures are
  // degraded so the core chat/runtime path can still show separately.
  const getCombinedStatus = () => {
    if (caipeStatus === "checking") return "checking";
    if (ragEnabled && ragStatus === "checking") return "checking";
    if (platformProbeStatus === "checking") return "checking";
    if (caipeStatus === "disconnected") return "disconnected";
    if (platformProbeStatus === "down") return "disconnected";
    if (platformProbeStatus === "degraded") return "degraded";
    if (ragEnabled && ragStatus === "disconnected") return "rag-disconnected";
    return "connected";
  };

  const combinedStatus = getCombinedStatus();
  const combinedStatusLabel =
    combinedStatus === "connected" ? "Connected" :
    combinedStatus === "checking" ? "Checking" :
    combinedStatus === "degraded" ? "Needs Attention" :
    combinedStatus === "rag-disconnected" ? "RAG Disconnected" :
    "Disconnected";
  const platformProbeGroups = [
    {
      id: "core",
      label: "Dynamic Agent Runtime",
      description: "The path dynamic agents use to reach tools: AgentGateway plus the config bridge that publishes MCP targets.",
    },
    {
      id: "identity",
      label: "Identity & Authz",
      description: "Keycloak sign-in, OpenFGA authorization, and the OpenFGA bridge used by runtime permission checks.",
    },
    {
      id: "bootstrap",
      label: "Bootstrap & Migrations",
      description: "Outcome checks for one-time setup: Keycloak realm reconciliation, OpenFGA store/model seeding, and required RBAC migrations.",
    },
    {
      id: "storage",
      label: "Storage",
      description: "Databases backing CAIPE, Keycloak, and OpenFGA.",
    },
    {
      id: "rag",
      label: "RAG & Web Ingestor",
      description: "Knowledge services, vector-store dependencies, Redis queue readiness, and web ingestor readiness.",
    },
  ] as const;
  const platformProbeIssues = platformProbes.filter((probe) => probe.status !== "healthy");
  const platformProbeHealthyCount = platformProbes.filter((probe) => probe.status === "healthy").length;
  const platformProbeIssueCount = platformProbeIssues.length;
  const platformHealthLabel =
    platformProbeStatus === "healthy" ? "Ready" :
    platformProbeStatus === "degraded" ? "Attention" :
    platformProbeStatus === "down" ? "Down" :
    "Checking";
  const platformHealthTone =
    platformProbeStatus === "healthy" ? "green" :
    platformProbeStatus === "down" ? "red" :
    platformProbeStatus === "checking" ? "muted" :
    "amber";
  const statusBadgeClassName = (tone: "green" | "amber" | "red" | "muted") =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
      tone === "green" && "border-green-500/25 bg-green-500/10 text-green-500 dark:text-green-400",
      tone === "amber" && "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      tone === "red" && "border-red-500/25 bg-red-500/10 text-red-500 dark:text-red-400",
      tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
    );

  const getActiveTab = () => {
    if (pathname === "/") return "home";
    if (pathname?.startsWith("/chat")) return "chat";
    if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
    if (pathname?.startsWith("/credentials")) return "credentials";
    if (pathname?.startsWith("/workflows")) return "workflows";
    if (pathname?.startsWith("/task-builder")) return "task-builder";
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
            <PopoverContent side="bottom" align="end" className="w-[600px] max-w-[calc(100vw-1rem)] max-h-[min(760px,calc(100vh-5rem))] p-0 overflow-hidden border-2">
              <TooltipProvider delayDuration={150}>
              <div className="flex max-h-[min(760px,calc(100vh-5rem))] flex-col bg-gradient-to-br from-card via-card to-card/95">
                {/* Header with gradient */}
                <div className="gradient-primary-br p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-base font-bold text-white mb-1">System Status</div>
                      <div className="text-xs text-white/80">Dynamic agents, tools, identity, and knowledge services</div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full transition-colors duration-700",
                        combinedStatus === "connected" ? "bg-green-400" :
                        combinedStatus === "checking" ? "bg-amber-400" :
                        combinedStatus === "degraded" ? "bg-amber-400" :
                        combinedStatus === "rag-disconnected" ? "bg-amber-400" : "bg-red-400"
                      )} />
                      <span className="text-xs font-medium text-white">
                        {combinedStatus === "connected" ? "All Systems Live" :
                         combinedStatus === "checking" ? "Checking" :
                         combinedStatus === "degraded" ? "Action Needed" :
                         combinedStatus === "rag-disconnected" ? "RAG Offline" :
                         "Issues Detected"}
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  data-testid="platform-health-scroll"
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
                >
                  <div className="rounded-xl border border-border/70 bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Platform Health</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {platformProbeSummary
                            ? `${platformProbeSummary.total} checks across dynamic agents, auth, storage, RAG, web ingestor, and migrations`
                            : "Checking dynamic agents, auth, storage, RAG, web ingestor, and migrations"}
                        </div>
                      </div>
                      <span className={statusBadgeClassName(platformHealthTone)}>
                        {platformProbeSummary
                          ? `${platformProbeSummary.healthy}/${platformProbeSummary.total} ${platformHealthLabel}`
                          : platformHealthLabel}
                      </span>
                    </div>

                    {platformProbes.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Checking Keycloak, OpenFGA, AgentGateway, RAG, storage, web ingestor readiness, and migrations...
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {platformProbeGroups.map((group) => {
                          const groupProbes = platformProbes.filter((probe) => probe.group === group.id);
                          if (groupProbes.length === 0) return null;
                          const downCount = groupProbes.filter((probe) => probe.status === "down").length;
                          const warningCount = groupProbes.filter((probe) => probe.status === "warning").length;
                          const groupStatus = downCount > 0 ? "down" : warningCount > 0 ? "warning" : "healthy";
                          return (
                            <Tooltip key={group.id}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
                                    groupStatus === "healthy" && "border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400",
                                    groupStatus === "warning" && "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                                    groupStatus === "down" && "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
                                  )}
                                >
                                  <span className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    groupStatus === "healthy" && "bg-green-400",
                                    groupStatus === "warning" && "bg-amber-400",
                                    groupStatus === "down" && "bg-red-400",
                                  )} />
                                  {group.label}
                                  <Info className="h-3 w-3 opacity-70" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-h-80 max-w-[28rem] overflow-y-auto whitespace-normal text-left">
                                <div className="font-semibold">{group.label}</div>
                                <div className="mt-1 text-muted-foreground">{group.description}</div>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  {groupStatus === "healthy"
                                    ? `${groupProbes.length} checks OK`
                                    : `${downCount + warningCount} of ${groupProbes.length} need attention`}
                                </div>
                                <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Probes
                                  </div>
                                  {groupProbes.map((probe) => (
                                    <div key={probe.id} className="rounded bg-muted/35 px-2 py-1.5">
                                      <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                                        <span>{probe.label}</span>
                                        <span className={cn(
                                          "shrink-0",
                                          probe.status === "healthy" && "text-green-500 dark:text-green-400",
                                          probe.status === "warning" && "text-amber-600 dark:text-amber-400",
                                          probe.status === "down" && "text-red-500 dark:text-red-400",
                                        )}>
                                          {probe.status === "healthy" ? "OK" : probe.status === "warning" ? "Check" : "Down"}
                                        </span>
                                      </div>
                                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                                        {probe.detail}
                                        {probe.latency_ms !== null ? ` · ${probe.latency_ms}ms` : ""}
                                      </div>
                                      <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                                        {probe.target}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}

                    {platformProbeIssues.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                            Action needed
                          </div>
                          <div className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
                            {platformProbeHealthyCount} healthy · {platformProbeIssueCount} attention
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {platformProbeIssues.slice(0, 3).map((probe) => (
                            <div
                              key={probe.id}
                              title={`${probe.target} — ${probe.detail}`}
                              className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-foreground">
                                  {probe.label}
                                </div>
                                <div className="truncate text-[10px] text-muted-foreground">
                                  {probe.detail}
                                </div>
                              </div>
                              {probe.remediation ? (
                                <button
                                  type="button"
                                  onClick={() => router.push(probe.remediation!.href)}
                                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90"
                                  title={probe.remediation.description}
                                >
                                  {probe.remediation.label}
                                </button>
                              ) : (
                                <span className={statusBadgeClassName(probe.status === "warning" ? "amber" : "red")}>
                                  {probe.status === "warning" ? "Check" : "Down"}
                                </span>
                              )}
                            </div>
                          ))}
                          {platformProbeIssues.length > 3 && (
                            <div className="px-1 text-[10px] text-muted-foreground">
                              {platformProbeIssues.length - 3} more checks need attention.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : platformProbes.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-muted-foreground">
                        All critical checks are ready.
                      </div>
                    ) : null}

                    {platformProbes.length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-lg border border-border/60">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <span>Probe</span>
                          <span>Status</span>
                        </div>
                        <div
                          data-testid="platform-health-probe-list"
                          className="max-h-48 divide-y divide-border/60 overflow-y-auto overscroll-contain"
                        >
                          {platformProbes.map((probe) => (
                            <Tooltip key={probe.id}>
                              <TooltipTrigger asChild>
                                <div className="grid cursor-help grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 hover:bg-muted/30">
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium text-foreground">
                                      {probe.label}
                                    </div>
                                    <div className="truncate text-[10px] text-muted-foreground">
                                      {probe.detail}
                                      {probe.latency_ms !== null ? ` · ${probe.latency_ms}ms` : ""}
                                    </div>
                                  </div>
                                  <span className={statusBadgeClassName(
                                    probe.status === "healthy" ? "green" : probe.status === "warning" ? "amber" : "red",
                                  )}>
                                    {probe.status === "healthy" ? "OK" : probe.status === "warning" ? "Check" : "Down"}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-96 whitespace-normal text-left">
                                <div className="font-semibold">{probe.label}</div>
                                <div className="mt-1 text-muted-foreground">Validation: {probe.detail}</div>
                                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Probe target
                                </div>
                                <div className="mt-2 break-all rounded bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                  {probe.target}
                                </div>
                                {probe.remediation && (
                                  <div className="mt-2 text-[10px] text-muted-foreground">
                                    Action: {probe.remediation.description}
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-2 text-right text-[10px] font-mono text-muted-foreground">
                      Next probe: {platformProbeNextCheck}s
                    </div>
                  </div>
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
                       combinedStatus === "degraded" ? "Action available" :
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
              </TooltipProvider>
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

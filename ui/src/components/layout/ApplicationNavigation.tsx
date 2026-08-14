"use client";

import { useApplicationNavigation } from "@/components/layout/ApplicationNavigationContext";
import {
  APPLICATION_SECTION_AREA_KEYS,
  ApplicationSectionNavigation,
} from "@/components/layout/ApplicationSectionNavigation";
import { GuardedNavigationLink } from "@/components/layout/GuardedNavigationLink";
import {
  CollapsedNavigationFlyout,
  WorkspaceRailToggle,
} from "@/components/layout/WorkspaceNavigation";
import { useWorkspaceRail } from "@/components/layout/WorkspaceRailContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useHydrated } from "@/hooks/use-hydrated";
import { config,getLogoFilterClass } from "@/lib/config";
import { cn } from "@/lib/utils";
import { resolveChatNavigationPath,useChatStore } from "@/store/chat-store";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  Database,
  Home,
  KeyRound,
  Menu,
  MessageCircle,
  Shield,
  SlidersHorizontal,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import React from "react";

interface ApplicationNavigationItem {
  disabled?: boolean;
  href: string;
  icon: LucideIcon;
  key: string;
  label: string;
  utility?: boolean;
}

function activeAreaForPath(pathname: string | null): string | null {
  if (pathname === "/") return "home";
  if (pathname?.startsWith("/chat")) return "chat";
  if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
  if (pathname?.startsWith("/credentials")) return "credentials";
  if (pathname?.startsWith("/workflows")) return "workflows";
  if (pathname?.startsWith("/skills") || pathname?.startsWith("/use-cases")) {
    return "skills";
  }
  if (pathname?.startsWith("/dynamic-agents")) return "dynamic-agents";
  if (pathname?.startsWith("/schedules")) return "schedules";
  if (pathname?.startsWith("/admin")) return "admin";
  if (pathname?.startsWith("/settings")) return "settings";
  return null;
}

function ChatActivityBadge({
  inputRequired,
  streaming,
  unviewed,
}: {
  inputRequired: number;
  streaming: number;
  unviewed: number;
}): React.ReactElement | null {
  const count = streaming || inputRequired || unviewed;
  if (count === 0) return null;
  const color = streaming
    ? "bg-emerald-500"
    : inputRequired
      ? "bg-amber-500"
      : "bg-blue-500";

  return (
    <span
      aria-label={`${count} chat${count === 1 ? "" : "s"} ${
        streaming ? "streaming" : inputRequired ? "need input" : "unviewed"
      }`}
      className={cn(
        "absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white",
        color,
      )}
    >
      {streaming ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60"
        />
      ) : null}
      <span className="relative">{count}</span>
    </span>
  );
}

function ApplicationNavigationContents({
  collapsed,
}: {
  collapsed: boolean;
}): React.ReactElement {
  const contextualNavigationId = React.useId();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { data: session } = useSession();
  const { isAdmin } = useAdminRole();
  const applicationNavigation = useApplicationNavigation();
  const {
    activeConversationId,
    conversations,
    inputRequiredConversations,
    streamingConversations,
    unviewedConversations,
  } = useChatStore();
  const chatHref = React.useMemo(
    () => hydrated
      ? resolveChatNavigationPath({ conversations,activeConversationId })
      : "/chat",
    [activeConversationId,conversations,hydrated],
  );
  const storageMode = config.storageMode;
  const activeArea = activeAreaForPath(pathname);
  const registeredContextualNavigation =
    applicationNavigation?.registration?.areaKey === activeArea
      ? applicationNavigation.registration.content
      : null;
  const activeHasSectionNavigation = Boolean(
    activeArea
      && (registeredContextualNavigation
        || APPLICATION_SECTION_AREA_KEYS.has(activeArea)),
  );
  const [expandedAreaKeys,setExpandedAreaKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const lastActiveAreaRef = React.useRef(activeArea);
  const autoExpandedAreaRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (lastActiveAreaRef.current !== activeArea) {
      lastActiveAreaRef.current = activeArea;
      autoExpandedAreaRef.current = null;
    }
    if (!activeArea || !activeHasSectionNavigation) return;
    if (autoExpandedAreaRef.current === activeArea) return;
    autoExpandedAreaRef.current = activeArea;
    setExpandedAreaKeys((current) => {
      if (current.has(activeArea)) return current;
      const next = new Set(current);
      next.add(activeArea);
      return next;
    });
  }, [activeArea,activeHasSectionNavigation]);

  const items = [
    { key: "home",href: "/",label: "Home",icon: Home },
    { key: "chat",href: chatHref,label: "Chat",icon: MessageCircle },
    { key: "skills",href: "/skills",label: "Skills",icon: Zap },
    config.workflowsEnabled && {
      key: "workflows",
      href: "/workflows",
      label: "Workflows",
      icon: Workflow,
    },
    config.ragEnabled && {
      key: "knowledge",
      href: "/knowledge-bases/search",
      label: "Knowledge Bases",
      icon: Database,
    },
    storageMode === "mongodb" && {
      key: "dynamic-agents",
      href: "/dynamic-agents",
      label: "Agents",
      icon: Bot,
    },
    storageMode === "mongodb"
      && config.dynamicAgentsEnabled
      && config.schedulerEnabled
      && (!config.schedulerAdminOnly || isAdmin) && {
        key: "schedules",
        href: "/schedules",
        label: "Schedules",
        icon: CalendarClock,
      },
    storageMode === "mongodb" && config.userConnectionsEnabled && {
      key: "credentials",
      href: "/credentials/connections",
      label: "Credentials",
      icon: KeyRound,
    },
    (session || isAdmin) && {
      key: "admin",
      href: "/admin",
      label: "Admin",
      icon: Shield,
      disabled: storageMode !== "mongodb",
      utility: true,
    },
    {
      key: "settings",
      href: "/settings/appearance",
      label: "Settings",
      icon: SlidersHorizontal,
      utility: true,
    },
  ].filter(Boolean) as ApplicationNavigationItem[];

  const firstUtilityKey = items.find((item) => item.utility)?.key;

  const closeMobileNavigation = () =>
    applicationNavigation?.closeMobileNavigation();

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Application navigation"
        className="flex min-h-full flex-col gap-1"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeArea === item.key;
          const contextualNavigation =
            registeredContextualNavigation && active
              ? registeredContextualNavigation
              : APPLICATION_SECTION_AREA_KEYS.has(item.key)
                ? <ApplicationSectionNavigation areaKey={item.key} />
                : null;
          const hasSectionNavigation =
            !item.disabled && Boolean(contextualNavigation);
          const contextExpanded =
            hasSectionNavigation && expandedAreaKeys.has(item.key);
          const chatBadge = item.key === "chat" ? (
            <ChatActivityBadge
              inputRequired={inputRequiredConversations.size}
              streaming={streamingConversations.size}
              unviewed={unviewedConversations.size}
            />
          ) : null;
          const contents = (
            <>
              <span
                className={cn(
                  "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  active
                    ? "gradient-primary-br text-white shadow-sm"
                    : "bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {chatBadge}
              </span>
              {!collapsed ? (
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.label}
                </span>
              ) : null}
            </>
          );
          const className = cn(
            "group flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            collapsed && "justify-center",
            item.disabled
              ? "cursor-not-allowed text-muted-foreground opacity-50"
              : active
                ? "bg-muted/60 font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          );

          if (collapsed && hasSectionNavigation) {
            return (
              <div
                className={cn(item.key === firstUtilityKey && "mt-auto pt-6")}
                key={item.key}
              >
                <CollapsedNavigationFlyout
                  active={active}
                  icon={Icon}
                  label={item.label}
                >
                  {(close) => (
                    <div
                      onClick={(event) => {
                        if (
                          !(event.target as HTMLElement).closest(
                            "[data-navigation-leaf='true']",
                          )
                        ) return;
                        close();
                        closeMobileNavigation();
                      }}
                    >
                      {contextualNavigation}
                    </div>
                  )}
                </CollapsedNavigationFlyout>
              </div>
            );
          }

          const toggleContext = () => {
            setExpandedAreaKeys((current) => {
              const next = new Set(current);
              if (next.has(item.key)) {
                next.delete(item.key);
              } else {
                next.add(item.key);
              }
              return next;
            });
          };
          const control = item.disabled ? (
            <span
              aria-disabled="true"
              aria-label={`${item.label}: unavailable`}
              className={className}
              role="link"
              tabIndex={0}
            >
              {contents}
            </span>
          ) : hasSectionNavigation && !collapsed ? (
            <button
              aria-controls={`${contextualNavigationId}-${item.key}`}
              aria-current={active ? "page" : undefined}
              aria-expanded={contextExpanded}
              className={className}
              onClick={toggleContext}
              type="button"
            >
              {contents}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "ml-auto h-4 w-4 shrink-0 transition-transform",
                  contextExpanded && "rotate-180",
                )}
              />
            </button>
          ) : (
            <GuardedNavigationLink
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={className}
              href={item.href}
              onClick={closeMobileNavigation}
              prefetch
            >
              {contents}
            </GuardedNavigationLink>
          );

          return (
            <div
              className={cn(
                "space-y-1",
                item.key === firstUtilityKey && "mt-auto pt-6",
              )}
              key={item.key}
            >
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{control}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {item.key === "home" ? "Homepage" : item.label}
                  </TooltipContent>
                </Tooltip>
              ) : control}
              {!collapsed && contextExpanded ? (
                <div
                  className="ml-3 border-l border-border/60 pb-3 pl-3 pt-2"
                  id={`${contextualNavigationId}-${item.key}`}
                >
                  {contextualNavigation}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

function ApplicationBrand({
  collapsed,
}: {
  collapsed: boolean;
}): React.ReactElement {
  const applicationNavigation = useApplicationNavigation();
  const brand = (
    <GuardedNavigationLink
      aria-label={`${config.appName} home`}
      className={cn(
        "brand-link relative flex h-20 w-full items-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        collapsed
          ? "justify-center px-2"
          : "justify-start gap-2.5 px-4",
      )}
      href="/"
      onClick={applicationNavigation?.closeMobileNavigation}
    >
      <Image
        alt=""
        aria-hidden="true"
        className={cn("h-12 w-auto",getLogoFilterClass(config.logoStyle))}
        height={48}
        src={config.logoUrl}
        unoptimized
        width={48}
      />
      {!collapsed ? (
        <span className="brand-lockup relative min-w-0">
          <span
            aria-hidden="true"
            className="brand-name truncate text-2xl font-bold"
          >
            {Array.from(config.appName).map((letter,index) => (
              <span className="brand-letter" key={`${letter}-${index}`}>
                {letter === " " ? "\u00a0" : letter}
              </span>
            ))}
          </span>
        </span>
      ) : null}
    </GuardedNavigationLink>
  );

  return (
    <TooltipProvider delayDuration={1000}>
      <Tooltip className="block w-full">
        <TooltipTrigger asChild>
          <span className="block w-full">{brand}</span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>Homepage</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ApplicationNavigationRail(): React.ReactElement {
  const { collapsed } = useWorkspaceRail();

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 flex-col border-r border-border/60 bg-background/70 backdrop-blur-xl xl:flex",
        collapsed ? "w-[4.25rem]" : "w-64",
      )}
    >
      <ApplicationBrand collapsed={collapsed} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2">
        <ApplicationNavigationContents collapsed={collapsed} />
      </div>
      <div
        className={cn(
          "flex shrink-0 pb-3 pt-2",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <WorkspaceRailToggle />
      </div>
    </aside>
  );
}

export function ApplicationNavigationDrawer(): React.ReactElement | null {
  const applicationNavigation = useApplicationNavigation();
  if (!applicationNavigation) return null;

  return (
    <Dialog
      onOpenChange={applicationNavigation.setMobileNavigationOpen}
      open={applicationNavigation.mobileNavigationOpen}
    >
      <DialogContent className="left-0 top-0 flex h-dvh w-[min(20rem,90vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-l-0 p-0 sm:rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Navigation</DialogTitle>
          <DialogDescription>Choose a CAIPE destination.</DialogDescription>
        </DialogHeader>
        <ApplicationBrand collapsed={false} />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <ApplicationNavigationContents collapsed={false} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ApplicationNavigationMenuButton(): React.ReactElement | null {
  const applicationNavigation = useApplicationNavigation();
  if (!applicationNavigation) return null;

  return (
    <button
      aria-label="Open navigation"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
      onClick={applicationNavigation.openMobileNavigation}
      type="button"
    >
      <Menu aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

export function MobileApplicationBrand(): React.ReactElement {
  return (
    <GuardedNavigationLink
      aria-label={`${config.appName} home`}
      className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
      href="/"
    >
      <Image
        alt=""
        aria-hidden="true"
        className={cn("h-9 w-auto",getLogoFilterClass(config.logoStyle))}
        height={36}
        src={config.logoUrl}
        unoptimized
        width={36}
      />
      <span className="gradient-text hidden truncate text-lg font-bold sm:inline">
        {config.appName}
      </span>
    </GuardedNavigationLink>
  );
}

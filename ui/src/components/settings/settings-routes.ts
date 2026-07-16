import {
  Bell,
  Bot,
  BrainCircuit,
  Code2,
  KeyRound,
  Megaphone,
  Palette,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsRouteId =
  | "appearance"
  | "chat"
  | "notifications"
  | "access"
  | "developer"
  | "platform-defaults"
  | "platform-access"
  | "platform-announcements"
  | "platform-ai-review";

export interface SettingsRouteDefinition {
  description: string;
  href: string;
  icon: LucideIcon;
  id: SettingsRouteId;
  label: string;
  scope: "personal" | "platform";
}

export const PERSONAL_SETTINGS_ROUTES: SettingsRouteDefinition[] = [
  {
    id: "appearance",
    href: "/settings/appearance",
    label: "Appearance",
    description: "Theme, typography, and interface style.",
    icon: Palette,
    scope: "personal",
  },
  {
    id: "chat",
    href: "/settings/chat",
    label: "Chat & agents",
    description: "Default agents and conversation behavior.",
    icon: Bot,
    scope: "personal",
  },
  {
    id: "notifications",
    href: "/settings/notifications",
    label: "Notifications",
    description: "Choose the updates you want to see.",
    icon: Bell,
    scope: "personal",
  },
  {
    id: "access",
    href: "/settings/access",
    label: "Account & access",
    description: "Your role, teams, and linked identity.",
    icon: KeyRound,
    scope: "personal",
  },
  {
    id: "developer",
    href: "/settings/developer",
    label: "Developer",
    description: "Debug preferences and session diagnostics.",
    icon: Code2,
    scope: "personal",
  },
];

export const PLATFORM_SETTINGS_ROUTES: SettingsRouteDefinition[] = [
  {
    id: "platform-defaults",
    href: "/settings/platform/defaults",
    label: "Defaults",
    description: "Set defaults for people who have not chosen their own.",
    icon: SlidersHorizontal,
    scope: "platform",
  },
  {
    id: "platform-access",
    href: "/settings/platform/access",
    label: "Access before sign-in",
    description: "Control access for unlinked Slack and Webex callers.",
    icon: Shield,
    scope: "platform",
  },
  {
    id: "platform-announcements",
    href: "/settings/platform/announcements",
    label: "Announcements",
    description: "Control platform-wide release announcements.",
    icon: Megaphone,
    scope: "platform",
  },
  {
    id: "platform-ai-review",
    href: "/settings/platform/ai-review",
    label: "AI review",
    description: "Configure review policies for AI-generated changes.",
    icon: BrainCircuit,
    scope: "platform",
  },
];

export const ALL_SETTINGS_ROUTES = [
  ...PERSONAL_SETTINGS_ROUTES,
  ...PLATFORM_SETTINGS_ROUTES,
];

export function findSettingsRoute(pathname: string): SettingsRouteDefinition | undefined {
  const normalized = pathname.replace(/\/$/,"") || "/settings";
  return ALL_SETTINGS_ROUTES.find((route) => route.href === normalized);
}

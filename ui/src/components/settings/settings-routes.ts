import {
  Bell,
  Bot,
  Code2,
  KeyRound,
  Megaphone,
  Palette,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsRouteId =
  | "appearance"
  | "chat"
  | "notifications"
  | "access"
  | "developer"
  | "defaults"
  | "announcements";

export interface SettingsRouteDefinition {
  description: string;
  icon: LucideIcon;
  id: SettingsRouteId;
  label: string;
  scope: "personal" | "platform";
}

export const PERSONAL_SETTINGS_ROUTES: SettingsRouteDefinition[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, typography, and interface style.",
    icon: Palette,
    scope: "personal",
  },
  {
    id: "chat",
    label: "Chat & agents",
    description: "Default agents and conversation behavior.",
    icon: Bot,
    scope: "personal",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Choose the updates you want to see.",
    icon: Bell,
    scope: "personal",
  },
  {
    id: "access",
    label: "Account & access",
    description: "Your role, teams, and linked identity.",
    icon: KeyRound,
    scope: "personal",
  },
  {
    id: "developer",
    label: "Developer",
    description: "Debug preferences and session diagnostics.",
    icon: Code2,
    scope: "personal",
  },
];

export const PLATFORM_SETTINGS_ROUTES: SettingsRouteDefinition[] = [
  {
    id: "defaults",
    label: "Defaults",
    description: "Set fallback behavior for people who have not made a personal choice.",
    icon: SlidersHorizontal,
    scope: "platform",
  },
  {
    id: "announcements",
    label: "Announcements",
    description: "Control platform-wide release announcements.",
    icon: Megaphone,
    scope: "platform",
  },
];

export const ALL_SETTINGS_ROUTES = [
  ...PERSONAL_SETTINGS_ROUTES,
  ...PLATFORM_SETTINGS_ROUTES,
];

export const DEFAULT_SETTINGS_ROUTE_ID: SettingsRouteId = "chat";

export function findSettingsRouteById(
  id: string | null | undefined,
): SettingsRouteDefinition | undefined {
  return ALL_SETTINGS_ROUTES.find((route) => route.id === id);
}

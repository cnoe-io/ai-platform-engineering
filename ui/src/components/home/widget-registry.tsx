import { CapabilityCards } from "./CapabilityCards";
import { InsightsWidget } from "./InsightsWidget";
import { RecentChats } from "./RecentChats";
import { SharedConversations } from "./SharedConversations";
import type { ComponentType } from "react";

/** Maps each `HOME_WIDGET_DEFINITIONS` id to its zero-required-prop component. */
export const HOME_WIDGET_COMPONENTS: Record<string, ComponentType> = {
  shortcuts: CapabilityCards,
  recentChats: RecentChats,
  insights: InsightsWidget,
  sharedConversations: SharedConversations,
};

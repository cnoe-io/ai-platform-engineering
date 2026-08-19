import {
  Bot,
  CalendarClock,
  Cpu,
  Database,
  KeyRound,
  Link2,
  MessageSquare,
  Server,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface QuickStartCard {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  ctaLabel: string;
  href: string;
}

export type QuickStartTabId = "build" | "automate" | "connect" | "explore";

export interface QuickStartTab {
  id: QuickStartTabId;
  label: string;
  cards: QuickStartCard[];
}

export const QUICK_START_TABS: QuickStartTab[] = [
  {
    id: "build",
    label: "Build",
    cards: [
      {
        id: "build-agent",
        title: "Build Agent",
        description: "Build agents and choose the instructions, tools, skills, and model they use.",
        icon: Bot,
        ctaLabel: "Start building",
        href: "/dynamic-agents",
      },
      {
        id: "add-mcp-server",
        title: "Add MCP server",
        description: "Configure MCP server connections so agents can reach approved tools.",
        icon: Server,
        ctaLabel: "Add MCP server",
        href: "/dynamic-agents?tab=mcp-servers",
      },
      {
        id: "create-skills",
        title: "Create Skills",
        description: "Build reusable skills and templates for common tasks.",
        icon: Zap,
        ctaLabel: "Create Skills",
        href: "/skills/workspace/new",
      },
      {
        id: "add-knowledge-base",
        title: "Add Knowledge Base",
        description: "Ingest and manage the sources your agents can search.",
        icon: Database,
        ctaLabel: "Add Knowledge Base",
        href: "/knowledge-bases/ingest",
      },
      {
        id: "add-model",
        title: "Add Model",
        description: "Register the LLM models available for agents to use.",
        icon: Cpu,
        ctaLabel: "Add Model",
        href: "/dynamic-agents?tab=llm-models",
      },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    cards: [
      {
        id: "build-workflow",
        title: "Build Workflow",
        description: "Chain multiple agents together into automated, multi-step workflows.",
        icon: Workflow,
        ctaLabel: "Build Workflow",
        href: "/workflows",
      },
      {
        id: "create-schedules",
        title: "Create Schedules",
        description: "Set up recurring agent jobs for your account.",
        icon: CalendarClock,
        ctaLabel: "Create Schedules",
        href: "/schedules",
      },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    cards: [
      {
        id: "connect-apps",
        title: "Connect Apps",
        description: "Connect apps like Atlassian so agents can use approved account access.",
        icon: Link2,
        ctaLabel: "Connect Apps",
        href: "/credentials/connections",
      },
      {
        id: "secrets",
        title: "Secrets",
        description: "Store secrets that agents and services can use without showing the value again.",
        icon: KeyRound,
        ctaLabel: "Add Secrets",
        href: "/credentials/secrets",
      },
    ],
  },
  {
    id: "explore",
    label: "Explore",
    cards: [
      {
        id: "chat-assistants",
        title: "Chat assistants",
        description: "Chat with platform and dynamic agents.",
        icon: MessageSquare,
        ctaLabel: "Start chat",
        href: "/chat",
      },
    ],
  },
];

"use client";

// assisted-by claude code claude-sonnet-4-6

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MCPCredentialSource } from "@/types/dynamic-agent";
import { ArrowRight, Plus } from "lucide-react";
import React from "react";

export interface RemoteMCPTemplate {
  name: string;
  description: string;
  endpoint: string;
  credential_sources: MCPCredentialSource[];
}

interface RemoteMCPCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: RemoteMCPTemplate) => void;
  onSelectCustom: () => void;
}

interface ProviderEntry extends RemoteMCPTemplate {
  key: string;
  logoSrc: string;
  accentClass: string;
  note?: string;
}

// Comma-separated allowlist of provider keys (e.g. "amplitude,pagerduty,github").
// Unset or "*" → show all.
const ENABLED_KEYS: Set<string> | null = (() => {
  const raw = process.env.NEXT_PUBLIC_REMOTE_MCP_CATALOG_PROVIDERS ?? "";
  if (!raw || raw === "*") return null;
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
})();

const REMOTE_MCP_PROVIDERS: ProviderEntry[] = [
  {
    key: "amplitude",
    name: "Amplitude",
    description: "Query analytics events, charts, funnels, and user cohorts",
    endpoint: "https://mcp.amplitude.com/mcp",
    logoSrc: "/provider-logos/amplitude.svg",
    accentClass: "hover:border-blue-500/50 hover:bg-blue-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "amplitude",
        target: "header",
      },
    ],
  },
  {
    key: "atlassian",
    name: "Atlassian",
    description: "Search Jira issues, Confluence pages, and project data",
    endpoint: "https://mcp.atlassian.com/v1/mcp/authv2",
    logoSrc: "/provider-logos/atlassian.svg",
    accentClass: "hover:border-sky-500/50 hover:bg-sky-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "atlassian",
        target: "header",
      },
    ],
  },
  {
    key: "aws",
    name: "AWS",
    description: "Query AWS resources, CloudWatch metrics, and infrastructure across accounts",
    endpoint: "https://aws-mcp.us-east-1.api.aws/mcp",
    logoSrc: "",
    accentClass: "hover:border-orange-500/50 hover:bg-orange-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "aws",
        target: "header",
      },
    ],
    note: "Requires AWS to allowlist your redirect URI before OAuth client registration",
  },
  {
    key: "figma",
    name: "Figma",
    description: "Inspect design files, components, assets, and variable tokens",
    endpoint: "https://www.figma.com/api/mcp",
    logoSrc: "/provider-logos/figma.svg",
    accentClass: "hover:border-purple-500/50 hover:bg-purple-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "figma",
        target: "header",
      },
    ],
    note: "Early access — verify endpoint before use",
  },
  {
    key: "github",
    name: "GitHub Copilot",
    description: "Code search, pull request review, and repository insights via Copilot",
    endpoint: "https://api.githubcopilot.com/mcp",
    logoSrc: "",
    accentClass: "hover:border-slate-500/50 hover:bg-slate-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "github",
        target: "header",
      },
    ],
  },
  {
    key: "linear",
    name: "Linear",
    description: "Browse issues, projects, cycles, and teams in Linear",
    endpoint: "https://mcp.linear.app/mcp",
    logoSrc: "",
    accentClass: "hover:border-violet-500/50 hover:bg-violet-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "linear",
        target: "header",
      },
    ],
  },
  {
    key: "notion",
    name: "Notion",
    description: "Read and search pages, databases, and blocks in Notion",
    endpoint: "https://mcp.notion.com/mcp",
    logoSrc: "",
    accentClass: "hover:border-neutral-500/50 hover:bg-neutral-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "notion",
        target: "header",
      },
    ],
  },
  {
    key: "pagerduty",
    name: "PagerDuty",
    description: "List incidents, services, escalation policies, and on-call schedules",
    endpoint: "https://mcp.pagerduty.com/mcp",
    logoSrc: "",
    accentClass: "hover:border-green-500/50 hover:bg-green-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "pagerduty",
        target: "header",
      },
    ],
  },
  {
    key: "zapier",
    name: "Zapier",
    description: "Trigger Zaps and run automations across thousands of connected apps",
    endpoint: "https://mcp.zapier.com/mcp",
    logoSrc: "",
    accentClass: "hover:border-orange-500/50 hover:bg-orange-500/5",
    credential_sources: [
      {
        kind: "provider_connection",
        name: "X-CAIPE-Provider-Token",
        provider: "zapier",
        target: "header",
      },
    ],
  },
];

function GitHubIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.2-.02-2.18-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.97 10.97 0 0 1 12 6.03c.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.79.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function LinearIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 100 100" fill="currentColor">
      <path d="M1.22 61.5L38.5 98.78a50.08 50.08 0 0 1-37.28-37.28ZM0 49.44 50.56 100A50 50 0 0 1 0 49.44ZM10.52 23.5l65.98 65.98a50.27 50.27 0 0 1-8.1 5.44L5.08 31.6a50.27 50.27 0 0 1 5.44-8.1ZM23.5 10.52a50 50 0 0 1 66 66L23.5 10.52ZM49.44 0 100 50.56A50 50 0 0 1 49.44 0ZM61.5 1.22A50.08 50.08 0 0 1 98.78 38.5L61.5 1.22Z" />
    </svg>
  );
}

function NotionIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 100 100" fill="currentColor">
      <path d="M6 4.75C6 2.68 7.68 1 9.75 1h68.5C80.32 1 82 2.68 82 4.75v5.5C82 12.32 80.32 14 78.25 14H9.75C7.68 14 6 12.32 6 10.25V4.75Z"/>
      <path fillRule="evenodd" d="M6 24.75C6 22.68 7.68 21 9.75 21h29.5C41.32 21 43 22.68 43 24.75v50.5C43 77.32 41.32 79 39.25 79H9.75C7.68 79 6 77.32 6 75.25V24.75Zm8 5.25v40h20V30H14Z" clipRule="evenodd"/>
      <path d="M55 24.75C55 22.68 56.68 21 58.75 21h19.5C80.32 21 82 22.68 82 24.75v5.5C82 32.32 80.32 34 78.25 34H58.75C56.68 34 55 32.32 55 30.25v-5.5ZM55 49.75C55 47.68 56.68 46 58.75 46h19.5C80.32 46 82 47.68 82 49.75v5.5C82 57.32 80.32 59 78.25 59H58.75C56.68 59 55 57.32 55 55.25v-5.5ZM55 74.75C55 72.68 56.68 71 58.75 71h19.5C80.32 71 82 72.68 82 74.75v5.5C82 82.32 80.32 84 78.25 84H58.75C56.68 84 55 82.32 55 80.25v-5.5Z"/>
    </svg>
  );
}

function AWSIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 304 182" fill="none">
      <path fill="#FF9900" d="M86 66c0 3 .4 5.4 1 7 .7 1.6 1.7 3.3 3 5 .5.7.7 1.4.7 2 0 .9-.5 1.8-1.6 2.7l-5.3 3.5c-.8.5-1.5.7-2.2.7-1 0-2-.5-3-1.4a30.7 30.7 0 0 1-3.5-4.6 76.2 76.2 0 0 1-3-5.8c-7.5 8.9-17 13.3-28.4 13.3-8.1 0-14.6-2.3-19.2-7-4.7-4.6-7-10.8-7-18.4 0-8.1 2.9-14.7 8.6-19.6 5.7-5 13.4-7.4 23-7.4 3.2 0 6.5.3 10 .8 3.4.5 7 1.3 10.6 2.2v-6.7c0-7-1.5-12-4.4-14.9-3-3-8-4.4-15.2-4.4-3.3 0-6.6.4-10 1.2-3.4.8-6.7 1.9-10 3.3-.5.2-1 .4-1.2.4-.7.2-1.2.3-1.5.3-1.3 0-2-.9-2-2.8V12c0-1.5.2-2.6.7-3.2.5-.7 1.4-1.4 2.8-2 3.3-1.7 7.3-3.2 12-4.3 4.7-1.2 9.7-1.8 15-1.8 11.4 0 19.8 2.6 25.2 7.8 5.3 5.2 8 13 8 23.4V66zm-39.2 14.6c3.1 0 6.3-.6 9.7-1.7 3.4-1.1 6.5-3.2 9-6 1.5-1.8 2.7-3.8 3.2-6.1.6-2.3.9-5 .9-8.3v-4c-2.8-.7-5.8-1.3-8.9-1.7-3-.4-6-.6-9-.6-6.4 0-11.2 1.3-14.3 3.9-3.2 2.6-4.7 6.3-4.7 11.2 0 4.6 1.2 8 3.5 10.4 2.3 2.3 5.6 3.4 10.6 3ZM140 88c-1.7 0-2.8-.3-3.6-1-.7-.6-1.4-2-2-3.9L107 10.3C106.5 8.3 106 7 106 6.1c0-1.6.8-2.5 2.4-2.5h9.8c1.7 0 2.9.3 3.6 1 .8.6 1.4 2 2 3.9l21.7 85.5 20.1-85.5c.5-2 1.1-3.3 1.9-3.9.8-.7 2-.9 3.7-.9h8c1.7 0 2.9.3 3.7 1 .8.6 1.4 2 1.9 3.9l20.3 86.6 22.3-86.6c.5-2 1.2-3.3 2-3.9.7-.7 2-.9 3.5-.9h9.3c1.6 0 2.5.9 2.5 2.5 0 .5 0 1-.2 1.6l-.6 2-27.7 83c-.6 2-1.2 3.3-2 3.9-.8.7-2 1-3.6 1h-8.7c-1.7 0-2.9-.3-3.7-1-.7-.6-1.4-2-1.8-4l-20-83-19.9 82.9c-.5 2-1 3.3-1.8 4-.8.6-2 .9-3.7.9H140zm148.1 3c-5.3 0-10.6-.6-15.7-1.8-5.1-1.2-9.1-2.5-11.7-4-.7-.4-1.2-.9-1.4-1.3-.2-.5-.3-1-.3-1.5v-5.4c0-1.9.7-2.8 2.1-2.8.6 0 1.1.1 1.6.3.5.2 1.3.6 2.1 1 2.9 1.3 6 2.3 9.3 3 3.4.7 6.7 1 10.1 1 5.4 0 9.5-1 12.4-2.8 2.9-1.9 4.4-4.6 4.4-8 0-2.4-.8-4.4-2.3-6-1.5-1.6-4.4-3.1-8.6-4.5l-12.3-3.8c-6.2-2-10.8-4.8-13.6-8.6-2.8-3.7-4.2-7.8-4.2-12.2 0-3.5.8-6.6 2.3-9.3 1.5-2.7 3.5-5 6-6.9 2.5-2 5.3-3.4 8.6-4.4 3.3-1 6.8-1.4 10.5-1.4 1.8 0 3.7.1 5.5.3 1.9.2 3.6.5 5.3.9 1.7.4 3.3.8 4.8 1.3 1.5.5 2.7 1 3.5 1.5.8.5 1.3.8 1.7 1.3.4.5.5 1 .5 1.7v5c0 1.9-.7 2.9-2.1 2.9-.7 0-1.8-.4-3.2-1.1-4.8-2.2-10.2-3.3-16.2-3.3-4.9 0-8.7.8-11.4 2.5-2.7 1.7-4 4.2-4 7.7 0 2.4.8 4.4 2.5 6 1.7 1.6 4.7 3.2 9.2 4.6l12.1 3.8c6.1 2 10.5 4.7 13.2 8.2 2.7 3.5 4 7.5 4 11.8 0 3.6-.7 6.8-2.2 9.7-1.5 2.9-3.5 5.4-6.2 7.5-2.6 2.2-5.7 3.8-9.4 4.9-3.8 1.2-7.8 1.8-12.2 1.8z"/>
      <path fill="#FF9900" d="M274.4 144.7c-32.2 23.8-79 36.4-119.2 36.4-56.4 0-107.2-20.8-145.6-55.5-3-2.7-.3-6.4 3.3-4.3 41.5 24.1 92.8 38.7 145.8 38.7 35.7 0 74.9-7.4 111.1-22.8 5.4-2.4 10 3.6 4.6 7.5z"/>
      <path fill="#FF9900" d="M287.8 129.4c-4.1-5.3-27.2-2.5-37.6-1.3-3.1.4-3.6-2.4-.8-4.4 18.4-13 48.6-9.2 52.1-4.9 3.5 4.4-1 34.6-18.2 49-2.6 2.2-5.1 1-4-2 3.9-9.7 12.6-31.2 8.5-36.4z"/>
    </svg>
  );
}

function PagerDutyIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="8" fill="#06AC38"/>
      <path fill="white" d="M40.5 10H27.2c-1 0-1.8.8-1.8 1.8v14.3H20v7.8h5.4V46h7.8V33.9h7.3c7.2 0 13-5.8 13-13S47.7 10 40.5 10zm0 18.2h-7.3v-10.4h7.3c2.9 0 5.2 2.3 5.2 5.2s-2.3 5.2-5.2 5.2zM20 38.5h7.8V54H20z"/>
    </svg>
  );
}

function ZapierIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24" fill="#FF4A00">
      <path d="M14.47 12A8.56 8.56 0 0 1 12 19.47 8.56 8.56 0 0 1 9.53 12 8.56 8.56 0 0 1 12 4.53 8.56 8.56 0 0 1 14.47 12ZM23.47 10.5h-7.24a8.61 8.61 0 0 0-1.5-3.61l5.11-5.1a.53.53 0 0 0 0-.75l-1.38-1.38a.53.53 0 0 0-.75 0l-5.1 5.11A8.61 8.61 0 0 0 10 3.27V.53A.53.53 0 0 0 9.47 0h-1.94A.53.53 0 0 0 7 .53v7.24a8.61 8.61 0 0 0-3.61 1.5L.29 4.16a.53.53 0 0 0-.75 0L-.84 5.54a.53.53 0 0 0 0 .75l5.11 5.1A8.61 8.61 0 0 0 2.77 15H.53A.53.53 0 0 0 0 15.47v1.94A.53.53 0 0 0 .53 18h7.24a8.61 8.61 0 0 0 1.5 3.61l-5.11 5.1a.53.53 0 0 0 0 .75l1.38 1.38a.53.53 0 0 0 .75 0l5.1-5.11A8.61 8.61 0 0 0 15 25.23v2.24a.53.53 0 0 0 .53.53h1.94a.53.53 0 0 0 .53-.53v-7.24a8.61 8.61 0 0 0 3.61-1.5l5.11 5.11a.53.53 0 0 0 .75 0l1.38-1.38a.53.53 0 0 0 0-.75L23.74 16.4A8.61 8.61 0 0 0 25.23 13H27.47A.53.53 0 0 0 28 12.47v-1.94A.53.53 0 0 0 27.47 10.5Z"/>
    </svg>
  );
}

function ProviderLogo({ provider }: { provider: ProviderEntry }) {
  if (provider.logoSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        aria-hidden="true"
        className="h-8 w-8 object-contain"
        height={32}
        src={provider.logoSrc}
        width={32}
      />
    );
  }
  switch (provider.name) {
    case "AWS": return <AWSIcon />;
    case "GitHub Copilot": return <GitHubIcon />;
    case "Linear": return <LinearIcon />;
    case "Notion": return <NotionIcon />;
    case "PagerDuty": return <PagerDutyIcon />;
    case "Zapier": return <ZapierIcon />;
    default: return <GitHubIcon />;
  }
}

export function RemoteMCPCatalogDialog({
  open,
  onOpenChange,
  onSelect,
  onSelectCustom,
}: RemoteMCPCatalogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Choose a pre-configured remote MCP provider or start from a blank form.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 mt-1">
          {REMOTE_MCP_PROVIDERS.filter((p) => !ENABLED_KEYS || ENABLED_KEYS.has(p.key)).map((provider) => (
            <button
              key={provider.name}
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSelect(provider);
              }}
              className={[
                "group relative flex flex-col gap-3 rounded-lg border bg-card p-4 text-left",
                "transition-colors duration-150 cursor-pointer",
                provider.accentClass,
              ].join(" ")}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background">
                    <ProviderLogo provider={provider} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{provider.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">
                      {new URL(provider.endpoint).hostname}
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0" />
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {provider.description}
              </p>

              {provider.note && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                  ⚠ {provider.note}
                </p>
              )}
            </button>
          ))}

          {/* Custom / blank option */}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onSelectCustom();
            }}
            className="group flex flex-col gap-3 rounded-lg border border-dashed bg-card p-4 text-left transition-colors duration-150 cursor-pointer hover:border-primary/50 hover:bg-primary/5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background">
                <Plus className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <div className="font-semibold text-sm">Custom</div>
                <div className="text-[10px] text-muted-foreground">Blank form</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Configure any MCP server manually — local process, internal service, or any remote endpoint.
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

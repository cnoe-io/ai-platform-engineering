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
  logoSrc: string;
  accentClass: string;
  note?: string;
}

const REMOTE_MCP_PROVIDERS: ProviderEntry[] = [
  {
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
    note: "Verify endpoint — Figma MCP is in early access",
  },
  {
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
];

function GitHubIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.2-.02-2.18-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.97 10.97 0 0 1 12 6.03c.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.79.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function ProviderLogo({ provider }: { provider: ProviderEntry }) {
  if (!provider.logoSrc) return <GitHubIcon />;
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
          {REMOTE_MCP_PROVIDERS.map((provider) => (
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

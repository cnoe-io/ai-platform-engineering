"use client";

// assisted-by Codex Codex-sonnet-4-6

import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface SecretPrincipalRef {
  type?: string;
  id?: string;
  email?: string;
  name?: string;
  displayName?: string;
}

export interface SecretStorageSummary {
  metadataCollection?: string;
  payloadCollection?: string;
  encryption?: string;
}

interface PrincipalLabelOptions {
  userIdFallback?: string;
  fallback?: string;
}

function friendlyPrincipalType(type?: string): string {
  switch (type) {
    case "service_account":
      return "Service account";
    case "user":
      return "User";
    case "team":
      return "Team";
    case "organization":
      return "Organization";
    default:
      return "Identity";
  }
}

export function principalLabel(
  principal?: SecretPrincipalRef,
  options: PrincipalLabelOptions = {},
): string {
  const fallback = options.fallback ?? "Not recorded";
  if (!principal) return fallback;

  const canonicalName =
    principal.displayName?.trim() || principal.name?.trim() || principal.email?.trim();
  if (canonicalName) return canonicalName;

  const id = principal.id?.trim();
  if (!id) return fallback;
  if (id.includes("@")) return id;
  if (principal.type === "user" && options.userIdFallback) return options.userIdFallback;

  return `${friendlyPrincipalType(principal.type)} ${id}`;
}

export function SecretProtectionBadge({ storage }: { storage?: SecretStorageSummary }) {
  void storage;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Secret protection details"
            className="h-8 gap-2 px-2 text-xs"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Protected
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          className="max-w-sm whitespace-normal p-3 text-left font-normal leading-relaxed"
        >
          <div className="space-y-2">
            <p className="font-medium text-foreground">Secret protection</p>
            <p>
              The saved value stays encrypted after you save it. The masked preview is a
              protected hint so you can recognize the secret without revealing it.
            </p>
            <p className="text-muted-foreground">
              Authorized agents and services can use the secret on the server side, but
              the full value is never shown in the browser.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

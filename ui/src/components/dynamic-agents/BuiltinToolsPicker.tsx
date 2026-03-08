"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BuiltinToolsConfig, FetchUrlToolConfig } from "@/types/dynamic-agent";

interface BuiltinToolsPickerProps {
  value: BuiltinToolsConfig | undefined;
  onChange: (value: BuiltinToolsConfig) => void;
  disabled?: boolean;
}

const DEFAULT_FETCH_URL_CONFIG: FetchUrlToolConfig = {
  enabled: false,
  allowed_domains: "*",
};

export function BuiltinToolsPicker({ value, onChange, disabled }: BuiltinToolsPickerProps) {
  // Get current fetch_url config or defaults
  const fetchUrlConfig = value?.fetch_url || DEFAULT_FETCH_URL_CONFIG;

  const handleFetchUrlEnabledChange = (enabled: boolean) => {
    onChange({
      ...value,
      fetch_url: {
        ...fetchUrlConfig,
        enabled,
        // Prefill with * when enabling for the first time
        allowed_domains: fetchUrlConfig.allowed_domains || "*",
      },
    });
  };

  const handleAllowedDomainsChange = (allowed_domains: string) => {
    onChange({
      ...value,
      fetch_url: {
        ...fetchUrlConfig,
        allowed_domains,
      },
    });
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4 text-purple-400" />
          Built-in Tools
        </CardTitle>
        <CardDescription>
          Enable built-in tools for this agent. These tools run locally without external MCP servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* fetch_url tool */}
        <div className="rounded-lg border border-border/50 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <Label className="font-medium">fetch_url</Label>
                <p className="text-xs text-muted-foreground">
                  Fetch content from URLs (web pages, APIs, documentation)
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleFetchUrlEnabledChange(!fetchUrlConfig.enabled)}
              disabled={disabled}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                fetchUrlConfig.enabled ? "bg-green-500" : "bg-muted-foreground/30"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              role="switch"
              aria-checked={fetchUrlConfig.enabled}
              aria-label="Enable fetch_url tool"
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  fetchUrlConfig.enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Domain configuration - shown when enabled */}
          {fetchUrlConfig.enabled && (
            <div className="pl-10 space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="allowed_domains" className="text-sm">
                  Allowed Domains
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <div className="space-y-1 text-xs">
                        <p className="font-medium">Domain pattern format:</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          <li><code>*</code> — Allow all domains</li>
                          <li><code>*.cisco.com</code> — Allow subdomains</li>
                          <li><code>cisco.com</code> — Exact domain only</li>
                        </ul>
                        <p className="pt-1">Separate multiple patterns with commas.</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id="allowed_domains"
                value={fetchUrlConfig.allowed_domains}
                onChange={(e) => handleAllowedDomainsChange(e.target.value)}
                placeholder="*.example.com, *.another.com"
                disabled={disabled}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {fetchUrlConfig.allowed_domains === "*" ? (
                  <span className="text-amber-500">All domains allowed. Consider restricting for security.</span>
                ) : fetchUrlConfig.allowed_domains.trim() === "" ? (
                  <span className="text-red-500">No domains allowed. The tool will block all requests.</span>
                ) : (
                  <span>
                    {fetchUrlConfig.allowed_domains.split(",").filter(d => d.trim()).length} domain pattern(s) configured.
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Placeholder for future built-in tools */}
        {/* Add more tool sections here as needed */}
      </CardContent>
    </Card>
  );
}

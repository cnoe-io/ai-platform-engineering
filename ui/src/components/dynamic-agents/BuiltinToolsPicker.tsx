"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Globe, Info, Settings, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [expanded, setExpanded] = React.useState(false);
  
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
    // Auto-expand when enabling
    if (enabled) {
      setExpanded(true);
    }
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
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-sm">
        <Globe className="h-4 w-4 text-purple-400" />
        Built-in Tools
      </Label>

      <div
        className={cn(
          "border rounded-lg transition-colors",
          fetchUrlConfig.enabled ? "border-primary bg-primary/5" : "border-border"
        )}
      >
        {/* Tool Header Row */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            {/* Toggle Switch */}
            <button
              type="button"
              onClick={() => handleFetchUrlEnabledChange(!fetchUrlConfig.enabled)}
              disabled={disabled}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                fetchUrlConfig.enabled ? "bg-green-500" : "bg-muted-foreground/30",
                disabled && "opacity-50 cursor-not-allowed"
              )}
              role="switch"
              aria-checked={fetchUrlConfig.enabled}
              aria-label="Enable fetch_url tool"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  fetchUrlConfig.enabled ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>

            <div>
              <span className="font-mono text-sm font-medium">fetch_url</span>
              <span className="text-xs text-muted-foreground ml-2">
                Fetch web content
              </span>
            </div>
          </div>

          {fetchUrlConfig.enabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-7 px-2"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3 mr-1" />
              ) : (
                <ChevronRight className="h-3 w-3 mr-1" />
              )}
              <Settings className="h-3 w-3 mr-1" />
              <span className="text-xs">Configure</span>
            </Button>
          )}
        </div>

        {/* Expanded Configuration */}
        {fetchUrlConfig.enabled && expanded && (
          <div className="border-t p-3 bg-muted/30 space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="allowed_domains" className="text-xs">
                Allowed Domains
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
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
              className="font-mono text-xs h-8"
            />
            <p className="text-xs text-muted-foreground">
              {fetchUrlConfig.allowed_domains === "*" ? (
                <span className="text-amber-500">All domains allowed</span>
              ) : fetchUrlConfig.allowed_domains.trim() === "" ? (
                <span className="text-red-500">No domains allowed</span>
              ) : (
                <span>
                  {fetchUrlConfig.allowed_domains.split(",").filter(d => d.trim()).length} pattern(s)
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

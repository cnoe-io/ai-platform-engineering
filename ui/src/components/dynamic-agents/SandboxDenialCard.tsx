"use client";

import React, { useState } from "react";
import { ShieldAlert, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SandboxDenialData } from "./sse-types";

interface SandboxDenialCardProps {
  denial: SandboxDenialData;
  agentId: string;
  onAllowed?: () => void;
}

/**
 * Inline card rendered in the chat timeline when a sandbox policy denial
 * is streamed. Offers "Allow Once" (temporary rule) and "Always Allow"
 * (permanent rule) actions.
 */
export function SandboxDenialCard({
  denial,
  agentId,
  onAllowed,
}: SandboxDenialCardProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "allowed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAllow = async (temporary: boolean) => {
    if (!denial.host) return;
    setStatus("loading");
    setErrorMsg(null);

    try {
      const res = await fetch(
        `/api/dynamic-agents/sandbox/policy/${agentId}/allow-rule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: denial.host,
            port: denial.port || 443,
            binary: denial.binary || undefined,
            temporary,
          }),
        }
      );

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to add rule");
      }

      setStatus("allowed");
      onAllowed?.();
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to allow");
    }
  };

  const stageLabel = denial.stage === "l4_deny"
    ? "Network"
    : denial.stage === "l7_deny"
    ? "HTTP"
    : denial.stage === "ssrf"
    ? "SSRF"
    : denial.stage || "Policy";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 my-2 text-sm",
        status === "allowed"
          ? "border-green-500/30 bg-green-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert
          className={cn(
            "h-4 w-4 mt-0.5 shrink-0",
            status === "allowed" ? "text-green-500" : "text-amber-500"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">
              Sandbox {stageLabel} Denied
            </span>
            {denial.host && (
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                {denial.host}:{denial.port || 443}
              </code>
            )}
          </div>

          {denial.reason && (
            <p className="text-xs text-muted-foreground mt-1">{denial.reason}</p>
          )}

          {denial.binary && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Binary: <code className="font-mono">{denial.binary}</code>
            </p>
          )}

          {status === "idle" && denial.host && (
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAllow(true)}
              >
                Allow Once
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAllow(false)}
              >
                Always Allow
              </Button>
            </div>
          )}

          {status === "loading" && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Updating policy...
            </div>
          )}

          {status === "allowed" && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3 w-3" />
              Rule added and policy hot-reloaded
            </div>
          )}

          {status === "error" && errorMsg && (
            <p className="text-xs text-destructive mt-2">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}

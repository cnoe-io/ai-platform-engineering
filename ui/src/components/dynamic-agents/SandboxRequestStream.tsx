"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SSEAgentEvent } from "./sse-types";

interface SandboxRequestStreamProps {
  events: SSEAgentEvent[];
}

interface StreamEntry {
  id: string;
  timestamp: Date;
  kind: "denial" | "policy_update" | "tool_exec";
  label: string;
  detail?: string;
  severity: "error" | "success" | "info";
}

export function SandboxRequestStream({ events }: SandboxRequestStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const entries: StreamEntry[] = useMemo(() => {
    const out: StreamEntry[] = [];

    for (const evt of events) {
      if (evt.type === "sandbox_denial" && evt.sandboxDenialData) {
        const d = evt.sandboxDenialData;
        const stageLabel =
          d.stage === "l4_deny" ? "L4" :
          d.stage === "l7_deny" ? "L7" :
          d.stage === "l7_audit" ? "L7 Audit" :
          d.stage === "ssrf" ? "SSRF" :
          d.stage || "Deny";

        out.push({
          id: evt.id,
          timestamp: evt.timestamp,
          kind: "denial",
          label: `${stageLabel} blocked → ${d.host || "?"}:${d.port || "?"}`,
          detail: d.reason || d.binary || undefined,
          severity: "error",
        });
      }

      if (evt.type === "sandbox_policy_update" && evt.sandboxPolicyUpdateData) {
        const u = evt.sandboxPolicyUpdateData;
        out.push({
          id: evt.id,
          timestamp: evt.timestamp,
          kind: "policy_update",
          label: `Policy ${u.status}${u.rule_id ? ` (${u.rule_id})` : ""}`,
          severity: u.status === "loaded" ? "success" : "error",
        });
      }

      if (evt.type === "sandbox_tool_exec" && evt.sandboxToolExecData) {
        const t = evt.sandboxToolExecData;
        out.push({
          id: evt.id,
          timestamp: evt.timestamp,
          kind: "tool_exec",
          label: `${t.tool_name}${t.command ? `: ${t.command.slice(0, 60)}${t.command.length > 60 ? "…" : ""}` : ""}`,
          detail: t.exit_code !== undefined ? `exit ${t.exit_code}` : undefined,
          severity: t.exit_code === 0 ? "success" : t.exit_code !== undefined ? "error" : "info",
        });
      }
    }

    return out;
  }, [events]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Activity className="h-3 w-3" />
          <span>Request Stream</span>
        </div>
        <p className="text-xs text-muted-foreground italic pl-5">
          No sandbox events yet. Send a message to start.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Activity className="h-3 w-3" />
        <span>Request Stream ({entries.length})</span>
      </div>
      <ScrollArea className="max-h-60">
        <div className="space-y-0.5 font-mono text-[11px]">
          {entries.map((entry) => {
            const Icon =
              entry.kind === "denial" ? ShieldAlert :
              entry.kind === "policy_update" ? ShieldCheck :
              Terminal;

            const timeStr = entry.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-start gap-1.5 px-1.5 py-1 rounded",
                  entry.severity === "error" && "bg-destructive/5",
                  entry.severity === "success" && "bg-green-500/5",
                  entry.severity === "info" && "bg-muted/30"
                )}
              >
                <Icon
                  className={cn(
                    "h-3 w-3 mt-0.5 shrink-0",
                    entry.severity === "error" && "text-destructive",
                    entry.severity === "success" && "text-green-500",
                    entry.severity === "info" && "text-muted-foreground"
                  )}
                />
                <span className="text-muted-foreground shrink-0">{timeStr}</span>
                <span
                  className={cn(
                    "truncate",
                    entry.severity === "error" && "text-destructive",
                    entry.severity === "success" && "text-green-600 dark:text-green-400",
                    entry.severity === "info" && "text-foreground"
                  )}
                  title={entry.label}
                >
                  {entry.label}
                </span>
                {entry.detail && (
                  <span className="text-muted-foreground shrink-0">
                    {entry.detail}
                  </span>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Client-side tool approval policy (display + optional prompt before risky tools).
 */

import { readSettings } from "../platform/config.js";

export type ToolApprovalMode = "auto" | "prompt" | "deny";

const RISKY = /bash|shell|exec|write|delete|rm |kubectl|terraform apply|curl.*\|/i;

export function getToolApprovalMode(): ToolApprovalMode {
  const env = process.env.CAIPE_TOOL_APPROVAL?.trim().toLowerCase();
  if (env === "auto" || env === "prompt" || env === "deny") return env;
  const v = readSettings().chat?.toolApproval;
  if (v === "auto" || v === "prompt" || v === "deny") return v;
  return "prompt";
}

export function isRiskyTool(name: string): boolean {
  return RISKY.test(name);
}

export function formatToolNotice(name: string, mode: ToolApprovalMode): string {
  if (mode === "auto") return `🔧 Tool: **${name}**`;
  if (mode === "deny" && isRiskyTool(name)) {
    return `⛔ Blocked tool (chat.tool-approval=deny): **${name}**`;
  }
  if (isRiskyTool(name)) {
    return `🔧 Tool (review): **${name}** — set chat.tool-approval=auto to skip warnings`;
  }
  return `🔧 Tool: **${name}**`;
}

import { getConfig } from "@/lib/config";

/**
 * "{appName} can make mistakes..." disclaimer, with the audit-logging
 * clause appended when `auditLogsEnabled` is on. Shared so every chat
 * surface (main Dynamic Agent chat, Tome project chat) shows identical
 * audit messaging instead of each hand-rolling the same string.
 */
export function AuditNotice() {
  const appName = getConfig("appName");
  const auditLogsEnabled = getConfig("auditLogsEnabled");

  return (
    <>
      {appName} can make mistakes. Verify important info.
      {auditLogsEnabled && " · Conversations are logged for audit."}
    </>
  );
}

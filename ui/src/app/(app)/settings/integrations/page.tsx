"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface WebexStatus {
  connected: boolean;
  expiresAt?: string;
  scopes?: string[];
  createdAt?: string;
  updatedAt?: string;
  error?: string;
}

export default function IntegrationsPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<WebexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    const outcome = params.get("webex");
    const message = params.get("message");
    if (outcome === "success") {
      setBanner({ kind: "success", text: "Webex connected." });
    } else if (outcome === "error") {
      setBanner({
        kind: "error",
        text: `Webex connection failed${message ? `: ${message}` : ""}.`,
      });
    }
  }, [params]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const resp = await fetch("/api/integrations/webex/status", {
        cache: "no-store",
      });
      const body = (await resp.json()) as WebexStatus;
      setStatus(body);
    } catch (err) {
      setStatus({ connected: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  function connect() {
    setBusy(true);
    window.location.href = "/api/integrations/webex/start";
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/integrations/webex/disconnect", { method: "POST" });
      await refresh();
      setBanner({ kind: "success", text: "Webex disconnected." });
    } catch (err) {
      setBanner({
        kind: "error",
        text: `Failed to disconnect: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const expiresLabel = status?.expiresAt
    ? new Date(status.expiresAt).toLocaleString()
    : null;

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect external services to your account. Tokens are stored
          per-user and used by agents that act on your behalf.
        </p>
      </div>

      {banner && (
        <div
          className={
            banner.kind === "success"
              ? "rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-300"
              : "rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300"
          }
        >
          {banner.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Cisco Webex</span>
            <span
              className={
                status?.connected
                  ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-bold text-green-400 border border-green-500/30"
                  : "rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground border"
              }
            >
              {status?.connected ? "CONNECTED" : "NOT CONNECTED"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Required for agents that read your meetings, transcripts, and
            recordings (e.g. Pam, the pod meeting assistant). Uses Cisco&apos;s
            official Webex Meetings MCP at{" "}
            <code className="text-xs">mcp.webexapis.com/mcp/webex-meeting</code>.
          </p>

          {status?.connected && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              {expiresLabel && (
                <>
                  <dt className="text-muted-foreground">Token expires</dt>
                  <dd className="font-mono">{expiresLabel}</dd>
                </>
              )}
              {status.scopes && status.scopes.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Scopes</dt>
                  <dd className="font-mono break-all">{status.scopes.join(" ")}</dd>
                </>
              )}
            </dl>
          )}

          <div className="flex gap-2 pt-1">
            {status?.connected ? (
              <>
                <Button variant="outline" disabled={busy} onClick={connect}>
                  Reconnect
                </Button>
                <Button variant="destructive" disabled={busy} onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={connect}>
                Connect Webex
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

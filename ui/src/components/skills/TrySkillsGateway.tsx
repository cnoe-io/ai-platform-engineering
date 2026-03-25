"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Terminal, RefreshCcw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminRole } from "@/hooks/use-admin-role";

const DEFAULT_KEY_HEADER =
  process.env.NEXT_PUBLIC_CAIPE_CATALOG_API_KEY_HEADER ||
  "X-Caipe-Catalog-Key";

type SyncStatus = "in_sync" | "supervisor_stale" | "unknown" | string;

function syncLabel(status: SyncStatus | undefined): string {
  switch (status) {
    case "in_sync":
      return "In sync — supervisor loaded the current catalog generation.";
    case "supervisor_stale":
      return "Supervisor stale — run Refresh skills so the assistant picks up the latest catalog.";
    default:
      return "Status unavailable — backend may not expose generation metadata yet.";
  }
}

export function TrySkillsGateway() {
  const { isAdmin } = useAdminRole();
  const [sync, setSync] = useState<{
    sync_status?: SyncStatus;
    catalog_cache_generation?: number | null;
    last_built_catalog_generation?: number | null;
    skills_loaded_count?: number | null;
    graph_generation?: number | null;
  } | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [mintBusy, setMintBusy] = useState(false);
  const [keys, setKeys] = useState<
    { key_id: string; created_at?: number; revoked_at?: number | null }[]
  >([]);

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://your-instance.example.com";

  const loadSync = useCallback(async () => {
    setSyncLoading(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/skills/supervisor-status", {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError("Could not load sync status.");
        setSync(null);
        return;
      }
      setSync(data);
    } catch {
      setSyncError("Could not load sync status.");
      setSync(null);
    } finally {
      setSyncLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog-api-keys", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.keys)) setKeys(data.keys);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadSync();
    void loadKeys();
  }, [loadSync, loadKeys]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/skills/refresh", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefreshMsg(
          data.message ||
            (res.status === 403
              ? "Admin role required to refresh the supervisor."
              : "Refresh failed."),
        );
        return;
      }
      setRefreshMsg(data.message || "Refresh completed.");
      await loadSync();
    } catch {
      setRefreshMsg("Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleMint = async () => {
    setMintBusy(true);
    setMintedKey(null);
    try {
      const res = await fetch("/api/catalog-api-keys", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMintedKey(null);
        return;
      }
      if (typeof data.key === "string") setMintedKey(data.key);
      await loadKeys();
    } finally {
      setMintBusy(false);
    }
  };

  const searchExample = `${baseUrl}/api/skills?q=aws&page=1&page_size=20&source=default`;

  const curlBearer = `curl -sS "${searchExample}" \\\n  -H "Authorization: Bearer <access_token>"`;

  const curlKey = `curl -sS "${searchExample}" \\\n  -H "${DEFAULT_KEY_HEADER}: <key_id.secret>"`;

  return (
    <div className="space-y-6 max-w-3xl">
      <Card className="border-border/80 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Terminal className="h-5 w-5" />
            Try skills gateway
          </CardTitle>
          <CardDescription>
            Call the same catalog as the UI and supervisor using an OIDC access token or a catalog
            API key. Invalid authentication returns <strong>401</strong> with a generic body (no
            account enumeration).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-foreground mb-1">Base URL</p>
            <code className="block rounded-md bg-muted px-3 py-2 text-xs break-all">{baseUrl}</code>
          </div>

          <div>
            <p className="font-medium text-foreground mb-1">Auth option A — Bearer token</p>
            <p className="text-muted-foreground mb-2">
              Use an OIDC access token accepted by the same validation as other CAIPE APIs.
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">
              {curlBearer}
            </pre>
          </div>

          <div>
            <p className="font-medium text-foreground mb-1">Auth option B — Catalog API key</p>
            <p className="text-muted-foreground mb-2">
              Header name: <code>{DEFAULT_KEY_HEADER}</code> (configure server-side; do not log key
              values).
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">
              {curlKey}
            </pre>
            <p className="text-muted-foreground mt-2 text-xs">
              Optional query params: <code>q</code>, <code>page</code>, <code>page_size</code>,{" "}
              <code>source</code>, <code>visibility</code> (global | team | personal),{" "}
              <code>include_content</code>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={mintBusy}
              onClick={() => void handleMint()}
            >
              {mintBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Mint catalog API key
            </Button>
            {mintedKey ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 break-all">
                Copy once: <code>{mintedKey}</code>
              </span>
            ) : null}
          </div>
          {keys.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Active / past keys: </span>
              {keys.map((k) => k.key_id).join(", ")}
            </div>
          ) : null}

          <div className="border-t border-border pt-4 space-y-2">
            <p className="font-medium text-foreground">Skills sync (supervisor vs catalog)</p>
            {syncLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : syncError ? (
              <p className="text-destructive text-xs flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />
                {syncError}
              </p>
            ) : (
              <div className="space-y-1 text-xs">
                <p className="flex items-start gap-1.5">
                  {sync?.sync_status === "in_sync" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  {syncLabel(sync?.sync_status)}
                </p>
                <p className="text-muted-foreground pl-5">
                  catalog_cache_generation: {sync?.catalog_cache_generation ?? "—"} ·
                  last_built_catalog_generation: {sync?.last_built_catalog_generation ?? "—"} ·
                  skills_loaded_count: {sync?.skills_loaded_count ?? "—"}
                </p>
              </div>
            )}
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              >
                <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                Refresh skills (supervisor)
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                Ask an administrator to run <strong>Refresh skills</strong> if the supervisor is
                stale.
              </p>
            )}
            {refreshMsg ? (
              <p className="text-xs text-muted-foreground mt-1">{refreshMsg}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claude (Desktop / Code)</CardTitle>
          <CardDescription>
            CAIPE remains the source of truth for <strong>listing</strong> skills; export or copy
            SKILL.md bodies when <code>include_content=true</code> if you mirror files locally.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
          <ol className="space-y-2 pl-1">
            <li>Obtain an OIDC access token or mint a catalog API key above.</li>
            <li>
              Run the <code>curl</code> example against <code>/api/skills</code> and save the JSON.
            </li>
            <li>
              Map each skill to a folder under{" "}
              <code className="text-foreground">.claude/skills/&lt;name&gt;/SKILL.md</code> or your
              team&apos;s agreed layout per{" "}
              <a
                className="text-primary underline"
                href="https://agentskills.io/specification"
                target="_blank"
                rel="noreferrer"
              >
                agentskills.io
              </a>
              .
            </li>
            <li>Reload the assistant; treat the catalog as authoritative for names and descriptions.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cursor</CardTitle>
          <CardDescription>
            Align with project rules or <code>.cursor/skills</code> (team convention).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <ol className="space-y-2 list-decimal list-inside pl-1">
            <li>Authenticate the same way as for Claude (token or catalog key header).</li>
            <li>Fetch catalog JSON from <code>/api/skills</code> with the query params you need.</li>
            <li>
              Add concise rules in <code>.cursor/rules</code> referencing skill names, or symlink /
              copy exported <code>SKILL.md</code> files into <code>.cursor/skills</code> if your org
              uses that layout.
            </li>
            <li>Re-fetch when admins refresh the catalog or hubs change.</li>
          </ol>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
        <strong>Skill Scanner</strong> (hub ingest) uses{" "}
        <a
          className="text-primary underline"
          href="https://github.com/cisco-ai-defense/skill-scanner"
          target="_blank"
          rel="noreferrer"
        >
          Skill Scanner
        </a>
        , provided by <strong>Cisco AI Defense</strong>. Scanner results are best-effort and do not
        guarantee security.
      </p>
    </div>
  );
}

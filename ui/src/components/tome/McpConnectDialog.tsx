"use client";

import { useEffect, useState } from "react";
import { Plug, Loader2, KeyRound, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * "Connect via MCP" - surfaced from the Tome header. Shows the MCP endpoint,
 * mints a personal API key (a local skills token via POST /api/skills/token),
 * and renders ready-to-paste client configs for Claude Desktop and Cursor.
 *
 * The key is a JWT, it can't be recovered later, only regenerated, so we show
 * it once on generation and let the user copy it then.
 */

const TOKEN_PLACEHOLDER = "<YOUR_TOKEN>";

function claudeConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        tome: {
          command: "npx",
          args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${token}`],
        },
      },
    },
    null,
    2,
  );
}

function claudeCodeCommand(endpoint: string, token: string): string {
  return [
    "claude mcp add --scope user --transport http tome \\",
    `  ${endpoint} \\`,
    `  --header "Authorization: Bearer ${token}"`,
  ].join("\n");
}

function cursorConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        tome: {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

type ActiveKeyStatus = { hasActiveKey: boolean; createdAt?: string; expiresAt?: string };

export function McpConnectDialog({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [endpoint, setEndpoint] = useState("/api/tome/mcp");
  const [days, setDays] = useState(90);
  const [token, setToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<ActiveKeyStatus | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setEndpoint(`${window.location.origin}/api/tome/mcp`);
    }
  }, []);

  useEffect(() => {
    if (!open || token) return;
    let cancelled = false;
    fetch("/api/skills/token")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setActiveKey({
          hasActiveKey: body.has_active_key,
          createdAt: body.created_at,
          expiresAt: body.expires_at,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expires_in_days: days }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to generate key (${res.status})`);
      }
      const body = await res.json();
      setToken(body.token);
      setActiveKey({ hasActiveKey: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const shownToken = token ?? TOKEN_PLACEHOLDER;
  const hasExistingKey = !token && activeKey?.hasActiveKey;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-auto gap-1.5 px-2 py-1">
          <Plug className="h-3.5 w-3.5" />
          Connect via MCP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Connect via MCP
          </DialogTitle>
          <DialogDescription>
            Use these TOME projects from an MCP client (Claude Code, Claude Desktop, Cursor). Generate
            a personal API key and paste the config into your client.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          {/* Teaser: a one-command Claude Code plugin is in the works. */}
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className="font-medium text-foreground">Claude plugin coming soon.</span>
              <span className="text-muted-foreground">
                {" "}One-command setup with a <code>/tome</code> command and a
                project-aware skill. For now, use the manual config below.
              </span>
            </div>
          </div>

          {/* API key */}
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium">API key</label>
            <p className="text-xs text-muted-foreground">
              Endpoint <code>{endpoint}</code> is included in the client config below once generated.
            </p>
            {hasExistingKey && (
              <p className="text-xs text-muted-foreground">
                You already have an active key
                {activeKey?.expiresAt
                  ? ` (expires ${new Date(activeKey.expiresAt).toLocaleDateString()})`
                  : ""}
                . Generating a new one will revoke it.
              </p>
            )}
            <div className="flex items-center gap-2">
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-md border bg-background px-2 py-2 text-xs"
                aria-label="Key expiry"
              >
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <Button onClick={generate} disabled={generating} size="sm" className="gap-1.5">
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                {token || hasExistingKey ? "Regenerate" : "Generate key"}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {token && (
              <div className="space-y-1">
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted/40 px-3 py-2 text-xs">
                    {token}
                  </code>
                  <CopyButton value={token} label="Copy API key" copiedLabel="Copied key" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Copy it now. For security this key is shown only once; regenerating revokes it and
                  issues a new one.
                </p>
              </div>
            )}
          </div>

          {/* Client config — only shown once there's a real token to embed */}
          {token && (
            <div className="min-w-0 space-y-1.5">
              <label className="text-sm font-medium">Client configuration</label>
              <Tabs defaultValue="claude-code" className="min-w-0">
                <TabsList>
                  <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
                  <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
                  <TabsTrigger value="cursor">Cursor</TabsTrigger>
                </TabsList>
                <TabsContent value="claude-code" className="min-w-0 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Run this once. Registers the server (user scope) via the native HTTP transport, no
                    bridge needed. Then <code>/mcp</code> shows <code>tome</code>.
                  </p>
                  <ConfigBlock text={claudeCodeCommand(endpoint, shownToken)} />
                </TabsContent>
                <TabsContent value="claude" className="min-w-0 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Add to <code>claude_desktop_config.json</code> (uses the <code>mcp-remote</code>{" "}
                    bridge). Claude Code: <code>claude mcp add</code> the same endpoint with the
                    Authorization header.
                  </p>
                  <ConfigBlock text={claudeConfig(endpoint, shownToken)} />
                </TabsContent>
                <TabsContent value="cursor" className="min-w-0 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Add to <code>.cursor/mcp.json</code> (project) or <code>~/.cursor/mcp.json</code>{" "}
                    (global).
                  </p>
                  <ConfigBlock text={cursorConfig(endpoint, shownToken)} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigBlock({ text }: { text: string }) {
  return (
    <div className="relative min-w-0">
      <pre className="max-h-64 max-w-full overflow-auto rounded-md border bg-muted/40 p-3 pr-12 text-xs">
        <code>{text}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={text} label="Copy config" copiedLabel="Copied" variant="secondary" />
      </div>
    </div>
  );
}

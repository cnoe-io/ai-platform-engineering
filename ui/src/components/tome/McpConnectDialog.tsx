"use client";

import { useState } from "react";
import { Plug, Sparkles } from "lucide-react";

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
import { buildMcpRemoteOAuthArgs } from "@/lib/tome/mcpb/manifest";

/**
 * "Connect via MCP" - surfaced from the Tome header. All three clients sign
 * in via OAuth/PKCE against the same public `caipe-cli` Keycloak client — no
 * API key needed anywhere in this dialog:
 *   - Claude Code: native `claude mcp login`.
 *   - Claude Desktop: an installable .mcpb bundle wrapping mcp-remote's own
 *     OAuth client (or, as a fallback, a manual claude_desktop_config.json
 *     entry running the same mcp-remote flow via npx).
 *   - Cursor: a static `auth` object (CLIENT_ID only, no secret — Cursor's
 *     own PKCE-client support) in .cursor/mcp.json.
 */

// Native OAuth/PKCE — no API key needed. --client-id/--callback-port match
// the Keycloak `caipe-cli` public client's already-registered redirect URIs
// (see ui/src/lib/tome/mcpb/manifest.ts for the same client reused by the
// Claude Desktop bundle below).
function claudeCodeCommand(endpoint: string): string {
  return [
    "claude mcp add --scope user --transport http --client-id caipe-cli --callback-port 8085 tome \\",
    `  ${endpoint}`,
    "claude mcp login tome",
  ].join("\n");
}

// Fallback for enterprise policies that disable installing Desktop
// Extensions (.mcpb bundles): the same OAuth flow via `npx mcp-remote`,
// hand-added to claude_desktop_config.json. Shares buildMcpRemoteOAuthArgs
// with the bundle (ui/src/lib/tome/mcpb/manifest.ts) so the two never drift.
function claudeDesktopManualConfig(endpoint: string, allowHttp: boolean): string {
  return JSON.stringify(
    {
      mcpServers: {
        tome: {
          command: "npx",
          args: ["-y", "mcp-remote", ...buildMcpRemoteOAuthArgs({ endpoint, allowHttp })],
        },
      },
    },
    null,
    2,
  );
}

// Cursor's own OAuth support (https://cursor.com/docs/mcp#installing-mcp-servers):
// a static `auth` object naming a pre-registered client, no dynamic client
// registration. `caipe-cli` is a public PKCE client (no secret), which
// Cursor's docs confirm the `auth` object supports (CLIENT_SECRET is
// optional, "if the provider uses confidential clients"). Cursor Desktop
// redirects via its own app URI scheme (cursor://anysphere.cursor-mcp/...),
// not a localhost port — registered on `caipe-cli` alongside the 8085
// already used by Claude Code/Desktop — see
// charts/ai-platform-engineering/charts/keycloak/realm-config.json.
function cursorConfig(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        tome: {
          url: endpoint,
          auth: {
            CLIENT_ID: "caipe-cli",
            scopes: ["openid", "email", "profile"],
          },
        },
      },
    },
    null,
    2,
  );
}

export function McpConnectDialog({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const endpoint = `${typeof window !== "undefined" ? window.location.origin : ""}/api/tome/mcp`;

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
            Use these TOME projects from an MCP client (Claude Code, Claude Desktop, Cursor). All
            three sign in via OAuth — no API key needed.
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

          {/* Client config */}
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
                  Signs in via native OAuth — no API key needed. Run this once, then{" "}
                  <code>/mcp</code> shows <code>tome</code>.
                </p>
                <ConfigBlock text={claudeCodeCommand(endpoint)} />
              </TabsContent>
              <TabsContent value="claude" className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Many organizations block installing Desktop Extensions (.mcpb bundles) via
                  policy. Add this to <code>claude_desktop_config.json</code> (Settings →
                  Developer → Edit Config) — no API key needed, you&apos;ll sign in via your
                  browser the first time a Tome tool is used.
                </p>
                <ConfigBlock
                  text={claudeDesktopManualConfig(endpoint, endpoint.startsWith("http://"))}
                />
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    If Desktop Extensions are allowed in your environment, this is simpler:
                    download and double-click to install.
                  </p>
                  <Button asChild size="sm" className="gap-1.5">
                    <a href="/api/tome/mcp/bundle" download>
                      <Plug className="h-3.5 w-3.5" />
                      Download MCP Bundle
                    </a>
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="cursor" className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Signs in via OAuth — no API key needed. Add to <code>.cursor/mcp.json</code>{" "}
                  (project) or <code>~/.cursor/mcp.json</code> (global).
                </p>
                <ConfigBlock text={cursorConfig(endpoint)} />
              </TabsContent>
            </Tabs>
          </div>
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

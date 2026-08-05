"use client";

import { useState } from "react";
import { Plug } from "lucide-react";

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
 * "Connect via MCP" - surfaced from the Tome header. Native remote-MCP
 * clients only need the Streamable HTTP URL: they discover OAuth from the
 * protected-resource metadata and dynamically register a public PKCE client.
 * Claude Desktop still needs an MCP bridge because it does not accept a
 * remote Streamable HTTP URL directly, but that bridge uses the same
 * discovery and registration flow rather than a pre-registered client id.
 */

function codexCommand(endpoint: string): string {
  return [
    `codex mcp add tome --url ${endpoint}`,
    "",
    "# Reauthenticate later with:",
    "# codex mcp login tome",
  ].join("\n");
}

// Native OAuth/PKCE — no API key or pre-registered client id needed.
function claudeCodeCommand(endpoint: string): string {
  return [
    "claude mcp add --scope user --transport http tome \\",
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

// Cursor follows the same remote-MCP discovery flow from the URL. Omitting a
// static auth object avoids coupling it to a pre-registered Keycloak client.
function cursorConfig(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        tome: {
          url: endpoint,
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
            Use these TOME projects from an MCP client (Codex, Claude Code, Claude Desktop,
            Cursor). All four sign in via OAuth in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          {/* Client config */}
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium">Client configuration</label>
            <Tabs defaultValue="codex" className="min-w-0">
              <TabsList>
                <TabsTrigger value="codex">Codex</TabsTrigger>
                <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
                <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
                <TabsTrigger value="cursor">Cursor</TabsTrigger>
              </TabsList>
              <TabsContent value="codex" className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Run this native Streamable HTTP command. Codex discovers OAuth and registers
                  itself from the server URL; no <code>npx</code> proxy or client ID is required.
                </p>
                <ConfigBlock text={codexCommand(endpoint)} />
              </TabsContent>
              <TabsContent value="claude-code" className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Run this once, then run <code>/mcp</code> to confirm <code>tome</code> is
                  connected.
                </p>
                <ConfigBlock text={claudeCodeCommand(endpoint)} />
              </TabsContent>
              <TabsContent value="claude" className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Download and double-click to install, then sign in via your browser when a
                  Tome tool is first used.
                </p>
                <Button asChild size="sm" className="gap-1.5">
                  <a href="/api/tome/mcp/bundle" download>
                    <Plug className="h-3.5 w-3.5" />
                    Download MCP Bundle
                  </a>
                </Button>
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Some organizations block installing Desktop Extensions (.mcpb bundles) via
                    policy. If yours does, add this to <code>claude_desktop_config.json</code>{" "}
                    instead (Settings → Developer → Edit Config), then restart Claude Desktop for
                    it to take effect.
                  </p>
                  <ConfigBlock
                    text={claudeDesktopManualConfig(endpoint, endpoint.startsWith("http://"))}
                  />
                </div>
              </TabsContent>
              <TabsContent value="cursor" className="min-w-0 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Add to <code>.cursor/mcp.json</code> (project) or{" "}
                  <code>~/.cursor/mcp.json</code> (global), then sign in via your browser when a
                  Tome tool is first used.
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

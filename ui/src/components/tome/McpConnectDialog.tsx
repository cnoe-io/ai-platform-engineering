"use client";

import { useState, type ReactNode } from "react";
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
 * Claude Desktop uses a local bridge configured through its Developer settings
 * because enterprise accounts can restrict custom Web connectors. Every option
 * uses the same OAuth discovery and public-PKCE flow; none requires a static
 * client registration or bearer key.
 */

const VERIFICATION_PROMPT = [
  "Use only the Tome MCP server.",
  "List its available tools, then call tome_list_projects once.",
  "Do not create, update, or delete anything.",
].join(" ");

function codexCommand(endpoint: string): string {
  return [`codex mcp add tome --url ${endpoint}`, "codex mcp login tome"].join(
    "\n",
  );
}

// Native OAuth/PKCE — no API key or pre-registered client id needed.
function claudeCodeCommand(endpoint: string): string {
  return [
    "claude mcp add --scope user --transport http tome \\",
    `  ${endpoint}`,
  ].join("\n");
}

function claudeDesktopManualConfig(
  endpoint: string,
  allowHttp: boolean,
): string {
  return JSON.stringify(
    {
      mcpServers: {
        tome: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            ...buildMcpRemoteOAuthArgs({ endpoint, allowHttp }),
          ],
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

function openCodeCommand(endpoint: string): string {
  return [
    `opencode mcp add tome --url ${endpoint}`,
    "opencode mcp auth tome",
  ].join("\n");
}

export function McpConnectDialog({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const endpoint = `${typeof window !== "undefined" ? window.location.origin : ""}/api/tome/mcp`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-auto gap-1.5 px-2 py-1"
        >
          <Plug className="h-3.5 w-3.5" />
          Connect via MCP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Connect via MCP
          </DialogTitle>
          <DialogDescription>
            Use these TOME projects from Codex, Claude, Cursor, or OpenCode.
            Native clients connect over Streamable HTTP; Claude Desktop uses a
            local bridge. Every option signs in via OAuth.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          {/* Client config */}
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium">Client configuration</label>
            <Tabs defaultValue="codex" className="min-w-0">
              <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="codex" className="shrink-0">
                  Codex
                </TabsTrigger>
                <TabsTrigger value="claude-code" className="shrink-0">
                  Claude Code
                </TabsTrigger>
                <TabsTrigger value="claude" className="shrink-0">
                  Claude Desktop
                </TabsTrigger>
                <TabsTrigger value="cursor" className="shrink-0">
                  Cursor
                </TabsTrigger>
                <TabsTrigger value="opencode" className="shrink-0">
                  OpenCode
                </TabsTrigger>
              </TabsList>
              <TabsContent value="codex" className="min-w-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Run this once. Codex discovers Tome&apos;s OAuth settings and
                  opens your browser to sign in.
                </p>
                <InstructionBlock
                  title="Configure and sign in"
                  text={codexCommand(endpoint)}
                />
                <InstructionBlock
                  title="Check the connection"
                  description={
                    <>
                      Both commands should show <code>tome</code> enabled with
                      OAuth. In Codex, use <code>/mcp</code> to inspect its
                      tools.
                    </>
                  }
                  text={["codex mcp get tome", "codex mcp list"].join("\n")}
                />
              </TabsContent>
              <TabsContent
                value="claude-code"
                className="min-w-0 space-y-3"
              >
                <p className="text-xs text-muted-foreground">
                  Claude Code connects directly over HTTP. OAuth client
                  registration and PKCE are handled automatically.
                </p>
                <InstructionBlock
                  title="Configure"
                  text={claudeCodeCommand(endpoint)}
                />
                <InstructionBlock
                  title="Sign in and verify"
                  description={
                    <>
                      Start Claude Code, run <code>/mcp</code>, select{" "}
                      <code>tome</code>, and complete authentication. The list
                      command should then report it as connected.
                    </>
                  }
                  text="claude mcp list"
                />
              </TabsContent>
              <TabsContent value="claude" className="min-w-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enterprise connector policies can prevent adding a custom Web
                  connector. Open{" "}
                  <strong>Settings → Developer → Edit Config</strong>, merge
                  this into <code>claude_desktop_config.json</code>, save, and
                  restart Claude Desktop.
                </p>
                <InstructionBlock
                  title="Configure the local bridge"
                  description={
                    <>
                      Requires Node.js and <code>npx</code>. The bridge runs
                      locally and connects to Tome over HTTP-only Streamable
                      HTTP.
                    </>
                  }
                  text={claudeDesktopManualConfig(
                    endpoint,
                    endpoint.startsWith("http://"),
                  )}
                  copyLabel="Copy JSON"
                />
                <div className="rounded-md border p-3 text-xs">
                  <p className="font-medium">Check the connection</p>
                  <p className="mt-1 text-muted-foreground">
                    After restarting, open <strong>Settings → Developer</strong>
                    . <code>tome</code> should show as running. Start a new chat
                    and use the verification prompt below; the first run opens
                    your browser for OAuth.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="cursor" className="min-w-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Add to <code>.cursor/mcp.json</code> (project) or{" "}
                  <code>~/.cursor/mcp.json</code> (global). Cursor discovers
                  OAuth and registers its client automatically.
                </p>
                <InstructionBlock
                  title="Configure"
                  text={cursorConfig(endpoint)}
                  copyLabel="Copy JSON"
                />
                <InstructionBlock
                  title="Sign in and list tools"
                  description="The final command should include tome_list_projects."
                  text={[
                    "cursor agent mcp login tome",
                    "cursor agent mcp list",
                    "cursor agent mcp list-tools tome",
                  ].join("\n")}
                />
              </TabsContent>
              <TabsContent value="opencode" className="min-w-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  OpenCode connects directly over Streamable HTTP and uses DCR
                  with PKCE when no client ID is configured.
                </p>
                <InstructionBlock
                  title="Configure and sign in"
                  text={openCodeCommand(endpoint)}
                />
                <InstructionBlock
                  title="Debug and verify"
                  description={
                    <>
                      Debug should pass discovery and OAuth checks; list should
                      report <code>tome</code> as connected.
                    </>
                  }
                  text={[
                    "opencode mcp debug tome",
                    "opencode mcp list",
                  ].join("\n")}
                />
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div>
              <p className="text-sm font-medium">Confirm Tome is working</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run this read-only check in a new client conversation after
                signing in.
              </p>
            </div>
            <ConfigBlock
              text={VERIFICATION_PROMPT}
              copyLabel="Copy test prompt"
            />
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  Working
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>
                    <code>tome</code> shows connected.
                  </li>
                  <li>
                    Tools include <code>tome_list_projects</code>.
                  </li>
                  <li>Your accessible projects are returned.</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-destructive">Not working</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>
                    <code>401</code>: authentication was not completed.
                  </li>
                  <li>
                    <code>403</code>: a firewall or WAF blocked DCR or the
                    callback URL.
                  </li>
                  <li>No tools: restart the client and reconnect.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InstructionBlock({
  title,
  description,
  text,
  copyLabel,
}: {
  title: string;
  description?: ReactNode;
  text: string;
  copyLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <ConfigBlock text={text} copyLabel={copyLabel} />
    </div>
  );
}

function ConfigBlock({
  text,
  copyLabel = "Copy",
}: {
  text: string;
  copyLabel?: string;
}) {
  return (
    <div className="relative min-w-0">
      <pre className="max-h-64 max-w-full overflow-auto rounded-md border bg-muted/40 p-3 pr-12 text-xs">
        <code>{text}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton
          value={text}
          label={copyLabel}
          copiedLabel="Copied"
          variant="secondary"
        />
      </div>
    </div>
  );
}

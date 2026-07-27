// GET /api/tome/mcp/bundle
//
// Downloads a Claude Desktop MCP Bundle (.mcpb) preconfigured to reach this
// deployment's Tome MCP server via mcp-remote's OAuth/PKCE flow — no static
// API token needed, unlike the Claude Code / Cursor tabs in the "Connect via
// MCP" dialog. Session-gated like the rest of the Tome UI; the bundle itself
// carries no secret (auth happens live via OAuth after install), but this
// route is only ever reached from within the authenticated dialog anyway.

import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

import { getRequestOrigin } from "@/app/api/skills/_lib/request-origin";
import { authOptions } from "@/lib/auth-config";
import { buildTomeMcpbBundle } from "@/lib/tome/mcpb/build-bundle";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export async function GET(request: NextRequest) {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!(session as { user?: { email?: string | null } } | null)?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = getRequestOrigin(request);
  const allowHttp = origin.startsWith("http://");

  const buffer = await buildTomeMcpbBundle({ origin, allowHttp });

  // Copy the Node Buffer into a fresh ArrayBuffer so the resulting
  // Uint8Array is typed against ArrayBuffer (not the SharedArrayBuffer
  // union Node's Buffer carries) — required by the DOM BlobPart typing in
  // this Next.js version. Mirrors ui/src/app/api/skills/configs/[id]/export.
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  const body = new Blob([new Uint8Array(ab)], { type: "application/zip" });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="tome.mcpb"',
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

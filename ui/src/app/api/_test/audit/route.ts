import { NextResponse } from "next/server";

import { getAuditBackend } from "@/lib/audit/backend";
import { getAuditReader } from "@/lib/audit/reader";

// assisted-by Codex Codex-sonnet-4-6

function auditTestModeEnabled(): boolean {
  return process.env.AUDIT_TEST_MODE === "1";
}

export async function GET(): Promise<NextResponse> {
  if (!auditTestModeEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const events = await getAuditReader().query({ limit: 1000 });
  return NextResponse.json({ events }, { status: 200 });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!auditTestModeEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let event: Record<string, unknown>;
  try {
    event = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  getAuditBackend().write(event);

  return NextResponse.json({ written: true }, { status: 200 });
}

export async function DELETE(): Promise<NextResponse> {
  if (!auditTestModeEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(
    { error: "audit-service reset is not supported by the UI test route" },
    { status: 501 },
  );
}

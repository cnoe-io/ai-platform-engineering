import fs from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

import { getAuditBackend } from "@/lib/audit/backend";

function auditTestModeEnabled(): boolean {
  return process.env.AUDIT_TEST_MODE === "1";
}

function getAuditLogPath(): string {
  return process.env.AUDIT_LOG_LOCAL_PATH ?? "./audit-logs";
}

async function collectNdjsonFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectNdjsonFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".ndjson")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function removeDirectoryContents(dir: string): Promise<void> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeDirectoryContents(fullPath);
      try {
        await fs.rmdir(fullPath);
      } catch {
        // ignore
      }
    } else {
      try {
        await fs.unlink(fullPath);
      } catch {
        // ignore
      }
    }
  }
}

export async function GET(): Promise<NextResponse> {
  if (!auditTestModeEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const auditPath = getAuditLogPath();
  const files = await collectNdjsonFiles(auditPath);

  const events: Record<string, unknown>[] = [];
  for (const file of files) {
    if (events.length >= 1000) break;
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (events.length >= 1000) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        events.push(parsed);
      } catch {
        // skip malformed lines
      }
    }
  }

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

  const auditPath = getAuditLogPath();
  await removeDirectoryContents(auditPath);

  return NextResponse.json({ cleared: true }, { status: 200 });
}

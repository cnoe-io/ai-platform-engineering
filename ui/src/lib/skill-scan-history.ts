/**
 * Skill scan history — append-only audit log of every scan event.
 *
 * Persists into Mongo collection `skill_scan_history`. One row per scan call
 * (manual user action, hub manual scan, automatic on-save, future hub crawl).
 * Designed to never block scans: write failures are logged and swallowed.
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { ScanStatus } from "@/types/agent-skill";

export type ScanTrigger =
  | "manual_user_skill"
  | "manual_hub_skill"
  | "auto_save"
  | "hub_crawl"
  // Bulk triggers — admin "Scan all" sweeps across the catalog. We split
  // by source so the Scan history filter can isolate "all the bulk runs
  // I kicked off this morning" vs the single-skill events.
  | "bulk_user_skill"
  | "bulk_hub_skill";

export type SkillSourceKind = "agent_skills" | "hub" | "default";

export interface SkillScanHistoryDoc {
  /** Stable event id (timestamp+random suffix). */
  id: string;
  ts: Date;
  trigger: ScanTrigger;
  /** Logical skill identity (Mongo `id` for agent_skills; `hub-<hubId>-<skillId>` for hub rows). */
  skill_id: string;
  skill_name: string;
  source: SkillSourceKind;
  /** Optional: hub doc id for hub-sourced scans. */
  hub_id?: string;
  /** Email / display name of the user who triggered the scan, when known. */
  actor?: string;
  scan_status: ScanStatus;
  scan_summary?: string;
  /** True when the supervisor was unreachable / SKILL.md was empty. */
  scanner_unavailable?: boolean;
  /** Wall time of the scan call in ms. */
  duration_ms?: number;
}

const COLLECTION = "skill_scan_history";

function makeId(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordScanEvent(
  event: Omit<SkillScanHistoryDoc, "id" | "ts"> & { ts?: Date },
): Promise<void> {
  if (!isMongoDBConfigured) return;
  try {
    const col = await getCollection<SkillScanHistoryDoc>(COLLECTION);
    await col.insertOne({
      id: makeId(),
      ts: event.ts ?? new Date(),
      ...event,
    });
  } catch (err) {
    console.warn("[skill-scan-history] failed to record event:", err);
  }
}

export interface ScanHistoryQuery {
  page?: number;
  pageSize?: number;
  status?: ScanStatus;
  trigger?: ScanTrigger;
  source?: SkillSourceKind;
  /** Substring match on skill_name (case-insensitive). */
  q?: string;
  /** Exact match on skill_id (used by the per-skill workspace History tab). */
  skill_id?: string;
}

export interface ScanHistoryPage {
  events: SkillScanHistoryDoc[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export async function listScanHistory(
  query: ScanHistoryQuery,
): Promise<ScanHistoryPage> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

  const filter: Record<string, unknown> = {};
  if (query.status) filter.scan_status = query.status;
  if (query.trigger) filter.trigger = query.trigger;
  if (query.source) filter.source = query.source;
  if (query.skill_id) filter.skill_id = query.skill_id;
  if (query.q?.trim()) {
    const safe = query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.skill_name = { $regex: safe, $options: "i" };
  }

  if (!isMongoDBConfigured) {
    return { events: [], total: 0, page, page_size: pageSize, has_more: false };
  }

  const col = await getCollection<SkillScanHistoryDoc>(COLLECTION);
  const total = await col.countDocuments(filter);
  const events = await col
    .find(filter)
    .sort({ ts: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .project<SkillScanHistoryDoc>({ _id: 0 })
    .toArray();

  return {
    events,
    total,
    page,
    page_size: pageSize,
    has_more: page * pageSize < total,
  };
}

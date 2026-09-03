// Replica-safe scheduler claims. Mirrors
// idp-sync-store's claimScheduledFire: dedupe by UTC minute key so concurrent
// ticks (across replicas) can't double-fire the same project in the same
// minute, without needing a distributed lock.

import { createHash } from "node:crypto";
import type { Filter } from "mongodb";

import { getCollection } from "@/lib/mongodb";

const COLLECTION = "tome_auto_ingest_cursors";

interface AutoIngestCursorDoc {
  _id: string; // `${projectId}`
  last_fire_minute?: string;
  last_credential_refresh_window?: string;
  owner_subject?: string;
  site_url?: string;
  next_webex_check_at?: Date;
  last_webex_check_at?: Date;
  webex_refresh_requested_at?: Date;
  updated_at?: Date;
}

function webexOwnerCursorId(ownerSubject: string, siteUrl: string): string {
  const digest = createHash("sha256")
    .update(`${ownerSubject}\0${siteUrl.trim().toLowerCase().replace(/\/+$/, "")}`)
    .digest("hex");
  return `webex-series-owner:${digest}`;
}

/** Claim a due calendar reconciliation once across all UI replicas. */
export async function claimWebexMeetingOwnerCheck(
  ownerSubject: string,
  siteUrl: string,
  now: Date,
  claimUntil: Date,
): Promise<boolean> {
  const col = await getCollection<AutoIngestCursorDoc>(COLLECTION);
  const id = webexOwnerCursorId(ownerSubject, siteUrl);
  const existing = await col.findOne({ _id: id });
  const refreshRequested = Boolean(
    existing?.webex_refresh_requested_at && existing.webex_refresh_requested_at <= now,
  );
  if (!refreshRequested && existing?.next_webex_check_at && existing.next_webex_check_at > now) {
    return false;
  }

  if (!existing) {
    try {
      await col.insertOne({
        _id: id,
        owner_subject: ownerSubject,
        site_url: siteUrl,
        next_webex_check_at: claimUntil,
        updated_at: now,
      });
      return true;
    } catch {
      return false;
    }
  }

  const dueFilter: Filter<AutoIngestCursorDoc> = { _id: id };
  if (refreshRequested) {
    dueFilter.webex_refresh_requested_at = existing.webex_refresh_requested_at;
  } else if (existing.next_webex_check_at) {
    dueFilter.next_webex_check_at = existing.next_webex_check_at;
  } else {
    dueFilter.next_webex_check_at = { $exists: false };
  }
  const res = await col.updateOne(
    dueFilter,
    {
      $set: { next_webex_check_at: claimUntil, updated_at: now },
      $unset: { webex_refresh_requested_at: "" },
    },
  );
  if (res.modifiedCount === 1) return true;
  return false;
}

/** Request one fresh calendar sweep without breaking an in-flight claim. */
export async function requestWebexMeetingOwnerCheck(
  ownerSubject: string,
  siteUrl: string,
  requestedAt: Date,
): Promise<void> {
  const col = await getCollection<AutoIngestCursorDoc>(COLLECTION);
  await col.updateOne(
    { _id: webexOwnerCursorId(ownerSubject, siteUrl) },
    {
      $set: {
        owner_subject: ownerSubject,
        site_url: siteUrl,
        webex_refresh_requested_at: requestedAt,
        updated_at: requestedAt,
      },
    },
    { upsert: true },
  );
}

/** Set the next daily/event-driven calendar check for one user and site. */
export async function scheduleWebexMeetingOwnerCheck(
  ownerSubject: string,
  siteUrl: string,
  checkedAt: Date,
  nextCheckAt: Date,
): Promise<void> {
  const col = await getCollection<AutoIngestCursorDoc>(COLLECTION);
  await col.updateOne(
    { _id: webexOwnerCursorId(ownerSubject, siteUrl) },
    {
      $set: {
        owner_subject: ownerSubject,
        site_url: siteUrl,
        last_webex_check_at: checkedAt,
        next_webex_check_at: nextCheckAt,
        updated_at: checkedAt,
      },
    },
    { upsert: true },
  );
}

const CREDENTIAL_REFRESH_CURSOR_ID = "__credential_refresh__";

/**
 * Atomically claim the right to fire auto-ingest for `projectId` at
 * `minuteKey` (e.g. "2026-08-13T02:00"). Returns true only for the single
 * writer (across replicas) that flips the stored minute key.
 */
export async function claimAutoIngestFire(
  projectId: string,
  minuteKey: string,
): Promise<boolean> {
  const col = await getCollection<AutoIngestCursorDoc>(COLLECTION);
  const res = await col.updateOne(
    { _id: projectId, last_fire_minute: { $ne: minuteKey } },
    { $set: { last_fire_minute: minuteKey } },
  );
  if (res.modifiedCount === 1) return true;
  // First-ever fire for this project: no doc yet. Insert-if-absent; the
  // unique _id makes the insert atomic, so only one racer creates it.
  try {
    await col.insertOne({ _id: projectId, last_fire_minute: minuteKey });
    return true;
  } catch {
    return false; // another racer inserted first
  }
}

/**
 * Atomically claim one credential-refresh window across all UI replicas.
 * The caller chooses the window key from its configured interval, so this
 * remains replica-safe without holding a distributed lock during provider I/O.
 */
export async function claimAutoIngestCredentialRefresh(windowKey: string): Promise<boolean> {
  const col = await getCollection<AutoIngestCursorDoc>(COLLECTION);
  const res = await col.updateOne(
    {
      _id: CREDENTIAL_REFRESH_CURSOR_ID,
      last_credential_refresh_window: { $ne: windowKey },
    },
    { $set: { last_credential_refresh_window: windowKey } },
  );
  if (res.modifiedCount === 1) return true;
  try {
    await col.insertOne({
      _id: CREDENTIAL_REFRESH_CURSOR_ID,
      last_credential_refresh_window: windowKey,
    });
    return true;
  } catch {
    return false;
  }
}

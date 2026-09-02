import type { Document } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import {
  normalizeCustomTomeTrackerLabels,
  TOME_TRACKED_ISSUE_LABELS,
  tomeTrackedIssueLabel,
  type TomeTrackedIssueLabel,
} from "@/lib/tome/issue-filter-views";

const TOME_ISSUE_TRACKERS_COLLECTION = "tome_issue_trackers";

interface TomeIssueTrackerDocument extends Document {
  project_id: string;
  labels: string[];
  updated_at: Date;
}

async function trackersCollection() {
  return getCollection<TomeIssueTrackerDocument>(TOME_ISSUE_TRACKERS_COLLECTION);
}

export async function readTomeCustomIssueTrackers(projectId: string): Promise<string[]> {
  const trackers = await trackersCollection();
  const document = await trackers.findOne(
    { project_id: projectId },
    { projection: { _id: 0, labels: 1 } },
  );
  return normalizeCustomTomeTrackerLabels(document?.labels);
}

export async function addTomeCustomIssueTracker(
  projectId: string,
  label: string,
): Promise<string[]> {
  const trackers = await trackersCollection();
  await trackers.updateOne(
    { project_id: projectId },
    {
      $set: { project_id: projectId, updated_at: new Date() },
      $addToSet: { labels: label },
    },
    { upsert: true },
  );
  return readTomeCustomIssueTrackers(projectId);
}

export async function listTomeTrackedIssueLabels(
  projectIds: string[],
): Promise<TomeTrackedIssueLabel[]> {
  const trackers = await trackersCollection();
  const documents = await trackers.find(
    { project_id: { $in: projectIds } },
    { projection: { _id: 0, labels: 1 } },
  ).toArray();
  const custom = normalizeCustomTomeTrackerLabels(
    documents.flatMap((document) => document.labels),
  );
  return [...TOME_TRACKED_ISSUE_LABELS, ...custom.map(tomeTrackedIssueLabel)];
}

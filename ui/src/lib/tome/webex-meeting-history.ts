import { getCollection } from "@/lib/mongodb";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import {
  TOME_COLLECTIONS,
  type IngestRun,
  type WebexMeetingOccurrenceDocument,
  type WebexMeetingOccurrenceSummary,
} from "@/types/tome";

function transcriptIds(occurrence: WebexMeetingOccurrenceDocument): string[] {
  const ids = (occurrence.transcript_ids ?? []).filter(Boolean);
  if (ids.length > 0) return [...new Set(ids)];
  return occurrence.transcript_id ? [occurrence.transcript_id] : [];
}

/** Join scheduler occurrences to their latest durable ingest-run state. */
export function summarizeWebexMeetingOccurrences(
  occurrences: WebexMeetingOccurrenceDocument[],
  runs: IngestRun[],
): WebexMeetingOccurrenceSummary[] {
  const runsById = new Map(
    runs
      .filter((run) => run._id)
      .map((run) => [String(run._id), run]),
  );

  return [...occurrences]
    .sort((left, right) => right.start.getTime() - left.start.getTime())
    .map((occurrence) => {
      const ids = transcriptIds(occurrence);
      const run = occurrence.run_id ? runsById.get(occurrence.run_id) : undefined;
      return {
        id: String(occurrence._id),
        subscriptionId: occurrence.subscription_id,
        title: occurrence.title,
        start: occurrence.start.toISOString(),
        end: occurrence.end.toISOString(),
        status: occurrence.status,
        transcriptFound: ids.length > 0,
        transcriptCount: ids.length,
        ...(occurrence.run_id ? { runId: occurrence.run_id } : {}),
        ...(run?.status ? { runStatus: run.status } : {}),
        ...(run?.report_id ? { reportId: run.report_id } : {}),
        logLines: run?.log?.length ?? 0,
        ...(run?.review_outcome ? { reviewOutcome: run.review_outcome } : {}),
        ...(run?.reviewed_by ? { reviewedBy: run.reviewed_by } : {}),
        ...(occurrence.last_error ? { lastError: occurrence.last_error } : {}),
      };
    });
}

export async function loadWebexMeetingOccurrenceHistory(
  projectId: string,
  subscriptionIds: string[],
  now = new Date(),
): Promise<WebexMeetingOccurrenceSummary[]> {
  if (subscriptionIds.length === 0) return [];

  const collection = await getCollection<WebexMeetingOccurrenceDocument>(
    TOME_COLLECTIONS.WEBEX_MEETING_OCCURRENCES,
  );
  const occurrences = await collection
    .find({
      project_id: projectId,
      subscription_id: { $in: subscriptionIds },
      end: { $lte: now },
    })
    .sort({ start: -1 })
    .toArray();
  const runIds = [...new Set(occurrences.map((item) => item.run_id).filter(Boolean))] as string[];
  if (runIds.length === 0) return summarizeWebexMeetingOccurrences(occurrences, []);

  const runCollection = await getTomeIngestRunsCollection();
  const runs = await runCollection.find({ _id: { $in: runIds } }).toArray();
  return summarizeWebexMeetingOccurrences(occurrences, runs);
}

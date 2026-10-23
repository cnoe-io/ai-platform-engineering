import { createHash } from "crypto";

import { ApiError } from "@/lib/api-middleware";
import type { GitHubTicketResult } from "@/lib/github-ticket";
import { getCollection } from "@/lib/mongodb";

interface Submission {
  _id: string;
  created_at: Date;
  reporter: string;
  request_id: string;
  ticket?: GitHubTicketResult;
}

/** Reserve before the external write. An uncertain result stays reserved for reconciliation. */
export async function submitServiceDeskOnce(
  reporter: string,
  requestId: string,
  submit: () => Promise<GitHubTicketResult>,
): Promise<GitHubTicketResult> {
  const submissions = await getCollection<Submission>("service_desk_submissions");
  const id = createHash("sha256").update(`${reporter}\0${requestId}`).digest("hex");
  try {
    await submissions.insertOne({ _id: id, created_at: new Date(), reporter, request_id: requestId });
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
    const existing = await submissions.findOne({ _id: id });
    if (existing?.ticket) return existing.ticket;
    throw new ApiError(
      "This submission is in progress or its outcome is unknown. Check the service desk before submitting again.",
      409,
      "submission_pending",
    );
  }
  const ticket = await submit();
  await submissions.updateOne({ _id: id }, { $set: { ticket } });
  return ticket;
}

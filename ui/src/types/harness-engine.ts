export type HarnessRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface HarnessRun {
  run_id: string;
  agent_id: string;
  conversation_id: string;
  harness_id: "agentcore";
  status: HarnessRunStatus;
  last_sequence: number;
}

export interface HarnessRunEvent {
  run_id: string;
  sequence: number;
  event_type: "run.started" | "content.delta" | "run.completed" | "run.failed" | "run.cancelled";
  data: Record<string, unknown>;
}

export interface HarnessEventPage {
  run: HarnessRun;
  events: HarnessRunEvent[];
  next_cursor: number;
}

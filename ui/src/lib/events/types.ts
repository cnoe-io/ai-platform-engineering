/** Provider-neutral event envelope and durable subscriber delivery state. */

export interface CaipeEvent {
  /** Provider delivery id, namespaced by source. Used as the idempotency key. */
  _id: string;
  specversion: "1.0";
  source: string;
  type: string;
  subject: string;
  time: Date;
  received_at: Date;
  /** Normalized trigger metadata and, when needed, a provider resource snapshot. */
  data: Record<string, unknown>;
  expires_at: Date;
}

export type CaipeEventDeliveryStatus =
  | "pending"
  | "processing"
  | "completed"
  | "dead_letter";

export interface CaipeEventDelivery {
  _id: string;
  event_id: string;
  subscriber_id: string;
  status: CaipeEventDeliveryStatus;
  attempts: number;
  available_at: Date;
  created_at: Date;
  updated_at: Date;
  lease_until?: Date;
  completed_at?: Date;
  last_error?: string;
  expires_at: Date;
}

export interface CaipeEventSubscriber {
  id: string;
  matches(event: CaipeEvent): boolean;
  handle(event: CaipeEvent): Promise<void>;
}

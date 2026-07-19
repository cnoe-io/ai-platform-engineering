import { ApiError } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";

export const PLATFORM_CONFIG_ID = "platform_settings";

export const PLATFORM_AGENT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

export interface PlatformDefaultAgentDocument {
  _id?: string;
  default_agent_id?: unknown;
}

export function normalizePlatformDefaultAgentId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new ApiError(
      "default_agent_id must be a string or null",
      400,
      "INVALID_DEFAULT_AGENT_ID",
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!PLATFORM_AGENT_ID_PATTERN.test(trimmed)) {
    throw new ApiError(
      "default_agent_id is not a valid OpenFGA object id",
      400,
      "INVALID_DEFAULT_AGENT_ID",
    );
  }
  return trimmed;
}

/** Resolve the platform default exactly as the Admin settings endpoint does. */
export async function getResolvedPlatformDefaultAgentId(): Promise<string | null> {
  const collection = await getCollection<PlatformDefaultAgentDocument>(
    "platform_config",
  );
  const document = await collection.findOne({ _id: PLATFORM_CONFIG_ID } as never);
  return (
    normalizePlatformDefaultAgentId(document?.default_agent_id) ??
    process.env.DEFAULT_AGENT_ID ??
    null
  );
}

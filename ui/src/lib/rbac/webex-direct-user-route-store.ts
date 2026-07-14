import type { Document } from "mongodb";

import { getRbacCollection } from "./mongo-collections";

export type WebexDmAccessMode = "disabled" | "allowlist" | "all_users";

export interface WebexDirectUserRouteDocument extends Document {
  bot_id: string;
  keycloak_user_id: string;
  user_email: string;
  expected_webex_email: string;
  webex_user_id?: string;
  agent_id: string;
  status: "active" | "disabled";
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

const SAFE_ID = /^[A-Za-z0-9._@+-]+$/;

function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || !SAFE_ID.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizedEmail(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !normalized.includes("@")) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

export function webexDmAccessMode(env: NodeJS.ProcessEnv = process.env): WebexDmAccessMode {
  const value = (env.WEBEX_DM_ACCESS_MODE ?? "disabled").trim().toLowerCase();
  if (value === "disabled" || value === "allowlist" || value === "all_users") return value;
  throw new Error("WEBEX_DM_ACCESS_MODE must be disabled, allowlist, or all_users");
}

function routeId(botId: string, keycloakUserId: string): string {
  return JSON.stringify([botId, keycloakUserId]);
}

export async function listWebexDirectUserRoutes(botId: string): Promise<WebexDirectUserRouteDocument[]> {
  const collection = await getRbacCollection<WebexDirectUserRouteDocument>("webexDirectUserRoutes");
  const normalizedBotId = requiredId(botId, "bot_id");
  return collection
    .find({ bot_id: normalizedBotId } as never)
    .sort({ user_email: 1 })
    .toArray();
}

export async function upsertWebexDirectUserRoute(input: {
  botId: string;
  keycloakUserId: string;
  userEmail: string;
  expectedWebexEmail: string;
  webexUserId?: string;
  agentId: string;
  actor: string;
}): Promise<void> {
  const collection = await getRbacCollection<WebexDirectUserRouteDocument>("webexDirectUserRoutes");
  const now = new Date().toISOString();
  const botId = requiredId(input.botId, "bot_id");
  const keycloakUserId = requiredId(input.keycloakUserId, "keycloak_user_id");
  const actor = input.actor.trim() || "unknown";
  await collection.updateOne(
    { _id: routeId(botId, keycloakUserId) } as never,
    {
      $set: {
        bot_id: botId,
        keycloak_user_id: keycloakUserId,
        user_email: normalizedEmail(input.userEmail, "user_email"),
        expected_webex_email: normalizedEmail(input.expectedWebexEmail, "expected_webex_email"),
        ...(input.webexUserId?.trim() ? { webex_user_id: input.webexUserId.trim() } : {}),
        agent_id: requiredId(input.agentId, "agent_id"),
        status: "active",
        updated_at: now,
        updated_by: actor,
      },
      $setOnInsert: { created_at: now, created_by: actor },
    } as never,
    { upsert: true },
  );
}

export async function deleteWebexDirectUserRoute(
  botId: string,
  keycloakUserId: string,
): Promise<boolean> {
  const collection = await getRbacCollection<WebexDirectUserRouteDocument>("webexDirectUserRoutes");
  const normalizedBotId = requiredId(botId, "bot_id");
  const normalizedUserId = requiredId(keycloakUserId, "keycloak_user_id");
  const result = await collection.deleteOne({
    _id: routeId(normalizedBotId, normalizedUserId),
  } as never);
  return result.deletedCount === 1;
}

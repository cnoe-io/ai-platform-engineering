import type { Document } from "mongodb";

import { getRbacCollection } from "./mongo-collections";

export type WebexDmAccessMode = "disabled" | "allowlist" | "all_users";

export interface WebexDirectUserRouteDocument extends Document {
  ownership_schema_version: 3;
  deployment_id: string;
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

export function webexDeploymentId(env: NodeJS.ProcessEnv = process.env): string {
  return requiredId(env.WEBEX_DEPLOYMENT_ID ?? "default", "WEBEX_DEPLOYMENT_ID");
}

const WEBEX_DIRECT_USER_OWNERSHIP_SCHEMA_VERSION = 3 as const;

function routeId(deploymentId: string, botId: string, keycloakUserId: string): string {
  return JSON.stringify([deploymentId, botId, keycloakUserId]);
}

async function deleteLegacyRoutes(
  collection: Awaited<ReturnType<typeof getRbacCollection<WebexDirectUserRouteDocument>>>,
): Promise<void> {
  await collection.deleteMany({
    deployment_id: webexDeploymentId(),
    ownership_schema_version: { $ne: WEBEX_DIRECT_USER_OWNERSHIP_SCHEMA_VERSION },
  } as never);
}

export async function listWebexDirectUserRoutes(botId: string): Promise<WebexDirectUserRouteDocument[]> {
  const collection = await getRbacCollection<WebexDirectUserRouteDocument>("webexDirectUserRoutes");
  const normalizedBotId = requiredId(botId, "bot_id");
  await deleteLegacyRoutes(collection);
  return collection
    .find({
      deployment_id: webexDeploymentId(),
      ownership_schema_version: WEBEX_DIRECT_USER_OWNERSHIP_SCHEMA_VERSION,
      bot_id: normalizedBotId,
    } as never)
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
  const deploymentId = webexDeploymentId();
  const botId = requiredId(input.botId, "bot_id");
  const keycloakUserId = requiredId(input.keycloakUserId, "keycloak_user_id");
  const actor = input.actor.trim() || "unknown";
  await deleteLegacyRoutes(collection);
  await collection.updateOne(
    { _id: routeId(deploymentId, botId, keycloakUserId) } as never,
    {
      $set: {
        deployment_id: deploymentId,
        ownership_schema_version: WEBEX_DIRECT_USER_OWNERSHIP_SCHEMA_VERSION,
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
  const deploymentId = webexDeploymentId();
  const normalizedBotId = requiredId(botId, "bot_id");
  const normalizedUserId = requiredId(keycloakUserId, "keycloak_user_id");
  await deleteLegacyRoutes(collection);
  const result = await collection.deleteOne({
    _id: routeId(deploymentId, normalizedBotId, normalizedUserId),
  } as never);
  return result.deletedCount === 1;
}

import { ApiError } from "@/lib/api-error";

type Env = Record<string, string | undefined>;

interface WebexBotConfig {
  id: string;
  name: string;
  tokenEnv: string;
}

export interface WebexBotOption {
  id: string;
  name: string;
  available: boolean;
}

const CONFIG_ENV = "WEBEX_INTEGRATION_BOTS_JSON";
const DEFAULT_TOKEN_ENV = "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function requiredString(
  candidate: Record<string, unknown>,
  field: "id" | "name" | "tokenEnv",
  index: number,
): string {
  const value = candidate[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(`${CONFIG_ENV}[${index}].${field} is required`, 500);
  }
  return value.trim();
}

export function configuredWebexBots(env: Env = process.env): WebexBotConfig[] {
  const serialized = env[CONFIG_ENV]?.trim();
  if (!serialized) {
    return [{ id: "default", name: "Webex bot", tokenEnv: DEFAULT_TOKEN_ENV }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ApiError(`${CONFIG_ENV} must contain valid JSON`, 500);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ApiError(`${CONFIG_ENV} must contain at least one bot`, 500);
  }

  const ids = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError(`${CONFIG_ENV}[${index}] must be an object`, 500);
    }
    const candidate = value as Record<string, unknown>;
    if ("token" in candidate || "accessToken" in candidate) {
      throw new ApiError(`${CONFIG_ENV}[${index}] cannot contain an inline token`, 500);
    }
    const id = requiredString(candidate, "id", index);
    const name = requiredString(candidate, "name", index);
    const tokenEnv = requiredString(candidate, "tokenEnv", index);
    if (!ID_PATTERN.test(id)) {
      throw new ApiError(`${CONFIG_ENV}[${index}].id is invalid`, 500);
    }
    if (ids.has(id)) {
      throw new ApiError(`${CONFIG_ENV} contains duplicate bot id ${id}`, 500);
    }
    if (!ENV_PATTERN.test(tokenEnv)) {
      throw new ApiError(`${CONFIG_ENV}[${index}].tokenEnv is invalid`, 500);
    }
    ids.add(id);
    return { id, name, tokenEnv };
  });
}

export function listWebexBotOptions(env: Env = process.env): WebexBotOption[] {
  return configuredWebexBots(env).map((bot) => ({
    id: bot.id,
    name: bot.name,
    available: Boolean(env[bot.tokenEnv]?.trim()),
  }));
}

export function resolveWebexBotToken(
  botId: string | null | undefined,
  env: Env = process.env,
): { id: string; name: string; token: string } {
  const bots = configuredWebexBots(env);
  const requestedId = botId?.trim();
  const bot = requestedId ? bots.find((candidate) => candidate.id === requestedId) : bots[0];
  if (!bot) {
    throw new ApiError(`Unknown Webex bot: ${requestedId}`, 400);
  }
  const token = env[bot.tokenEnv]?.trim();
  if (!token) {
    throw new ApiError(`Webex bot "${bot.name}" is not configured`, 503);
  }
  return { id: bot.id, name: bot.name, token };
}

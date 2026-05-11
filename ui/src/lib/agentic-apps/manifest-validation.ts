// assisted-by Codex Codex-sonnet-4-6

import type {
  AgenticAppManifest,
  AgenticAppRuntimeKind,
} from "@/types/agentic-app";

const API_VERSION = "1.0";

/** Same pattern as manifest `id` — reuse for app/package API identifiers. */
export const AGENTIC_APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

const RUNTIME_KINDS: readonly AgenticAppRuntimeKind[] = [
  "proxied-next-zone",
  "iframe-sandboxed",
  "web-component",
  "in-process",
] as const;
const WEBHOOK_METHODS = new Set(["POST", "PUT"]);
const WEBHOOK_VERIFICATION_OWNERS = new Set(["app", "caipe"]);
const POLICY_DEFAULT_EFFECTS = new Set(["allow", "deny"]);
const HEALTH_BLOCK_STATES = new Set(["unknown", "degraded", "unreachable"]);

/** Key names that commonly carry credentials; `tokenScopes` is intentionally allowed by name (validated separately). */
const SECRET_LIKE_KEY_NAMES = new Set([
  "password",
  "secret",
  "privatekey",
  "apikey",
  "accesstoken",
  "refreshtoken",
]);

export type ManifestValidationResult =
  | { ok: true; manifest: AgenticAppManifest; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function isSecretLikeKeyName(key: string): boolean {
  return SECRET_LIKE_KEY_NAMES.has(key.toLowerCase());
}

function collectSecretLikeFieldErrors(value: unknown, path: string): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectSecretLikeFieldErrors(item, `${path}[${index}]`),
    );
  }
  const obj = value as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(obj)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isSecretLikeKeyName(key)) {
      out.push(`manifest contains secret-like field "${key}" at ${nextPath}`);
    }
    out.push(...collectSecretLikeFieldErrors(obj[key], nextPath));
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateAgenticAppManifest(input: unknown): ManifestValidationResult {
  const warnings: string[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: ["manifest must be a non-null object"],
      warnings,
    };
  }

  const secretErrors = collectSecretLikeFieldErrors(input, "");
  const errors: string[] = [...secretErrors];

  const root = input;

  const id = root.id;
  if (typeof id !== "string") {
    errors.push("id must be a string");
  } else if (!AGENTIC_APP_ID_PATTERN.test(id)) {
    errors.push(`id must match ${AGENTIC_APP_ID_PATTERN}`);
  }

  if (typeof root.displayName !== "string" || root.displayName.length === 0) {
    errors.push("displayName must be a non-empty string");
  }

  if (typeof root.description !== "string" || root.description.length === 0) {
    errors.push("description must be a non-empty string");
  }

  const apiVersion = root.apiVersion;
  if (apiVersion !== API_VERSION) {
    errors.push("apiVersion must be 1.0");
  }

  const runtimeRaw = root.runtime;
  let runtime: AgenticAppManifest["runtime"] | undefined;

  if (!isPlainObject(runtimeRaw)) {
    errors.push("runtime must be an object");
  } else {
    const kind = runtimeRaw.kind;
    if (typeof kind !== "string" || !RUNTIME_KINDS.includes(kind as AgenticAppRuntimeKind)) {
      errors.push(
        `runtime.kind must be one of: ${RUNTIME_KINDS.join(", ")}`,
      );
    }

    const mountPath = runtimeRaw.mountPath;
    if (typeof mountPath !== "string") {
      errors.push("runtime.mountPath must be a string");
    } else if (!mountPath.startsWith("/apps/")) {
      errors.push("runtime.mountPath must start with /apps/");
    }

    if (runtimeRaw.origin !== undefined && typeof runtimeRaw.origin !== "string") {
      errors.push("runtime.origin must be a string when present");
    }
    if (runtimeRaw.assetPrefix !== undefined && typeof runtimeRaw.assetPrefix !== "string") {
      errors.push("runtime.assetPrefix must be a string when present");
    }
    if (
      runtimeRaw.preserveMountPath !== undefined &&
      typeof runtimeRaw.preserveMountPath !== "boolean"
    ) {
      errors.push("runtime.preserveMountPath must be a boolean when present");
    }
    if (
      runtimeRaw.chrome !== undefined &&
      runtimeRaw.chrome !== "fullscreen" &&
      runtimeRaw.chrome !== "iframe"
    ) {
      errors.push('runtime.chrome must be "fullscreen" or "iframe" when present');
    }

    if (
      typeof kind === "string" &&
      RUNTIME_KINDS.includes(kind as AgenticAppRuntimeKind) &&
      typeof mountPath === "string" &&
      mountPath.startsWith("/apps/")
    ) {
      runtime = {
        kind: kind as AgenticAppRuntimeKind,
        mountPath,
      };
      if (typeof runtimeRaw.origin === "string") {
        runtime.origin = runtimeRaw.origin;
      }
      if (typeof runtimeRaw.assetPrefix === "string") {
        runtime.assetPrefix = runtimeRaw.assetPrefix;
      }
      if (typeof runtimeRaw.preserveMountPath === "boolean") {
        runtime.preserveMountPath = runtimeRaw.preserveMountPath;
      }
      if (runtimeRaw.chrome === "fullscreen" || runtimeRaw.chrome === "iframe") {
        runtime.chrome = runtimeRaw.chrome;
      }
    }
  }

  const surfacesRaw = root.surfaces;
  let surfaces: AgenticAppManifest["surfaces"] | undefined;

  if (!isPlainObject(surfacesRaw)) {
    errors.push("surfaces must be an object");
  } else {
    if (typeof surfacesRaw.showInHub !== "boolean") {
      errors.push("surfaces.showInHub must be a boolean");
    }
    if (surfacesRaw.showInTopNav !== undefined && typeof surfacesRaw.showInTopNav !== "boolean") {
      errors.push("surfaces.showInTopNav must be a boolean when present");
    }
    if (surfacesRaw.homeEligible !== undefined && typeof surfacesRaw.homeEligible !== "boolean") {
      errors.push("surfaces.homeEligible must be a boolean when present");
    }
    if (surfacesRaw.navOrder !== undefined && typeof surfacesRaw.navOrder !== "number") {
      errors.push("surfaces.navOrder must be a number when present");
    }
    if (surfacesRaw.overlays !== undefined) {
      if (!Array.isArray(surfacesRaw.overlays) || !surfacesRaw.overlays.every((o) => typeof o === "string")) {
        errors.push("surfaces.overlays must be an array of strings when present");
      }
    }

    if (typeof surfacesRaw.showInHub === "boolean") {
      surfaces = { showInHub: surfacesRaw.showInHub };
      if (typeof surfacesRaw.showInTopNav === "boolean") {
        surfaces.showInTopNav = surfacesRaw.showInTopNav;
      }
      if (typeof surfacesRaw.navOrder === "number") {
        surfaces.navOrder = surfacesRaw.navOrder;
      }
      if (typeof surfacesRaw.homeEligible === "boolean") {
        surfaces.homeEligible = surfacesRaw.homeEligible;
      }
      if (
        Array.isArray(surfacesRaw.overlays) &&
        surfacesRaw.overlays.every((o) => typeof o === "string")
      ) {
        surfaces.overlays = surfacesRaw.overlays;
      }
    }
  }

  const accessRaw = root.access;
  let access: AgenticAppManifest["access"] | undefined;

  if (!isPlainObject(accessRaw)) {
    errors.push("access must be an object");
  } else {
    const tokenScopes = accessRaw.tokenScopes;
    if (!Array.isArray(tokenScopes)) {
      errors.push("access.tokenScopes must be an array of strings");
    } else if (!tokenScopes.every((s) => typeof s === "string")) {
      errors.push("access.tokenScopes must be an array of strings");
    }

    if (accessRaw.requiredRoles !== undefined) {
      if (!Array.isArray(accessRaw.requiredRoles) || !accessRaw.requiredRoles.every((r) => typeof r === "string")) {
        errors.push("access.requiredRoles must be an array of strings when present");
      }
    }
    if (accessRaw.requiredGroups !== undefined) {
      if (
        !Array.isArray(accessRaw.requiredGroups) ||
        !accessRaw.requiredGroups.every((g) => typeof g === "string")
      ) {
        errors.push("access.requiredGroups must be an array of strings when present");
      }
    }
    if (accessRaw.canUseCustomAgents !== undefined && typeof accessRaw.canUseCustomAgents !== "boolean") {
      errors.push("access.canUseCustomAgents must be a boolean when present");
    }
    if (accessRaw.policyActions !== undefined) {
      if (!Array.isArray(accessRaw.policyActions)) {
        errors.push("access.policyActions must be an array when present");
      } else {
        accessRaw.policyActions.forEach((action, index) => {
          if (!isPlainObject(action)) {
            errors.push(`access.policyActions[${index}] must be an object`);
            return;
          }
          if (typeof action.action !== "string" || action.action.length === 0) {
            errors.push(`access.policyActions[${index}].action must be a non-empty string`);
          }
          if (action.description !== undefined && typeof action.description !== "string") {
            errors.push(`access.policyActions[${index}].description must be a string when present`);
          }
          if (action.reasonCode !== undefined && typeof action.reasonCode !== "string") {
            errors.push(`access.policyActions[${index}].reasonCode must be a string when present`);
          }
          if (
            action.defaultEffect !== undefined &&
            !POLICY_DEFAULT_EFFECTS.has(String(action.defaultEffect))
          ) {
            errors.push(
              `access.policyActions[${index}].defaultEffect must be "allow" or "deny" when present`,
            );
          }
        });
      }
    }

    if (Array.isArray(tokenScopes) && tokenScopes.every((s) => typeof s === "string")) {
      access = { tokenScopes: [...tokenScopes] };
      if (
        Array.isArray(accessRaw.requiredRoles) &&
        accessRaw.requiredRoles.every((r) => typeof r === "string")
      ) {
        access.requiredRoles = [...accessRaw.requiredRoles];
      }
      if (
        Array.isArray(accessRaw.requiredGroups) &&
        accessRaw.requiredGroups.every((g) => typeof g === "string")
      ) {
        access.requiredGroups = [...accessRaw.requiredGroups];
      }
      if (typeof accessRaw.canUseCustomAgents === "boolean") {
        access.canUseCustomAgents = accessRaw.canUseCustomAgents;
      }
      if (Array.isArray(accessRaw.policyActions)) {
        const validPolicyActions = accessRaw.policyActions.every((action) => {
          if (!isPlainObject(action)) return false;
          if (typeof action.action !== "string" || action.action.length === 0) return false;
          if (action.description !== undefined && typeof action.description !== "string") return false;
          if (action.reasonCode !== undefined && typeof action.reasonCode !== "string") return false;
          if (
            action.defaultEffect !== undefined &&
            !POLICY_DEFAULT_EFFECTS.has(String(action.defaultEffect))
          ) {
            return false;
          }
          return true;
        });
        if (validPolicyActions) {
          access.policyActions = accessRaw.policyActions.map((action) => {
            const a = action as Record<string, unknown>;
            return {
              action: a.action as string,
              ...(typeof a.description === "string" ? { description: a.description } : {}),
              ...(typeof a.reasonCode === "string" ? { reasonCode: a.reasonCode } : {}),
              ...(a.defaultEffect === "allow" || a.defaultEffect === "deny"
                ? { defaultEffect: a.defaultEffect }
                : {}),
            };
          });
        }
      }
    }
  }

  const healthRaw = root.health;
  let health: AgenticAppManifest["health"] | undefined;

  if (!isPlainObject(healthRaw)) {
    errors.push("health must be an object");
  } else {
    if (typeof healthRaw.endpoint !== "string" || healthRaw.endpoint.length === 0) {
      errors.push("health.endpoint must be a non-empty string");
    }
    if (healthRaw.timeoutMs !== undefined && typeof healthRaw.timeoutMs !== "number") {
      errors.push("health.timeoutMs must be a number when present");
    }
    if (healthRaw.blockLaunchWhen !== undefined) {
      if (
        !Array.isArray(healthRaw.blockLaunchWhen) ||
        !healthRaw.blockLaunchWhen.every((s) => typeof s === "string" && HEALTH_BLOCK_STATES.has(s))
      ) {
        errors.push("health.blockLaunchWhen must include only unknown, degraded, or unreachable");
      }
    }

    if (typeof healthRaw.endpoint === "string" && healthRaw.endpoint.length > 0) {
      health = { endpoint: healthRaw.endpoint };
      if (typeof healthRaw.timeoutMs === "number") {
        health.timeoutMs = healthRaw.timeoutMs;
      }
      if (
        Array.isArray(healthRaw.blockLaunchWhen) &&
        healthRaw.blockLaunchWhen.every((s) => typeof s === "string" && HEALTH_BLOCK_STATES.has(s))
      ) {
        health.blockLaunchWhen = healthRaw.blockLaunchWhen;
      }
    }
  }

  let assistant: AgenticAppManifest["assistant"];
  if (root.assistant !== undefined) {
    if (!isPlainObject(root.assistant)) {
      errors.push("assistant must be an object when present");
    } else {
      const a = root.assistant;
      if (a.enabled !== undefined && typeof a.enabled !== "boolean") {
        errors.push("assistant.enabled must be a boolean when present");
      }
      if (
        a.schemaVersions !== undefined &&
        (!Array.isArray(a.schemaVersions) || !a.schemaVersions.every((v) => typeof v === "string"))
      ) {
        errors.push("assistant.schemaVersions must be an array of strings when present");
      }
      if (
        a.maxContextBytes !== undefined &&
        (typeof a.maxContextBytes !== "number" ||
          a.maxContextBytes < 1 ||
          a.maxContextBytes > 65536)
      ) {
        errors.push("assistant.maxContextBytes must be between 1 and 65536 when present");
      }
      if (a.capability !== undefined && typeof a.capability !== "string") {
        errors.push("assistant.capability must be a string when present");
      }
      if (a.suggestions !== undefined && typeof a.suggestions !== "boolean") {
        errors.push("assistant.suggestions must be a boolean when present");
      }
      if (
        a.label !== undefined &&
        (typeof a.label !== "string" || a.label.length < 1 || a.label.length > 32)
      ) {
        errors.push("assistant.label must be a string of 1-32 characters when present");
      }
      if (
        a.agentName !== undefined &&
        (typeof a.agentName !== "string" || a.agentName.length < 1 || a.agentName.length > 64)
      ) {
        errors.push("assistant.agentName must be a string of 1-64 characters when present");
      }

      const assistantValid =
        (a.enabled === undefined || typeof a.enabled === "boolean") &&
        (a.schemaVersions === undefined ||
          (Array.isArray(a.schemaVersions) && a.schemaVersions.every((v) => typeof v === "string"))) &&
        (a.maxContextBytes === undefined ||
          (typeof a.maxContextBytes === "number" &&
            a.maxContextBytes >= 1 &&
            a.maxContextBytes <= 65536)) &&
        (a.capability === undefined || typeof a.capability === "string") &&
        (a.suggestions === undefined || typeof a.suggestions === "boolean") &&
        (a.label === undefined ||
          (typeof a.label === "string" && a.label.length >= 1 && a.label.length <= 32)) &&
        (a.agentName === undefined ||
          (typeof a.agentName === "string" && a.agentName.length >= 1 && a.agentName.length <= 64));
      if (assistantValid) {
        assistant = {};
        if (typeof a.enabled === "boolean") assistant.enabled = a.enabled;
        if (Array.isArray(a.schemaVersions)) assistant.schemaVersions = [...a.schemaVersions];
        if (typeof a.maxContextBytes === "number") assistant.maxContextBytes = a.maxContextBytes;
        if (typeof a.capability === "string") assistant.capability = a.capability;
        if (typeof a.suggestions === "boolean") assistant.suggestions = a.suggestions;
        if (typeof a.label === "string") assistant.label = a.label;
        if (typeof a.agentName === "string") assistant.agentName = a.agentName;
      }
    }
  }

  let webhooks: AgenticAppManifest["webhooks"];
  if (root.webhooks !== undefined) {
    if (!Array.isArray(root.webhooks)) {
      errors.push("webhooks must be an array when present");
    } else {
      const webhookKeys = new Set<string>();
      root.webhooks.forEach((hook, index) => {
        if (!isPlainObject(hook)) {
          errors.push(`webhooks[${index}] must be an object`);
          return;
        }
        if (typeof hook.provider === "string" && typeof hook.channel === "string") {
          const key = `${hook.provider}/${hook.channel}`;
          if (webhookKeys.has(key)) {
            errors.push(`webhooks must not duplicate provider/channel "${key}"`);
          }
          webhookKeys.add(key);
        }
        if (typeof hook.provider !== "string" || hook.provider.length === 0) {
          errors.push(`webhooks[${index}].provider must be a non-empty string`);
        }
        if (typeof hook.channel !== "string" || hook.channel.length === 0) {
          errors.push(`webhooks[${index}].channel must be a non-empty string`);
        }
        if (typeof hook.upstreamPath !== "string" || !hook.upstreamPath.startsWith("/")) {
          errors.push(`webhooks[${index}].upstreamPath must start with /`);
        }
        if (
          !Array.isArray(hook.allowedMethods) ||
          !hook.allowedMethods.every((m) => typeof m === "string" && WEBHOOK_METHODS.has(m))
        ) {
          errors.push(`webhooks[${index}].allowedMethods must include only POST or PUT`);
        }
        if (
          typeof hook.verificationOwner !== "string" ||
          !WEBHOOK_VERIFICATION_OWNERS.has(hook.verificationOwner)
        ) {
          errors.push(`webhooks[${index}].verificationOwner must be "app" or "caipe"`);
        }
        if (
          typeof hook.maxBodyBytes !== "number" ||
          hook.maxBodyBytes < 1 ||
          hook.maxBodyBytes > 10485760
        ) {
          errors.push(`webhooks[${index}].maxBodyBytes must be between 1 and 10485760`);
        }
        if (
          hook.preservedHeaders !== undefined &&
          (!Array.isArray(hook.preservedHeaders) ||
            !hook.preservedHeaders.every((h) => typeof h === "string"))
        ) {
          errors.push(`webhooks[${index}].preservedHeaders must be an array of strings when present`);
        }
        if (hook.policyAction !== undefined && typeof hook.policyAction !== "string") {
          errors.push(`webhooks[${index}].policyAction must be a string when present`);
        }
      });

      const hooksValid =
        errors.every((error) => !error.startsWith("webhooks must not duplicate provider/channel")) &&
        root.webhooks.every((hook) => {
          if (!isPlainObject(hook)) return false;
          return (
            typeof hook.provider === "string" &&
            hook.provider.length > 0 &&
            typeof hook.channel === "string" &&
            hook.channel.length > 0 &&
            typeof hook.upstreamPath === "string" &&
            hook.upstreamPath.startsWith("/") &&
            Array.isArray(hook.allowedMethods) &&
            hook.allowedMethods.every((m) => typeof m === "string" && WEBHOOK_METHODS.has(m)) &&
            typeof hook.verificationOwner === "string" &&
            WEBHOOK_VERIFICATION_OWNERS.has(hook.verificationOwner) &&
            typeof hook.maxBodyBytes === "number" &&
            hook.maxBodyBytes >= 1 &&
            hook.maxBodyBytes <= 10485760 &&
            (hook.preservedHeaders === undefined ||
              (Array.isArray(hook.preservedHeaders) &&
                hook.preservedHeaders.every((h) => typeof h === "string"))) &&
            (hook.policyAction === undefined || typeof hook.policyAction === "string")
          );
        });
      if (hooksValid) {
        webhooks = root.webhooks.map((hook) => {
          const h = hook as Record<string, unknown>;
          return {
            provider: h.provider as string,
            channel: h.channel as string,
            upstreamPath: h.upstreamPath as string,
            allowedMethods: h.allowedMethods as Array<"POST" | "PUT">,
            verificationOwner: h.verificationOwner as "app" | "caipe",
            maxBodyBytes: h.maxBodyBytes as number,
            ...(Array.isArray(h.preservedHeaders) ? { preservedHeaders: h.preservedHeaders as string[] } : {}),
            ...(typeof h.policyAction === "string" ? { policyAction: h.policyAction } : {}),
          };
        });
      }
    }
  }

  let agents: AgenticAppManifest["agents"];
  if (root.agents !== undefined) {
    if (!Array.isArray(root.agents)) {
      errors.push("agents must be an array when present");
    } else {
      root.agents.forEach((agent, index) => {
        if (!isPlainObject(agent)) {
          errors.push(`agents[${index}] must be an object`);
          return;
        }
        if (typeof agent.id !== "string" || agent.id.length === 0) {
          errors.push(`agents[${index}].id must be a non-empty string`);
        }
        if (typeof agent.displayName !== "string" || agent.displayName.length === 0) {
          errors.push(`agents[${index}].displayName must be a non-empty string`);
        }
        if (typeof agent.required !== "boolean") {
          errors.push(`agents[${index}].required must be a boolean`);
        }
        if (agent.dynamicAgentId !== undefined && typeof agent.dynamicAgentId !== "string") {
          errors.push(`agents[${index}].dynamicAgentId must be a string when present`);
        }
        if (agent.capabilities !== undefined) {
          if (!Array.isArray(agent.capabilities) || !agent.capabilities.every((c) => typeof c === "string")) {
            errors.push(`agents[${index}].capabilities must be an array of strings when present`);
          }
        }
      });

      const agentsOk = root.agents.every((agent, index) => {
        if (!isPlainObject(agent)) {
          return false;
        }
        const base =
          typeof agent.id === "string" &&
          agent.id.length > 0 &&
          typeof agent.displayName === "string" &&
          agent.displayName.length > 0 &&
          typeof agent.required === "boolean";
        if (!base) {
          return false;
        }
        if (agent.dynamicAgentId !== undefined && typeof agent.dynamicAgentId !== "string") {
          return false;
        }
        if (
          agent.capabilities !== undefined &&
          (!Array.isArray(agent.capabilities) || !agent.capabilities.every((c) => typeof c === "string"))
        ) {
          return false;
        }
        return true;
      });

      if (agentsOk) {
        agents = root.agents.map((agent) => {
          const a = agent as Record<string, unknown>;
          const entry: AgenticAppManifest["agents"][number] = {
            id: a.id as string,
            displayName: a.displayName as string,
            required: a.required as boolean,
          };
          if (typeof a.dynamicAgentId === "string") {
            entry.dynamicAgentId = a.dynamicAgentId;
          }
          if (Array.isArray(a.capabilities) && a.capabilities.every((c) => typeof c === "string")) {
            entry.capabilities = a.capabilities as string[];
          }
          return entry;
        });
      }
    }
  }

  let data: AgenticAppManifest["data"];
  if (root.data !== undefined) {
    if (!isPlainObject(root.data)) {
      errors.push("data must be an object when present");
    } else {
      const d = root.data as Record<string, unknown>;
      if (d.apiBasePath !== undefined && typeof d.apiBasePath !== "string") {
        errors.push("data.apiBasePath must be a string when present");
      }
      if (d.eventChannels !== undefined) {
        if (!Array.isArray(d.eventChannels) || !d.eventChannels.every((c) => typeof c === "string")) {
          errors.push("data.eventChannels must be an array of strings when present");
        }
      }
      if (d.mongoCollections !== undefined) {
        if (
          !Array.isArray(d.mongoCollections) ||
          !d.mongoCollections.every((c) => typeof c === "string")
        ) {
          errors.push("data.mongoCollections must be an array of strings when present");
        }
      }

      const dataValid =
        (d.apiBasePath === undefined || typeof d.apiBasePath === "string") &&
        (d.eventChannels === undefined ||
          (Array.isArray(d.eventChannels) && d.eventChannels.every((c) => typeof c === "string"))) &&
        (d.mongoCollections === undefined ||
          (Array.isArray(d.mongoCollections) && d.mongoCollections.every((c) => typeof c === "string")));

      if (dataValid) {
        data = {};
        if (typeof d.apiBasePath === "string") {
          data.apiBasePath = d.apiBasePath;
        }
        if (Array.isArray(d.eventChannels)) {
          data.eventChannels = [...d.eventChannels];
        }
        if (Array.isArray(d.mongoCollections)) {
          data.mongoCollections = [...d.mongoCollections];
        }
      }
    }
  }

  let catalog: AgenticAppManifest["catalog"];
  if (root.catalog !== undefined) {
    if (!isPlainObject(root.catalog)) {
      errors.push("catalog must be an object when present");
    } else {
      const c = root.catalog as Record<string, unknown>;
      if (
        c.categories !== undefined &&
        (!Array.isArray(c.categories) || !c.categories.every((entry) => typeof entry === "string"))
      ) {
        errors.push("catalog.categories must be an array of strings when present");
      }
      if (
        c.capabilities !== undefined &&
        (!Array.isArray(c.capabilities) || !c.capabilities.every((entry) => typeof entry === "string"))
      ) {
        errors.push("catalog.capabilities must be an array of strings when present");
      }
      if (c.icon !== undefined && typeof c.icon !== "string") {
        errors.push("catalog.icon must be a string when present");
      }
      if (c.supportUrl !== undefined && typeof c.supportUrl !== "string") {
        errors.push("catalog.supportUrl must be a string when present");
      }
      if (c.compatibility !== undefined && typeof c.compatibility !== "string") {
        errors.push("catalog.compatibility must be a string when present");
      }

      const catalogValid =
        (c.categories === undefined ||
          (Array.isArray(c.categories) && c.categories.every((entry) => typeof entry === "string"))) &&
        (c.capabilities === undefined ||
          (Array.isArray(c.capabilities) && c.capabilities.every((entry) => typeof entry === "string"))) &&
        (c.icon === undefined || typeof c.icon === "string") &&
        (c.supportUrl === undefined || typeof c.supportUrl === "string") &&
        (c.compatibility === undefined || typeof c.compatibility === "string");

      if (catalogValid) {
        catalog = {};
        if (Array.isArray(c.categories)) catalog.categories = c.categories as string[];
        if (Array.isArray(c.capabilities)) catalog.capabilities = c.capabilities as string[];
        if (typeof c.icon === "string") catalog.icon = c.icon;
        if (typeof c.supportUrl === "string") catalog.supportUrl = c.supportUrl;
        if (typeof c.compatibility === "string") catalog.compatibility = c.compatibility;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  if (
    typeof id !== "string" ||
    typeof root.displayName !== "string" ||
    typeof root.description !== "string" ||
    apiVersion !== API_VERSION ||
    !runtime ||
    !surfaces ||
    !access ||
    !health
  ) {
    return {
      ok: false,
      errors: ["manifest validation failed unexpectedly"],
      warnings,
    };
  }

  const manifest: AgenticAppManifest = {
    id,
    displayName: root.displayName as string,
    description: root.description as string,
    apiVersion: API_VERSION,
    runtime,
    surfaces,
    access,
    health,
  };

  if (agents) {
    manifest.agents = agents;
  }
  if (data) {
    manifest.data = data;
  }
  if (assistant) {
    manifest.assistant = assistant;
  }
  if (webhooks) {
    manifest.webhooks = webhooks;
  }
  if (catalog) {
    manifest.catalog = catalog;
  }

  return { ok: true, manifest, warnings };
}

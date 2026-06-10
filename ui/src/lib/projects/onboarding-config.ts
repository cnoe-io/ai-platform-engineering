// assisted-by Cursor Composer

import fs from "fs";
import path from "path";

import yaml from "js-yaml";

export interface ProjectOnboardingStepConfig {
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  gradient?: string;
  /**
   * Provider that fulfills this step:
   *  - `mock`: simulated (local/dev demos)
   *  - `http`: POST the project to an external system at `endpoint`
   *  - `link`: no backend call — just record an app-tile deep link (`appUrl`)
   *    for a first-party/in-process app (e.g. an in-app feature route)
   *  - `none`/unset: no-op (skipped)
   * The external system is named/located entirely via `endpoint`/`appUrl`
   * (which may reference `${ENV_VAR}`), so no product-specific provider is
   * hardcoded in this repo.
   */
  provider?: "mock" | "none" | "http" | "link";
  /** http provider: target URL; supports `${ENV_VAR}` interpolation. */
  endpoint?: string;
  /** http provider: deep-link recorded as `<id>_url`; supports `${ENV_VAR}`. */
  appUrl?: string;
  /**
   * http provider: provider connection keys (e.g. `github`, `atlassian`) whose
   * access token, for the signed-in actor, should be forwarded to the target
   * system in the POST body under `credentials.<provider>`. Lets the external
   * app act with the user's own creds (from the Connections tab) instead of a
   * shared service token. Tokens are sent only when the user has that
   * connection; nothing provider-specific is hardcoded here.
   */
  forwardCredentials?: string[];
  /**
   * http provider: DELETE endpoint for cascading project deletion. When the
   * CAIPE project is deleted, this URL is called so the external resource is
   * removed too. Supports `${ENV_VAR}` and `${id}` (the id this step recorded as
   * `<id>_id` at create time). Omit to leave external resources in place.
   */
  deleteEndpoint?: string;
  /**
   * http provider: request body template. Values may reference project fields
   * via `${project.<field>}` (e.g. `name`, `description`, `repos`,
   * `integrations`, `labels`). A value that is exactly `${project.<field>}`
   * passes the typed value through (arrays/objects preserved). Omit to send the
   * default `{ name, slug }`.
   */
  body?: Record<string, unknown>;
  checklist?: string[];
}

export interface ProjectOnboardingConfig {
  hero: {
    title: string;
    description: string;
  };
  steps: ProjectOnboardingStepConfig[];
}

const DEFAULT_CONFIG: ProjectOnboardingConfig = {
  hero: {
    title: "Projects for your teams",
    description:
      "Create projects aligned with your Backstage catalog. Onboarding steps are configured externally.",
  },
  steps: [],
};

let cachedConfig: ProjectOnboardingConfig | null = null;
let cachedPath: string | null = null;
let cachedMtimeMs = 0;

function resolveConfigPath(): string | null {
  const explicit = process.env.PROJECTS_ONBOARDING_CONFIG_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const candidates = [
    path.join(process.cwd(), "config", "projects-onboarding.yaml"),
    path.join(process.cwd(), "..", "config", "projects-onboarding.yaml"),
    "/app/config/projects-onboarding.yaml",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeConfig(raw: unknown): ProjectOnboardingConfig {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_CONFIG;
  }

  const record = raw as Record<string, unknown>;
  const heroRaw = record.hero as Record<string, unknown> | undefined;
  const stepsRaw = Array.isArray(record.steps) ? record.steps : [];

  const steps: ProjectOnboardingStepConfig[] = stepsRaw
    .map((step) => {
      if (!step || typeof step !== "object") return null;
      const s = step as Record<string, unknown>;
      const id = typeof s.id === "string" ? s.id.trim() : "";
      const title = typeof s.title === "string" ? s.title.trim() : "";
      const subtitle = typeof s.subtitle === "string" ? s.subtitle.trim() : "";
      if (!id || !title) return null;
      return {
        id,
        title,
        subtitle,
        icon: typeof s.icon === "string" ? s.icon : undefined,
        gradient: typeof s.gradient === "string" ? s.gradient : undefined,
        provider:
          s.provider === "mock"
            ? "mock"
            : s.provider === "http"
              ? "http"
              : s.provider === "link"
                ? "link"
                : "none",
        endpoint: typeof s.endpoint === "string" ? s.endpoint : undefined,
        appUrl: typeof s.appUrl === "string" ? s.appUrl : undefined,
        body:
          s.body && typeof s.body === "object" && !Array.isArray(s.body)
            ? (s.body as Record<string, unknown>)
            : undefined,
        forwardCredentials: Array.isArray(s.forwardCredentials)
          ? s.forwardCredentials.filter((x): x is string => typeof x === "string")
          : undefined,
        deleteEndpoint: typeof s.deleteEndpoint === "string" ? s.deleteEndpoint : undefined,
        checklist: Array.isArray(s.checklist)
          ? s.checklist.filter((item): item is string => typeof item === "string")
          : undefined,
      };
    })
    .filter((step): step is ProjectOnboardingStepConfig => step !== null);

  return {
    hero: {
      title:
        typeof heroRaw?.title === "string" && heroRaw.title.trim()
          ? heroRaw.title.trim()
          : DEFAULT_CONFIG.hero.title,
      description:
        typeof heroRaw?.description === "string" && heroRaw.description.trim()
          ? heroRaw.description.trim()
          : DEFAULT_CONFIG.hero.description,
    },
    steps,
  };
}

export function loadProjectOnboardingConfig(): ProjectOnboardingConfig {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  try {
    const stat = fs.statSync(configPath);
    if (
      cachedConfig &&
      cachedPath === configPath &&
      cachedMtimeMs === stat.mtimeMs
    ) {
      return cachedConfig;
    }

    const parsed = yaml.load(fs.readFileSync(configPath, "utf8"));
    const normalized = normalizeConfig(parsed);
    cachedConfig = normalized;
    cachedPath = configPath;
    cachedMtimeMs = stat.mtimeMs;
    return normalized;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function buildEmptyOnboardingState(
  config: ProjectOnboardingConfig = loadProjectOnboardingConfig(),
): Record<string, { status: "pending" }> {
  return Object.fromEntries(
    config.steps.map((step) => [step.id, { status: "pending" as const }]),
  );
}

export function getConfiguredStepOrder(
  config: ProjectOnboardingConfig = loadProjectOnboardingConfig(),
): string[] {
  return config.steps.map((step) => step.id);
}

// assisted-by Cursor Composer

import fs from "fs";
import path from "path";

import yaml from "js-yaml";

import { isTomeServerEnabled } from "@/lib/tome/guard";

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
   *  - `source`: a pre-create metadata step — a live-fetch picker that attaches
   *    the project's sources (repos / spaces) from a connected provider. Which
   *    connector it picks is set by `source` (e.g. `github`, `confluence`).
   *    These steps run BEFORE the project is created, so their selections feed
   *    the create payload (and any later `http` steps' `${project.repos}`).
   *  - `none`/unset: no-op (skipped)
   * The external system is named/located entirely via `endpoint`/`appUrl`
   * (which may reference `${ENV_VAR}`), so no product-specific provider is
   * hardcoded in this repo.
   */
  provider?: "mock" | "none" | "http" | "link" | "source";
  /**
   * `source` provider: which connector this step attaches. Each renders its own
   * live-fetch picker UX. Selections populate the project's sources at create.
   */
  source?: "github" | "confluence" | "webex";
  /** http provider: target URL; supports `${ENV_VAR}` interpolation. */
  endpoint?: string;
  /**
   * link/http provider: deep-link recorded as `<id>_url`. Supports `${ENV_VAR}`
   * and (link provider) `${project.<field>}` such as `${project.slug}`.
   */
  appUrl?: string;
  /** link provider: optional app-tile image recorded as `<id>_icon`. */
  appIcon?: string;
  /** Whether this integration starts enabled in the wizard's Integrations step. */
  default_enabled?: boolean;
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
   * http provider: PATCH endpoint called when the CAIPE project is edited.
   * Receives the same rendered `body` template as the create POST (re-rendered
   * against the updated project), so the external resource stays in sync.
   * Supports `${ENV_VAR}` and `${id}`. Omit to skip syncing edits externally.
   */
  updateEndpoint?: string;
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
    .map((step): ProjectOnboardingStepConfig | null => {
      if (!step || typeof step !== "object") return null;
      const s = step as Record<string, unknown>;
      const id = typeof s.id === "string" ? s.id.trim() : "";
      const title = typeof s.title === "string" ? s.title.trim() : "";
      const subtitle = typeof s.subtitle === "string" ? s.subtitle.trim() : "";
      if (!id || !title) return null;
      const provider: ProjectOnboardingStepConfig["provider"] =
        s.provider === "mock"
          ? "mock"
          : s.provider === "http"
            ? "http"
            : s.provider === "link"
              ? "link"
              : s.provider === "source"
                ? "source"
                : "none";
      return {
        id,
        title,
        subtitle,
        icon: typeof s.icon === "string" ? s.icon : undefined,
        gradient: typeof s.gradient === "string" ? s.gradient : undefined,
        provider,
        source:
          s.source === "github" || s.source === "confluence" || s.source === "webex"
            ? s.source
            : undefined,
        endpoint: typeof s.endpoint === "string" ? s.endpoint : undefined,
        appUrl: typeof s.appUrl === "string" ? s.appUrl : undefined,
        appIcon: typeof s.appIcon === "string" ? s.appIcon : undefined,
        default_enabled:
          typeof s.default_enabled === "boolean" ? s.default_enabled : undefined,
        body:
          s.body && typeof s.body === "object" && !Array.isArray(s.body)
            ? (s.body as Record<string, unknown>)
            : undefined,
        forwardCredentials: Array.isArray(s.forwardCredentials)
          ? s.forwardCredentials.filter((x): x is string => typeof x === "string")
          : undefined,
        deleteEndpoint: typeof s.deleteEndpoint === "string" ? s.deleteEndpoint : undefined,
        updateEndpoint: typeof s.updateEndpoint === "string" ? s.updateEndpoint : undefined,
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

/**
 * First-party apps that register themselves as available integrations when
 * their feature flag is on — no deployment YAML required. Generic seam: each
 * entry is `{ enabled, step }`; the step flows through the same wizard +
 * provisioning path as a YAML `link` integration. (Tome is the only one today.)
 */
const BUILTIN_APPS: Array<{
  enabled: () => boolean;
  step: ProjectOnboardingStepConfig;
}> = [
  {
    enabled: isTomeServerEnabled,
    step: {
      id: "tome",
      title: "Tome",
      subtitle: "A project wiki with an embedded agent",
      icon: "book-open",
      provider: "link",
      appUrl: "/projects/${project.slug}/tome",
      appIcon: "/app-icons/tome.png",
      default_enabled: true,
    },
  },
];

/** Append enabled built-in apps not already present in the config. */
function withBuiltinApps(
  config: ProjectOnboardingConfig,
): ProjectOnboardingConfig {
  const extra = BUILTIN_APPS.filter(
    (a) => a.enabled() && !config.steps.some((s) => s.id === a.step.id),
  ).map((a) => a.step);
  if (extra.length === 0) return config;
  return { ...config, steps: [...config.steps, ...extra] };
}

export function loadProjectOnboardingConfig(): ProjectOnboardingConfig {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return withBuiltinApps(DEFAULT_CONFIG);
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
    const normalized = withBuiltinApps(normalizeConfig(parsed));
    cachedConfig = normalized;
    cachedPath = configPath;
    cachedMtimeMs = stat.mtimeMs;
    return normalized;
  } catch {
    return withBuiltinApps(DEFAULT_CONFIG);
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

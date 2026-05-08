// assisted-by Codex Codex-sonnet-4-6

import { getCollection } from "@/lib/mongodb";
import type {
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppPackageCatalogMeta,
  AgenticAppPackageRecord,
  AgenticAppPackageSource,
} from "@/types/agentic-app";

export type { AgenticAppPackageCatalogMeta };

export const AGENTIC_APP_PACKAGES_COLLECTION = "agentic_app_packages";
export const AGENTIC_APP_INSTALLATIONS_COLLECTION = "agentic_app_installations";
export const AGENTIC_APP_EVENTS_COLLECTION = "agentic_app_events";

export type UpsertAppPackageFromManifestInput = {
  packageId: string;
  source: AgenticAppPackageSource;
  manifest: AgenticAppManifest;
  importedAt?: string;
  importedBy?: string;
  catalog?: AgenticAppPackageCatalogMeta;
};

export type InstallAppPackageInput = {
  appId: string;
  packageId: string;
  installed?: boolean;
  enabled?: boolean;
  isDefaultLanding?: boolean;
};

export type EffectiveAppForUser = {
  appId: string;
  packageId: string;
  installed: boolean;
  enabled: boolean;
  isDefaultLanding?: boolean;
  manifest: AgenticAppManifest;
  /** Primary UI route for launching the app shell (manifest-driven, not executable code). */
  launchPath: string;
  runtime: AgenticAppManifest["runtime"];
  access: AgenticAppManifest["access"];
  surfaces: AgenticAppManifest["surfaces"];
};

export type EffectiveAppsUserContext = {
  roles?: string[];
  groups?: string[];
  email?: string;
};

/** Deny if access is missing or not trustworthy (persisted corruption). */
export function isUsableAccessRecord(
  access: unknown,
): access is AgenticAppManifest["access"] {
  if (access === null || typeof access !== "object" || Array.isArray(access)) {
    return false;
  }
  const a = access as Record<string, unknown>;
  if (!Array.isArray(a.tokenScopes) || !a.tokenScopes.every((t) => typeof t === "string")) {
    return false;
  }
  if (
    a.requiredRoles !== undefined &&
    (!Array.isArray(a.requiredRoles) || !a.requiredRoles.every((r) => typeof r === "string"))
  ) {
    return false;
  }
  if (
    a.requiredGroups !== undefined &&
    (!Array.isArray(a.requiredGroups) || !a.requiredGroups.every((g) => typeof g === "string"))
  ) {
    return false;
  }
  if (a.canUseCustomAgents !== undefined && typeof a.canUseCustomAgents !== "boolean") {
    return false;
  }
  return true;
}

/** Hub/catalog RBAC: manifest requiredRoles/requiredGroups vs resolved user roles/groups (not OAuth scope claims). */
export function userPassesAgenticAppAccessGates(
  manifest: AgenticAppManifest,
  ctx: EffectiveAppsUserContext,
): boolean {
  if (!isUsableAccessRecord(manifest.access)) {
    return false;
  }
  const access = manifest.access;
  const roles = expandAgenticAppRoles(ctx.roles);
  const groups = ctx.groups ?? [];
  const needRoles = access.requiredRoles;
  if (needRoles && needRoles.length > 0) {
    if (!needRoles.some((r) => roles.includes(r))) {
      return false;
    }
  }
  const needGroups = access.requiredGroups;
  if (needGroups && needGroups.length > 0) {
    if (!needGroups.some((g) => groups.includes(g))) {
      return false;
    }
  }
  return true;
}

function expandAgenticAppRoles(roles: string[] | undefined): string[] {
  const effectiveRoles = new Set(roles ?? []);
  if (effectiveRoles.has("admin")) {
    effectiveRoles.add("user");
  }
  return [...effectiveRoles];
}

export async function listAppPackages(): Promise<AgenticAppPackageRecord[]> {
  const col = await getCollection<AgenticAppPackageRecord>(AGENTIC_APP_PACKAGES_COLLECTION);
  return col.find({}).sort({ packageId: 1 }).toArray();
}

export async function listAppInstallations(): Promise<AgenticAppInstallationRecord[]> {
  const col =
    await getCollection<AgenticAppInstallationRecord>(AGENTIC_APP_INSTALLATIONS_COLLECTION);
  return col.find({}).sort({ appId: 1 }).toArray();
}

export type AppendAgenticAppEventInput = {
  type: string;
  actorEmail: string;
  packageId?: string;
  appId?: string;
  payload?: Record<string, unknown>;
};

export async function appendAgenticAppEvent(input: AppendAgenticAppEventInput): Promise<void> {
  const col = await getCollection(AGENTIC_APP_EVENTS_COLLECTION);
  await col.insertOne({
    createdAt: new Date().toISOString(),
    type: input.type,
    actorEmail: input.actorEmail,
    ...(input.packageId !== undefined ? { packageId: input.packageId } : {}),
    ...(input.appId !== undefined ? { appId: input.appId } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  });
}

export async function upsertAppPackageFromManifest(
  input: UpsertAppPackageFromManifestInput,
): Promise<void> {
  if (input.packageId !== input.manifest.id) {
    throw new Error(
      `packageId "${input.packageId}" must match manifest.id "${input.manifest.id}"`,
    );
  }
  const col = await getCollection(AGENTIC_APP_PACKAGES_COLLECTION);
  const $set: Record<string, unknown> = {
    packageId: input.packageId,
    source: input.source,
    manifest: input.manifest,
  };
  if (input.importedAt !== undefined) {
    $set.importedAt = input.importedAt;
  }
  if (input.importedBy !== undefined) {
    $set.importedBy = input.importedBy;
  }
  if (input.catalog !== undefined) {
    $set.catalog = input.catalog;
  }

  const $unset: Record<string, ""> = {};
  if (input.importedAt === undefined) {
    $unset.importedAt = "";
  }
  if (input.importedBy === undefined) {
    $unset.importedBy = "";
  }
  if (input.catalog === undefined) {
    $unset.catalog = "";
  }

  const update: Record<string, unknown> = { $set };
  if (Object.keys($unset).length > 0) {
    update.$unset = $unset;
  }

  await col.updateOne({ packageId: input.packageId }, update, { upsert: true });
}

export async function installAppPackage(input: InstallAppPackageInput): Promise<void> {
  const col = await getCollection(AGENTIC_APP_INSTALLATIONS_COLLECTION);
  const installed = input.installed ?? true;
  const enabled = input.enabled ?? true;
  const $set: Record<string, unknown> = {
    appId: input.appId,
    packageId: input.packageId,
    installed,
    enabled,
    updatedAt: new Date().toISOString(),
  };
  /**
   * `isDefaultLanding`: omitted → Mongo `$set` does not touch the field (partial updates keep the
   * previous default-landing flag). Explicit `false` → persisted as false (clears default landing).
   */
  if (input.isDefaultLanding !== undefined) {
    $set.isDefaultLanding = input.isDefaultLanding;
  }
  await col.updateOne({ appId: input.appId }, { $set }, { upsert: true });
}

export async function listEffectiveAppsForUser(
  ctx: EffectiveAppsUserContext,
): Promise<EffectiveAppForUser[]> {
  const installationsCol =
    await getCollection<AgenticAppInstallationRecord>(AGENTIC_APP_INSTALLATIONS_COLLECTION);
  const packagesCol = await getCollection<AgenticAppPackageRecord>(AGENTIC_APP_PACKAGES_COLLECTION);

  const activeInstalls = await installationsCol
    .find({ installed: true, enabled: true })
    .toArray();

  const packageIds = [...new Set(activeInstalls.map((row) => row.packageId))];
  if (packageIds.length === 0) {
    return [];
  }

  const packageRows = await packagesCol
    .find({ packageId: { $in: packageIds } })
    .toArray();
  const byPackageId = new Map(packageRows.map((p) => [p.packageId, p]));

  const out: EffectiveAppForUser[] = [];

  for (const inst of activeInstalls) {
    const pkg = byPackageId.get(inst.packageId);
    if (!pkg) {
      continue;
    }
    const { manifest } = pkg;
    if (
      !manifest.runtime ||
      typeof manifest.runtime.mountPath !== "string" ||
      !manifest.surfaces ||
      typeof manifest.surfaces.showInHub !== "boolean"
    ) {
      continue;
    }
    if (!userPassesAgenticAppAccessGates(manifest, ctx)) {
      continue;
    }
    const launchPath = manifest.runtime.mountPath;
    const installation = inst as AgenticAppInstallationRecord & { isDefaultLanding?: boolean };
    out.push({
      appId: inst.appId,
      packageId: inst.packageId,
      installed: inst.installed,
      enabled: inst.enabled,
      ...(typeof installation.isDefaultLanding === "boolean"
        ? { isDefaultLanding: installation.isDefaultLanding }
        : {}),
      manifest,
      launchPath,
      runtime: manifest.runtime,
      access: manifest.access,
      surfaces: manifest.surfaces,
    });
  }

  out.sort((a, b) => {
    const ao = a.manifest.surfaces?.navOrder;
    const bo = b.manifest.surfaces?.navOrder;
    if (typeof ao === "number" && typeof bo === "number" && ao !== bo) {
      return ao - bo;
    }
    return a.appId.localeCompare(b.appId);
  });

  return out;
}

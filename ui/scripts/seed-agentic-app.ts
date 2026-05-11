#!/usr/bin/env -S node --enable-source-maps
/**
 * Seed any external Agentic App manifest into MongoDB.
 *
 * This script is intentionally app-agnostic: the external app owns its manifest
 * JSON, and CAIPE only imports/installs that manifest through the generic
 * platform collections.
 *
 * Usage:
 *   npm run agentic-apps:seed -- --manifest /path/to/manifest.json --origin http://localhost:3001 --mount-path /apps/example --chrome iframe
 *   npm run agentic-apps:seed -- --app-id example --delete
 */

import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { validateAgenticAppManifest } from "../src/lib/agentic-apps/manifest-validation";

loadEnvLocal();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE;

const PACKAGES = "agentic_app_packages";
const INSTALLATIONS = "agentic_app_installations";
const EVENTS = "agentic_app_events";

type CliOptions = {
  manifestPath?: string;
  appId?: string;
  packageId?: string;
  origin?: string;
  mountPath?: string;
  chrome?: "fullscreen" | "iframe";
  preserveMountPath?: boolean;
  delete?: boolean;
  source?: "builtin" | "admin-import" | "helm" | "api";
};

async function main(): Promise<void> {
  if (!MONGODB_URI || !MONGODB_DATABASE) {
    console.error("MONGODB_URI and MONGODB_DATABASE must be set before running this script.");
    process.exit(1);
  }

  const options = parseArgs(process.argv.slice(2));
  const manifestInput = options.manifestPath ? readManifest(options.manifestPath) : undefined;
  const appId = options.appId ?? manifestInput?.id;
  if (!appId) {
    throw new Error("--app-id is required when --manifest is not provided");
  }
  const packageId = options.packageId ?? appId;
  const mountPath = normalizeMountPath(options.mountPath ?? manifestInput?.runtime?.mountPath ?? `/apps/${appId}`);

  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 4,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 10_000,
  });

  console.log(`Connecting to MongoDB database "${MONGODB_DATABASE}"...`);
  await client.connect();
  const db = client.db(MONGODB_DATABASE);

  if (options.delete) {
    const packages = await db.collection(PACKAGES).deleteOne({ packageId });
    const installations = await db.collection(INSTALLATIONS).deleteOne({ appId });
    await db.collection(EVENTS).insertOne({
      createdAt: new Date().toISOString(),
      type: "agentic_app_external_removed",
      actorEmail: "seed-agentic-app",
      appId,
      packageId,
      payload: { mountPath },
    });
    console.log(`Removed external app docs: packages=${packages.deletedCount}, installations=${installations.deletedCount}`);
    await client.close();
    return;
  }

  if (!manifestInput) {
    throw new Error("--manifest is required unless --delete is set");
  }

  const manifest = applyRuntimeOverrides(manifestInput, {
    origin: options.origin,
    mountPath,
    chrome: options.chrome,
    preserveMountPath: options.preserveMountPath,
  });
  const validation = validateAgenticAppManifest(manifest);
  if (validation.ok === false) {
    throw new Error(`Invalid manifest: ${validation.errors.join("; ")}`);
  }
  if (packageId !== validation.manifest.id || appId !== validation.manifest.id) {
    throw new Error("app id, package id, and manifest.id must match for the generic seeder");
  }

  const now = new Date().toISOString();
  const origin = options.origin ?? validation.manifest.runtime.origin;

  await db.collection(PACKAGES).updateOne(
    { packageId },
    {
      $set: {
        packageId,
        source: options.source ?? "admin-import",
        manifest: validation.manifest,
        importedAt: now,
        importedBy: "seed-agentic-app",
        ...(validation.manifest.catalog ? { catalog: validation.manifest.catalog } : {}),
      },
    },
    { upsert: true },
  );

  await db.collection(INSTALLATIONS).updateOne(
    { appId },
    {
      $set: {
        appId,
        packageId,
        installed: true,
        enabled: true,
        visible: true,
        runtimeMountPath: mountPath,
        ...(origin ? { runtimeOriginOverride: trimTrailingSlash(origin) } : {}),
        runtimeHealth: "unknown",
        healthPolicy: {
          blockLaunchWhen: validation.manifest.health.blockLaunchWhen ?? ["degraded", "unreachable"],
        },
        routeOwnership: { normalizedMountPath: mountPath },
        updatedAt: now,
        updatedBy: "seed-agentic-app",
      },
      $setOnInsert: {
        installedAt: now,
      },
    },
    { upsert: true },
  );

  await db.collection(EVENTS).insertOne({
    createdAt: now,
    type: "agentic_app_external_seeded",
    actorEmail: "seed-agentic-app",
    appId,
    packageId,
    payload: {
      origin,
      mountPath,
      runtimeKind: validation.manifest.runtime.kind,
      chrome: validation.manifest.runtime.chrome ?? "fullscreen",
    },
  });

  console.log("");
  console.log("External Agentic App seeded:");
  console.log(`  appId     : ${appId}`);
  console.log(`  mountPath : ${mountPath}`);
  console.log(`  origin    : ${origin ?? "(manifest omitted origin)"}`);
  console.log(`  launch    : ${validation.manifest.runtime.chrome === "iframe" ? `/apps/embed/${appId}` : mountPath}`);
  console.log("");
  console.log("To remove it:");
  console.log(`  npm run agentic-apps:seed -- --app-id ${appId} --delete`);

  await client.close();
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--manifest":
        options.manifestPath = requireValue(arg, next);
        i += 1;
        break;
      case "--app-id":
        options.appId = requireValue(arg, next);
        i += 1;
        break;
      case "--package-id":
        options.packageId = requireValue(arg, next);
        i += 1;
        break;
      case "--origin":
        options.origin = trimTrailingSlash(requireValue(arg, next));
        i += 1;
        break;
      case "--mount-path":
        options.mountPath = requireValue(arg, next);
        i += 1;
        break;
      case "--chrome": {
        const value = requireValue(arg, next);
        if (value !== "fullscreen" && value !== "iframe") {
          throw new Error("--chrome must be fullscreen or iframe");
        }
        options.chrome = value;
        i += 1;
        break;
      }
      case "--preserve-mount-path":
        options.preserveMountPath = true;
        break;
      case "--no-preserve-mount-path":
        options.preserveMountPath = false;
        break;
      case "--delete":
        options.delete = true;
        break;
      case "--source": {
        const value = requireValue(arg, next);
        if (!["builtin", "admin-import", "helm", "api"].includes(value)) {
          throw new Error("--source must be builtin, admin-import, helm, or api");
        }
        options.source = value as CliOptions["source"];
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function readManifest(manifestPath: string): Record<string, any> {
  const text = manifestPath === "-"
    ? readFileSync(0, "utf8")
    : readFileSync(resolve(manifestPath), "utf8");
  return JSON.parse(text);
}

function applyRuntimeOverrides(
  manifest: Record<string, any>,
  overrides: Pick<CliOptions, "origin" | "mountPath" | "chrome" | "preserveMountPath">,
): Record<string, any> {
  return {
    ...manifest,
    runtime: {
      ...manifest.runtime,
      ...(overrides.origin ? { origin: overrides.origin } : {}),
      ...(overrides.mountPath ? { mountPath: overrides.mountPath } : {}),
      ...(overrides.chrome ? { chrome: overrides.chrome } : {}),
      ...(overrides.preserveMountPath !== undefined
        ? { preserveMountPath: overrides.preserveMountPath }
        : {}),
    },
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeMountPath(value: string): string {
  const trimmed = value.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const resolvedPath = new URL(withSlash.replace(/\/+$/, ""), "http://caipe.local").pathname;
  if (!resolvedPath.startsWith("/apps/")) {
    throw new Error(`mount path must stay under /apps/ (got "${value}")`);
  }
  return resolvedPath;
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return;
  }
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    const key = trimmed.slice(0, equals).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = unquoteEnvValue(trimmed.slice(equals + 1).trim());
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

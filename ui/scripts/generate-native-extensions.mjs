import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tailwindSourceForEntry } from "./native-extension-source.mjs";
import {
  normalizeNativeExtensionManifest,
  validateAgenticAppManifest,
} from "../native-extension-sdk/agentic-app-manifest.mjs";
import {
  validateBuiltArtifact,
  validateInstalledPin,
  validateManifest,
  validateOwnership,
  validatePackage,
} from "./native-extension-contract.mjs";

export function generateNativeExtensions(
  uiRoot = join(dirname(fileURLToPath(import.meta.url)), ".."),
  modules = (process.env.CAIPE_NATIVE_EXTENSION_MODULES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
) {
  const require = createRequire(join(uiRoot, "package.json"));
  const outputRoot = join(uiRoot, "src", "native-extensions");

  const manifests = modules.map((moduleName) => {
    if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(moduleName)) {
      throw new Error(`Invalid native extension module name: ${moduleName}`);
    }
    const manifestPath = require.resolve(`${moduleName}/manifest`);
    const entryPath = require.resolve(moduleName);
    const declaration = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifest = validateManifest(moduleName, declaration);
    const packageRoot = dirname(manifestPath);
    const pkg = validatePackage(packageRoot, manifest);
    validateBuiltArtifact(packageRoot, pkg);
    if (pkg.name !== moduleName)
      throw new Error(`${moduleName}: installed package name mismatch`);
    validateInstalledPin(uiRoot, moduleName, pkg.version);
    const appManifest =
      declaration.apiVersion === "2.0"
        ? validateAgenticAppManifest(declaration)
        : normalizeNativeExtensionManifest(manifest, moduleName, pkg.version);
    if (
      appManifest.version !== pkg.version ||
      appManifest.ui.profiles.find(
        (profile) => profile.mode === "native-package",
      )?.package !== moduleName
    ) {
      throw new Error(
        `${moduleName}: application version/package must match the artifact`,
      );
    }
    return {
      moduleName,
      manifest,
      appManifest,
      legacy: declaration.apiVersion !== "2.0",
      entryPath,
    };
  });

  validateOwnership(manifests);
  mkdirSync(outputRoot, { recursive: true });

  const imports = manifests
    .map(
      ({ moduleName }, index) =>
        `import extension${index} from ${JSON.stringify(moduleName)};`,
    )
    .join("\n");
  const entries = manifests
    .map(
      ({ manifest }, index) =>
        `  { manifest: ${JSON.stringify(manifest)}, module: extension${index} },`,
    )
    .join("\n");
  writeFileSync(
    join(outputRoot, "installed.generated.tsx"),
    `"use client";\n\n${imports}\n\nimport type { InstalledNativeExtension } from "./types";\n\nexport const installedNativeExtensions: InstalledNativeExtension[] = [\n${entries}\n];\n`,
  );

  writeFileSync(
    join(outputRoot, "manifests.generated.ts"),
    `import type { NativeExtensionManifest } from "./types";\nimport type { AgenticAppManifest } from "@/types/agentic-app";\n\nexport const installedAgenticAppManifests: AgenticAppManifest[] = ${JSON.stringify(
      manifests.map(({ appManifest }) => appManifest),
      null,
      2,
    )};\n\nexport const installedLegacyNativeExtensionIds: string[] = ${JSON.stringify(manifests.filter(({ legacy }) => legacy).map(({ manifest }) => manifest.id))};\n\nexport const installedNativeExtensionManifests: NativeExtensionManifest[] = ${JSON.stringify(
      manifests.map(({ manifest }) => manifest),
      null,
      2,
    )};\n`,
  );

  writeFileSync(
    join(outputRoot, "styles.generated.css"),
    `${manifests.map(({ moduleName, entryPath }) => `@import ${JSON.stringify(`${moduleName}/styles.css`)};\n@source ${JSON.stringify(tailwindSourceForEntry(join(outputRoot, "styles.generated.css"), entryPath))};`).join("\n")}\n`,
  );
}

if (import.meta.main) generateNativeExtensions();

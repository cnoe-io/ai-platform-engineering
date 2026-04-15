#!/usr/bin/env node
/**
 * Build a Node.js Single Executable Application (SEA) for the current platform.
 *
 * Handles keytar (native module) by:
 *   1. Marking it external in esbuild
 *   2. Patching Module._resolveFilename so require('keytar') resolves to
 *      keytar.node placed next to the binary
 *   3. Copying keytar.node into dist/
 *
 * Outputs: dist/caipe  (signed with codesign -s - on macOS)
 */

import { build } from "esbuild";
import {
  copyFileSync, readFileSync, writeFileSync,
  existsSync, mkdirSync, chmodSync, rmSync,
} from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// 1. esbuild — bundle everything except keytar + fsevents
// ---------------------------------------------------------------------------
console.log("→ Bundling with esbuild…");

// Preamble injected at the top of the bundle: patch Node module resolution so
// that require('keytar') loads keytar.node from the same directory as the
// running binary (works for both SEA binary and plain `node dist/bundle.cjs`
// when keytar.node is present in the same directory).
const keytarPreamble = `
;(function patchKeytarForSEA() {
  const path = require('path');
  const fs   = require('fs');
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (id, parent, isMain, opts) {
    if (id === 'keytar') {
      const candidates = [
        // Next to the running binary (SEA mode)
        path.join(path.dirname(process.execPath), 'keytar.node'),
        // Next to this bundle file (node dist/bundle.cjs)
        path.join(__dirname, 'keytar.node'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
    return orig.call(this, id, parent, isMain, opts);
  };
})();
`;

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/bundle.cjs",
  external: ["keytar", "fsevents"],
  banner: { js: keytarPreamble },
  // Silence "require() of ES Module" warnings from dependencies that ship
  // dual CJS/ESM packages (e.g. execa, chalk).
  mainFields: ["main"],
  conditions: ["require", "node"],
  logLevel: "warning",
});
console.log("   ✓ dist/bundle.cjs");

// ---------------------------------------------------------------------------
// 2. Copy keytar.node into dist/ (optional — only if keytar is installed)
// ---------------------------------------------------------------------------
const keytarSrc = join(__dirname, "node_modules/keytar/build/Release/keytar.node");
const keytarDst = join(__dirname, "dist/keytar.node");
if (existsSync(keytarSrc)) {
  console.log("→ Copying keytar.node…");
  copyFileSync(keytarSrc, keytarDst);
  console.log("   ✓ dist/keytar.node");
} else {
  console.log("→ keytar.node not found (optional) — skipping. Keychain backend won't be available.");
}

// ---------------------------------------------------------------------------
// 3. Node.js SEA — generate injection blob
// ---------------------------------------------------------------------------
console.log("→ Generating SEA blob…");

const seaConfig = {
  main: "dist/bundle.cjs",
  output: "dist/sea-prep.blob",
  disableExperimentalSEAWarning: true,
};
writeFileSync("dist/sea-config.json", JSON.stringify(seaConfig, null, 2));

execSync("node --experimental-sea-config dist/sea-config.json", { stdio: "inherit" });
console.log("   ✓ dist/sea-prep.blob");

// ---------------------------------------------------------------------------
// 4. Create binary — copy node, inject blob, sign
// ---------------------------------------------------------------------------
console.log("→ Creating binary…");

const nodePath  = process.execPath;           // /opt/homebrew/bin/node  (or wherever)
const outBinary = join(__dirname, "dist/caipe");

if (existsSync(outBinary)) rmSync(outBinary);
copyFileSync(nodePath, outBinary);
chmodSync(outBinary, 0o755);

// Remove existing signature (required on macOS before postject can modify the binary)
if (process.platform === "darwin") {
  try {
    execSync(`codesign --remove-signature "${outBinary}"`, { stdio: "pipe" });
  } catch {
    // Binary may not be signed yet — ignore
  }
}

// Inject blob using postject
const postject = join(__dirname, "node_modules/.bin/postject");
if (!existsSync(postject)) {
  console.log("   Installing postject…");
  execSync("npm install --save-dev postject --silent", { stdio: "inherit", cwd: __dirname });
}

const machoFlag = process.platform === "darwin"
  ? "--macho-segment-name NODE_SEA"
  : "";

execSync(
  `"${postject}" "${outBinary}" NODE_SEA_BLOB dist/sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ${machoFlag}`,
  { stdio: "inherit", cwd: __dirname },
);

// Re-sign on macOS (ad-hoc signature — no Apple Developer account needed)
if (process.platform === "darwin") {
  execSync(`codesign -s - "${outBinary}"`, { stdio: "inherit" });
  console.log("   ✓ Signed with ad-hoc codesign");
}

console.log(`\n✓ Binary ready: ${outBinary}`);

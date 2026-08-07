#!/usr/bin/env node
/**
 * npm/npx entrypoint: prefer published platform binary, else local compile, else tsx.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const args = process.argv.slice(2);

const PLATFORM_PACKAGES = [
  { os: "darwin", cpu: "arm64", pkg: "caipe-darwin-arm64" },
  { os: "darwin", cpu: "x64", pkg: "caipe-darwin-x64" },
  { os: "linux", cpu: "arm64", pkg: "caipe-linux-arm64" },
  { os: "linux", cpu: "x64", pkg: "caipe-linux-x64" },
];

function die(msg) {
  process.stderr.write(`[caipe] ${msg}\n`);
  process.exit(1);
}

function run(bin, binArgs) {
  const r = spawnSync(bin, binArgs, { stdio: "inherit" });
  if (r.error) {
    die(r.error.message);
  }
  process.exit(r.status ?? 1);
}

function tryPlatformBinary() {
  const os = process.platform;
  const cpu = process.arch;
  for (const entry of PLATFORM_PACKAGES) {
    if (entry.os !== os || entry.cpu !== cpu) continue;
    let binPath;
    try {
      binPath = require.resolve(path.join(entry.pkg, "bin/caipe"));
    } catch {
      continue;
    }
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  }
  return null;
}

function tryLocalBinary() {
  const local = path.join(root, "dist", "caipe");
  if (fs.existsSync(local)) {
    return local;
  }
  return null;
}

function tryBundle() {
  const bundle = path.join(root, "dist", "bundle.cjs");
  if (fs.existsSync(bundle)) {
    return { node: process.execPath, script: bundle };
  }
  return null;
}

function tryTsx() {
  let tsxCli;
  try {
    tsxCli = require.resolve("tsx/dist/cli.mjs");
  } catch {
    return null;
  }
  const entry = path.join(root, "src", "index.ts");
  if (!fs.existsSync(entry)) {
    return null;
  }
  return { node: process.execPath, script: tsxCli, entry };
}

const platformBin = tryPlatformBinary();
if (platformBin) {
  run(platformBin, args);
}

const localBin = tryLocalBinary();
if (localBin) {
  run(localBin, args);
}

const bundle = tryBundle();
if (bundle) {
  run(bundle.node, [bundle.script, ...args]);
}

const tsx = tryTsx();
if (tsx) {
  run(tsx.node, [tsx.script, tsx.entry, ...args]);
}

die(
  "Could not start caipe. Install a release binary (curl install.sh), run setup-caipe-cli.sh, or build with: bun install && npm run compile",
);

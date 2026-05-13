#!/usr/bin/env node
/**
 * Snapshot current docs as NEW_VERSION and prune old doc versions.
 *
 * Retention policy:
 *   - Latest MAX_CURRENT_MINOR (5) versions from the current minor series (e.g. 0.4.x)
 *   - Highest version from each previous minor series (e.g. 0.3.11, 0.2.x)
 *
 * Usage (run from repo root):
 *   NEW_VERSION=0.4.12 node docs/scripts/snapshot-and-prune-versions.js
 *
 * assisted-by claude code claude-sonnet-4-6
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DOCS_DIR = path.join(__dirname, '..');
const VERSIONED_DOCS_DIR = path.join(DOCS_DIR, 'versioned_docs');
const VERSIONED_SIDEBARS_DIR = path.join(DOCS_DIR, 'versioned_sidebars');
const VERSIONS_JSON = path.join(DOCS_DIR, 'versions.json');
const VERSIONS_CONFIG_JSON = path.join(DOCS_DIR, 'versions-config.json');

const MAX_CURRENT_MINOR = 5;

// ---------------------------------------------------------------------------
// Semver helpers (no external dependencies)
// ---------------------------------------------------------------------------

function parseVersion(v) {
  const parts = v.split('.').map(Number);
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function compareVersionsDesc(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  return pb.patch - pa.patch;
}

function minorKey(v) {
  const { major, minor } = parseVersion(v);
  return `${major}.${minor}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const newVersion = process.env.NEW_VERSION;
if (!newVersion) {
  console.error('ERROR: NEW_VERSION env var is required (e.g. NEW_VERSION=0.4.12)');
  process.exit(1);
}

// 1. Snapshot docs as the new version
console.log(`\n==> Snapshotting docs as version ${newVersion} ...`);
execSync(`npm run docusaurus -- docs:version ${newVersion}`, {
  cwd: DOCS_DIR,
  stdio: 'inherit',
});

// 2. Read the updated versions.json (docusaurus prepended the new version)
let versions = JSON.parse(fs.readFileSync(VERSIONS_JSON, 'utf8'));
versions.sort(compareVersionsDesc);

// 3. Group by minor series
const byMinor = {};
for (const v of versions) {
  const key = minorKey(v);
  if (!byMinor[key]) byMinor[key] = [];
  byMinor[key].push(v); // already sorted desc, so first = highest
}

const sortedMinors = Object.keys(byMinor).sort((a, b) => {
  const [aMaj, aMin] = a.split('.').map(Number);
  const [bMaj, bMin] = b.split('.').map(Number);
  if (aMaj !== bMaj) return bMaj - aMaj;
  return bMin - aMin;
});

const currentMinor = sortedMinors[0];
const prevMinors = sortedMinors.slice(1);

// 4. Compute keep set
const keep = new Set();

// Latest N from current minor
byMinor[currentMinor].slice(0, MAX_CURRENT_MINOR).forEach(v => keep.add(v));

// Highest from each previous minor
for (const minor of prevMinors) {
  keep.add(byMinor[minor][0]);
}

const toPrune = versions.filter(v => !keep.has(v));

console.log(`\n==> Keeping : ${[...keep].sort(compareVersionsDesc).join(', ')}`);
if (toPrune.length) {
  console.log(`==> Pruning : ${toPrune.join(', ')}`);
} else {
  console.log('==> Nothing to prune.');
}

// 5. Delete pruned versioned_docs/ dirs and versioned_sidebars/ files
for (const v of toPrune) {
  const docDir = path.join(VERSIONED_DOCS_DIR, `version-${v}`);
  const sidebarFile = path.join(VERSIONED_SIDEBARS_DIR, `version-${v}-sidebars.json`);

  if (fs.existsSync(docDir)) {
    fs.rmSync(docDir, { recursive: true, force: true });
    console.log(`  Removed ${path.relative(DOCS_DIR, docDir)}`);
  }
  if (fs.existsSync(sidebarFile)) {
    fs.rmSync(sidebarFile);
    console.log(`  Removed ${path.relative(DOCS_DIR, sidebarFile)}`);
  }
}

// 6. Rewrite versions.json (sorted, pruned)
const updatedVersions = versions.filter(v => keep.has(v));
fs.writeFileSync(VERSIONS_JSON, JSON.stringify(updatedVersions, null, 2) + '\n');
console.log(`\n==> Rewrote versions.json: [${updatedVersions.join(', ')}]`);

// 7. Rebuild versions-config.json
const versionsConfig = JSON.parse(fs.readFileSync(VERSIONS_CONFIG_JSON, 'utf8'));

const newVersionsBlock = {
  // Preserve the "current" (main 🚧) entry
  current: versionsConfig.versions.current || {
    label: 'main 🚧',
    path: 'next',
    badge: true,
  },
};

// New version becomes "(Latest)" at root path
newVersionsBlock[newVersion] = {
  label: `${newVersion} (Latest)`,
  path: '',
  badge: false,
};

// All other kept versions use their version string as the path
for (const v of updatedVersions) {
  if (v === newVersion) continue;
  newVersionsBlock[v] = {
    label: v,
    path: v,
    badge: false,
  };
}

versionsConfig.lastVersion = newVersion;
versionsConfig.versions = newVersionsBlock;

fs.writeFileSync(VERSIONS_CONFIG_JSON, JSON.stringify(versionsConfig, null, 2) + '\n');
console.log(`==> Updated versions-config.json: lastVersion=${newVersion}`);
console.log('Done.\n');

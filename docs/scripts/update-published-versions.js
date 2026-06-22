#!/usr/bin/env node
/**
 * Add a newly-released version to docs/published-versions.json and apply the
 * retention policy. This is the only file the docs-snapshot workflow touches on a
 * tag push — the heavy `versioned_docs/` trees are materialised at build time by
 * generate-versioned-docs.js, never committed.
 *
 * Retention policy:
 *   - Keep the latest MAX_PATCHES patches of the current minor series.
 *   - Keep only the highest patch of each older minor series.
 *   - Keep at most MAX_MINORS minor series in total (newest first).
 *
 * MAX_PATCHES caps versioned-docs build size. Each additional version adds
 * ~1-2 GB to the Docusaurus static-generation heap; 5 patches is the tested
 * safe ceiling on the 8 GB CI runner.
 *
 * Usage:
 *   NEW_VERSION=0.5.3 node docs/scripts/update-published-versions.js
 *
 * assisted-by Claude:claude-opus-4-8
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..');
const PUBLISHED_JSON = path.join(DOCS_DIR, 'published-versions.json');

const MAX_MINORS = 3;
const MAX_PATCHES = 5; // keep last 5 patches of the current minor

function compareVersionsDesc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

function minorKey(v) {
  const [major, minor] = v.split('.').map(Number);
  return `${major}.${minor}`;
}

const newVersion = (process.env.NEW_VERSION || '').replace(/^v/, '').trim();
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('ERROR: NEW_VERSION must be a semver release (e.g. 0.5.3).');
  process.exit(1);
}

let versions = [];
if (fs.existsSync(PUBLISHED_JSON)) {
  versions = JSON.parse(fs.readFileSync(PUBLISHED_JSON, 'utf8'));
}

versions = [...new Set([newVersion, ...versions])].sort(compareVersionsDesc);

// Group by minor series (already sorted desc, so index 0 of each group is highest).
const byMinor = {};
for (const v of versions) {
  const key = minorKey(v);
  (byMinor[key] = byMinor[key] || []).push(v);
}

const sortedMinors = Object.keys(byMinor).sort((a, b) => {
  const [aMaj, aMin] = a.split('.').map(Number);
  const [bMaj, bMin] = b.split('.').map(Number);
  if (aMaj !== bMaj) return bMaj - aMaj;
  return bMin - aMin;
});

const currentMinor = sortedMinors[0];
const keep = new Set();

for (const minor of sortedMinors.slice(0, MAX_MINORS)) {
  if (minor === currentMinor) {
    // Keep only the latest MAX_PATCHES patches of the current minor series.
    byMinor[minor].slice(0, MAX_PATCHES).forEach((v) => keep.add(v));
  } else {
    // Keep only the highest patch of older minor series.
    keep.add(byMinor[minor][0]);
  }
}

const updated = versions.filter((v) => keep.has(v)).sort(compareVersionsDesc);

fs.writeFileSync(PUBLISHED_JSON, JSON.stringify(updated, null, 2) + '\n');
console.log(`published-versions.json -> [${updated.join(', ')}]`);

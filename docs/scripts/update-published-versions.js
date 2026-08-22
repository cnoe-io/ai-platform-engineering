#!/usr/bin/env node
/**
 * Add a newly-released version to docs/published-versions.json and apply the
 * retention policy. This is the only file the docs-snapshot workflow touches on a
 * tag push — the heavy `versioned_docs/` trees are materialised at build time by
 * generate-versioned-docs.js, never committed.
 *
 * Retention policy:
 *   - Keep the final release of the newest three minor series as frozen
 *     snapshots.
 *
 * Frozen snapshots are the only generated versioned-docs trees. Keeping three
 * limits the Docusaurus static-generation footprint while leaving historical
 * release notes and upgrade guides in the releases blog intact.
 *
 * Usage:
 *   NEW_VERSION=0.5.3 node docs/scripts/update-published-versions.js
 *
 * assisted-by Claude:claude-opus-4-8
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { retainVersions } = require('./versioned-docs-policy');

const DOCS_DIR = path.join(__dirname, '..');
const PUBLISHED_JSON = path.join(DOCS_DIR, 'published-versions.json');

const newVersion = (process.env.NEW_VERSION || '').replace(/^v/, '').trim();
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('ERROR: NEW_VERSION must be a semver release (e.g. 0.5.3).');
  process.exit(1);
}

let versions = [];
if (fs.existsSync(PUBLISHED_JSON)) {
  versions = JSON.parse(fs.readFileSync(PUBLISHED_JSON, 'utf8'));
}

const updated = retainVersions([newVersion, ...versions]);

fs.writeFileSync(PUBLISHED_JSON, JSON.stringify(updated, null, 2) + '\n');
console.log(`published-versions.json -> [${updated.join(', ')}]`);

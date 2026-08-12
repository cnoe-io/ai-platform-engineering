#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAIN_UI_VERSION_PATTERN = /^\d+\.\d+\.\d+-ui-main-[0-9a-f]+$/;
const CONVENTIONAL_SUBJECT_PATTERN =
  /^(feat|fix|docs|perf|security|refactor|chore|build|ci|test)(?:\(([^)]+)\))?:\s*(.+)$/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value arguments; received ${key}`);
    }
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

export function classifySubject(subject) {
  const pullRequestMatch = subject.match(/\s+\(#(\d+)\)$/);
  const pullRequest = pullRequestMatch?.[1] ?? null;
  const withoutPullRequest = pullRequestMatch
    ? subject.slice(0, pullRequestMatch.index).trim()
    : subject.trim();
  const conventional = withoutPullRequest.match(CONVENTIONAL_SUBJECT_PATTERN);
  if (!conventional) {
    return { category: "maintenance", pullRequest, scope: null, text: withoutPullRequest };
  }

  const [, rawType, scope, text] = conventional;
  const type = rawType.toLowerCase();
  const category =
    type === "feat"
      ? "features"
      : type === "fix"
        ? "fixes"
        : type === "security"
          ? "security"
          : type === "docs"
            ? "docs"
            : type === "perf"
              ? "performance"
              : "maintenance";
  return { category, pullRequest, scope: scope ?? null, text };
}

function linkedChange(change, repository) {
  const scope = change.scope ? `**${change.scope}**: ` : "";
  const target = change.pullRequest
    ? `https://github.com/${repository}/pull/${change.pullRequest}`
    : `https://github.com/${repository}/commit/${change.sha}`;
  const label = change.pullRequest ? `#${change.pullRequest}` : change.sha.slice(0, 9);
  return `- ${scope}${change.text} ([${label}](${target}))`;
}

export function renderMarkdown({ changes, currentTag, previousTag, previousVersion, repository }) {
  const compareUrl = `https://github.com/${repository}/compare/${previousTag}...${currentTag}`;
  const groups = new Map([
    ["features", { heading: "What's New", entries: [] }],
    ["fixes", { heading: "Bug Fixes", entries: [] }],
    ["security", { heading: "Security", entries: [] }],
    ["performance", { heading: "Performance", entries: [] }],
    ["docs", { heading: "Documentation", entries: [] }],
    ["maintenance", { heading: "Maintenance", entries: [] }],
  ]);
  for (const change of changes) {
    groups.get(change.category).entries.push(linkedChange(change, repository));
  }

  const sections = [
    `> Mirror main update. Changes since \`${previousVersion}\`.`,
  ];
  for (const { heading, entries } of groups.values()) {
    if (entries.length > 0) {
      sections.push(`## ${heading}\n\n${entries.join("\n")}`);
    }
  }
  if (changes.length === 0) {
    sections.push("## Maintenance\n\nNo user-facing changes were detected in this increment.");
  }
  sections.push(`[Compare all changes](${compareUrl})`);
  return sections.join("\n\n");
}

export function generateMainIncrementReleaseNotes({ version, repository }) {
  if (!MAIN_UI_VERSION_PATTERN.test(version)) {
    throw new Error(`Version is not a mirror main UI increment: ${version}`);
  }

  const currentTag = `caipe-ui-${version}`;
  const tags = git([
    "for-each-ref",
    "--sort=creatordate",
    "--format=%(refname:short)",
    "refs/tags/caipe-ui-*-ui-main-*",
  ])
    .split("\n")
    .filter(Boolean);
  const currentIndex = tags.indexOf(currentTag);
  if (currentIndex < 0) {
    throw new Error(`Release tag is not available in the checkout: ${currentTag}`);
  }
  if (currentIndex === 0) {
    throw new Error(`No previous mirror main UI tag exists before ${currentTag}`);
  }

  const previousTag = tags[currentIndex - 1];
  const previousVersion = previousTag.replace(/^caipe-ui-/, "");
  const currentCommit = git(["rev-parse", `${currentTag}^{commit}`]);
  const previousCommit = git(["rev-parse", `${previousTag}^{commit}`]);
  const log = git([
    "log",
    "--first-parent",
    "--no-merges",
    "--format=%H%x09%s",
    `${previousCommit}..${currentCommit}`,
  ]);
  const changes = log
    ? log.split("\n").map((line) => {
        const separator = line.indexOf("\t");
        const sha = line.slice(0, separator);
        const subject = line.slice(separator + 1);
        return { sha, ...classifySubject(subject) };
      })
    : [];
  const date = git(["show", "-s", "--format=%cI", currentCommit]).slice(0, 10);
  const changelogUrl = `https://github.com/${repository}/compare/${previousTag}...${currentTag}`;

  return {
    version,
    previousVersion,
    title: `Mirror main update ${version.split("-").at(-1)}`,
    date,
    body: renderMarkdown({ changes, currentTag, previousTag, previousVersion, repository }),
    changelogUrl,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const repository = args.repository;
  const output = args.output ?? "ui/public/main-increment-release-notes.json";
  if (!version || !repository) {
    throw new Error("Usage: --version <version> --repository <owner/repo> [--output <path>]");
  }

  const notes = generateMainIncrementReleaseNotes({ version, repository });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
  console.log(`Generated ${output}: ${notes.previousVersion} -> ${notes.version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

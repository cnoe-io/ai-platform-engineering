/**
 * Skill update orchestrator (T030).
 *
 * Compares installed skill versions against catalog, shows diffs,
 * prompts for confirmation, and applies updates with backup.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import semver from "semver";
import { fetchCatalog } from "./catalog.js";
import { scanInstalledSkills } from "./scan.js";
import { renderDiff } from "../platform/diff.js";

export interface UpdateReport {
  updated: string[];
  skipped: string[];
  upToDate: string[];
  errors: string[];
}

export async function runSkillsUpdateCore(
  name: string | undefined,
  opts: { all?: boolean; dryRun?: boolean },
): Promise<UpdateReport> {
  const cwd = process.cwd();
  const catalog = await fetchCatalog();
  const installed = scanInstalledSkills(cwd);

  // Filter to the requested skill(s)
  const toCheck = name
    ? installed.filter((s) => s.name === name)
    : opts.all
      ? installed
      : installed; // default: check all if no name + no --all

  if (name && toCheck.length === 0) {
    process.stderr.write(`[ERROR] Skill "${name}" is not installed.\n`);
    process.exit(3);
  }

  const report: UpdateReport = { updated: [], skipped: [], upToDate: [], errors: [] };

  for (const skill of toCheck) {
    const catalogEntry = catalog.skills.find((s) => s.name === skill.name);
    if (!catalogEntry) {
      // Skill not in catalog (local-only)
      report.upToDate.push(skill.name);
      continue;
    }

    if (!semver.gt(catalogEntry.version, skill.version)) {
      report.upToDate.push(skill.name);
      if (!opts.dryRun) {
        process.stdout.write(`${skill.name}: up to date (v${skill.version})\n`);
      }
      continue;
    }

    // Update available
    if (opts.dryRun) {
      process.stdout.write(
        `${skill.name}: v${skill.version} → v${catalogEntry.version} (available)\n`,
      );
      report.updated.push(skill.name);
      continue;
    }

    // Fetch new content
    let newContent: string;
    try {
      const res = await fetch(catalogEntry.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      newContent = await res.text();
    } catch (err) {
      process.stderr.write(
        `[ERROR] Could not fetch update for "${skill.name}": ${String(err)}\n`,
      );
      report.errors.push(skill.name);
      continue;
    }

    // Show diff and prompt
    const oldContent = readFileSync(skill.path, "utf8");
    const diff = renderDiff(oldContent, newContent, skill.name);

    process.stdout.write(
      `\nUpdate available: ${skill.name} v${skill.version} → v${catalogEntry.version}\n`,
    );
    process.stdout.write(diff + "\n");
    process.stdout.write(`Apply update? [y/N] `);

    const answer = await readLine();
    if (!answer.trim().toLowerCase().startsWith("y")) {
      process.stdout.write(`Skipped "${skill.name}".\n`);
      report.skipped.push(skill.name);
      continue;
    }

    // Backup existing
    const backupPath = `${skill.path}.bak`;
    writeFileSync(backupPath, oldContent, "utf8");

    // Write new version
    writeFileSync(skill.path, newContent, "utf8");
    process.stdout.write(
      `Updated "${skill.name}" (backup: ${backupPath})\n`,
    );
    report.updated.push(skill.name);
  }

  // Summary
  if (!opts.dryRun) {
    process.stdout.write(
      `\nUpdate complete: ${report.updated.length} updated, ` +
        `${report.skipped.length} skipped, ${report.upToDate.length} up to date` +
        (report.errors.length > 0 ? `, ${report.errors.length} errors` : "") +
        "\n",
    );
  }

  return report;
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nl));
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

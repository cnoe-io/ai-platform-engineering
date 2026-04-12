/**
 * Command handlers for `caipe skills *` subcommands.
 */

import React from "react";
import { render } from "ink";
import { fetchCatalog, verifyChecksum } from "./catalog.js";
import { installSkill } from "./install.js";
import { scanInstalledSkills } from "./scan.js";
import { SkillsBrowser } from "./Browser.js";
import { renderMarkdown } from "../platform/markdown.js";

// ---------------------------------------------------------------------------
// skills list
// ---------------------------------------------------------------------------

export async function runSkillsList(opts: {
  tag?: string;
  installed?: boolean;
  json?: boolean;
}): Promise<void> {
  const catalog = await fetchCatalog();
  const cwd = process.cwd();
  const installedSkills = scanInstalledSkills(cwd);
  const installedNames = new Set(installedSkills.map((s) => s.name));

  let list = catalog.skills;
  if (opts.tag) {
    list = list.filter((s) => s.tags.includes(opts.tag!));
  }
  if (opts.installed) {
    list = list.filter((s) => installedNames.has(s.name));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(list, null, 2) + "\n");
    return;
  }

  if (!process.stdout.isTTY) {
    // Non-interactive: print plain text table
    for (const skill of list) {
      const mark = installedNames.has(skill.name) ? "✓" : " ";
      process.stdout.write(
        `${mark} ${skill.name.padEnd(30)} v${skill.version.padEnd(8)} ${skill.description}\n`,
      );
    }
    return;
  }

  // Interactive Ink browser
  render(
    React.createElement(SkillsBrowser, {
      tagFilter: opts.tag,
      showInstalled: opts.installed ?? false,
      installedNames,
      onInstall: async (name) => {
        await installSkill(name, {});
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// skills preview
// ---------------------------------------------------------------------------

export async function runSkillsPreview(name: string): Promise<void> {
  const catalog = await fetchCatalog();
  const entry = catalog.skills.find((s) => s.name === name);
  if (!entry) {
    process.stderr.write(`[ERROR] Skill "${name}" not found in catalog.\n`);
    process.exit(1);
  }

  const res = await fetch(entry.url);
  if (!res.ok) {
    process.stderr.write(`[ERROR] Could not fetch skill content: HTTP ${res.status}\n`);
    process.exit(2);
  }

  const content = await res.text();
  process.stdout.write(renderMarkdown(content));
}

// ---------------------------------------------------------------------------
// skills install
// ---------------------------------------------------------------------------

export async function runSkillsInstall(
  name: string,
  opts: { global?: boolean; target?: string; force?: boolean },
): Promise<void> {
  await installSkill(name, opts);
}

// ---------------------------------------------------------------------------
// skills update
// ---------------------------------------------------------------------------

export async function runSkillsUpdate(
  name: string | undefined,
  opts: { all?: boolean; dryRun?: boolean },
): Promise<void> {
  const { runSkillsUpdateCore } = await import("./update.js");
  await runSkillsUpdateCore(name, opts);
}

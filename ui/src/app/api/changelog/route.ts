import fs from "fs";
import { NextResponse } from "next/server";
import path from "path";

export const dynamic = "force-dynamic";

const CHANGELOG_URL =
  "https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/CHANGELOG.md";
const STABLE_RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface ChangelogItem {
  text: string;
  scope: string | null;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  sections: { type: string; items: ChangelogItem[] }[];
}

function extractScope(text: string): { scope: string | null; text: string } {
  const match = text.match(/^\*\*([a-zA-Z0-9_/.-]+)\*\*:\s*/);
  if (match) {
    return { scope: match[1].toLowerCase(), text };
  }
  return { scope: null, text };
}

function collectScopes(releases: ChangelogRelease[]): string[] {
  const scopeSet = new Set<string>();
  for (const release of releases) {
    for (const section of release.sections) {
      for (const item of section.items) {
        if (item.scope) scopeSet.add(item.scope);
      }
    }
  }
  return Array.from(scopeSet).sort();
}

function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  const lines = markdown.split("\n");

  let currentRelease: ChangelogRelease | null = null;
  let currentSection: { type: string; items: ChangelogItem[] } | null = null;

  for (const line of lines) {
    const versionMatch = line.match(
      /^## v?(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.]+)*)\s*\((\d{4}-\d{2}-\d{2})\)/
    );
    if (versionMatch) {
      const [, version, date] = versionMatch;
      if (currentRelease) {
        if (currentSection && currentSection.items.length > 0) {
          currentRelease.sections.push(currentSection);
        }
        releases.push(currentRelease);
      }
      currentRelease = { version, date, sections: [] };
      currentSection = null;
      continue;
    }

    if (!currentRelease) continue;

    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) {
      if (currentSection && currentSection.items.length > 0) {
        currentRelease.sections.push(currentSection);
      }
      currentSection = { type: sectionMatch[1].trim(), items: [] };
      continue;
    }

    const itemMatch = line.match(/^- (.+)/);
    if (itemMatch && currentSection) {
      const { scope, text } = extractScope(itemMatch[1].trim());
      currentSection.items.push({ text, scope });
    }
  }

  if (currentRelease) {
    if (currentSection && currentSection.items.length > 0) {
      currentRelease.sections.push(currentSection);
    }
    releases.push(currentRelease);
  }

  return releases;
}

async function fetchChangelogContent(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(CHANGELOG_URL, {
      signal: controller.signal,
      headers: { Accept: "text/plain" },
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (response.ok) {
      return await response.text();
    }
  } catch (err) {
    console.warn("[Changelog API] GitHub fetch failed, trying local fallback:", err);
  }

  const localPaths = [
    path.join(process.cwd(), "..", "CHANGELOG.md"),
    path.join(process.cwd(), "CHANGELOG.md"),
  ];
  for (const p of localPaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf-8");
    }
  }

  return null;
}

export async function GET() {
  try {
    const markdown = await fetchChangelogContent();

    if (!markdown) {
      return NextResponse.json(
        { error: "Failed to fetch changelog", releases: [], scopes: [] },
        { status: 502 }
      );
    }

    const allReleases = parseChangelog(markdown);

    // assisted-by Codex Codex-sonnet-4-6
    const stableReleases = allReleases.filter((r) => STABLE_RELEASE_VERSION_PATTERN.test(r.version));
    const scopes = collectScopes(stableReleases);

    return NextResponse.json({ releases: stableReleases, scopes });
  } catch (error) {
    console.error("[Changelog API] Error fetching changelog:", error);
    return NextResponse.json(
      { error: "Failed to fetch changelog", releases: [], scopes: [] },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const CHANGELOG_URL =
  "https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/CHANGELOG.md";

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

function parseChangelog(markdown: string): { releases: ChangelogRelease[]; scopes: string[] } {
  const releases: ChangelogRelease[] = [];
  const scopeSet = new Set<string>();
  const lines = markdown.split("\n");

  let currentRelease: ChangelogRelease | null = null;
  let currentSection: { type: string; items: ChangelogItem[] } | null = null;

  for (const line of lines) {
    const versionMatch = line.match(
      /^## (\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\s*\((\d{4}-\d{2}-\d{2})\)/
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
      if (scope) scopeSet.add(scope);
      currentSection.items.push({ text, scope });
    }
  }

  if (currentRelease) {
    if (currentSection && currentSection.items.length > 0) {
      currentRelease.sections.push(currentSection);
    }
    releases.push(currentRelease);
  }

  const scopes = Array.from(scopeSet).sort();
  return { releases, scopes };
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

    const { releases: allReleases, scopes } = parseChangelog(markdown);

    const stableReleases = allReleases.filter(
      (r) => !r.version.includes("rc") && !r.version.includes("alpha") && !r.version.includes("beta")
    );

    return NextResponse.json({ releases: stableReleases, scopes });
  } catch (error) {
    console.error("[Changelog API] Error fetching changelog:", error);
    return NextResponse.json(
      { error: "Failed to fetch changelog", releases: [], scopes: [] },
      { status: 500 }
    );
  }
}

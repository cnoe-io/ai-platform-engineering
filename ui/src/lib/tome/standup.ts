import { parseFrontmatter } from "@/lib/tome/schema";

export interface StandupSections {
  whatIsThis: string;
  headline: string;
  blockers: string;
  upNext: string;
  fallback: string;
}

type StandupSectionKey = "whatIsThis" | "headline" | "blockers" | "upNext";

const SECTION_ALIASES: Record<string, StandupSectionKey> = {
  "what is this": "whatIsThis",
  headline: "headline",
  "asks / blockers": "blockers",
  "asks/blockers": "blockers",
  blockers: "blockers",
  "up next": "upNext",
};

function sectionKey(label: string): StandupSectionKey | undefined {
  const normalized = label
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
  return SECTION_ALIASES[normalized];
}

export function parseStandup(markdown: string): StandupSections {
  const [, body] = parseFrontmatter(markdown);
  const normalizedBody = body.replace(
    /\*\*\s*(what is this|headline|asks\s*\/?\s*blockers|blockers|up next)\s*:?\s*\*\*/gi,
    (_match, label: string) => `\n## ${label}\n`,
  );
  const sections: Partial<Record<StandupSectionKey, string>> = {};
  const heading = /^#{2,3}\s+(.+?)\s*$/gm;
  const matches = [...normalizedBody.matchAll(heading)];
  for (let index = 0; index < matches.length; index++) {
    const key = sectionKey(matches[index][1]);
    if (!key) continue;
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index ?? normalizedBody.length
        : normalizedBody.length;
    sections[key] = normalizedBody.slice(start, end).trim();
  }
  const structured = Boolean(
    sections.whatIsThis || sections.headline || sections.blockers || sections.upNext,
  );
  return {
    whatIsThis: sections.whatIsThis ?? "",
    headline: sections.headline ?? "",
    blockers: sections.blockers ?? "",
    upNext: sections.upNext ?? "",
    fallback: structured ? "" : body.trim(),
  };
}

import type { AgenticAppManifest } from "@/types/agentic-app";

type SearchableAgenticApp = Pick<
  AgenticAppManifest,
  "id" | "displayName" | "description" | "access" | "catalog" | "agents"
> & { createdBy?: string };

export function filterAgenticApps<T extends SearchableAgenticApp>(
  apps: T[],
  query: string,
): T[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return apps;

  return apps.filter((app) => {
    const searchableText = normalize(
      [
        app.id,
        app.displayName,
        app.description,
        app.createdBy ?? "",
        ...(app.catalog?.categories ?? []),
        ...(app.catalog?.capabilities ?? []),
        ...app.access.tokenScopes,
        ...(app.agents ?? []).flatMap((agent) => [
          agent.id,
          agent.displayName,
          ...(agent.capabilities ?? []),
        ]),
      ].join(" "),
    );

    return terms.every((term) => searchableText.includes(term));
  });
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[-_:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

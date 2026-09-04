import { dataStewardLabel, type ProjectDocument } from "@/types/projects";

function searchableProjectText(project: ProjectDocument): string {
  const stewardValues =
    typeof project.data_steward === "string"
      ? [project.data_steward]
      : [
          dataStewardLabel(project.data_steward),
          project.data_steward?.email,
          project.data_steward?.id,
        ];
  const values = [
    project.title,
    project.name,
    project.slug,
    project.description,
    project.domain,
    project.team_name,
    ...stewardValues,
    ...(project.tags ?? []),
    project.labels?.domain,
    ...(project.labels?.initiatives ?? []),
    ...(project.labels?.areas ?? []),
    ...(project.sources?.repos ?? []),
    ...(project.sources?.github_repos ?? []).map((repo) => repo.full_name),
    ...(project.sources?.confluence_spaces ?? []).flatMap((space) => [
      space.name,
      space.slug,
      space.space_key,
    ]),
    ...(project.sources?.webex_rooms ?? []).flatMap((room) => [room.name, room.slug]),
  ];

  return values.filter(Boolean).join(" ").toLocaleLowerCase();
}

export function projectMatchesQuery(project: ProjectDocument, query: string): boolean {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return true;

  const haystack = searchableProjectText(project);
  return terms.every((term) => haystack.includes(term));
}

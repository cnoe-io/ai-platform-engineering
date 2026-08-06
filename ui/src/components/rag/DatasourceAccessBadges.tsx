import { Badge } from "@/components/ui/badge";
import { Search, User, Users } from "lucide-react";
import type { RagCollectionMembershipLabel } from "@/types/rag-collection";

interface DatasourceAccessBadgesProps {
  ownerTeamSlug?: string | null;
  ownerSubject?: string | null;
  ownerDisplayName?: string | null;
  searchTeamSlugs?: string[] | null;
  searchUserDisplayNames?: string[] | null;
  ragCollections?: RagCollectionMembershipLabel[] | null;
  detailsKnown: boolean;
  canReadContent?: boolean;
}

function normalizedTeams(teamSlugs?: string[] | null): string[] {
  return Array.from(
    new Set((teamSlugs ?? []).map((slug) => slug.trim()).filter(Boolean)),
  );
}

function compactList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "No access";
  return `${labels[0]} +${labels.length - 1}`;
}

export function DatasourceAccessBadges({
  ownerTeamSlug,
  ownerSubject,
  ownerDisplayName,
  searchTeamSlugs,
  searchUserDisplayNames,
  ragCollections,
  detailsKnown,
  canReadContent = false,
}: DatasourceAccessBadgesProps) {
  const ownerTeam = ownerTeamSlug?.trim();
  const searchTeams = normalizedTeams(searchTeamSlugs);
  const personal = !ownerTeam && Boolean(ownerSubject?.trim());
  const personalLabel = ownerDisplayName?.trim() || "Unknown user";
  const searchUsers = Array.from(
    new Set((searchUserDisplayNames ?? []).map((label) => label.trim()).filter(Boolean)),
  );
  const collectionLabels = (ragCollections ?? []).map((collection) => {
    const readers = normalizedTeams(collection.reader_team_slugs);
    return readers.length > 0
      ? `${collection.name} · ${readers.join(", ")}`
      : collection.name;
  });

  const ownerLabel = ownerTeam
    ? ownerTeam
    : personal
      ? personalLabel
      : detailsKnown
        ? "Unassigned"
        : "Restricted";
  const ownerTitle = ownerTeam
    ? `Management owner: ${ownerTeam}`
    : personal
      ? `Management owner: ${personalLabel}`
      : detailsKnown
        ? "No management owner is assigned"
        : "Management owner details are not available with your access";

  const searchLabels = [
    ...(personal ? [personalLabel] : []),
    ...searchTeams,
    ...searchUsers,
    ...collectionLabels,
  ];
  const searchLabel = searchLabels.length > 0
      ? compactList(searchLabels)
      : personal
        ? personalLabel
        : detailsKnown
          ? "No access"
          : canReadContent
            ? "Shared with you"
            : "Restricted";
  const searchTitle = searchLabels.length > 0
      ? `Search access: ${searchLabels.join(", ")}`
      : personal
        ? `Search access: ${personalLabel}`
        : detailsKnown
          ? "Search access: no one assigned"
          : canReadContent
            ? "Search access: this source is shared with you; policy details are restricted"
            : "Search access details are restricted";

  return (
    <>
      <Badge
        variant="outline"
        className="max-w-44 shrink-0 gap-1 border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-700 dark:text-blue-300"
        title={ownerTitle}
      >
        {personal ? <User className="h-3 w-3 shrink-0" /> : <Users className="h-3 w-3 shrink-0" />}
        <span className="truncate">Owner: {ownerLabel}</span>
      </Badge>
      <Badge
        variant="outline"
        className="max-w-52 shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
        title={searchTitle}
      >
        <Search className="h-3 w-3 shrink-0" />
        <span className="truncate">Search: {searchLabel}</span>
      </Badge>
    </>
  );
}

"use client";

import {
  Database,
  Layers3,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";

import {
  DatasourceOptionRow,
  datasourceKind,
  KnowledgeCardHand,
  knowledgeCardStats,
  startKnowledgeDrag,
  type KnowledgeCardItem,
  type KnowledgeDragCandidate,
} from "@/components/rag/KnowledgeCardSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TeamMultiPicker,
  type TeamPickerOption,
} from "@/components/ui/team-picker";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { RagCollectionWithPermissions } from "@/types/rag-collection";

interface DatasourceOption {
  datasource_id: string;
  name: string;
  source_type?: string;
  document_count?: number;
  chunk_count?: number;
  can_manage?: boolean;
  can_read?: boolean;
}

interface TeamRow {
  _id?: string;
  slug?: string;
  name?: string;
}

/** Manage reusable RAG collections without moving or duplicating indexed data. */
export function RagCollectionsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [collections, setCollections] = React.useState<
    RagCollectionWithPermissions[]
  >([]);
  const [datasources, setDatasources] = React.useState<DatasourceOption[]>([]);
  const [teams, setTeams] = React.useState<TeamRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createDescription, setCreateDescription] = React.useState("");
  const [sourceSearch, setSourceSearch] = React.useState("");
  const [dragCandidate, setDragCandidate] =
    React.useState<KnowledgeDragCandidate | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    searchParams.get("collection"),
  );
  const [draftName, setDraftName] = React.useState("");
  const [draftDescription, setDraftDescription] = React.useState("");
  const [draftSources, setDraftSources] = React.useState<string[]>([]);
  const [draftMaintainers, setDraftMaintainers] = React.useState<string[]>([]);
  const [draftReaders, setDraftReaders] = React.useState<string[]>([]);

  const selected = collections.find((item) => item._id === selectedId) ?? null;
  // User-created collections retain their personal owner as a reader even
  // after team delegation, so additions must not elevate that owner's access.
  const selectedHasPersonalOwner = Boolean(selected?.owner_subject);

  const replaceCollectionUrl = React.useCallback(
    (id: string | null): void => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("collection", id);
      else params.delete("collection");
      const query = params.toString();
      router.replace(
        `/knowledge-bases/collections${query ? `?${query}` : ""}`,
        { scroll: false },
      );
    },
    [router, searchParams],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [collectionResponse, datasourceResponse, teamResponse] =
        await Promise.all([
          fetch("/api/rag/collections").then((response) => response.json()),
          fetch("/api/dynamic-agents/datasources?purpose=publish").then(
            (response) => response.json(),
          ),
          fetch("/api/dynamic-agents/teams").then((response) =>
            response.json(),
          ),
        ]);
      if (!collectionResponse?.success) {
        throw new Error(
          collectionResponse?.error || "Could not load knowledge bases",
        );
      }
      const nextCollections = (collectionResponse.data?.collections ??
        []) as RagCollectionWithPermissions[];
      setCollections(nextCollections);
      setDatasources(
        datasourceResponse?.success &&
          Array.isArray(datasourceResponse.data?.datasources)
          ? datasourceResponse.data.datasources
          : [],
      );
      setTeams(
        teamResponse?.success && Array.isArray(teamResponse.data)
          ? teamResponse.data
          : [],
      );
      setSelectedId((current) =>
        current && nextCollections.some((item) => item._id === current)
          ? current
          : null,
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "Could not load knowledge bases",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (loading) return;
    const requestedId = searchParams.get("collection");
    if (
      requestedId &&
      !collections.some((collection) => collection._id === requestedId)
    ) {
      replaceCollectionUrl(null);
    }
  }, [collections, loading, replaceCollectionUrl, searchParams]);

  React.useEffect(() => {
    if (!selected) return;
    setDraftName(selected.name);
    setDraftDescription(selected.description ?? "");
    setDraftSources(selected.source_ids ?? []);
    setDraftMaintainers(selected.maintainer_team_slugs ?? []);
    setDraftReaders(selected.reader_team_slugs ?? []);
  }, [selected]);

  function selectCollection(id: string): void {
    setSelectedId(id);
    replaceCollectionUrl(id);
  }

  async function createCollection(): Promise<void> {
    if (!createName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/rag/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Could not create knowledge base");
      }
      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
      await load();
      selectCollection(result.data._id);
      toast("Knowledge base created", "success");
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "Could not create knowledge base",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCollection(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { source_ids: draftSources };
      if (selected._permissions.can_manage) {
        body.name = draftName;
        body.description = draftDescription;
      }
      if (selected._permissions.can_delegate) {
        body.maintainer_team_slugs = draftMaintainers;
        body.reader_team_slugs = draftReaders;
      }
      const response = await fetch(
        `/api/rag/collections/${encodeURIComponent(selected._id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Could not update knowledge base");
      }
      await load();
      toast("Knowledge base updated", "success");
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "Could not update knowledge base",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteCollection(): Promise<void> {
    if (!selected || selected.is_platform) return;
    if (
      !window.confirm(
        `Delete “${selected.name}”? Datasources and indexed data are not deleted.`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/rag/collections/${encodeURIComponent(selected._id)}`,
        {
          method: "DELETE",
        },
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Could not delete knowledge base");
      }
      setSelectedId(null);
      replaceCollectionUrl(null);
      await load();
      toast(
        "Collection deleted. Datasources and indexed content remain unchanged.",
        "success",
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "Could not delete knowledge base",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  const teamOptions = teams
    .filter((team): team is TeamRow & { slug: string } => Boolean(team.slug))
    .map<TeamPickerOption>((team) => ({
      slug: team.slug,
      name: team.name ?? team.slug,
      _id: team._id,
    }));
  const datasourceById = new Map(
    datasources.map((item) => [item.datasource_id, item]),
  );
  const selectedSourceCards: KnowledgeCardItem[] = draftSources.map((id) => {
    const datasource = datasourceById.get(id);
    return {
      id,
      name: datasource?.name ?? id,
      kind: "datasource",
      datasourceKind: datasourceKind(datasource?.source_type, id),
      stats: knowledgeCardStats(
        datasource?.document_count,
        datasource?.chunk_count,
      ),
      subtitle: "Collection datasource",
    };
  });
  const filteredDatasources = datasources.filter((datasource) => {
    if (draftSources.includes(datasource.datasource_id)) return false;
    if (datasource.can_manage !== true) return false;
    const query = sourceSearch.trim().toLowerCase();
    if (!query) return true;
    return datasource.name.toLowerCase().includes(query);
  });

  function canAddDatasource(datasource: DatasourceOption | undefined): boolean {
    return Boolean(
      datasource?.can_manage === true &&
        (!selectedHasPersonalOwner || datasource.can_read === true),
    );
  }

  function addDatasourceToDraft(datasourceId: string): void {
    if (
      !selected?._permissions.can_publish ||
      saving ||
      draftSources.includes(datasourceId) ||
      !canAddDatasource(datasourceById.get(datasourceId))
    ) {
      return;
    }
    setDraftSources((current) => [...current, datasourceId]);
  }

  if (loading && collections.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading knowledge bases...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">RAG Collections</h1>
          <p className="text-sm text-muted-foreground">
            Group indexed datasources once, attach them to agents, and maintain
            membership centrally.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Collection
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_1fr]">
        <div className="space-y-2 overflow-y-auto border-r p-4">
          {collections.map((collection) => (
            <button
              type="button"
              key={collection._id}
              onClick={() => selectCollection(collection._id)}
              className={cn(
                "w-full rounded-xl border p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]",
                selectedId === collection._id &&
                  "border-primary/50 bg-primary/[0.06]",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/15 p-2 text-primary">
                  <Layers3 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{collection.name}</p>
                    {collection.is_platform && (
                      <Badge variant="secondary">Default</Badge>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {collection.description ||
                      "A maintained set of RAG datasources"}
                  </p>
                  <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Database className="h-3.5 w-3.5" />{" "}
                      {collection.source_ids.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />{" "}
                      {collection.reader_team_slugs.length}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
          {collections.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Create a personal collection, then add datasources you manage.
            </div>
          )}
        </div>

        <div className="overflow-y-auto p-6">
          {selected ? (
            <div className="mx-auto max-w-4xl space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers3 className="h-5 w-5 text-primary" />
                    Collection settings
                  </CardTitle>
                  <CardDescription>
                    Collections group datasources so they can be assigned and
                    managed together.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="collection-name">Name</Label>
                    <Input
                      id="collection-name"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      disabled={!selected._permissions.can_manage || saving}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="collection-description">Description</Label>
                    <Textarea
                      id="collection-description"
                      value={draftDescription}
                      onChange={(event) =>
                        setDraftDescription(event.target.value)
                      }
                      disabled={!selected._permissions.can_manage || saving}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-cyan-500" /> Datasources
                  </CardTitle>
                  <CardDescription>
                    Adding requires management access to the datasource.
                    Personally owned collections also require existing search
                    access, so membership never creates access the owner did not
                    already have. Removing a source never deletes indexed data.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <KnowledgeCardHand
                    items={selectedSourceCards}
                    onRemove={(card) =>
                      setDraftSources((current) =>
                        current.filter((id) => id !== card.id),
                      )
                    }
                    disabled={!selected._permissions.can_publish || saving}
                    dragCandidate={dragCandidate}
                    onDropCandidate={(candidate) => {
                      if (candidate.kind === "datasource") {
                        addDatasourceToDraft(candidate.id);
                      }
                      setDragCandidate(null);
                    }}
                    ariaLabel="Selected collection datasources"
                    emptyTitle="Drop a datasource here."
                    emptyDescription="This collection does not contain any datasources yet."
                  />
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={sourceSearch}
                      onChange={(event) => setSourceSearch(event.target.value)}
                      placeholder="Search datasources..."
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2">
                    {filteredDatasources.map((datasource) => {
                      const canManage = datasource?.can_manage === true;
                      const canAdd = canAddDatasource(datasource);
                      const disabled =
                        !selected._permissions.can_publish || saving || !canAdd;
                      return (
                        <DatasourceOptionRow
                          key={datasource.datasource_id}
                          datasourceId={datasource.datasource_id}
                          name={datasource.name}
                          sourceType={datasource.source_type}
                          disabled={disabled}
                          title={
                            !canAdd
                              ? !canManage
                                ? "You must manage this datasource before publishing it"
                                : "A personal collection can only include datasources you can already search"
                              : undefined
                          }
                          onDragStart={(event) => {
                            const candidate: KnowledgeDragCandidate = {
                              kind: "datasource",
                              id: datasource.datasource_id,
                            };
                            setDragCandidate(candidate);
                            startKnowledgeDrag(event, candidate);
                          }}
                          onDragEnd={() => setDragCandidate(null)}
                          onClick={() =>
                            addDatasourceToDraft(datasource.datasource_id)
                          }
                        />
                      );
                    })}
                    {filteredDatasources.length === 0 && (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {sourceSearch.trim()
                          ? "No available datasources match this search."
                          : "All available datasources are already in this collection."}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {selected._permissions.can_delegate && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-emerald-500" />{" "}
                      Delegation
                    </CardTitle>
                    <CardDescription>
                      Maintainers can publish sources; their team admins can
                      manage settings. Reader teams receive member-datasource
                      access and the platform search capability, so they can
                      query through search, API, and agents.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Maintainer teams</Label>
                      <TeamMultiPicker
                        options={teamOptions}
                        selected={draftMaintainers}
                        onChange={setDraftMaintainers}
                        placeholder="Select maintainers..."
                        portalled={false}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Reader teams</Label>
                      <TeamMultiPicker
                        options={teamOptions}
                        selected={draftReaders}
                        onChange={setDraftReaders}
                        placeholder="Select readers..."
                        portalled={false}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center justify-between">
                <div>
                  {!selected.is_platform &&
                    selected._permissions.can_manage && (
                      <Button
                        variant="ghost"
                        className="gap-2 text-destructive hover:text-destructive"
                        onClick={deleteCollection}
                        disabled={saving}
                      >
                        <Trash2 className="h-4 w-4" /> Delete collection
                      </Button>
                    )}
                </div>
                {(selected._permissions.can_publish ||
                  selected._permissions.can_manage) && (
                  <Button
                    className="gap-2"
                    onClick={saveCollection}
                    disabled={saving || !draftName.trim()}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save collection
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select or create a RAG collection.
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a RAG collection</DialogTitle>
            <DialogDescription>
              Create a private collection from datasources you manage. An
              administrator can later give teams permission to manage the
              collection or search its content.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-collection-name">Name</Label>
              <Input
                id="new-collection-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-collection-description">Description</Label>
              <Textarea
                id="new-collection-description"
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={createCollection}
              disabled={saving || !createName.trim()}
            >
              Create collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

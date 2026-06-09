"use client";

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AlertCircle,CheckCircle2,GripVertical,Loader2,Plus } from "lucide-react";
import { useEffect,useMemo,useState,type DragEvent } from "react";

interface BaselineGrantDefinition {
  id: string;
  label: string;
  description: string;
}

type BaselineProfileRole = "member" | "admin";

interface BaselineProfileDefinition {
  id: string;
  name: string;
  description?: string;
  role: BaselineProfileRole;
  grants: string[];
  built_in?: boolean;
}

interface BaselineProfileBundle {
  profiles: BaselineProfileDefinition[];
  global_member_profile_id: string;
  global_admin_profile_id: string;
  source?: "default" | "mongo";
}

interface TeamAssignment {
  team_id: string;
  team_slug: string;
  team_name?: string;
  member_profile_id?: string;
  admin_profile_id?: string;
}

interface BaselineProfileResponse {
  bundle?: BaselineProfileBundle;
  profile?: {
    member_grants: string[];
    admin_grants: string[];
    source?: "default" | "mongo";
  };
  available_grants: {
    member: BaselineGrantDefinition[];
    admin: BaselineGrantDefinition[];
  };
  team_assignments?: TeamAssignment[];
  reconciliation?: {
    mode: "none" | "user" | "all";
    user_count: number;
    writes: number;
    deletes: number;
  };
}

interface FgaCatalogResourceType {
  type: string;
  actions?: readonly string[];
  description?: string;
}

interface FgaCatalogResource {
  type?: string;
  id?: string;
  display_name?: string;
  name?: string;
  object?: string;
  description?: string;
}

interface FgaCatalogResponse {
  resource_types?: FgaCatalogResourceType[];
  actions?: Record<string, readonly string[]>;
  resources?: {
    agents?: FgaCatalogResource[];
    tools?: FgaCatalogResource[];
    knowledge_bases?: FgaCatalogResource[];
    by_type?: Record<string, FgaCatalogResource[]>;
  };
  universal_resources?: FgaCatalogResource[];
}

interface OpenFgaTupleKey {
  user: string;
  relation: string;
  object: string;
}

interface OpenFgaTupleEntry {
  key: OpenFgaTupleKey;
  timestamp?: string;
}

interface OpenFgaTuplesResponse {
  tuples?: OpenFgaTupleEntry[];
  continuation_token?: string;
}

const ORG_MEMBER_PROFILE_ID = "org-member";
const ORG_ADMIN_PROFILE_ID = "org-admin";
const TUPLE_PAGE_SIZE = 200;
const MAX_TUPLE_PAGES = 25;

function apiData<T>(payload: unknown): T {
  const value = payload as { data?: T };
  return value.data as T;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function objectType(object: string): string {
  return object.split(":", 1)[0] || "unknown";
}

function catalogResources(catalog: FgaCatalogResponse | null): FgaCatalogResource[] {
  if (!catalog) return [];
  if (catalog.universal_resources?.length) return catalog.universal_resources;

  const resources: FgaCatalogResource[] = [];
  if (catalog.resources?.agents) resources.push(...catalog.resources.agents);
  if (catalog.resources?.tools) resources.push(...catalog.resources.tools);
  if (catalog.resources?.knowledge_bases) resources.push(...catalog.resources.knowledge_bases);
  for (const typedResources of Object.values(catalog.resources?.by_type ?? {})) {
    resources.push(...typedResources);
  }
  return resources;
}

function actionCount(catalog: FgaCatalogResponse | null): number {
  if (!catalog) return 0;
  const fromActions = Object.values(catalog.actions ?? {}).reduce((sum, actions) => sum + actions.length, 0);
  if (fromActions > 0) return fromActions;
  return (catalog.resource_types ?? []).reduce((sum, resourceType) => sum + (resourceType.actions?.length ?? 0), 0);
}

function resourceTypeActions(catalog: FgaCatalogResponse, resourceType: FgaCatalogResourceType): readonly string[] {
  return catalog.actions?.[resourceType.type] ?? resourceType.actions ?? [];
}

function relationshipFamilies(tuples: OpenFgaTupleEntry[]): Array<{ type: string; relations: string[]; count: number }> {
  const byType = new Map<string, { relations: Set<string>; count: number }>();
  for (const tuple of tuples) {
    const type = objectType(tuple.key.object);
    const current = byType.get(type) ?? { relations: new Set<string>(), count: 0 };
    current.relations.add(tuple.key.relation);
    current.count += 1;
    byType.set(type, current);
  }
  return Array.from(byType.entries())
    .map(([type, value]) => ({
      type,
      relations: Array.from(value.relations).sort(),
      count: value.count,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function formatCatalogResource(resource: FgaCatalogResource): string {
  if (resource.display_name) return resource.display_name;
  if (resource.name) return resource.name;
  if (resource.object) return resource.object;
  if (resource.type && resource.id) return `${resource.type}:${resource.id}`;
  return resource.id ?? "unknown resource";
}

async function fetchAllOpenFgaTuples(): Promise<{ tuples: OpenFgaTupleEntry[]; truncated: boolean }> {
  const tuples: OpenFgaTupleEntry[] = [];
  let continuationToken: string | undefined;
  let page = 0;

  do {
    const params = new URLSearchParams({ limit: String(TUPLE_PAGE_SIZE) });
    if (continuationToken) params.set("continuation_token", continuationToken);
    const response = await fetch(`/api/admin/openfga/tuples?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `OpenFGA tuples failed: ${response.status}`);
    const data = apiData<OpenFgaTuplesResponse>(payload);
    tuples.push(...(data.tuples ?? []));
    continuationToken = data.continuation_token;
    page += 1;
  } while (continuationToken && page < MAX_TUPLE_PAGES);

  return { tuples, truncated: Boolean(continuationToken) };
}

function bundleFromResponse(data: BaselineProfileResponse): BaselineProfileBundle {
  if (data.bundle) return data.bundle;
  return {
    profiles: [
      {
        id: ORG_MEMBER_PROFILE_ID,
        name: "Organization member",
        role: "member",
        grants: data.profile?.member_grants ?? [],
        built_in: true,
      },
      {
        id: ORG_ADMIN_PROFILE_ID,
        name: "Organization admin",
        role: "admin",
        grants: data.profile?.admin_grants ?? [],
        built_in: true,
      },
    ],
    global_member_profile_id: ORG_MEMBER_PROFILE_ID,
    global_admin_profile_id: ORG_ADMIN_PROFILE_ID,
    source: data.profile?.source,
  };
}

export function BaselineFgaProfilePanel({ isAdmin }: { isAdmin: boolean }) {
  const [bundle, setBundle] = useState<BaselineProfileBundle | null>(null);
  const [memberGrants, setMemberGrants] = useState<BaselineGrantDefinition[]>([]);
  const [adminGrants, setAdminGrants] = useState<BaselineGrantDefinition[]>([]);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState(ORG_MEMBER_PROFILE_ID);
  const [applyAll, setApplyAll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Snapshot of the last-saved editable state so the Save button only enables
  // once the profiles or team assignments actually change.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");

  const snapshotOf = (
    nextBundle: BaselineProfileBundle | null,
    assignments: TeamAssignment[],
  ): string =>
    JSON.stringify({
      profiles: nextBundle?.profiles ?? [],
      global_member_profile_id: nextBundle?.global_member_profile_id ?? null,
      global_admin_profile_id: nextBundle?.global_admin_profile_id ?? null,
      team_assignments: assignments,
    });

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/openfga/baseline-profile");
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Baseline profile failed: ${response.status}`);
        const data = apiData<BaselineProfileResponse>(payload);
        const nextBundle = bundleFromResponse(data);
        if (cancelled) return;
        setBundle(nextBundle);
        setMemberGrants(data.available_grants.member);
        setAdminGrants(data.available_grants.admin);
        setTeamAssignments(data.team_assignments ?? []);
        setSavedSnapshot(snapshotOf(nextBundle, data.team_assignments ?? []));
        setSelectedProfileId(nextBundle.global_member_profile_id || nextBundle.profiles[0]?.id || ORG_MEMBER_PROFILE_ID);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load baseline profiles");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProfile = useMemo(
    () => bundle?.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [bundle, selectedProfileId],
  );
  const grantsForSelectedRole = selectedProfile?.role === "admin" ? adminGrants : memberGrants;
  const selectedGrantIds = new Set(selectedProfile?.grants ?? []);
  const currentGrants = grantsForSelectedRole.filter((grant) => selectedGrantIds.has(grant.id));
  const availableGrants = grantsForSelectedRole.filter((grant) => !selectedGrantIds.has(grant.id));
  const memberProfiles = bundle?.profiles.filter((profile) => profile.role === "member") ?? [];
  const adminProfiles = bundle?.profiles.filter((profile) => profile.role === "admin") ?? [];
  const dirty = Boolean(bundle) && snapshotOf(bundle, teamAssignments) !== savedSnapshot;

  function updateProfile(profileId: string, update: (profile: BaselineProfileDefinition) => BaselineProfileDefinition) {
    setBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        profiles: current.profiles.map((profile) => (profile.id === profileId ? update(profile) : profile)),
      };
    });
    setMessage(null);
  }

  function addGrant(grantId: string) {
    if (!selectedProfile || !isAdmin) return;
    updateProfile(selectedProfile.id, (profile) => ({
      ...profile,
      grants: uniqueValues([...profile.grants, grantId]),
    }));
  }

  function removeGrant(grantId: string) {
    if (!selectedProfile || !isAdmin) return;
    updateProfile(selectedProfile.id, (profile) => ({
      ...profile,
      grants: profile.grants.filter((id) => id !== grantId),
    }));
  }

  function createCustomProfile() {
    if (!bundle || !selectedProfile || !isAdmin) return;
    const baseId = `custom-${selectedProfile.role}`;
    const id = `${baseId}-${bundle.profiles.filter((profile) => profile.id.startsWith(baseId)).length + 1}`;
    const profile: BaselineProfileDefinition = {
      id,
      name: selectedProfile.role === "member" ? "Custom member profile" : "Custom admin profile",
      description: "Custom baseline profile override.",
      role: selectedProfile.role,
      grants: [...selectedProfile.grants],
      built_in: false,
    };
    setBundle({ ...bundle, profiles: [...bundle.profiles, profile] });
    setSelectedProfileId(id);
    setMessage(null);
  }

  function updateTeamAssignment(teamId: string, key: "member_profile_id" | "admin_profile_id", value: string) {
    setTeamAssignments((current) =>
      current.map((assignment) =>
        assignment.team_id === teamId ? { ...assignment, [key]: value || undefined } : assignment,
      ),
    );
    setMessage(null);
  }

  async function saveProfile() {
    if (!bundle || !isAdmin) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/openfga/baseline-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundle: {
            profiles: bundle.profiles,
            global_member_profile_id: bundle.global_member_profile_id,
            global_admin_profile_id: bundle.global_admin_profile_id,
          },
          team_assignments: teamAssignments,
          apply: { mode: applyAll ? "all" : "none" },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Baseline profile save failed: ${response.status}`);
      const data = apiData<BaselineProfileResponse>(payload);
      const nextBundle = bundleFromResponse(data);
      const nextAssignments = data.team_assignments ?? teamAssignments;
      setBundle(nextBundle);
      setTeamAssignments(nextAssignments);
      setSavedSnapshot(snapshotOf(nextBundle, nextAssignments));
      if (data.available_grants.member.length > 0) setMemberGrants(data.available_grants.member);
      if (data.available_grants.admin.length > 0) setAdminGrants(data.available_grants.admin);
      if (data.reconciliation?.mode === "all") {
        setMessage(
          `Applied to ${data.reconciliation.user_count} user(s): ${data.reconciliation.writes} writes, ${data.reconciliation.deletes} deletes.`,
        );
      } else {
        setMessage("Baseline profiles saved. New logins will use these profiles.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save baseline profiles");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Default OpenFGA Grants Applied on Login</CardTitle>
              <CardDescription>
                These profiles are templates that materialize concrete OpenFGA tuples during login or reconciliation.
              </CardDescription>
            </div>
            {bundle?.source && (
              <Badge variant="outline">{bundle.source === "mongo" ? "Saved profiles" : "Default profiles"}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading default grant profiles...
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              {error}
            </div>
          )}
          {message && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
              {message}
            </div>
          )}
          {bundle && selectedProfile && (
            <>
              <div className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <Label htmlFor="baseline-profile-select">Default grant profile</Label>
                  <select
                    id="baseline-profile-select"
                    aria-label="Default grant profile"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedProfileId}
                    disabled={!isAdmin}
                    onChange={(event) => setSelectedProfileId(event.target.value)}
                  >
                    {bundle.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.role})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Editing {selectedProfile.name}. Team assignments override the global default grant profile for matching users.
                  </p>
                </div>
                <Button type="button" variant="outline" className="gap-2" disabled={!isAdmin} onClick={createCustomProfile}>
                  <Plus className="h-4 w-4" />
                  New custom profile
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <GrantColumn
                  title="Not included in selected default profile"
                  description="Drag right or use Add to include these grants."
                  grants={availableGrants}
                  actionLabel="Add"
                  disabled={!isAdmin}
                  dropLabel="available"
                  onMove={addGrant}
                  onDropGrant={removeGrant}
                />
                <GrantColumn
                  title="Included in selected default profile"
                  description="Drag left or use Remove to exclude these grants."
                  grants={currentGrants}
                  actionLabel="Remove"
                  disabled={!isAdmin}
                  dropLabel="current"
                  onMove={removeGrant}
                  onDropGrant={addGrant}
                />
              </div>

              <TeamOverrideAssignments
                assignments={teamAssignments}
                memberProfiles={memberProfiles}
                adminProfiles={adminProfiles}
                disabled={!isAdmin}
                onChange={updateTeamAssignment}
              />

              <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={applyAll}
                    disabled={!isAdmin || saving}
                    onChange={(event) => setApplyAll(event.target.checked)}
                  />
                  <span>
                  Apply default grant changes to all known users when saving
                    <span className="block text-xs text-muted-foreground">
                      Saving always affects future logins. This option also reconciles current user tuples immediately.
                    </span>
                  </span>
                </label>
                <SaveButton
                  onSave={saveProfile}
                  saving={saving}
                  dirty={dirty}
                  disabled={!isAdmin}
                  ariaLabel="Save default grant profiles"
                />
              </div>
              {!isAdmin && (
                <p className="text-sm text-muted-foreground">
                Only admins can update and reconcile default grant profiles.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <FgaCatalogPanel />
    </div>
  );
}

function FgaCatalogPanel() {
  const [catalog, setCatalog] = useState<FgaCatalogResponse | null>(null);
  const [tuples, setTuples] = useState<OpenFgaTupleEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setLoading(true);
      setError(null);
      try {
        const [catalogResponse, tupleResponse] = await Promise.all([
          fetch("/api/admin/openfga/catalog"),
          fetchAllOpenFgaTuples(),
        ]);
        const catalogPayload = await catalogResponse.json();
        if (!catalogResponse.ok) {
          throw new Error(catalogPayload.error || `OpenFGA catalog failed: ${catalogResponse.status}`);
        }
        if (cancelled) return;
        setCatalog(apiData<FgaCatalogResponse>(catalogPayload));
        setTuples(tupleResponse.tuples);
        setTruncated(tupleResponse.truncated);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the OpenFGA catalog");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const resources = catalogResources(catalog);
  const relationships = relationshipFamilies(tuples);
  const resourceTypes = catalog?.resource_types ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>OpenFGA Store: Catalog & Live Relationships</CardTitle>
            <CardDescription>
              This is the live authorization store, including relationships created by login defaults, team grants, and direct admin changes.
            </CardDescription>
          </div>
          <Badge variant="outline">Catalog view</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading FGA catalog...
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            {error}
          </div>
        )}
        {catalog && !loading && (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <FgaMetric label="resource types" value={resourceTypes.length} />
              <FgaMetric label="actions" value={actionCount(catalog)} />
              <FgaMetric label="catalog resources" value={resources.length} />
              <FgaMetric label={truncated ? "live tuples (partial)" : "live tuples"} value={tuples.length} />
            </div>
            {truncated && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                Tuple listing reached the UI safety limit of {MAX_TUPLE_PAGES * TUPLE_PAGE_SIZE} relationships. Narrow the
                tuple filters in OpenFGA Tuples for the remaining pages.
              </p>
            )}
            <div className="space-y-4">
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Authorization model and action checks</div>
                  <p className="text-xs text-muted-foreground">
                    These resource types define the complete action surface shown to access managers and policy reviewers.
                  </p>
                </div>
                <div data-testid="fga-resource-type-list" className="space-y-2">
                  {resourceTypes.map((resourceType) => (
                    <div key={resourceType.type} className="rounded-md border bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-sm font-semibold">{resourceType.type}</code>
                        {resourceTypeActions(catalog, resourceType).map((action) => (
                          <Badge key={action} variant="secondary">
                            {action}
                          </Badge>
                        ))}
                      </div>
                      {resourceType.description && (
                        <p className="mt-2 text-xs text-muted-foreground">{resourceType.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Observed relationship families</div>
                  <p className="text-xs text-muted-foreground">
                    Grouped from live OpenFGA tuples by object type and relation.
                  </p>
                </div>
                <div data-testid="fga-relationship-family-list" className="space-y-2">
                  {relationships.length === 0 ? (
                    <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      No OpenFGA tuples are currently materialized.
                    </p>
                  ) : (
                    relationships.map((relationship) => (
                      <div key={relationship.type} className="rounded-md border bg-muted/10 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <code className="text-sm font-semibold">{relationship.type}</code>
                          <Badge variant="outline">{relationship.count} tuple(s)</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {relationship.relations.map((relation) => (
                            <Badge key={relation} variant="secondary">
                              {relation}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Discovered resources</div>
                  <p className="text-xs text-muted-foreground">
                    Runtime catalog objects that can receive grants or be checked by the BFF.
                  </p>
                </div>
                <div data-testid="fga-discovered-resource-list" className="space-y-2">
                  {resources.length === 0 ? (
                    <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      No catalog resources discovered.
                    </p>
                  ) : (
                    resources.map((resource, index) => (
                      <div key={`${resource.type ?? "resource"}-${resource.id ?? resource.object ?? index}`} className="rounded-md border bg-muted/10 p-3">
                        <div className="text-sm font-medium">{formatCatalogResource(resource)}</div>
                        <code className="text-xs text-muted-foreground">
                          {resource.object ?? (resource.type && resource.id ? `${resource.type}:${resource.id}` : resource.id)}
                        </code>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Live relationships</div>
                  <p className="text-xs text-muted-foreground">
                    Every relationship loaded from OpenFGA through paginated tuple reads.
                  </p>
                </div>
                <div data-testid="fga-live-relationship-list" className="space-y-2">
                  {tuples.length === 0 ? (
                    <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      No live relationships to show.
                    </p>
                  ) : (
                    tuples.map((tuple, index) => (
                      <div key={`${tuple.key.user}-${tuple.key.relation}-${tuple.key.object}-${index}`} className="rounded-md border bg-muted/10 p-3">
                        <code className="block text-xs text-muted-foreground">{tuple.key.user}</code>
                        <div className="my-1 text-sm font-semibold">{tuple.key.relation}</div>
                        <code className="block text-xs text-muted-foreground">{tuple.key.object}</code>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FgaMetric({ label, value }: { label: string; value: number }) {
  const normalizedLabel = value === 1 ? label.replace(/s$/, "") : label;
  return (
    <div className="rounded-md border bg-muted/20 p-3" aria-label={`${value} ${normalizedLabel}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{normalizedLabel}</div>
    </div>
  );
}

function GrantColumn({
  title,
  description,
  grants,
  actionLabel,
  disabled,
  dropLabel,
  onMove,
  onDropGrant,
}: {
  title: string;
  description: string;
  grants: BaselineGrantDefinition[];
  actionLabel: string;
  disabled: boolean;
  dropLabel: string;
  onMove: (grantId: string) => void;
  onDropGrant: (grantId: string) => void;
}) {
  function onDragStart(event: DragEvent<HTMLDivElement>, grantId: string) {
    event.dataTransfer.setData("text/plain", grantId);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const grantId = event.dataTransfer.getData("text/plain");
    if (grantId) onDropGrant(grantId);
  }

  return (
    <div
      className="min-h-72 space-y-3 rounded-md border p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      aria-label={`${dropLabel} grant drop zone`}
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">
        {grants.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">No grants in this column.</p>
        ) : (
          grants.map((grant) => (
            <div
              key={grant.id}
              draggable={!disabled}
              onDragStart={(event) => onDragStart(event, grant.id)}
              className="rounded-md border bg-background p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    {grant.label}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{grant.description}</p>
                  <code className="mt-2 block text-xs text-muted-foreground">{grant.id}</code>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onMove(grant.id)}>
                  {actionLabel}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TeamOverrideAssignments({
  assignments,
  memberProfiles,
  adminProfiles,
  disabled,
  onChange,
}: {
  assignments: TeamAssignment[];
  memberProfiles: BaselineProfileDefinition[];
  adminProfiles: BaselineProfileDefinition[];
  disabled: boolean;
  onChange: (teamId: string, key: "member_profile_id" | "admin_profile_id", value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">Team profile overrides</div>
        <p className="text-xs text-muted-foreground">
          A selected team profile replaces the global baseline for users in that team.
        </p>
      </div>
      {assignments.length === 0 ? (
        <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">No teams found.</p>
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <div key={assignment.team_id} className="grid gap-3 rounded-md border bg-muted/10 p-3 md:grid-cols-[1fr_1fr_1fr]">
              <div>
                <div className="text-sm font-medium">{assignment.team_name || assignment.team_slug}</div>
                <code className="text-xs text-muted-foreground">team:{assignment.team_slug}</code>
              </div>
              <div>
                <Label htmlFor={`member-profile-${assignment.team_id}`}>Member profile for {assignment.team_name || assignment.team_slug}</Label>
                <select
                  id={`member-profile-${assignment.team_id}`}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={assignment.member_profile_id ?? ""}
                  disabled={disabled}
                  onChange={(event) => onChange(assignment.team_id, "member_profile_id", event.target.value)}
                >
                  <option value="">Use global member profile</option>
                  {memberProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`admin-profile-${assignment.team_id}`}>Admin profile for {assignment.team_name || assignment.team_slug}</Label>
                <select
                  id={`admin-profile-${assignment.team_id}`}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={assignment.admin_profile_id ?? ""}
                  disabled={disabled}
                  onChange={(event) => onChange(assignment.team_id, "admin_profile_id", event.target.value)}
                >
                  <option value="">Use global admin profile</option>
                  {adminProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

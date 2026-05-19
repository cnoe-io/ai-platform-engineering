"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Bot,
  Database,
  Hash,
  MessageSquare,
  Shield,
  CheckCircle2,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Trash2,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PolicyChangeSetDiff } from "./rebac/PolicyChangeSetDiff";
import { RebacAccessChecker } from "./rebac/RebacAccessChecker";
import { RebacGraphFilters, type RebacGraphUserOption } from "./rebac/RebacGraphFilters";
import type {
  UniversalRebacRelationship,
  UniversalRebacResourceAction,
  UniversalRebacResourceType,
  UniversalRebacResourceTypeDefinition,
  UniversalRebacSubjectRef,
  UniversalRebacSubjectType,
} from "@/types/rbac-universal";

type ResourceType = "agent" | "tool" | "knowledge_base";
type AccessResourceType = UniversalRebacResourceType;
type AccessSubjectType = Extract<
  UniversalRebacSubjectType,
  "team" | "user" | "slack_channel" | "webex_space" | "external_group" | "service_account"
>;
interface CatalogTeam {
  id: string;
  slug: string;
  name: string;
  members: Array<{ user_id: string; role: string }>;
  resources: Record<string, unknown>;
}

interface CatalogResource {
  id: string;
  name?: string;
  display_name?: string;
  description?: string;
  object?: string;
  type?: UniversalRebacResourceType;
  status?: string;
  enforcement_status?: string;
}

interface CatalogResponse {
  status: {
    configured: boolean;
    reconcile_enabled: boolean;
    store_name: string;
  };
  teams: CatalogTeam[];
  resource_types?: UniversalRebacResourceTypeDefinition[];
  actions?: Record<string, UniversalRebacResourceAction[]>;
  resources: {
    agents: CatalogResource[];
    tools: CatalogResource[];
    knowledge_bases: CatalogResource[];
    by_type?: Partial<Record<UniversalRebacResourceType, CatalogResource[]>>;
  };
  universal_resources?: CatalogResource[];
}

interface TupleKey {
  user: string;
  relation: string;
  object: string;
}

interface TupleRecord {
  key: TupleKey;
  timestamp?: string;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  kind?: "openfga" | "metadata";
  metadata?: {
    source_type: "slack_channel_team_mapping" | "webex_space_team_mapping";
    label: string;
    readonly: true;
  };
}

const RELATIONS_BY_TYPE: Record<ResourceType, string[]> = {
  agent: ["user", "manager"],
  tool: ["caller"],
  knowledge_base: ["reader", "ingestor", "manager"],
};

const RESOURCE_TYPES = new Set<ResourceType>(["agent", "tool", "knowledge_base"]);
const ALL_RELATIONSHIPS_SCOPE = "__all_relationships__";
const DEFAULT_OPENFGA_TAB = "tuples";
const OPENFGA_TABS = new Set(["tuples", "graph", "access"]);
const RELATION_TO_ACTION: Record<string, UniversalRebacResourceAction> = {
  user: "use",
  manager: "manage",
  caller: "call",
  reader: "read",
  ingestor: "ingest",
};
const ACTION_TO_CHECK_RELATION: Record<UniversalRebacResourceAction, string> = {
  discover: "can_discover",
  read: "can_read",
  use: "can_use",
  write: "can_write",
  create: "can_manage",
  delete: "can_delete",
  manage: "can_manage",
  administer: "can_admin",
  audit: "can_audit",
  approve: "can_approve",
  share: "can_share",
  call: "can_call",
  invoke: "can_invoke",
  map: "can_map",
  ingest: "can_ingest",
  "read-metadata": "can_read_metadata",
};

const ACCESS_RESOURCE_LABELS: Partial<Record<AccessResourceType, string>> = {
  organization: "Organization",
  user: "User",
  external_group: "External group",
  team: "Team",
  slack_workspace: "Slack workspace",
  slack_channel: "Slack channel",
  webex_workspace: "Webex workspace",
  webex_space: "Webex space",
  agent: "Agent",
  mcp_gateway: "AgentGateway",
  mcp_server: "MCP server",
  tool: "Tool",
  knowledge_base: "Knowledge base",
  document: "Document",
  skill: "Skill",
  task: "Task",
  conversation: "Conversation",
  admin_surface: "Admin surface",
  policy: "Policy",
  audit_log: "Audit log",
  secret_ref: "Secret reference",
  system_config: "System config",
};

const ACCESS_SUBJECT_LABELS: Record<AccessSubjectType, string> = {
  team: "Team",
  user: "User",
  slack_channel: "Slack channel",
  webex_space: "Webex space",
  external_group: "External group",
  service_account: "Service account",
};

const ACCESS_SUBJECT_TYPES: AccessSubjectType[] = [
  "team",
  "user",
  "slack_channel",
  "webex_space",
  "external_group",
  "service_account",
];

const BASE_RELATIONSHIP_CHEATSHEET = [
  {
    label: "Agent use",
    tuple: "team:<slug>#member user agent:<id>",
    meaning: "Team members can use or invoke agent.",
  },
  {
    label: "Agent manage",
    tuple: "team:<slug>#admin manager agent:<id>",
    meaning: "Team admins can edit, delete, and administer agent.",
  },
  {
    label: "Tool call",
    tuple: "agent:<id> caller tool:<server>/<tool>",
    meaning: "Agent may call that MCP tool through AgentGateway.",
  },
  {
    label: "Knowledge base read",
    tuple: "team:<slug>#member reader knowledge_base:<id>",
    meaning: "Team members can search/read that datasource.",
  },
  {
    label: "Knowledge base ingest",
    tuple: "team:<slug>#member ingestor knowledge_base:<id>",
    meaning: "Team members can ingest/update that datasource.",
  },
  {
    label: "Admin surface",
    tuple: "team:<slug>#member manager admin_surface:<name>",
    meaning: "Team can administer a protected UI surface.",
  },
] as const;

const DERIVED_PERMISSION_CHEATSHEET = [
  ["can_discover", "show in lists and pickers"],
  ["can_read", "read metadata or content"],
  ["can_use", "use or invoke agent"],
  ["can_write", "edit resource configuration"],
  ["can_delete", "remove lifecycle-managed resource"],
  ["can_manage", "administer resource"],
  ["can_call", "call MCP gateway/tool"],
] as const;

const SUBJECT_CHEATSHEET = [
  ["user:<sub>", "single Keycloak user"],
  ["user:*", "all authenticated users for typed-wildcard grants"],
  ["service_account:<id>", "machine principal"],
  ["team:<slug>", "team object for membership tuples"],
  ["team:<slug>#member", "all members of a team"],
  ["team:<slug>#admin", "team owners/admins"],
  ["external_group:<provider>/<id>#member", "synced IdP group members"],
  ["slack_channel:<workspace>--<channel>", "Slack channel route principal"],
  ["webex_space:<workspace>--<space>", "Webex space route principal"],
] as const;

const RESOURCE_OBJECT_CHEATSHEET = [
  ["organization:<org>", "platform-wide organization scope"],
  ["team:<slug>", "team membership container"],
  ["agent:<id>", "Dynamic Agent config/runtime target"],
  ["tool:<server>/<tool>", "specific MCP tool"],
  ["tool:<server>/*", "all tools from an MCP server"],
  ["mcp_gateway:<name>", "AgentGateway coarse MCP call gate"],
  ["mcp_server:<id>", "MCP server discovery/sync target"],
  ["knowledge_base:<id>", "RAG datasource or KB resource"],
  ["conversation:<id>", "chat history and sharing target"],
  ["skill:<id>", "skill catalog/runtime target"],
  ["task:<id>", "task template or task execution target"],
  ["admin_surface:<name>", "protected admin UI surface"],
  ["system_config:<key>", "platform configuration key"],
  ["slack_channel:<workspace>--<channel>", "Slack channel association target"],
  ["webex_space:<workspace>--<space>", "Webex space association target"],
] as const;

interface RebacNodeData {
  label: string;
  kind: string;
  object: string;
  description?: string;
  [key: string]: unknown;
}

interface RebacEdgeData {
  tuple?: TupleKey;
  metadata?: GraphEdge["metadata"];
  staged?: "write";
  [key: string]: unknown;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

function resourceName(resource: CatalogResource): string {
  return resource.display_name || resource.name || resource.id;
}

function normalizeOpenFgaTab(tab: string): string {
  if (tab === "builder" || tab === "explorer") return "access";
  return OPENFGA_TABS.has(tab) ? tab : DEFAULT_OPENFGA_TAB;
}

function accessResourceTypes(catalog: CatalogResponse | null): UniversalRebacResourceTypeDefinition[] {
  return catalog?.resource_types ?? [];
}

function accessResources(catalog: CatalogResponse | null, type: AccessResourceType): CatalogResource[] {
  if (!catalog) return [];
  const byType = catalog.resources.by_type?.[type] ?? [];
  if (byType.length > 0) return byType;
  if (type === "agent") return catalog.resources.agents;
  if (type === "tool") return catalog.resources.tools;
  if (type === "knowledge_base") return catalog.resources.knowledge_bases;
  return [];
}

function actionOptions(catalog: CatalogResponse | null, type: AccessResourceType): UniversalRebacResourceAction[] {
  const fromActions = catalog?.actions?.[type];
  if (fromActions?.length) return fromActions;
  return catalog?.resource_types?.find((definition) => definition.type === type)?.actions.slice() ?? [];
}

function subjectOptions(catalog: CatalogResponse | null, type: AccessSubjectType): CatalogResource[] {
  if (!catalog) return [];
  if (type === "team") {
    return catalog.teams.map((team) => ({
      type: "team",
      id: team.slug,
      display_name: `${team.name} (${team.slug})`,
      object: `team:${team.slug}`,
    }));
  }
  return accessResources(catalog, type as AccessResourceType);
}

function accessResourceLabel(type: AccessResourceType): string {
  return ACCESS_RESOURCE_LABELS[type] ?? type.replaceAll("_", " ");
}

function accessSubjectLabel(type: AccessSubjectType): string {
  return ACCESS_SUBJECT_LABELS[type];
}

function subjectRelations(type: AccessSubjectType): Array<NonNullable<UniversalRebacSubjectRef["relation"]>> {
  if (type === "team") return ["member", "admin"];
  if (type === "external_group") return ["member"];
  return [];
}

function normalizeUserSearchResults(users: RebacGraphUserOption[]): CatalogResource[] {
  return users.map((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    const primary = name || user.email || user.username || user.id;
    return {
      type: "user",
      id: user.id,
      display_name: primary === user.id ? `user:${user.id}` : `${primary} (${user.id})`,
      object: `user:${user.id}`,
    };
  });
}

function statusBadge(catalog: CatalogResponse | null) {
  if (!catalog?.status.configured) {
    return <Badge variant="destructive">OpenFGA not configured</Badge>;
  }
  if (!catalog.status.reconcile_enabled) {
    return <Badge variant="secondary">Tuple writes available, team-save reconciliation disabled</Badge>;
  }
  return <Badge variant="default">OpenFGA reconciliation enabled</Badge>;
}

function OpenFgaPermissionCheatsheet() {
  return (
    <Card className="border-cyan-500/25 bg-cyan-500/[0.04]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Access Manager Permission Cheatsheet</CardTitle>
            <CardDescription>
              Use this reference to connect selected actions to the base relationships that OpenFGA stores and the `can_*` permissions it checks at runtime.
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-cyan-500/40 text-cyan-700 dark:text-cyan-300">
            Relationship reference
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-2">
          <div className="text-sm font-medium">Base relationships you write</div>
          <div className="grid gap-2">
            {BASE_RELATIONSHIP_CHEATSHEET.map((item) => (
              <div key={item.tuple} className="rounded-md border bg-background/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{item.label}</Badge>
                  <code className="break-all text-xs">{item.tuple}</code>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.meaning}</p>
              </div>
            ))}
          </div>
        </div>
          <div className="space-y-2">
          <div className="text-sm font-medium">Derived permissions OpenFGA checks</div>
          <div className="rounded-md border bg-background/70 p-3">
            <dl className="space-y-2">
              {DERIVED_PERMISSION_CHEATSHEET.map(([permission, meaning]) => (
                <div key={permission} className="grid grid-cols-[auto_1fr] gap-3 text-xs">
                  <dt>
                    <code>{permission}</code>
                  </dt>
                  <dd className="text-muted-foreground">{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: tuple writes use relations like <code>user</code>, <code>manager</code>, <code>caller</code>,
            <code> reader</code>, and <code>ingestor</code>. Avoid writing derived <code>can_*</code> relations directly.
          </p>
        </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-sm font-medium">Subjects and usersets</div>
            <div className="rounded-md border bg-background/70 p-3">
              <dl className="grid gap-2 sm:grid-cols-2">
                {SUBJECT_CHEATSHEET.map(([subject, meaning]) => (
                  <div key={subject} className="space-y-0.5">
                    <dt>
                      <code className="break-all text-xs">{subject}</code>
                    </dt>
                    <dd className="text-xs text-muted-foreground">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Resource objects</div>
            <div className="rounded-md border bg-background/70 p-3">
              <dl className="grid gap-2 sm:grid-cols-2">
                {RESOURCE_OBJECT_CHEATSHEET.map(([resource, meaning]) => (
                  <div key={resource} className="space-y-0.5">
                    <dt>
                      <code className="break-all text-xs">{resource}</code>
                    </dt>
                    <dd className="text-xs text-muted-foreground">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function tupleKey(tuple: TupleKey): string {
  return `${tuple.user} ${tuple.relation} ${tuple.object}`;
}

function nodeKind(object: string): string {
  if (object.includes("#")) return "userset";
  const [type] = object.split(":");
  return type || "unknown";
}

const GRAPH_KIND_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  user: { label: "User", icon: User, className: "border-sky-400 bg-sky-500/10" },
  team: { label: "Team", icon: Shield, className: "border-violet-400 bg-violet-500/10" },
  userset: { label: "Userset", icon: Users, className: "border-indigo-400 bg-indigo-500/10" },
  agent: { label: "Agent", icon: Bot, className: "border-emerald-400 bg-emerald-500/10" },
  tool: { label: "Tool", icon: Wrench, className: "border-amber-400 bg-amber-500/10" },
  knowledge_base: { label: "Knowledge Base", icon: Database, className: "border-rose-400 bg-rose-500/10" },
  slack_channel: { label: "Slack Channel", icon: Hash, className: "border-cyan-400 bg-cyan-500/10" },
  webex_space: { label: "Webex Space", icon: MessageSquare, className: "border-violet-400 bg-violet-500/10" },
};

function graphKindMeta(kind: string) {
  return GRAPH_KIND_META[kind] ?? {
    label: kind.replace(/_/g, " ") || "Resource",
    icon: Database,
    className: "border-border bg-card",
  };
}

function resourceTypeFromObject(object: string): ResourceType | null {
  const [type] = object.split(":");
  return RESOURCE_TYPES.has(type as ResourceType) ? (type as ResourceType) : null;
}

function defaultRelationForObject(object: string, preferredRelation?: string): string | null {
  const resourceType = resourceTypeFromObject(object);
  if (!resourceType) return null;
  const relations = RELATIONS_BY_TYPE[resourceType];
  return preferredRelation && relations.includes(preferredRelation) ? preferredRelation : relations[0];
}

function tupleFromConnection(
  source: string | null | undefined,
  target: string | null | undefined,
  preferredRelation: string
): TupleKey | null {
  if (!source || !target || source === target) return null;

  if (source.startsWith("user:") && target.startsWith("team:") && !target.includes("#")) {
    return { user: source, relation: "member", object: target };
  }
  if (target.startsWith("user:") && source.startsWith("team:") && !source.includes("#")) {
    return { user: target, relation: "member", object: source };
  }

  if (source.startsWith("team:") && source.endsWith("#member")) {
    const relation = defaultRelationForObject(target, preferredRelation);
    return relation ? { user: source, relation, object: target } : null;
  }
  if (target.startsWith("team:") && target.endsWith("#member")) {
    const relation = defaultRelationForObject(source, preferredRelation);
    return relation ? { user: target, relation, object: source } : null;
  }

  return null;
}

function edgeTuple(edge: GraphEdge): TupleKey {
  return { user: edge.from, relation: edge.relation, object: edge.to };
}

function relationshipFromTuple(tuple: TupleKey): UniversalRebacRelationship | null {
  const [subjectType, subjectRest = ""] = tuple.user.split(":", 2);
  const [subjectId, subjectRelation] = subjectRest.split("#", 2);
  const [resourceType, resourceId = ""] = tuple.object.split(":", 2);
  const action = RELATION_TO_ACTION[tuple.relation];
  if (!subjectType || !subjectId || !resourceType || !resourceId || !action) return null;
  if (
    !["user", "team", "slack_channel", "webex_space", "external_group", "service_account", "anonymous"].includes(
      subjectType
    )
  ) {
    return null;
  }
  return {
    subject: {
      type: subjectType as UniversalRebacRelationship["subject"]["type"],
      id: subjectId,
      relation: subjectRelation as UniversalRebacRelationship["subject"]["relation"],
    },
    action,
    resource: {
      type: resourceType as UniversalRebacRelationship["resource"]["type"],
      id: resourceId,
    },
  };
}

export function OpenFgaRebacTab({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [tuples, setTuples] = useState<TupleRecord[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [graphScope, setGraphScope] = useState(ALL_RELATIONSHIPS_SCOPE);
  const [graphUser, setGraphUser] = useState<RebacGraphUserOption | null>(null);
  const [graphFullscreenOpen, setGraphFullscreenOpen] = useState(false);
  const [accessSubjectType, setAccessSubjectType] = useState<AccessSubjectType>("team");
  const [accessSubjectId, setAccessSubjectId] = useState("");
  const [accessSubjectRelation, setAccessSubjectRelation] =
    useState<NonNullable<UniversalRebacSubjectRef["relation"]>>("member");
  const [accessResourceType, setAccessResourceType] = useState<AccessResourceType>("agent");
  const [accessResourceId, setAccessResourceId] = useState("");
  const [accessAction, setAccessAction] = useState<UniversalRebacResourceAction>("use");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const [tupleFilter, setTupleFilter] = useState<Partial<TupleKey>>({});
  const [pendingGraphWrites, setPendingGraphWrites] = useState<TupleKey[]>([]);
  const [pendingGraphDeletes, setPendingGraphDeletes] = useState<TupleKey[]>([]);
  const [graphSelectedResourceObjects, setGraphSelectedResourceObjects] = useState<Set<string>>(() => new Set());
  const activeTab = useMemo(() => {
    const tab = searchParams.get("subtab") ?? searchParams.get("openfgaTab") ?? DEFAULT_OPENFGA_TAB;
    return normalizeOpenFgaTab(tab);
  }, [searchParams]);

  const selectedAccessRelationship: UniversalRebacRelationship | null = useMemo(() => {
    if (!accessSubjectId || !accessResourceId || !accessAction) return null;
    const allowedSubjectRelations = subjectRelations(accessSubjectType);
    const subjectRelation = allowedSubjectRelations.includes(accessSubjectRelation)
      ? accessSubjectRelation
      : undefined;
    return {
      subject: {
        type: accessSubjectType,
        id: accessSubjectId,
        ...(subjectRelation ? { relation: subjectRelation } : {}),
      },
      action: accessAction,
      resource: {
        type: accessResourceType,
        id: accessResourceId,
      },
    };
  }, [
    accessAction,
    accessResourceId,
    accessResourceType,
    accessSubjectId,
    accessSubjectRelation,
    accessSubjectType,
  ]);

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/admin/openfga/catalog");
    if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
    const payload = await res.json();
    const data = apiData<CatalogResponse>(payload);
    setCatalog(data);
    setAccessSubjectId((prev) => prev || data.teams[0]?.slug || "");
    setAccessResourceId((prev) => prev || accessResources(data, "agent")[0]?.id || "");
  }, []);

  const loadTuples = useCallback(async () => {
    const params = new URLSearchParams();
    if (tupleFilter.user) params.set("user", tupleFilter.user);
    if (tupleFilter.relation) params.set("relation", tupleFilter.relation);
    if (tupleFilter.object) params.set("object", tupleFilter.object);
    params.set("limit", "100");
    const res = await fetch(`/api/admin/openfga/tuples?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load tuples: ${res.status}`);
    const payload = await res.json();
    setTuples(apiData<{ tuples: TupleRecord[] }>(payload).tuples ?? []);
  }, [tupleFilter]);

  const loadGraph = useCallback(async () => {
    const params = new URLSearchParams();
    if (graphScope !== ALL_RELATIONSHIPS_SCOPE) params.set("team", graphScope);
    if (graphUser) params.set("subject", `user:${graphUser.id}`);
    params.set("limit", "1000");
    const res = await fetch(`/api/admin/rebac/graph?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to load graph: ${res.status}`);
    const payload = await res.json();
    setGraph(apiData<{ nodes: GraphNode[]; edges: GraphEdge[] }>(payload));
  }, [graphScope, graphUser]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadCatalog();
      await loadTuples();
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load OpenFGA data");
    } finally {
      setLoading(false);
    }
  }, [loadCatalog, loadGraph, loadTuples]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const nextSubjects = subjectOptions(catalog, accessSubjectType);
    setAccessSubjectId(nextSubjects[0]?.id || "");
    const relations = subjectRelations(accessSubjectType);
    setAccessSubjectRelation(relations[0] ?? "member");
    setCheckResult(null);
  }, [accessSubjectType, catalog]);

  useEffect(() => {
    const nextResources = accessResources(catalog, accessResourceType);
    const nextActions = actionOptions(catalog, accessResourceType);
    setAccessResourceId(nextResources[0]?.id || "");
    setAccessAction(nextActions[0] ?? "read");
    setCheckResult(null);
  }, [accessResourceType, catalog]);

  const setActiveTab = useCallback(
    (tab: string) => {
      const nextTab = normalizeOpenFgaTab(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("subtab", nextTab);
      params.set("openfgaTab", nextTab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  async function applyChangeSet(
    name: string,
    writes: UniversalRebacRelationship[],
    deletes: UniversalRebacRelationship[]
  ) {
    const create = await fetch("/api/admin/rebac/change-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, writes, deletes }),
    });
    if (!create.ok) throw new Error(`Change-set create failed: ${create.status}`);
    const createPayload = await create.json();
    const changeSet = apiData<{ change_set: { id: string } }>(createPayload).change_set;

    const validate = await fetch(`/api/admin/rebac/change-sets/${changeSet.id}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!validate.ok) throw new Error(`Change-set validation failed: ${validate.status}`);
    const validationPayload = await validate.json();
    const validation = apiData<{ validation: { valid: boolean; blocked?: unknown[] } }>(validationPayload).validation;
    if (!validation.valid) {
      throw new Error(`Change-set validation blocked ${validation.blocked?.length ?? 0} change(s)`);
    }

    const apply = await fetch(`/api/admin/rebac/change-sets/${changeSet.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!apply.ok) throw new Error(`Change-set apply failed: ${apply.status}`);
  }

  async function checkAccess() {
    if (!selectedAccessRelationship) {
      setError("Select a subject, resource, and action to check effective access");
      return;
    }
    setBusy(true);
    setError(null);
    setCheckResult(null);
    try {
      const res = await fetch("/api/admin/rebac/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationship: selectedAccessRelationship }),
      });
      if (!res.ok) throw new Error(`ReBAC access check failed: ${res.status}`);
      const payload = await res.json();
      setCheckResult(Boolean(apiData<{ allowed: boolean }>(payload).allowed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "ReBAC access check failed");
    } finally {
      setBusy(false);
    }
  }

  async function grantSelectedAccess() {
    if (!selectedAccessRelationship) {
      setError("Select a subject, resource, and action before granting access");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await applyChangeSet(
        `Grant effective access ${selectedAccessRelationship.action} ${selectedAccessRelationship.resource.type}:${selectedAccessRelationship.resource.id}`,
        [selectedAccessRelationship],
        []
      );
      setMessage(
        `Granted ${selectedAccessRelationship.action} on ${selectedAccessRelationship.resource.type}:${selectedAccessRelationship.resource.id}`
      );
      await Promise.all([loadTuples(), loadGraph()]);
      await checkAccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Effective access grant failed");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSelectedAccess() {
    if (!selectedAccessRelationship) {
      setError("Select a subject, resource, and action before revoking access");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await applyChangeSet(
        `Revoke effective access ${selectedAccessRelationship.action} ${selectedAccessRelationship.resource.type}:${selectedAccessRelationship.resource.id}`,
        [],
        [selectedAccessRelationship]
      );
      setMessage(
        `Revoked ${selectedAccessRelationship.action} on ${selectedAccessRelationship.resource.type}:${selectedAccessRelationship.resource.id}`
      );
      await Promise.all([loadTuples(), loadGraph()]);
      await checkAccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Effective access revoke failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTuple(tuple: TupleKey) {
    const relationship = relationshipFromTuple(tuple);
    if (!relationship) {
      setError("Tuple cannot be represented as a universal ReBAC relationship");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await applyChangeSet(`Revoke ${tuple.relation} ${tuple.object}`, [], [relationship]);
      setMessage(`Deleted ${tuple.user} ${tuple.relation} ${tuple.object}`);
      await Promise.all([loadTuples(), loadGraph()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tuple delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyGraphChanges() {
    if (pendingGraphWrites.length === 0 && pendingGraphDeletes.length === 0) return;
    const writes = pendingGraphWrites.map(relationshipFromTuple).filter(Boolean) as UniversalRebacRelationship[];
    const deletes = pendingGraphDeletes.map(relationshipFromTuple).filter(Boolean) as UniversalRebacRelationship[];
    if (writes.length !== pendingGraphWrites.length || deletes.length !== pendingGraphDeletes.length) {
      setError("One or more staged graph changes cannot be represented as universal ReBAC relationships");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await applyChangeSet("Graph policy change set", writes, deletes);
      setMessage(
        `Saved ${pendingGraphWrites.length} grant${pendingGraphWrites.length === 1 ? "" : "s"} and ${
          pendingGraphDeletes.length
        } revoke${pendingGraphDeletes.length === 1 ? "" : "s"}`
      );
      setPendingGraphWrites([]);
      setPendingGraphDeletes([]);
      await Promise.all([loadTuples(), loadGraph()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OpenFGA graph save failed");
    } finally {
      setBusy(false);
    }
  }

  function stageGraphWrite(tuple: TupleKey) {
    setPendingGraphDeletes((prev) => prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple)));
    setPendingGraphWrites((prev) =>
      prev.some((candidate) => tupleKey(candidate) === tupleKey(tuple)) ? prev : [...prev, tuple]
    );
  }

  function stageGraphDelete(tuple: TupleKey) {
    setPendingGraphWrites((prev) => prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple)));
    setPendingGraphDeletes((prev) =>
      prev.some((candidate) => tupleKey(candidate) === tupleKey(tuple)) ? prev : [...prev, tuple]
    );
  }

  function clearGraphChanges() {
    setPendingGraphWrites([]);
    setPendingGraphDeletes([]);
  }

  const toggleGraphResource = useCallback((object: string) => {
    setGraphSelectedResourceObjects((current) => {
      const next = new Set(current);
      if (next.has(object)) {
        next.delete(object);
      } else {
        next.add(object);
      }
      return next;
    });
  }, []);

  const setGraphResourceVisibility = useCallback((objects: string[], visible: boolean) => {
    setGraphSelectedResourceObjects((current) => {
      const next = new Set(current);
      for (const object of objects) {
        if (visible) {
          next.add(object);
        } else {
          next.delete(object);
        }
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading OpenFGA ReBAC admin data...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">OpenFGA ReBAC</h2>
          <p className="text-sm text-muted-foreground">
            Author and inspect team-to-resource relationships enforced by AgentGateway ext_authz.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(catalog)}
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="tuples" onClick={() => setActiveTab("tuples")}>OpenFGA Tuples</TabsTrigger>
          <TabsTrigger value="graph" onClick={() => setActiveTab("graph")}>Policy Graph</TabsTrigger>
          <TabsTrigger value="access" onClick={() => setActiveTab("access")}>Access Manager</TabsTrigger>
        </TabsList>

        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>Access Manager</CardTitle>
              <CardDescription>
                Select any catalog-backed subject and resource, check the derived permission, then grant or revoke it through a validated change set.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AccessCheckForm
                catalog={catalog}
                subjectType={accessSubjectType}
                subjectId={accessSubjectId}
                subjectRelation={accessSubjectRelation}
                resourceType={accessResourceType}
                resourceId={accessResourceId}
                action={accessAction}
                onSubjectType={setAccessSubjectType}
                onSubjectId={setAccessSubjectId}
                onSubjectRelation={setAccessSubjectRelation}
                onResourceType={setAccessResourceType}
                onResourceId={setAccessResourceId}
                onAction={setAccessAction}
              />
              {selectedAccessRelationship && <AccessPreview relationship={selectedAccessRelationship} />}
              <AccessChangeSetPreview
                relationship={selectedAccessRelationship}
                allowed={checkResult}
                canMutate={isAdmin}
              />
              <RebacAccessChecker
                relationship={selectedAccessRelationship}
                allowed={checkResult}
                busy={busy}
                canGrant={isAdmin}
                onCheck={checkAccess}
                onGrant={grantSelectedAccess}
                onRevoke={revokeSelectedAccess}
              />
              {!isAdmin && <p className="text-sm text-muted-foreground">You can inspect ReBAC, but only admins can mutate tuples.</p>}
              <OpenFgaPermissionCheatsheet />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="graph">
          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Policy / Resource Graph</CardTitle>
                <CardDescription>
                  Visualizes OpenFGA usersets as edges. Use a team scope or render all relationships in the store.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 self-start"
                onClick={() => setGraphFullscreenOpen(true)}
              >
                <Maximize2 className="h-4 w-4" />
                Full screen
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <RebacGraphFilters
                teams={catalog?.teams ?? []}
                scope={graphScope}
                allScopeValue={ALL_RELATIONSHIPS_SCOPE}
                selectedUser={graphUser}
                onScopeChange={setGraphScope}
                onUserChange={setGraphUser}
                onRender={loadGraph}
              />
              <GraphSummary graph={graph} />
              <OpenFgaGraphEditor
                catalog={catalog}
                graph={graph}
                teamSlug={graphScope === ALL_RELATIONSHIPS_SCOPE ? "" : graphScope}
                preferredRelation="user"
                selectedResourceObjects={graphSelectedResourceObjects}
                pendingWrites={pendingGraphWrites}
                pendingDeletes={pendingGraphDeletes}
                isAdmin={isAdmin}
                busy={busy}
                showUsers={Boolean(graphUser)}
                onToggleResource={toggleGraphResource}
                onSetResourceVisibility={setGraphResourceVisibility}
                onStageWrite={stageGraphWrite}
                onStageDelete={stageGraphDelete}
                onUnstageWrite={(tuple) => {
                  setPendingGraphWrites((prev) => prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple)));
                }}
                onClearChanges={clearGraphChanges}
                onSaveChanges={applyGraphChanges}
              />
              <GraphDetails graph={graph} />
              <Dialog open={graphFullscreenOpen} onOpenChange={setGraphFullscreenOpen}>
                <DialogContent className="flex h-[92vh] max-h-[92vh] min-w-0 w-[96vw] max-w-[96vw] flex-col gap-3 overflow-hidden p-4">
                  <DialogHeader className="min-w-0 shrink-0 pr-10">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <DialogTitle>OpenFGA Policy / Resource Graph</DialogTitle>
                        <DialogDescription>
                          Full-screen relationship workspace for all tuples or a selected team scope.
                        </DialogDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setGraphFullscreenOpen(false)}
                      >
                        <Minimize2 className="h-4 w-4" />
                        Exit full screen
                      </Button>
                    </div>
                  </DialogHeader>
                  <div className="min-w-0 shrink-0 rounded-md border bg-muted/10 p-3">
                    <RebacGraphFilters
                      teams={catalog?.teams ?? []}
                      scope={graphScope}
                      allScopeValue={ALL_RELATIONSHIPS_SCOPE}
                      selectedUser={graphUser}
                      idPrefix="graph-fullscreen"
                      onScopeChange={setGraphScope}
                      onUserChange={setGraphUser}
                      onRender={loadGraph}
                    />
                  </div>
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <OpenFgaGraphEditor
                      catalog={catalog}
                      graph={graph}
                      teamSlug={graphScope === ALL_RELATIONSHIPS_SCOPE ? "" : graphScope}
                      preferredRelation="user"
                      selectedResourceObjects={graphSelectedResourceObjects}
                      pendingWrites={pendingGraphWrites}
                      pendingDeletes={pendingGraphDeletes}
                      isAdmin={isAdmin}
                      busy={busy}
                      showUsers={Boolean(graphUser)}
                      fullscreen
                      onToggleResource={toggleGraphResource}
                      onSetResourceVisibility={setGraphResourceVisibility}
                      onStageWrite={stageGraphWrite}
                      onStageDelete={stageGraphDelete}
                      onUnstageWrite={(tuple) => {
                        setPendingGraphWrites((prev) =>
                          prev.filter((candidate) => tupleKey(candidate) !== tupleKey(tuple))
                        );
                      }}
                      onClearChanges={clearGraphChanges}
                      onSaveChanges={applyGraphChanges}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tuples">
          <Card>
            <CardHeader>
              <CardTitle>OpenFGA Tuple Store</CardTitle>
              <CardDescription>
                Advanced view of materialized OpenFGA tuples. Filters are passed through the Web UI backend and capped to 100 rows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <FilterInput label="User" value={tupleFilter.user ?? ""} onChange={(user) => setTupleFilter((prev) => ({ ...prev, user }))} />
                <FilterInput label="Relation" value={tupleFilter.relation ?? ""} onChange={(relationValue) => setTupleFilter((prev) => ({ ...prev, relation: relationValue }))} />
                <FilterInput label="Object" value={tupleFilter.object ?? ""} onChange={(object) => setTupleFilter((prev) => ({ ...prev, object }))} />
                <Button variant="outline" className="self-end" onClick={loadTuples}>
                  Apply filters
                </Button>
              </div>
              <div className="space-y-2">
                {tuples.length === 0 ? (
                  <p className="rounded-md border p-4 text-sm text-muted-foreground">No tuples found for the current filter.</p>
                ) : (
                  tuples.map((tuple) => (
                    <div key={`${tuple.key.user}:${tuple.key.relation}:${tuple.key.object}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                      <code className="break-all">
                        {tuple.key.user} <span className="text-muted-foreground">{tuple.key.relation}</span> {tuple.key.object}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isAdmin || busy}
                        onClick={() => deleteTuple(tuple.key)}
                        className="gap-1 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccessCheckForm(props: {
  catalog: CatalogResponse | null;
  subjectType: AccessSubjectType;
  subjectId: string;
  subjectRelation: NonNullable<UniversalRebacSubjectRef["relation"]>;
  resourceType: AccessResourceType;
  resourceId: string;
  action: UniversalRebacResourceAction;
  onSubjectType: (value: AccessSubjectType) => void;
  onSubjectId: (value: string) => void;
  onSubjectRelation: (value: NonNullable<UniversalRebacSubjectRef["relation"]>) => void;
  onResourceType: (value: AccessResourceType) => void;
  onResourceId: (value: string) => void;
  onAction: (value: UniversalRebacResourceAction) => void;
}) {
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjectResults, setSubjectResults] = useState<CatalogResource[]>([]);
  const [searchingSubjects, setSearchingSubjects] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const subjectCatalogOptions = subjectOptions(props.catalog, props.subjectType);
  const availableResourceTypes = accessResourceTypes(props.catalog);
  const resources = accessResources(props.catalog, props.resourceType);
  const actions = actionOptions(props.catalog, props.resourceType);
  const relations = subjectRelations(props.subjectType);
  const normalizedQuery = subjectQuery.trim().toLowerCase();
  const visibleSubjects = (subjectResults.length > 0 ? subjectResults : subjectCatalogOptions).filter((subject) => {
    if (!normalizedQuery || subjectResults.length > 0) return true;
    return `${resourceName(subject)} ${subject.id}`.toLowerCase().includes(normalizedQuery);
  });
  const showSubjectOptions = normalizedQuery.length > 0 || subjectResults.length > 0;

  async function searchSubjects() {
    if (props.subjectType !== "user") {
      setSubjectResults([]);
      return;
    }
    const query = subjectQuery.trim();
    if (!query) {
      setSubjectResults([]);
      return;
    }
    setSearchingSubjects(true);
    setSubjectError(null);
    try {
      const params = new URLSearchParams({ search: query, pageSize: "20" });
      const response = await fetch(`/api/admin/users?${params.toString()}`);
      if (!response.ok) throw new Error(`User search failed: ${response.status}`);
      const payload = await response.json();
      setSubjectResults(normalizeUserSearchResults(Array.isArray(payload.users) ? payload.users : []));
    } catch (err) {
      setSubjectError(err instanceof Error ? err.message : "Subject search failed");
    } finally {
      setSearchingSubjects(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
        <div>
          <Label htmlFor="rebac-access-subject-type">Subject type</Label>
          <select
            id="rebac-access-subject-type"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={props.subjectType}
            onChange={(event) => {
              props.onSubjectType(event.target.value as AccessSubjectType);
              setSubjectQuery("");
              setSubjectResults([]);
              setSubjectError(null);
            }}
          >
            {ACCESS_SUBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {accessSubjectLabel(type)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="rebac-access-subject">Subject</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="rebac-access-subject"
              autoComplete="off"
              value={subjectQuery}
              onChange={(event) => {
                setSubjectQuery(event.target.value);
                setSubjectResults([]);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchSubjects();
                }
              }}
              placeholder={`Search ${accessSubjectLabel(props.subjectType).toLowerCase()} subjects`}
            />
            <Button type="button" variant="outline" className="gap-2" onClick={() => void searchSubjects()}>
              <Search className="h-4 w-4" />
              Search subjects
            </Button>
          </div>
          {props.subjectId && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Selected <code>{props.subjectType}:{props.subjectId}</code>
              {relations.length > 0 ? `#${props.subjectRelation}` : ""}
            </p>
          )}
          {subjectError && <p className="mt-2 text-xs text-destructive">{subjectError}</p>}
          {searchingSubjects && <p className="mt-2 text-xs text-muted-foreground">Searching subjects...</p>}
          {showSubjectOptions && visibleSubjects.length > 0 && (
            <div className="mt-2 max-h-44 overflow-auto rounded-md border bg-background">
              {visibleSubjects.map((subject) => (
                <button
                  key={`${subject.type ?? props.subjectType}:${subject.id}`}
                  type="button"
                  className="block w-full border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted"
                  onClick={() => {
                    props.onSubjectId(subject.id);
                    setSubjectQuery(resourceName(subject));
                    setSubjectResults([]);
                  }}
                >
                  <span className="block font-medium">{resourceName(subject)}</span>
                  <span className="block text-muted-foreground">
                    {props.subjectType}:{subject.id}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {relations.length > 0 && (
          <div>
            <Label htmlFor="rebac-access-subject-relation">Subject relation</Label>
            <select
              id="rebac-access-subject-relation"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={props.subjectRelation}
              onChange={(event) =>
                props.onSubjectRelation(event.target.value as NonNullable<UniversalRebacSubjectRef["relation"]>)
              }
            >
              {relations.map((relationValue) => (
                <option key={relationValue} value={relationValue}>
                  {relationValue}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="rebac-access-resource-type">Resource type</Label>
          <select
            id="rebac-access-resource-type"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={props.resourceType}
            onChange={(event) => props.onResourceType(event.target.value as AccessResourceType)}
          >
            {availableResourceTypes.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {accessResourceLabel(definition.type)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="rebac-access-resource">Resource</Label>
          <select
            id="rebac-access-resource"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={props.resourceId}
            onChange={(event) => props.onResourceId(event.target.value)}
          >
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resourceName(resource)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="rebac-access-action">Action</Label>
          <select
            id="rebac-access-action"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={props.action}
            onChange={(event) => props.onAction(event.target.value as UniversalRebacResourceAction)}
          >
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function AccessPreview({ relationship }: { relationship: UniversalRebacRelationship }) {
  const subject = `${relationship.subject.type}:${relationship.subject.id}${
    relationship.subject.relation ? `#${relationship.subject.relation}` : ""
  }`;
  const object = `${relationship.resource.type}:${relationship.resource.id}`;
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="font-medium">Check preview</div>
      <code className="mt-1 block break-all">
        {subject} <span className="text-muted-foreground">{ACTION_TO_CHECK_RELATION[relationship.action]}</span>{" "}
        {object}
      </code>
    </div>
  );
}

function AccessChangeSetPreview({
  relationship,
  allowed,
  canMutate,
}: {
  relationship: UniversalRebacRelationship | null;
  allowed: boolean | null;
  canMutate: boolean;
}) {
  if (!relationship || allowed === null) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Run an access check to preview the grant or revoke change set for this relationship.
      </div>
    );
  }

  const grants = allowed ? [] : [relationship];
  const revocations = allowed ? [relationship] : [];
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">Policy change-set preview</div>
        <p className="text-xs text-muted-foreground">
          {canMutate
            ? "The next mutation will be validated and applied through the ReBAC change-set API."
            : "Only admins can apply this suggested policy change."}
        </p>
      </div>
      <PolicyChangeSetDiff grants={grants} revocations={revocations} />
    </div>
  );
}

function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" value={value} onChange={(event) => onChange(event.target.value)} placeholder={`${label.toLowerCase()} filter`} />
    </div>
  );
}

function GraphSummary({ graph }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }) {
  const grouped = graph.edges.reduce<Record<string, GraphEdge[]>>((acc, edge) => {
    acc[edge.relation] = [...(acc[edge.relation] ?? []), edge];
    return acc;
  }, {});

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <MetricCard label="Nodes" value={graph.nodes.length} />
      <MetricCard label="Relationships" value={graph.edges.length} />
      <MetricCard label="Relation types" value={Object.keys(grouped).length} />
    </div>
  );
}

function GraphDetails({ graph }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Node and edge details</div>
          <p className="text-xs text-muted-foreground">
            Raw graph inventory is collapsed by default to keep the policy canvas readable.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Hide node and edge details" : "Show node and edge details"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Nodes</div>
            <div className="flex flex-wrap gap-2">
              {graph.nodes.length === 0 ? (
                <span className="text-sm text-muted-foreground">No graph nodes loaded.</span>
              ) : (
                graph.nodes.map((node) => {
                  const meta = graphKindMeta(node.type);
                  const Icon = meta.icon;
                  return (
                    <Badge key={node.id} variant="secondary" className="gap-1.5">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      <span className="text-muted-foreground">{meta.label}</span>
                      {node.label}
                    </Badge>
                  );
                })
              )}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Edges</div>
            <div className="space-y-2">
              {graph.edges.length === 0 ? (
                <span className="text-sm text-muted-foreground">No graph edges loaded.</span>
              ) : (
                graph.edges.map((edge) => (
                  <div key={edge.id} className="rounded bg-muted/40 p-2 text-xs">
                    {edge.kind === "metadata" && (
                      <Badge variant="outline" className="mb-1">
                        routing metadata
                      </Badge>
                    )}
                    <code>{edge.from}</code> <span className="text-muted-foreground">{edge.relation}</span>{" "}
                    <code>{edge.to}</code>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface OpenFgaGraphEditorProps {
  catalog: CatalogResponse | null;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  teamSlug: string;
  preferredRelation: string;
  selectedResourceObjects: Set<string>;
  pendingWrites: TupleKey[];
  pendingDeletes: TupleKey[];
  isAdmin: boolean;
  busy: boolean;
  showUsers?: boolean;
  fullscreen?: boolean;
  onToggleResource: (object: string) => void;
  onSetResourceVisibility: (objects: string[], visible: boolean) => void;
  onStageWrite: (tuple: TupleKey) => void;
  onStageDelete: (tuple: TupleKey) => void;
  onUnstageWrite: (tuple: TupleKey) => void;
  onClearChanges: () => void;
  onSaveChanges: () => void;
}

function OpenFgaGraphEditor(props: OpenFgaGraphEditorProps) {
  return (
    <ReactFlowProvider>
      <OpenFgaGraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function OpenFgaGraphEditorInner({
  catalog,
  graph,
  teamSlug,
  preferredRelation,
  selectedResourceObjects,
  pendingWrites,
  pendingDeletes,
  isAdmin,
  busy,
  showUsers = false,
  fullscreen = false,
  onToggleResource,
  onSetResourceVisibility,
  onStageWrite,
  onStageDelete,
  onUnstageWrite,
  onClearChanges,
  onSaveChanges,
}: OpenFgaGraphEditorProps) {
  const reactFlow = useReactFlow();
  const team = catalog?.teams.find((candidate) => candidate.slug === teamSlug);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<RebacNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<RebacEdgeData>>([]);
  const [selectedEdge, setSelectedEdge] = useState<Edge<RebacEdgeData> | null>(null);
  const [graphWarning, setGraphWarning] = useState<string | null>(null);

  useEffect(() => {
    const nextNodes = buildFlowNodes(
      graph,
      catalog,
      teamSlug,
      team?.name,
      pendingWrites,
      selectedResourceObjects,
      showUsers
    );
    const visibleNodeIds = new Set(nextNodes.map((node) => node.id));
    setNodes(nextNodes);
    setEdges(buildFlowEdges(graph, pendingWrites, pendingDeletes, visibleNodeIds));
  }, [
    graph,
    catalog,
    pendingDeletes,
    pendingWrites,
    selectedResourceObjects,
    setEdges,
    setNodes,
    showUsers,
    team?.name,
    teamSlug,
  ]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isAdmin) return;
      const tuple = tupleFromConnection(connection.source, connection.target, preferredRelation);
      if (!tuple) {
        setGraphWarning("That edge is not a valid CAIPE OpenFGA relationship.");
        return;
      }
      setGraphWarning(null);
      onStageWrite(tuple);
    },
    [isAdmin, onStageWrite, preferredRelation]
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedEdge((params.edges[0] as Edge<RebacEdgeData> | undefined) ?? null);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/caipe-openfga-resource");
      if (!raw) return;
      const resource = JSON.parse(raw) as CatalogResource & { resourceType: AccessResourceType };
      const object = resource.object || `${resource.resourceType}:${resource.id}`;
      if (!selectedResourceObjects.has(object)) {
        onToggleResource(object);
      }
      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setNodes((currentNodes) => {
        if (currentNodes.some((node) => node.id === object)) return currentNodes;
        return [
          ...currentNodes,
          {
            id: object,
            type: "rebac",
            position,
            data: {
              label: resource.name,
              kind: resource.resourceType,
              object,
              description: resource.description,
            },
          },
        ];
      });
    },
    [onToggleResource, reactFlow, selectedResourceObjects, setNodes]
  );

  const selectedTuple = selectedEdge?.data?.tuple ?? null;
  const selectedMetadata = selectedEdge?.data?.metadata ?? null;
  const selectedIsPendingWrite = selectedEdge?.data?.staged === "write";
  const hasPendingChanges = pendingWrites.length > 0 || pendingDeletes.length > 0;

  return (
    <div
      className={cn(
        "grid min-w-0 gap-3",
        fullscreen
          ? "h-full min-h-0 overflow-hidden xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,280px)]"
          : "xl:grid-cols-[280px_minmax(0,1fr)_300px]"
      )}
    >
      <GraphResourcePalette
        catalog={catalog}
        selectedResourceObjects={selectedResourceObjects}
        disabled={!isAdmin}
        onToggleResource={onToggleResource}
        onSetResourceVisibility={onSetResourceVisibility}
      />

      <div
        data-testid="openfga-graph-canvas"
        className={cn(
          "min-w-0 overflow-hidden rounded-md border bg-background",
          fullscreen ? "h-full min-h-0" : "h-[560px]"
        )}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={GRAPH_NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onDragOver={onDragOver}
          onDrop={onDrop}
          fitView
          fitViewOptions={{ padding: 0.3 }}
        >
          <Panel position="top-left">
            <div className="rounded-md border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
              Drag a resource into the graph, then connect a team members node to grant access.
            </div>
          </Panel>
          <OpenFgaGraphControls />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--muted-foreground) / 0.15)"
          />
        </ReactFlow>
      </div>

      <div className={cn("min-w-0 space-y-3", fullscreen && "min-h-0 overflow-auto")}>
        {graphWarning && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {graphWarning}
          </div>
        )}
        <div className="rounded-md border p-3">
          <div className="text-sm font-medium">Selected relationship</div>
          {selectedTuple ? (
            <div className="mt-2 space-y-2">
              <code className="block break-all rounded bg-muted/40 p-2 text-xs">{tupleKey(selectedTuple)}</code>
              <Button
                size="sm"
                variant="outline"
                disabled={!isAdmin || busy}
                onClick={() =>
                  selectedIsPendingWrite ? onUnstageWrite(selectedTuple) : onStageDelete(selectedTuple)
                }
                className="w-full gap-1 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {selectedIsPendingWrite ? "Remove staged grant" : "Stage revoke"}
              </Button>
            </div>
          ) : selectedMetadata ? (
            <div className="mt-2 space-y-2">
              <Badge variant="outline">routing metadata</Badge>
              <p className="text-xs text-muted-foreground">
                {selectedMetadata.label}. This edge comes from a messaging team mapping, not an OpenFGA tuple.
              </p>
              <Button size="sm" variant="outline" disabled className="w-full">
                Read-only metadata edge
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Select an edge to stage a revoke.</p>
          )}
        </div>

        <PendingGraphChanges
          writes={pendingWrites}
          deletes={pendingDeletes}
          busy={busy}
          isAdmin={isAdmin}
          onClear={onClearChanges}
          onSave={onSaveChanges}
        />
      </div>
    </div>
  );
}

function buildFlowNodes(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  catalog: CatalogResponse | null,
  teamSlug: string,
  teamName: string | undefined,
  pendingWrites: TupleKey[],
  selectedResourceObjects: Set<string>,
  showUsers: boolean
): Node<RebacNodeData>[] {
  const nodesById = new Map<string, { id: string; label: string; kind: string }>();
  const addNode = (id: string, label = id, kind = nodeKind(id)) => {
    if (!nodesById.has(id)) nodesById.set(id, { id, label, kind: kind === "team_members" ? "userset" : kind });
  };

  if (teamSlug) {
    addNode(`team:${teamSlug}`, teamName ? `${teamName} team` : `team:${teamSlug}`, "team");
    addNode(`team:${teamSlug}#member`, teamName ? `${teamName} members` : `team:${teamSlug}#member`, "userset");
  }

  graph.nodes.forEach((node) => addNode(node.id, node.label, node.type));
  catalogGraphResourceNodes(catalog, selectedResourceObjects).forEach((node) => {
    addNode(node.id, node.label, node.kind);
  });
  graph.edges.forEach((edge) => {
    addNode(edge.from);
    addNode(edge.to);
  });
  pendingWrites.forEach((tuple) => {
    addNode(tuple.user);
    addNode(tuple.object);
  });

  const pendingNodeIds = new Set(pendingWrites.flatMap((tuple) => [tuple.user, tuple.object]));
  const visibleNodes = [...nodesById.values()].filter((node) => {
    if (node.kind === "team" || node.kind === "userset") return true;
    if (node.kind === "user") return showUsers || pendingNodeIds.has(node.id);
    return selectedResourceObjects.has(node.id) || pendingNodeIds.has(node.id);
  });

  const columnByKind: Record<string, number> = {
    user: 0,
    slack_channel: 0,
    webex_space: 0,
    team: 1,
    userset: 1,
    agent: 2,
    tool: 2,
    knowledge_base: 2,
    mcp_gateway: 2,
    mcp_server: 2,
    conversation: 2,
  };
  const rowByColumn: Record<number, number> = {};

  return visibleNodes
    .sort((left, right) => {
      const leftColumn = columnByKind[left.kind] ?? 3;
      const rightColumn = columnByKind[right.kind] ?? 3;
      return leftColumn - rightColumn || left.label.localeCompare(right.label);
    })
    .map((node) => {
      const column = columnByKind[node.kind] ?? 3;
      const row = rowByColumn[column] ?? 0;
      rowByColumn[column] = row + 1;
      return {
        id: node.id,
        type: "rebac",
        position: { x: 40 + column * 260, y: 60 + row * 110 },
        data: {
          label: node.label,
          kind: node.kind,
          object: node.id,
        },
      };
    });
}

function catalogGraphResourceNodes(
  catalog: CatalogResponse | null,
  selectedResourceObjects: Set<string>
): Array<{ id: string; label: string; kind: string }> {
  if (!catalog || selectedResourceObjects.size === 0) return [];

  return accessResourceTypes(catalog).flatMap((definition) =>
    accessResources(catalog, definition.type)
      .map((resource) => ({
        id: resource.object || `${definition.type}:${resource.id}`,
        label: resourceName(resource),
        kind: definition.type,
      }))
      .filter((resource) => selectedResourceObjects.has(resource.id))
  );
}

function buildFlowEdges(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  pendingWrites: TupleKey[],
  pendingDeletes: TupleKey[],
  visibleNodeIds: Set<string>
): Edge<RebacEdgeData>[] {
  const deleted = new Set(pendingDeletes.map(tupleKey));
  const existingKeys = new Set<string>();
  const persistedEdges = graph.edges
    .map((edge) => ({ edge, tuple: edge.kind === "metadata" ? null : edgeTuple(edge) }))
    .filter(({ edge, tuple }) => {
      if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) return false;
      return !tuple || !deleted.has(tupleKey(tuple));
    })
    .map(({ edge, tuple }) => {
      const isMetadata = edge.kind === "metadata";
      if (tuple) existingKeys.add(tupleKey(tuple));
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.metadata?.readonly ? `${edge.relation} (metadata)` : edge.relation,
        data: tuple ? { tuple } : { metadata: edge.metadata },
        labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
        labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        style: isMetadata
          ? { stroke: "hsl(var(--muted-foreground))", strokeWidth: 2, strokeDasharray: "4 4" }
          : { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      } satisfies Edge<RebacEdgeData>;
    });

  const stagedEdges = pendingWrites
    .filter((tuple) => !existingKeys.has(tupleKey(tuple)))
    .filter((tuple) => visibleNodeIds.has(tuple.user) && visibleNodeIds.has(tuple.object))
    .map((tuple) => ({
      id: `pending-${tupleKey(tuple)}`,
      source: tuple.user,
      target: tuple.object,
      label: tuple.relation,
      animated: true,
      data: { tuple, staged: "write" as const },
      labelStyle: { fontSize: 11, fill: "hsl(var(--foreground))" },
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      style: { stroke: "#10b981", strokeWidth: 2.5, strokeDasharray: "6 4" },
    }));

  return [...persistedEdges, ...stagedEdges];
}

function GraphResourcePalette({
  catalog,
  selectedResourceObjects,
  disabled,
  onToggleResource,
  onSetResourceVisibility,
}: {
  catalog: CatalogResponse | null;
  selectedResourceObjects: Set<string>;
  disabled: boolean;
  onToggleResource: (object: string) => void;
  onSetResourceVisibility: (objects: string[], visible: boolean) => void;
}) {
  const [resourceSearch, setResourceSearch] = useState("");
  const resourceGroups: Array<{ type: AccessResourceType; label: string; resources: CatalogResource[] }> =
    accessResourceTypes(catalog)
      .map((definition) => ({
        type: definition.type,
        label: accessResourceLabel(definition.type),
        resources: accessResources(catalog, definition.type),
      }))
      .filter((group) => group.resources.length > 0);
  const normalizedSearch = resourceSearch.trim().toLowerCase();
  const filteredResourceGroups = resourceGroups.map((group) => ({
    ...group,
    resources: normalizedSearch
      ? group.resources.filter((resource) =>
          [resourceName(resource), resource.object, resource.description, resource.id].some((value) =>
            (value ?? "").toLowerCase().includes(normalizedSearch)
          )
        )
      : group.resources,
  }));
  const visibleResources = filteredResourceGroups.flatMap((group) =>
    group.resources.map((resource) => ({
      ...resource,
      resourceType: group.type,
      object: resource.object || `${group.type}:${resource.id}`,
    }))
  );
  const visibleResourceObjects = visibleResources.map((resource) => resource.object);

  return (
    <div data-testid="openfga-graph-resource-palette" className="min-h-0 min-w-0 space-y-3 overflow-auto rounded-md border p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Resource palette</div>
          <Badge variant="secondary">{selectedResourceObjects.size} shown</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Select resources to show them in the graph, or drag one into the canvas before connecting it.
        </p>
      </div>
      <Input
        value={resourceSearch}
        onChange={(event) => setResourceSearch(event.target.value)}
        placeholder="Search resources"
        aria-label="Search resources"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={visibleResourceObjects.length === 0}
          onClick={() => onSetResourceVisibility(visibleResourceObjects, true)}
        >
          Select all shown
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={visibleResourceObjects.length === 0}
          onClick={() => onSetResourceVisibility(visibleResourceObjects, false)}
        >
          Unselect all shown
        </Button>
      </div>
      {filteredResourceGroups.map((group) => (
        <div key={group.type} className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
          {group.resources.length === 0 ? (
            <div className="rounded border border-dashed p-2 text-xs text-muted-foreground">No resources found.</div>
          ) : (
            group.resources.map((resource) => {
              const object = resource.object || `${group.type}:${resource.id}`;
              const checked = selectedResourceObjects.has(object);
              return (
                <label
                  key={`${group.type}:${resource.id}`}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/caipe-openfga-resource",
                      JSON.stringify({ ...resource, resourceType: group.type })
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs shadow-sm transition-colors hover:bg-muted",
                    checked && "border-primary bg-primary/10",
                    disabled && "cursor-default"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    onChange={() => onToggleResource(object)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{resourceName(resource)}</span>
                    <code className="block truncate text-[10px] text-muted-foreground">{object}</code>
                  </span>
                </label>
              );
            })
          )}
        </div>
      ))}
      {visibleResources.length === 0 && (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          No resources match the current search.
        </p>
      )}
    </div>
  );
}

function PendingGraphChanges({
  writes,
  deletes,
  busy,
  isAdmin,
  onClear,
  onSave,
}: {
  writes: TupleKey[];
  deletes: TupleKey[];
  busy: boolean;
  isAdmin: boolean;
  onClear: () => void;
  onSave: () => void;
}) {
  const hasChanges = writes.length > 0 || deletes.length > 0;
  const grants = writes.map(relationshipFromTuple).filter(Boolean) as UniversalRebacRelationship[];
  const revocations = deletes.map(relationshipFromTuple).filter(Boolean) as UniversalRebacRelationship[];

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Staged changes</div>
        <Badge variant="secondary">{writes.length + deletes.length}</Badge>
      </div>
      <div className="mt-2 max-h-60 space-y-2 overflow-auto">
        {!hasChanges && <p className="text-xs text-muted-foreground">No graph edits staged.</p>}
        <PolicyChangeSetDiff grants={grants} revocations={revocations} />
        {writes.map((tuple) => (
          <div key={`write-${tupleKey(tuple)}`} className="rounded bg-emerald-500/10 p-2 text-xs">
            <Badge className="mb-1">grant</Badge>
            <code className="block break-all">{tupleKey(tuple)}</code>
          </div>
        ))}
        {deletes.map((tuple) => (
          <div key={`delete-${tupleKey(tuple)}`} className="rounded bg-destructive/10 p-2 text-xs">
            <Badge variant="destructive" className="mb-1">
              revoke
            </Badge>
            <code className="block break-all">{tupleKey(tuple)}</code>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={!isAdmin || busy || !hasChanges} onClick={onSave}>
          Validate and save
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !hasChanges} onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function OpenFgaGraphControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const buttonClass =
    "flex h-8 w-8 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/15";

  return (
    <Panel position="bottom-left">
      <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-1 shadow-lg">
        <button type="button" onClick={() => zoomIn()} className={buttonClass} title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomOut()} className={buttonClass} title="Zoom out">
          -
        </button>
        <div className="my-0.5 h-px bg-border" />
        <button type="button" onClick={() => fitView({ padding: 0.3 })} className={buttonClass} title="Fit view">
          fit
        </button>
      </div>
    </Panel>
  );
}

function RebacGraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as RebacNodeData;
  const meta = graphKindMeta(nodeData.kind);
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "w-[210px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-all",
        meta.className,
        selected && "ring-2 ring-primary/40"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Badge variant="secondary" className="mb-1 gap-1 text-[10px]">
            <Icon className="h-3 w-3" aria-hidden="true" />
            {meta.label}
          </Badge>
          <div className="truncate text-sm font-medium">{nodeData.label}</div>
          <code className="block truncate text-[10px] text-muted-foreground">{nodeData.object}</code>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
    </div>
  );
}

const RebacGraphNode = memo(RebacGraphNodeComponent);
const GRAPH_NODE_TYPES = { rebac: RebacGraphNode };

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

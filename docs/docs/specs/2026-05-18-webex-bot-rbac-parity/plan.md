# Webex Bot RBAC Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fresh Webex bot integration with Slack-equivalent RBAC UI, identity/OBO, OpenFGA, deployment, tests, and docs, using Webex spaces where Slack uses channels.

**Architecture:** Implement Webex as a parallel surface rather than a shared messaging abstraction. Mirror Slack's proven boundaries with Webex-specific names: `webex_bot`, `webex_space`, `webex_user_id`, Webex BFF routes, Webex Mongo collections, and Webex OpenFGA types. Keep OpenFGA as the source of truth for grants; use MongoDB for mappings, provenance, route metadata, diagnostics, and admin UI state.

**Tech Stack:** Python 3.11+/3.13, Slack bot Python patterns, Webex APIs, FastAPI/Starlette-style admin endpoints as used locally, Next.js 16 route handlers, TypeScript, MongoDB, OpenFGA, Keycloak OIDC/token exchange, Helm, docker-compose, pytest, Vitest/Jest, Playwright/RBAC matrix.

---

## File Structure

### New Webex Bot Package

- Create `ai_platform_engineering/integrations/webex_bot/__init__.py`
- Create `ai_platform_engineering/integrations/webex_bot/app.py`
- Create `ai_platform_engineering/integrations/webex_bot/webex_websocket.py`
- Create `ai_platform_engineering/integrations/webex_bot/a2a_client.py`
- Create `ai_platform_engineering/integrations/webex_bot/sse_client.py` if Slack streaming code cannot be reused directly
- Create `ai_platform_engineering/integrations/webex_bot/utils/webex_context.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/identity_linker.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/obo_exchange.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/space_team_resolver.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/webex_rebac.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/webex_agent_routes.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/webex_space_auto_assign.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/webex_admin_api.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/audit.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/config_models.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/config.py`
- Create `ai_platform_engineering/integrations/webex_bot/utils/log_redaction.py`
- Create `ai_platform_engineering/integrations/webex_bot/tests/`

Use `ai_platform_engineering/integrations/slack_bot/` as the reference implementation, but keep Webex names and Webex API assumptions explicit.

### UI BFF And Types

- Create `ui/src/types/webex-rebac.ts`
- Create `ui/src/lib/rbac/webex-space-grant-store.ts`
- Create `ui/src/lib/rbac/webex-space-route-store.ts`
- Create `ui/src/lib/rbac/webex-space-rebac.ts`
- Modify `ui/src/lib/rbac/mongo-collections.ts`
- Modify `ui/src/types/mongodb.ts`
- Modify `ui/src/types/teams.ts`
- Create `ui/src/app/api/admin/webex/spaces/_lib.ts`
- Create `ui/src/app/api/admin/webex/spaces/route.ts`
- Create `ui/src/app/api/admin/webex/spaces/[workspaceId]/[spaceId]/resources/route.ts`
- Create `ui/src/app/api/admin/webex/spaces/[workspaceId]/[spaceId]/routes/route.ts`
- Create `ui/src/app/api/admin/webex/spaces/[workspaceId]/[spaceId]/access-check/route.ts`
- Create `ui/src/app/api/admin/webex/spaces/[workspaceId]/[spaceId]/diagnostics/route.ts`
- Create `ui/src/app/api/admin/webex/spaces/defaults/route.ts`
- Create `ui/src/app/api/admin/webex/available-spaces/route.ts`
- Create `ui/src/app/api/admin/webex/runtime/status/route.ts`
- Create `ui/src/app/api/admin/webex/runtime/reload/route.ts`
- Create `ui/src/app/api/admin/webex/runtime/sync-from-config/route.ts`
- Create `ui/src/app/api/admin/webex/users/route.ts`
- Create `ui/src/app/api/admin/webex/users/[id]/route.ts`
- Create `ui/src/app/api/auth/webex-link/route.ts`
- Create `ui/src/app/api/admin/teams/[id]/webex-spaces/route.ts`
- Create `ui/src/lib/webex-bot-admin.ts`

### UI Components

- Create `ui/src/components/admin/rebac/WebexSpaceRebacPanel.tsx`
- Modify `ui/src/components/admin/OpenFgaRebacTab.tsx`
- Modify `ui/src/components/admin/TeamDetailsDialog.tsx`
- Modify `ui/src/components/admin/UserDetailModal.tsx`
- Modify `ui/src/components/admin/UserManagementTab.tsx`
- Add tests under `ui/src/components/admin/rebac/__tests__/` and route tests under `ui/src/app/api/admin/webex/.../__tests__/`

### Policy, Deployment, And Docs

- Modify `deploy/openfga/model.fga`
- Modify `deploy/openfga/init/authorization-model.json`
- Modify `deploy/openfga-experiment/model.fga`
- Modify `deploy/openfga-experiment/init/authorization-model.json`
- Modify `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`
- Create `charts/ai-platform-engineering/charts/webex-bot/`
- Modify `charts/ai-platform-engineering/Chart.yaml`
- Modify `charts/ai-platform-engineering/values.yaml`
- Modify `charts/ai-platform-engineering/values-mongodb.yaml.example`
- Modify `charts/ai-platform-engineering/values-existing-secrets.yaml`
- Modify `charts/ai-platform-engineering/charts/caipe-ui/values.yaml`
- Modify `charts/ai-platform-engineering/charts/caipe-ui/values-external-secrets.yaml`
- Modify `docker-compose.dev.yaml`
- Modify `docker-compose.yaml`
- Create `.github/workflows/ci-webex-bot.yml`
- Create `build/Dockerfile.webex-bot`
- Create `deploy/secrets-examples/webex-secret.yaml.example`
- Create or update `docs/docs/api/webex-integration.md`
- Update `docs/docs/security/rbac/index.md`
- Update `docs/docs/security/rbac/architecture.md`
- Update `docs/docs/security/rbac/workflows.md`
- Update `docs/docs/security/rbac/file-map.md`
- Update `docs/docs/security/rbac/usage.md`
- Update `docs/docs/specs/2026-05-18-webex-bot-rbac-parity/spec.md` only if implementation reveals a necessary clarified requirement

Do not commit during execution unless the user explicitly asks. If committing is requested, use Conventional Commits and DCO according to repo policy.

---

## Task 1: Webex ReBAC Type And Store Foundations

**Files:**
- Create: `ui/src/types/webex-rebac.ts`
- Create: `ui/src/lib/rbac/webex-space-grant-store.ts`
- Create: `ui/src/lib/rbac/webex-space-route-store.ts`
- Create: `ui/src/lib/rbac/webex-space-rebac.ts`
- Modify: `ui/src/lib/rbac/mongo-collections.ts`
- Modify: `ui/src/types/mongodb.ts`
- Test: `ui/src/lib/rbac/__tests__/webex-space-stores.test.ts`

- [ ] **Step 1: Write failing tests for Webex subject IDs and collections**

Create `ui/src/lib/rbac/__tests__/webex-space-stores.test.ts` with tests that assert the Webex workspace alias, subject ID, collection names, and active grant replacement behavior.

```ts
import {
  WEBEX_SPACE_GRANT_RESOURCE_TYPES,
  webexSpaceSubjectId,
  webexWorkspaceRef,
} from "@/lib/rbac/webex-space-grant-store";
import { RBAC_COLLECTIONS } from "@/lib/rbac/mongo-collections";

describe("webex-space stores", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses WEBEX_WORKSPACE_ALIAS before raw workspace ids", () => {
    process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
    expect(webexWorkspaceRef("org-123")).toBe("CAIPE-WEBEX");
  });

  it("builds stable Webex space subject ids", () => {
    process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
    expect(webexSpaceSubjectId("org-123", "space-abc")).toBe("CAIPE-WEBEX--space-abc");
  });

  it("registers Webex RBAC collections", () => {
    expect(RBAC_COLLECTIONS.webexSpaceGrants).toBe("webex_space_grants");
    expect(RBAC_COLLECTIONS.webexSpaceAgentRoutes).toBe("webex_space_agent_routes");
    expect(RBAC_COLLECTIONS.webexSpaceTeamMappings).toBe("webex_space_team_mappings");
  });

  it("allows the same resource types as Slack channel grants", () => {
    expect(WEBEX_SPACE_GRANT_RESOURCE_TYPES).toEqual(
      new Set(["agent", "tool", "knowledge_base", "skill", "task"])
    );
  });
});
```

- [ ] **Step 2: Run the failing UI test**

Run: `cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/webex-space-stores.test.ts`

Expected: FAIL because `webex-space-grant-store.ts` and Webex collection keys do not exist.

- [ ] **Step 3: Implement Webex types**

Create `ui/src/types/webex-rebac.ts` with Webex-specific names mirroring `slack-rebac.ts`.

```ts
import type { UniversalRebacResourceAction, UniversalRebacResourceRef } from "./rbac-universal";

export type WebexSpaceGrantResourceType = "agent" | "tool" | "knowledge_base" | "skill" | "task";
export type WebexSpaceRouteListenMode = "mentions" | "all" | "off";
export type WebexSpaceGrantStatus = "active" | "revoked";

export interface WebexSpaceRef {
  workspace_id: string;
  space_id: string;
  space_title?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface WebexSpaceResourceGrant {
  workspace_id: string;
  space_id: string;
  resource: UniversalRebacResourceRef & { type: WebexSpaceGrantResourceType };
  actions: UniversalRebacResourceAction[];
  source_type?: "manual" | "route" | "default";
  status: WebexSpaceGrantStatus;
  created_by?: string;
  created_at?: string;
  updated_by?: string;
  updated_at?: string;
}

export interface WebexSpaceAgentRoute {
  workspace_id: string;
  space_id: string;
  agent_id: string;
  enabled: boolean;
  priority: number;
  users?: {
    listen?: WebexSpaceRouteListenMode;
  };
  created_by?: string;
  created_at?: string;
  updated_by?: string;
  updated_at?: string;
}

export interface WebexSpaceAccessCheckRequest {
  user_id: string;
  workspace_id: string;
  space_id: string;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
}

export interface WebexSpaceAccessCheckResponse {
  allowed: boolean;
  reason: string;
  user_allowed?: boolean;
  space_allowed?: boolean;
  team_id?: string;
}
```

- [ ] **Step 4: Add Webex collection names**

Modify `ui/src/lib/rbac/mongo-collections.ts` to add the Webex collections next to Slack collections.

```ts
export const RBAC_COLLECTIONS = {
  // existing keys
  webexSpaceGrants: "webex_space_grants",
  webexSpaceAgentRoutes: "webex_space_agent_routes",
  webexSpaceTeamMappings: "webex_space_team_mappings",
  webexLinkNonces: "webex_link_nonces",
  webexUserMetrics: "webex_user_metrics",
} as const;
```

If the file uses a typed registry rather than a plain object, add these keys to that registry and keep existing names unchanged.

- [ ] **Step 5: Implement Webex grant store**

Create `ui/src/lib/rbac/webex-space-grant-store.ts`.

```ts
import type { Document } from "mongodb";

import type {
  WebexSpaceGrantResourceType,
  WebexSpaceResourceGrant,
} from "@/types/webex-rebac";
import type { UniversalRebacResourceAction, UniversalRebacResourceRef } from "@/types/rbac-universal";

import { getRbacCollection } from "./mongo-collections";

export interface WebexSpaceGrantDocument extends Document, WebexSpaceResourceGrant {}

export interface WebexSpaceGrantInput {
  workspace_id: string;
  space_id: string;
  resource: UniversalRebacResourceRef & { type: WebexSpaceGrantResourceType };
  actions: UniversalRebacResourceAction[];
  created_by?: string;
}

export const WEBEX_SPACE_GRANT_RESOURCE_TYPES = new Set<WebexSpaceGrantResourceType>([
  "agent",
  "tool",
  "knowledge_base",
  "skill",
  "task",
]);

export function webexWorkspaceRef(workspaceId?: string | null): string {
  const alias = process.env.WEBEX_WORKSPACE_ALIAS?.trim();
  if (alias) return alias;
  const candidate = workspaceId?.trim();
  if (candidate) return candidate;
  return process.env.WEBEX_WORKSPACE_ID?.trim() || "unknown";
}

export function webexSpaceSubjectId(workspaceId: string, spaceId: string): string {
  return `${webexWorkspaceRef(workspaceId)}--${spaceId}`;
}

export async function listWebexSpaceGrants(
  workspaceId: string,
  spaceId: string
): Promise<WebexSpaceGrantDocument[]> {
  const collection = await getRbacCollection<WebexSpaceGrantDocument>("webexSpaceGrants");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const rows = await collection
    .find({ workspace_id: workspaceRef, space_id: spaceId, status: "active" } as never)
    .sort({ "resource.type": 1, "resource.id": 1 })
    .toArray();
  return rows as WebexSpaceGrantDocument[];
}

export async function replaceWebexSpaceGrants(
  workspaceId: string,
  spaceId: string,
  grants: WebexSpaceGrantInput[],
  actor: string
): Promise<WebexSpaceGrantDocument[]> {
  const collection = await getRbacCollection<WebexSpaceGrantDocument>("webexSpaceGrants");
  const now = new Date().toISOString();
  const workspaceRef = webexWorkspaceRef(workspaceId);

  await collection.updateMany(
    { workspace_id: workspaceRef, space_id: spaceId, status: "active" } as never,
    { $set: { status: "revoked", updated_by: actor, updated_at: now } }
  );

  for (const grant of grants) {
    await collection.updateOne(
      {
        workspace_id: workspaceRef,
        space_id: spaceId,
        "resource.type": grant.resource.type,
        "resource.id": grant.resource.id,
      } as never,
      {
        $set: {
          workspace_id: workspaceRef,
          space_id: spaceId,
          resource: grant.resource,
          actions: grant.actions,
          source_type: "manual",
          status: "active",
          created_by: grant.created_by ?? actor,
          created_at: now,
          updated_by: actor,
          updated_at: now,
        },
      },
      { upsert: true }
    );
  }

  return listWebexSpaceGrants(workspaceRef, spaceId);
}
```

- [ ] **Step 6: Implement route store and ReBAC helper by mirroring Slack**

Create `webex-space-route-store.ts` and `webex-space-rebac.ts` from Slack equivalents, replacing `SlackChannel` with `WebexSpace`, `channel_id` with `space_id`, `slack_channel` with `webex_space`, and Slack collection keys with Webex collection keys.

Run: `cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/webex-space-stores.test.ts`

Expected: PASS.

---

## Task 2: OpenFGA Model And Tuple Builders

**Files:**
- Modify: `deploy/openfga/model.fga`
- Modify: `deploy/openfga/init/authorization-model.json`
- Modify: `deploy/openfga-experiment/model.fga`
- Modify: `deploy/openfga-experiment/init/authorization-model.json`
- Modify or create: `ui/src/lib/rbac/__tests__/rebac/tuple-builders.test.ts`

- [ ] **Step 1: Add failing tuple/model tests**

Extend tuple tests to expect Webex subjects to be represented as `webex_space:<workspace>--<space>`.

```ts
import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";

it("builds Webex OpenFGA space subjects without Slack naming", () => {
  process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
  expect(`webex_space:${webexSpaceSubjectId("ignored", "space-1")}`).toBe(
    "webex_space:CAIPE-WEBEX--space-1"
  );
});
```

- [ ] **Step 2: Run the tuple/model tests**

Run: `cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/rebac/tuple-builders.test.ts`

Expected: FAIL until the Webex helper and model are present.

- [ ] **Step 3: Add Webex types to FGA DSL**

Modify both `model.fga` files with Webex types parallel to Slack.

```fga
type webex_workspace
  relations
    define admin: [user]
    define member: [user]
    define space: [webex_space]

type webex_space
  relations
    define parent: [webex_workspace]
    define user: [agent, tool, knowledge_base, skill, task]
```

If the current model expresses resource invocation relations on the target resource types instead, add `webex_space` to the same allowed subject lists where `slack_channel` is already allowed.

- [ ] **Step 4: Regenerate or manually sync authorization JSON**

Update the matching `authorization-model.json` files to include Webex types and subject references. Use the exact relation names from `model.fga`.

Run: `python -m json.tool deploy/openfga/init/authorization-model.json >/dev/null`

Expected: exit code 0.

- [ ] **Step 5: Run OpenFGA and tuple tests**

Run: `cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/rebac/tuple-builders.test.ts`

Expected: PASS.

---

## Task 3: Webex Admin BFF Routes

**Files:**
- Create: `ui/src/app/api/admin/webex/spaces/_lib.ts`
- Create: all routes under `ui/src/app/api/admin/webex/`
- Create: `ui/src/lib/webex-bot-admin.ts`
- Create: `ui/src/app/api/admin/webex/spaces/__tests__/space-resources-route.test.ts`
- Modify: `ui/src/app/api/admin/teams/[id]/webex-spaces/route.ts`

- [ ] **Step 1: Write failing route tests for resource grants**

Create `space-resources-route.test.ts` modeled on Slack's `channel-resources-route.test.ts`. Assert that PUT writes Webex grants, writes OpenFGA tuples with `webex_space`, and rejects non-admin users.

```ts
describe("PUT /api/admin/webex/spaces/[workspaceId]/[spaceId]/resources", () => {
  it("requires admin UI authorization", async () => {
    const response = await PUT(mockRequest({ grants: [] }), {
      params: Promise.resolve({ workspaceId: "WEBEX", spaceId: "space-1" }),
    });
    expect(response.status).toBe(403);
  });
});
```

Use the existing Slack route test helpers where possible.

- [ ] **Step 2: Run failing route test**

Run: `cd ui && npm test -- --runTestsByPath src/app/api/admin/webex/spaces/__tests__/space-resources-route.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement `_lib.ts` admin gate**

Create `_lib.ts` equivalent to Slack's channels `_lib.ts`, with Webex action names.

```ts
import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, requireRbacPermission } from "@/lib/api-middleware";

export async function withWebexSpaceRebacViewAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  return handler();
}

export async function withWebexSpaceRebacManageAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  return handler();
}
```

- [ ] **Step 4: Implement resources, routes, access-check, diagnostics, defaults, and list routes**

Copy Slack BFF route structure and rename:

- `workspaceId` stays as the deployment alias input
- `channelId` becomes `spaceId`
- `slack_channel` becomes `webex_space`
- `slackChannelSubjectId` becomes `webexSpaceSubjectId`
- Slack stores become Webex stores
- user-facing JSON labels use `space`

- [ ] **Step 5: Implement Webex bot admin client**

Create `ui/src/lib/webex-bot-admin.ts` modeled on `slack-bot-admin.ts` with environment variables:

```ts
const WEBEX_BOT_ADMIN_URL = process.env.WEBEX_BOT_ADMIN_URL;
const WEBEX_BOT_ADMIN_CLIENT_ID = process.env.WEBEX_BOT_ADMIN_CLIENT_ID;
const WEBEX_BOT_ADMIN_CLIENT_SECRET = process.env.WEBEX_BOT_ADMIN_CLIENT_SECRET;
const WEBEX_BOT_ADMIN_AUDIENCE = process.env.WEBEX_BOT_ADMIN_AUDIENCE ?? "caipe-webex-bot-admin";
```

Never log `WEBEX_BOT_ADMIN_CLIENT_SECRET`.

- [ ] **Step 6: Run route tests**

Run: `cd ui && npm test -- --runTestsByPath src/app/api/admin/webex/spaces/__tests__/space-resources-route.test.ts`

Expected: PASS.

---

## Task 4: Webex Admin UI Panels

**Files:**
- Create: `ui/src/components/admin/rebac/WebexSpaceRebacPanel.tsx`
- Create: `ui/src/components/admin/rebac/__tests__/WebexSpaceRebacPanel.test.tsx`
- Modify: `ui/src/components/admin/OpenFgaRebacTab.tsx`
- Modify: `ui/src/components/admin/TeamDetailsDialog.tsx`
- Modify: `ui/src/components/admin/UserDetailModal.tsx`
- Modify: `ui/src/components/admin/UserManagementTab.tsx`

- [ ] **Step 1: Write failing component tests**

Create tests that assert the Webex panel renders "Webex Spaces", uses "space" labels, loads `/api/admin/webex/spaces`, and does not render Slack channel text in Webex-specific controls.

```tsx
it("renders Webex space management copy", async () => {
  render(<WebexSpaceRebacPanel />);
  expect(await screen.findByText("Webex Spaces")).toBeInTheDocument();
  expect(screen.queryByText("Slack Channels")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing component tests**

Run: `cd ui && npm test -- --runTestsByPath src/components/admin/rebac/__tests__/WebexSpaceRebacPanel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement WebexSpaceRebacPanel**

Copy `SlackChannelRebacPanel.tsx` and rename API paths, component names, type imports, and visible labels. Preserve interaction behavior: search/list, select space, view resources, update grants, view routes, update routes, run diagnostics, and reload/sync runtime.

- [ ] **Step 4: Add Webex tab to OpenFGA ReBAC UI**

Modify `OpenFgaRebacTab.tsx` to include a Webex tab next to Slack.

```tsx
<TabsTrigger value="webex">Webex Spaces</TabsTrigger>
<TabsContent value="webex">
  <WebexSpaceRebacPanel />
</TabsContent>
```

Adapt to the existing tab implementation and URL state names.

- [ ] **Step 5: Add Webex team binding UI**

Modify `TeamDetailsDialog.tsx` to add a Webex Spaces section parallel to Slack Channels, calling `/api/admin/teams/[id]/webex-spaces`.

- [ ] **Step 6: Add Webex identity link status**

Modify `UserDetailModal.tsx` and `UserManagementTab.tsx` to show Webex link status beside Slack link status, using `webex_user_id` from user attributes.

- [ ] **Step 7: Run UI tests**

Run: `cd ui && npm test -- --runTestsByPath src/components/admin/rebac/__tests__/WebexSpaceRebacPanel.test.tsx src/components/admin/__tests__/OpenFgaRebacTab.test.tsx src/components/admin/__tests__/UserDetailModal.test.tsx`

Expected: PASS.

---

## Task 5: Webex Bot Identity And Runtime Gate

**Files:**
- Create: `ai_platform_engineering/integrations/webex_bot/app.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/identity_linker.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/obo_exchange.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/space_team_resolver.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/webex_rebac.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/audit.py`
- Create: `ai_platform_engineering/integrations/webex_bot/tests/test_identity_linker.py`
- Create: `ai_platform_engineering/integrations/webex_bot/tests/test_space_rebac.py`

- [ ] **Step 1: Write failing Python tests**

Create tests for unlinked user denial, linked user allow, missing space mapping denial, and OpenFGA outage denial.

```python
def test_unlinked_webex_user_denies_before_dispatch(fake_event, fake_dispatcher):
    result = handle_webex_message(
        fake_event(person_id="person-1", space_id="space-1"),
        identity_linker=FakeIdentityLinker(linked=False),
        dispatcher=fake_dispatcher,
    )

    assert result.allowed is False
    assert result.reason_code == "WEBEX_USER_NOT_LINKED"
    assert fake_dispatcher.calls == []
```

Define `handle_webex_message`, `WebexMessageResult`, and injectable collaborators in `app.py` so this test remains a stable runtime-gate contract instead of binding directly to Webex transport internals.

- [ ] **Step 2: Run failing Python tests**

Run: `uv run pytest ai_platform_engineering/integrations/webex_bot/tests/test_identity_linker.py ai_platform_engineering/integrations/webex_bot/tests/test_space_rebac.py -v`

Expected: FAIL because Webex bot modules do not exist.

- [ ] **Step 3: Implement identity linker**

Mirror Slack's identity linker with Webex names:

- Keycloak attribute: `webex_user_id`
- Nonce collection: `webex_link_nonces`
- Default TTL: 600 seconds
- Deny reason for missing link: `WEBEX_USER_NOT_LINKED`

- [ ] **Step 4: Implement OBO exchange**

Copy Slack OBO semantics and Webex env prefix:

- `KEYCLOAK_WEBEX_BOT_CLIENT_ID`
- `KEYCLOAK_WEBEX_BOT_CLIENT_SECRET`
- `KEYCLOAK_WEBEX_BOT_AUDIENCE`
- active team claim propagation

Do not log tokens, refresh tokens, client secrets, or authorization headers.

- [ ] **Step 5: Implement space team resolver and ReBAC client**

Mirror Slack channel resolver with Webex names and collection `webex_space_team_mappings`. The ReBAC client should call the UI BFF access-check route and require both user and space access.

- [ ] **Step 6: Implement message handler gate**

In `app.py`, ensure the dispatch order is:

1. Parse event.
2. Ignore bot/self/malformed events.
3. Resolve Webex user link.
4. Resolve space team.
5. Exchange OBO token.
6. Check Webex space/user ReBAC.
7. Resolve route.
8. Dispatch to agent runtime.

- [ ] **Step 7: Run Python tests**

Run: `uv run pytest ai_platform_engineering/integrations/webex_bot/tests/test_identity_linker.py ai_platform_engineering/integrations/webex_bot/tests/test_space_rebac.py -v`

Expected: PASS.

---

## Task 6: Webex Bot Routes, Admin API, And Streaming

**Files:**
- Create: `ai_platform_engineering/integrations/webex_bot/utils/webex_agent_routes.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/webex_space_auto_assign.py`
- Create: `ai_platform_engineering/integrations/webex_bot/utils/webex_admin_api.py`
- Create: `ai_platform_engineering/integrations/webex_bot/a2a_client.py`
- Create: `ai_platform_engineering/integrations/webex_bot/webex_websocket.py`
- Create: `ai_platform_engineering/integrations/webex_bot/tests/test_webex_agent_routes.py`
- Create: `ai_platform_engineering/integrations/webex_bot/tests/test_webex_admin_api.py`
- Create: `ai_platform_engineering/integrations/webex_bot/tests/test_webex_streaming.py`

- [ ] **Step 1: Write failing route resolver tests**

Assert that `WebexAgentRouteResolver` reads OpenFGA tuples for `webex_space:<workspace>--<space>`, merges Mongo route metadata, and writes `component: webex_bot` audit errors on OpenFGA read failure.

- [ ] **Step 2: Write failing admin API tests**

Assert that admin API calls require a valid admin token audience `caipe-webex-bot-admin` and expose status, reload, and sync actions.

- [ ] **Step 3: Run failing tests**

Run: `uv run pytest ai_platform_engineering/integrations/webex_bot/tests/test_webex_agent_routes.py ai_platform_engineering/integrations/webex_bot/tests/test_webex_admin_api.py -v`

Expected: FAIL because route/admin modules do not exist.

- [ ] **Step 4: Implement Webex route resolver**

Mirror `SlackAgentRouteResolver` with:

- Env: `WEBEX_AGENT_ROUTES_MODE`
- Collection: `webex_space_agent_routes`
- OpenFGA subject: `webex_space:<webexWorkspaceRef(workspace_id)>--<space_id>`
- Audit type: `webex_runtime`
- Component: `webex_bot`

- [ ] **Step 5: Implement Webex admin API**

Mirror Slack admin API with Webex env names:

- `WEBEX_ADMIN_API_ENABLED`
- `WEBEX_ADMIN_API_HOST`
- `WEBEX_ADMIN_API_PORT`
- `WEBEX_ADMIN_API_AUDIENCE`
- `KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_ID`
- `KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_SECRET`

- [ ] **Step 6: Implement Webex streaming and A2A client**

Use the current Slack AG-UI/SSE behavior as the reference, not the old PR code. Preserve narration/final-answer metadata and token forwarding rules used by current agent paths.

- [ ] **Step 7: Run Webex bot tests**

Run: `uv run pytest ai_platform_engineering/integrations/webex_bot/tests/ -v`

Expected: PASS for Webex bot unit tests.

---

## Task 7: Keycloak, Helm, Compose, CI, And Secrets

**Files:**
- Modify: `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`
- Create: `charts/ai-platform-engineering/charts/webex-bot/Chart.yaml`
- Create: `charts/ai-platform-engineering/charts/webex-bot/values.yaml`
- Create: `charts/ai-platform-engineering/charts/webex-bot/templates/_helpers.tpl`
- Create: `charts/ai-platform-engineering/charts/webex-bot/templates/deployment.yaml`
- Create: `charts/ai-platform-engineering/charts/webex-bot/templates/service.yaml`
- Create: `charts/ai-platform-engineering/charts/webex-bot/templates/serviceaccount.yaml`
- Modify: `charts/ai-platform-engineering/Chart.yaml`
- Modify: `charts/ai-platform-engineering/values.yaml`
- Modify: `charts/ai-platform-engineering/charts/caipe-ui/values.yaml`
- Modify: `docker-compose.dev.yaml`
- Modify: `docker-compose.yaml`
- Create: `.github/workflows/ci-webex-bot.yml`
- Create: `build/Dockerfile.webex-bot`
- Create: `deploy/secrets-examples/webex-secret.yaml.example`
- Test: `deploy/openfga/bridge/tests/test_helm_values.py` or a new Webex Helm test file

- [ ] **Step 1: Write failing Helm/values tests**

Add tests that assert `webex-bot` values exist, CAIPE UI receives Webex admin env, and secrets are referenced rather than hardcoded.

- [ ] **Step 2: Run failing Helm tests**

Run: `uv run pytest deploy/openfga/bridge/tests/test_helm_values.py -v`

Expected: FAIL until values are added.

- [ ] **Step 3: Add Keycloak Webex setup**

Modify `init-idp.sh` to create:

- `caipe-webex-bot`
- `caipe-webex-bot-admin`
- audience mapper `caipe-webex-bot-admin`
- token exchange permissions parallel to Slack
- user attribute pattern `webex_user_id`

Do not hardcode credentials; read from env or generated secret variables.

- [ ] **Step 4: Add Webex bot Helm chart**

Model the chart on `charts/ai-platform-engineering/charts/slack-bot/`. Ensure `securityContext.runAsNonRoot: true` and UID/GID 1001 where the image supports it.

- [ ] **Step 5: Add compose services**

Add `webex-bot` to `docker-compose.dev.yaml` and `docker-compose.yaml` with:

- `WEBEX_WORKSPACE_ALIAS`
- `WEBEX_INTEGRATION_BOT_ACCESS_TOKEN` or token secret reference for local dev
- MongoDB, Keycloak, OpenFGA, supervisor/dynamic agent URLs
- Webex admin API settings
- route mode and auto-assign settings

- [ ] **Step 6: Add Dockerfile and CI**

Create a minimal non-root Python image and CI workflow based on `ci-slack-bot.yml`. Use deterministic installs and avoid embedding secrets.

- [ ] **Step 7: Run deploy tests**

Run: `uv run pytest deploy/openfga/bridge/tests/test_helm_values.py -v`

Expected: PASS.

---

## Task 8: RBAC Docs, File Map, And E2E Matrix

**Files:**
- Create: `docs/docs/api/webex-integration.md`
- Modify: `docs/docs/security/rbac/index.md`
- Modify: `docs/docs/security/rbac/architecture.md`
- Modify: `docs/docs/security/rbac/workflows.md`
- Modify: `docs/docs/security/rbac/file-map.md`
- Modify: `docs/docs/security/rbac/usage.md`
- Modify: `tests/rbac/rbac-matrix.yaml`
- Create: `tests/rbac/e2e/story-webex-space-rebac.spec.ts`
- Create: `tests/rbac/fixtures/webex_rebac.ts`

- [ ] **Step 1: Add failing RBAC validation expectations**

Update or add tests so `scripts/validate-rbac-doc.py` expects Webex bot auth files in `file-map.md` once implementation files exist.

- [ ] **Step 2: Add RBAC matrix rows**

Add scenarios:

- linked user + authorized space + granted agent -> allow
- unlinked Webex user -> deny
- linked user + unmapped space -> deny
- linked user + mapped space + missing grant -> deny
- linked user + disabled route -> deny
- OpenFGA unavailable -> deny/retryable unavailable

- [ ] **Step 3: Write Webex E2E fixture**

Create `tests/rbac/fixtures/webex_rebac.ts` with seeded Webex workspace, space, user link, team mapping, and grant tuples.

- [ ] **Step 4: Write Webex E2E story**

Create `story-webex-space-rebac.spec.ts` parallel to the Slack channel story, replacing channel language with space language.

- [ ] **Step 5: Update canonical RBAC docs**

Document:

- Webex bot component in `architecture.md`
- Webex identity/OBO and space ReBAC flows in `workflows.md`
- every Webex auth file in `file-map.md`
- setup, diagnostics, and common failures in `usage.md`
- big-picture threat model update in `index.md`

- [ ] **Step 6: Run doc and RBAC validation**

Run: `python scripts/validate-rbac-doc.py`

Expected: PASS.

Run: `make test-rbac`

Expected: PASS or documented pre-existing failures unrelated to Webex.

---

## Task 9: Full Verification

**Files:**
- No new files; this task verifies the whole feature.

- [ ] **Step 1: Run targeted Python tests**

Run: `uv run pytest ai_platform_engineering/integrations/webex_bot/tests/ -v`

Expected: PASS.

- [ ] **Step 2: Run targeted UI tests**

Run: `cd ui && npm test -- --runTestsByPath src/lib/rbac/__tests__/webex-space-stores.test.ts src/components/admin/rebac/__tests__/WebexSpaceRebacPanel.test.tsx src/app/api/admin/webex/spaces/__tests__/space-resources-route.test.ts`

Expected: PASS.

- [ ] **Step 3: Run RBAC validation**

Run: `python scripts/validate-rbac-doc.py`

Expected: PASS.

- [ ] **Step 4: Run lint for touched Python and TypeScript**

Run: `uv run ruff check ai_platform_engineering/integrations/webex_bot`

Expected: PASS.

Run: `cd ui && npm run lint`

Expected: PASS or only documented pre-existing failures outside touched files.

- [ ] **Step 5: Run Helm template check**

Run: `helm template caipe charts/ai-platform-engineering --set webex-bot.enabled=true >/dev/null`

Expected: exit code 0.

- [ ] **Step 6: Review git diff**

Run: `git diff --stat && git diff -- docs/docs/specs/2026-05-18-webex-bot-rbac-parity/spec.md docs/docs/specs/2026-05-18-webex-bot-rbac-parity/plan.md`

Expected: New Webex implementation changes are scoped to bot, UI, OpenFGA, deployment, tests, and RBAC docs; no unrelated user changes are reverted.

---

## Spec Coverage Self-Review

- FR-001 through FR-005 are covered by Tasks 5 and 6.
- FR-006 through FR-010 are covered by Tasks 1, 2, 3, and 6.
- FR-011 through FR-013 are covered by Tasks 3 and 4.
- FR-014 and FR-015 are covered by Tasks 5, 6, and 8.
- FR-016 and FR-017 are covered by Task 7.
- FR-018 and FR-019 are covered by Tasks 8 and 9.
- FR-020 is covered by the plan's architecture choice and the explicit instruction to mirror current Slack patterns rather than import old PR code.

No implementation task should commit changes unless the user explicitly requests it. If a commit is requested, use a Conventional Commit subject, DCO sign-off only under explicit delegation rules, and required AI attribution trailers/comments per repo policy.

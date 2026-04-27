---
sidebar_position: 5
---

# RAG & Knowledge Bases API

Reference for the **CAIPE RAG server** (FastAPI) and the **Next.js UI Backend API** routes that proxy or extend RAG functionality. The RAG server validates **Bearer JWT** access tokens (OIDC / Keycloak) via JWKS, resolves roles from realm roles and/or OIDC userinfo (with Redis caching), and optionally enforces team/KB datasource scoping when enterprise RBAC is enabled.

**Role model (RAG server):** `readonly` → `ingestonly` → `admin` (each step adds privileges). Unauthenticated callers are `anonymous` unless trusted-network access is enabled (`ALLOW_TRUSTED_NETWORK` and related env vars).

**Common error shapes (RAG server):**

| Status | Meaning |
|--------|---------|
| `401` | Missing/invalid `Authorization: Bearer`, or malformed header |
| `403` | Authenticated but insufficient role, datasource/KB denied, or CEL policy denied |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate MCP `tool_id`, reserved tool id) |
| `502` | UI Backend API only: upstream RAG server unreachable |

---

## UI Backend API proxy routes (UI → RAG / MongoDB)

### GET|POST|PUT|DELETE `/api/rag/[...path]`

**Auth:** NextAuth session (OIDC); UI Backend API forwards `Authorization: Bearer <accessToken>` and optional `X-Tenant-Id` from session. **Service:** CAIPE UI (UI Backend API) → RAG server.

Catch-all proxy: the path after `/api/rag/` is joined and requested against `RAG_SERVER_URL` or `NEXT_PUBLIC_RAG_URL` (default `http://localhost:9446`). Query string is forwarded on GET and DELETE. JSON body is forwarded on POST and PUT when present.

**Example:** `GET /api/rag/v1/datasources` → `GET {RAG_SERVER_URL}/v1/datasources` with Bearer token.

**Headers forwarded (typical):**

- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`
- `X-Tenant-Id` — when session includes org/tenant

**Response `502` (UI Backend API):**

```json
{
  "error": "Failed to connect to RAG server",
  "details": "TypeError: fetch failed"
}
```

---

### GET|POST|PUT|DELETE `/api/rag/kb/[...path]`

**Auth:** NextAuth session + **Keycloak AuthZ** permission on resource `rag`: `kb.query` (GET), `kb.ingest` (POST), `kb.admin` (PUT/DELETE). **Service:** CAIPE UI (UI Backend API) → RAG server.

Same forwarding rules as the catch-all proxy, but each method is gated by enterprise RBAC (FR-015). Forwards `Authorization`, `X-Tenant-Id`, and `X-Team-Id` when derived from the access token for team-scoped KB resolution on the RAG server.

**Errors:**

- `401` — `{ "error": "Unauthorized" }` if no session user
- `403` — from `requireRbacPermission` when AuthZ denies the scope

**Target URL:** `{RAG_SERVER_URL}/{pathSegments joined}` — e.g. `POST /api/rag/kb/v1/ingest` → `POST {RAG}/v1/ingest`.

---

### GET `/api/rag/tools`

**Auth:** Session + Keycloak AuthZ `rag#tool.view`. **Service:** CAIPE UI (MongoDB; not proxied to RAG).

Lists team-scoped RAG tool documents from collection `team_rag_tools`, filtered by tenant and team membership (or all tenant tools for `admin` / `kb_admin`).

**Response `200`:**

```json
{
  "tools": [
    {
      "tool_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "tenant_id": "acme",
      "team_id": "platform",
      "name": "Platform runbooks",
      "description": "Search internal runbooks",
      "datasource_ids": ["src_web___docs_example_com"],
      "created_by": "sub-or-email",
      "updated_at": "2026-03-25T12:00:00.000Z",
      "status": "active"
    }
  ]
}
```

---

### POST `/api/rag/tools`

**Auth:** Session + Keycloak AuthZ `rag#tool.create`. **Service:** CAIPE UI (MongoDB).

**Request body:**

```json
{
  "name": "My team tool",
  "team_id": "platform",
  "datasource_ids": ["src_web___docs_example_com"],
  "description": "Optional"
}
```

**Response `201`:**

```json
{
  "tool": {
    "tool_id": "uuid",
    "tenant_id": "acme",
    "team_id": "platform",
    "name": "My team tool",
    "description": "Optional",
    "datasource_ids": ["src_web___docs_example_com"],
    "created_by": "user-sub",
    "updated_at": "2026-03-25T12:00:00.000Z",
    "status": "active"
  }
}
```

**Errors:** `400` validation, `403` cross-team or datasource not in team `allowed_datasource_ids`.

---

### GET `/api/rag/tools/{toolId}`

**Auth:** Session + `rag#tool.view`. **Service:** CAIPE UI (MongoDB).

**Response `200`:** `{ "tool": { ... } }`  
**Response `404`:** `{ "error": "Tool not found" }` (or soft-deleted)

---

### PUT `/api/rag/tools/{toolId}`

**Auth:** Session + `rag#tool.update`; caller must be member of tool’s team (or `admin` / `kb_admin`).

**Request body (partial):**

```json
{
  "name": "Updated name",
  "datasource_ids": ["src_web___docs_example_com"],
  "description": "New description"
}
```

**Response `200`:** `{ "tool": { ... } }`

---

### DELETE `/api/rag/tools/{toolId}`

**Auth:** Session + `rag#tool.delete`; same team rules as PUT.

**Response `204`:** No content (soft delete: `status` → `deleted`).

---

## User info

### GET `/v1/user/info`

**Auth:** Optional Bearer JWT or trusted network; **no auth required** (anonymous context returned if absent). **Service:** RAG server.

Returns resolved role, groups, and permission strings for UI gating.

**Response `200`:**

```json
{
  "email": "user@example.com",
  "role": "readonly",
  "is_authenticated": true,
  "groups": ["engineering"],
  "permissions": ["read"],
  "in_trusted_network": false
}
```

---

## Datasource management

### POST `/v1/datasource`

**Auth:** Bearer JWT — minimum role `ingestonly`. **Service:** RAG server.

Creates or updates datasource metadata in Redis. When `RBAC_TEAM_SCOPE_ENABLED` is set, datasource access is checked for the `ingest` scope (`X-Tenant-Id`, `X-Team-Id`).

**Request body:**

```json
{
  "datasource_id": "custom_kb_001",
  "ingestor_id": "webloader:default",
  "description": "Product documentation",
  "source_type": "web",
  "last_updated": 1711363200,
  "default_chunk_size": 10000,
  "default_chunk_overlap": 2000,
  "metadata": {
    "owner_team": "platform"
  }
}
```

**Response `202`:** Accepted (ingest metadata stored).

**Errors:** `401`, `403`, `500`.

---

### DELETE `/v1/datasource`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Query parameters:**

| Name | Description |
|------|-------------|
| `datasource_id` | Required. Datasource to remove from Milvus, metadata, jobs, and graph (if enabled). |

**Response `200`:** OK (empty body or status per deployment).

**Errors:** `400` if ingestion job in progress; `404` datasource not found; `403`, `500`.

---

### GET `/v1/datasources`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Query parameters:**

| Name | Description |
|------|-------------|
| `ingestor_id` | Optional filter |

**Response `200`:**

```json
{
  "success": true,
  "datasources": [
    {
      "datasource_id": "src_web___docs_example_com",
      "ingestor_id": "webloader:webloader",
      "description": "Web content from https://docs.example.com",
      "source_type": "web",
      "last_updated": 1711363200,
      "default_chunk_size": 10000,
      "default_chunk_overlap": 2000,
      "metadata": {}
    }
  ],
  "count": 1
}
```

---

## Ingestors

### GET `/v1/ingestors`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Response `200`:** Array of ingestor records (JSON encoded `IngestorInfo` list).

```json
[
  {
    "ingestor_id": "webloader:webloader",
    "ingestor_type": "webloader",
    "ingestor_name": "webloader",
    "description": "Default web ingestor",
    "metadata": {},
    "last_seen": 1711363200
  }
]
```

---

### POST `/v1/ingestor/heartbeat`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Request body:**

```json
{
  "ingestor_type": "webloader",
  "ingestor_name": "worker-1",
  "description": "Kubernetes pod webloader-7d4f9",
  "metadata": {"region": "us-west-2"}
}
```

**Response `200`:**

```json
{
  "ingestor_id": "webloader:worker-1",
  "message": "Ingestor heartbeat registered",
  "max_documents_per_ingest": 1000
}
```

---

### DELETE `/v1/ingestor/delete`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Query parameters:**

| Name | Description |
|------|-------------|
| `ingestor_id` | Required |

**Response `200`:** Success (metadata removed).  
**Errors:** `404` ingestor not found.

---

## Ingestion jobs

### GET `/v1/job/{job_id}`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Response `200`:**

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "in_progress",
  "message": "Processing batch",
  "created_at": 1711363200,
  "completed_at": null,
  "total": 100,
  "progress_counter": 42,
  "failed_counter": 0,
  "error_msgs": [],
  "datasource_id": "src_web___docs_example_com",
  "document_count": 40,
  "chunk_count": 120
}
```

**Errors:** `404` job not found.

---

### GET `/v1/jobs/datasource/{datasource_id}`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Query parameters:**

| Name | Description |
|------|-------------|
| `status_filter` | Optional: `pending`, `in_progress`, `completed`, `completed_with_errors`, `terminated`, `failed` |

**Response `200`:** JSON array of `JobInfo`.  
**Errors:** `404` if no jobs for datasource.

---

### POST `/v1/jobs/batch`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Request body:**

```json
{
  "datasource_ids": ["ds_a", "ds_b"],
  "status_filter": ["pending", "in_progress"]
}
```

**Response `200`:**

```json
{
  "jobs": {
    "ds_a": [{ "job_id": "...", "status": "pending", "datasource_id": "ds_a" }],
    "ds_b": []
  },
  "total_jobs": 1,
  "datasource_count": 2
}
```

**Errors:** `400` if more than 100 datasource IDs or invalid status strings.

---

### POST `/v1/job`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Query parameters:**

| Name | Description |
|------|-------------|
| `datasource_id` | Required |
| `job_status` | Optional enum |
| `message` | Optional |
| `total` | Optional |

**Response `201`:**

```json
{
  "job_id": "new-uuid",
  "datasource_id": "src_web___docs_example_com"
}
```

**Errors:** `404` datasource not found; `400` create failed.

---

### PATCH `/v1/job/{job_id}`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Query parameters:** `job_status`, `message`, `total` (all optional but at least one typically set).

**Response `200`:**

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "datasource_id": "src_web___docs_example_com"
}
```

**Errors:** `404`, `400` (e.g. terminated job).

---

### POST `/v1/job/{job_id}/terminate`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Response `200`:**

```json
{
  "message": "Job 550e8400-e29b-41d4-a716-446655440000 has been terminated."
}
```

---

### POST `/v1/job/{job_id}/increment-progress`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Query parameters:**

| Name | Default | Description |
|------|---------|-------------|
| `increment` | `1` | Progress delta |

**Response `200`:**

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "progress_counter": 43
}
```

**Errors:** `400` if job terminated.

---

### POST `/v1/job/{job_id}/increment-failure`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Query parameters:** `increment` (default `1`).

**Response `200`:**

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "failed_counter": 2
}
```

---

### POST `/v1/job/{job_id}/add-errors`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Request body (JSON array):**

```json
[
  "Timeout fetching page 12",
  "Parse error in section FAQ"
]
```

**Response `200`:**

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "errors_added": 2,
  "total_errors": 5
}
```

**Errors:** `400` empty array or job terminated.

---

## Query & search

### POST `/v1/query`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

Hybrid semantic + sparse (BM25) search over the unified Milvus collection. Optional metadata `filters` (e.g. `datasource_id`). With team/KB RBAC enabled, filters may be injected or the handler returns `[]` when the user has no accessible KBs.

**Request body:**

```json
{
  "query": "How do I reset the cache?",
  "limit": 10,
  "similarity_threshold": 0.3,
  "filters": {
    "datasource_id": "src_web___docs_example_com"
  },
  "ranker_type": "weighted",
  "ranker_params": {
    "weights": [0.7, 0.3]
  }
}
```

**Response `200`:** Array of hits (LangChain `Document` + score):

```json
[
  {
    "document": {
      "page_content": "To reset the cache, run...",
      "metadata": {
        "datasource_id": "src_web___docs_example_com",
        "title": "Cache operations"
      }
    },
    "score": 0.89
  }
]
```

**Errors:** `400` if `limit` exceeds server max (env `MAX_RESULTS_PER_QUERY`, default 100).

---

## Content ingestion

### POST `/v1/ingest`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

Bulk document ingestion into Milvus (and graph when enabled). Requires an existing datasource and a job in `in_progress` (ingestors usually transition job state before posting chunks).

**Request body:**

```json
{
  "documents": [
    {
      "page_content": "# Heading\nBody text...",
      "metadata": {
        "document_id": "doc-001",
        "datasource_id": "custom_kb_001",
        "ingestor_id": "webloader:webloader",
        "title": "Overview",
        "description": "",
        "is_graph_entity": false,
        "document_type": "markdown",
        "document_ingested_at": 1711363200,
        "fresh_until": 1711449600
      }
    }
  ],
  "ingestor_id": "webloader:webloader",
  "datasource_id": "custom_kb_001",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "fresh_until": 1711449600
}
```

**Response `202`:**

```json
{
  "message": "Text data ingestion started successfully"
}
```

**Errors:** `400` document count over limit, wrong job status, or validation error; `404` datasource/job missing; `403` KB access.

---

### POST `/v1/ingest/webloader/url`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

Queues a new URL crawl on the webloader Redis queue; creates datasource and pending job.

**Request body:**

```json
{
  "url": "https://docs.example.com/guide",
  "description": "Public product guide",
  "settings": {
    "crawl_mode": "sitemap",
    "max_depth": 2,
    "max_pages": 500,
    "chunk_size": 10000,
    "chunk_overlap": 2000
  },
  "reload_interval": 86400
}
```

**Response `202`:**

```json
{
  "datasource_id": "src_web___docs_example_com",
  "job_id": "new-uuid",
  "message": "URL ingestion request queued"
}
```

**Errors:** `400` URL already ingested or job already pending; `500` queue failure.

---

### POST `/v1/ingest/webloader/reload`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Request body:**

```json
{
  "datasource_id": "src_web___docs_example_com"
}
```

**Response `202`:**

```json
{
  "datasource_id": "src_web___docs_example_com",
  "message": "URL reload ingestion request queued"
}
```

**Errors:** `404` unknown datasource.

---

### POST `/v1/ingest/webloader/reload-all`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Request body:** None.

**Response `202`:**

```json
{
  "message": "Reload all URLs request queued"
}
```

---

### POST `/v1/ingest/confluence/page`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Request body:**

```json
{
  "url": "https://company.atlassian.net/wiki/spaces/ENG/pages/123456789/Runbook",
  "description": "Engineering space",
  "get_child_pages": true,
  "allowed_title_patterns": ["^Runbook.*"],
  "denied_title_patterns": ["Draft"]
}
```

**Response `202`:**

```json
{
  "datasource_id": "src_confluence___company_atlassian_net__ENG",
  "job_id": "new-uuid",
  "message": "Confluence page ingestion request queued"
}
```

**Errors:** `400` invalid URL format or wrong Confluence host vs `CONFLUENCE_URL`; `400` if another job pending for that space datasource.

---

### POST `/v1/ingest/confluence/reload`

**Auth:** Bearer JWT — `ingestonly`. **Service:** RAG server.

**Request body:**

```json
{
  "datasource_id": "src_confluence___company_atlassian_net__ENG"
}
```

**Response `202`:** `{ "datasource_id": "...", "message": "Confluence page reload request queued" }`

---

### POST `/v1/ingest/confluence/reload-all`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Response `202`:**

```json
{
  "message": "Reload all Confluence pages request queued"
}
```

---

## Graph explore (entity & ontology)

Requires `ENABLE_GRAPH_RAG=true` and Neo4j. All routes below need Bearer JWT — `readonly`.

### GET `/v1/graph/explore/entity_type`

Lists ontology entity types.

**Response `200`:** JSON object/array as returned by the ontology graph driver.

---

### GET `/v1/graph/explore/data/entities/batch`

**Query:** `offset`, `limit` (1–1000), optional `entity_type`.

**Response `200`:**

```json
{
  "entities": [],
  "count": 0,
  "offset": 0,
  "limit": 100
}
```

---

### GET `/v1/graph/explore/data/relations/batch`

**Query:** `offset`, `limit`, optional `relation_name`.

**Response `200`:**

```json
{
  "relations": [],
  "count": 0,
  "offset": 0,
  "limit": 100
}
```

---

### POST `/v1/graph/explore/data/entity/neighborhood`

**Request body:**

```json
{
  "entity_type": "Service",
  "entity_pk": "payments-api",
  "depth": 2
}
```

**Response `200`:** Neighborhood graph payload (`entity`, neighbors, edges — encoder-dependent).  
**Response `404`:** `{ "message": "Entity not found" }`

---

### GET `/v1/graph/explore/data/entity/start`

**Query:** `n` (1–100) random seed nodes.

**Response `200`:** Array of entity stubs for visualization bootstrap.

---

### GET `/v1/graph/explore/data/stats`

**Response `200`:** Graph statistics (node/relation counts — schema from Neo4j layer).

---

### GET `/v1/graph/explore/ontology/entities/batch`

Same contract as data entities batch, against the ontology graph.

---

### GET `/v1/graph/explore/ontology/relations/batch`

Same contract as data relations batch, ontology graph.

---

### POST `/v1/graph/explore/ontology/entity/neighborhood`

Same body as data neighborhood; uses ontology graph.

---

### GET `/v1/graph/explore/ontology/entity/start`

**Query:** `n` (1–100).

---

### GET `/v1/graph/explore/ontology/stats`

Ontology graph statistics.

---

### GET|POST|DELETE `/v1/graph/ontology/agent/{path}`

**Auth:** Bearer JWT — `readonly` for `GET` **only** when path ends with `/status`; other methods/paths require `admin`. **Service:** RAG server (reverse proxy to `ONTOLOGY_AGENT_RESTAPI_ADDR`, default `http://localhost:8098`).

Streams the ontology agent response (status and headers forwarded). **Errors:** `403` insufficient role; upstream errors pass through as received.

---

## MCP tools configuration (RAG server REST)

Distinct from `/api/rag/tools` (MongoDB team tools). These endpoints configure **MCP search tools** stored in Redis and exposed on the embedded MCP HTTP app at `/mcp` when `ENABLE_MCP=true`.

Reserved tool IDs (cannot be created/deleted via REST; updates return conflict): `search`, `fetch_document`, `list_datasources_and_entity_types`.

### GET `/v1/mcp/tools`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Response `200`:** Map or dict of `tool_id` → `MCPToolConfig`.

```json
{
  "infra_search": {
    "tool_id": "infra_search",
    "description": "Search infrastructure docs",
    "parallel_searches": [
      {
        "label": "results",
        "datasource_ids": ["src_web___docs_example_com"],
        "is_graph_entity": null,
        "extra_filters": {},
        "semantic_weight": 0.5
      }
    ],
    "allow_runtime_filters": false,
    "enabled": true,
    "created_at": 1711363200,
    "updated_at": 1711363200
  }
}
```

---

### POST `/v1/mcp/tools`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Request body:** `MCPToolConfig` (same shape as above; `created_at` / `updated_at` set server-side).

**Response `201`:** Stored config.  
**Errors:** `409` reserved or duplicate `tool_id`.

---

### PUT `/v1/mcp/tools/{tool_id}`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

Body `tool_id` must match path. Preserves `created_at`.

**Errors:** `404`, `400` id mismatch, `409` reserved id.

---

### DELETE `/v1/mcp/tools/{tool_id}`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Response `200`:**

```json
{
  "message": "MCP tool 'infra_search' deleted."
}
```

**Errors:** `404`, `409` reserved id.

---

### GET `/v1/mcp/builtin-config`

**Auth:** Bearer JWT — `readonly`. **Service:** RAG server.

**Response `200`:**

```json
{
  "search_enabled": true,
  "fetch_document_enabled": true,
  "fetch_datasources_enabled": true,
  "graph_explore_ontology_entity_enabled": true,
  "graph_explore_data_entity_enabled": true,
  "graph_fetch_data_entity_details_enabled": true,
  "graph_shortest_path_between_entity_types_enabled": true,
  "graph_raw_query_data_enabled": true,
  "graph_raw_query_ontology_enabled": true
}
```

---

### PUT `/v1/mcp/builtin-config`

**Auth:** Bearer JWT — `admin`. **Service:** RAG server.

**Request body:** Same shape as GET; toggles built-in MCP tools after reload.

**Response `200`:** Updated config JSON.

---

## Health

### GET `/healthz`

**Auth:** None required. **Service:** RAG server.

Returns process health, timestamp, optional error details, and a large `config` snapshot (Milvus, Redis, embeddings model, datasource list, graph settings when enabled).

**Response `200`:**

```json
{
  "status": "healthy",
  "timestamp": 1711363200,
  "details": {},
  "config": {
    "graph_rag_enabled": true,
    "search": {
      "keys": ["document_id", "datasource_id", "title"]
    },
    "vector_db": {
      "milvus": {
        "uri": "http://localhost:19530",
        "collections": ["rag_default"],
        "index_params": {}
      }
    },
    "embeddings": { "model": "text-embedding-3-small" },
    "metadata_storage": { "redis": { "url": "redis://localhost:6379" } },
    "ui_url": "http://localhost:9447",
    "datasources": []
  }
}
```

When dependencies are not initialized, `status` may be `unhealthy` with `details.error` set.

---

## MCP HTTP transport (reference)

When enabled, FastMCP exposes **`/mcp`** on the same server. If `MCP_AUTH_ENABLED=true`, requests must include `Authorization: Bearer <token>` (or trusted network), enforced by middleware. This is the **Model Context Protocol** streamable HTTP surface for agents, not the REST JSON API above.

---

## JWT validation (direct clients)

The RAG server’s `auth` module validates access tokens against configured OIDC providers (`OIDC_ISSUER` / `OIDC_DISCOVERY_URL` + `OIDC_AUDIENCE`, optional second ingestor issuer). Tokens must include a JWKS `kid`; signature algorithms RS/ES families are supported. User tokens trigger userinfo fetch (cached) for email and groups when resolving legacy group-based roles.

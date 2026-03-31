# RAG: Graph Entity → Structured Entity Rename

## Overview

This document outlines the comprehensive plan to rename "graph entity" to "structured entity" across the entire codebase. The goal is to decouple the concept of structured/entity-based documents from being specifically "graph-based," making the terminology more accurate and flexible.

## Decisions

| Decision Point | Resolution |
|----------------|------------|
| Backwards compatibility for existing Milvus data | **Not needed** — old documents will be cleaned up by periodic cleanup |
| `graph:` prefix in `document_type`/`document_id` | **Change to `structured:`** — new ingestion will replace old docs, periodic cleanup handles stale ones |
| LLM tool schema changes | **OK** — agents will be redeployed alongside this change |
| Prompt config updates | **Update** — deployed at same time as code |
| Scope | **Pure rename** — no logic changes, no field removal |
| Test ingestor rename | `test_dummy_graph` → `dummy_structured_ingestor` |

## What Changes vs What Stays

### RENAME (Target of this change)
- `is_graph_entity` field → `is_structured_entity`
- `graph_entity_type` metadata key → `structured_entity_type`
- `graph_entity_pk` metadata key → `structured_entity_pk`
- `graph:` prefix in `document_type`/`document_id` → `structured:`
- All method names, variables, UI labels, and documentation containing "graph entity"

### STAYS (Graph RAG Infrastructure)
- `graph_rag_enabled` / `ENABLE_GRAPH_RAG` — feature flag for the graph DB
- `graph_rag` docker profile — activates Neo4j services
- All `/v1/graph/explore/` API routes — graph DB browsing endpoints
- All `graph_explore_*_enabled` / `graph_fetch_*_enabled` config keys — graph DB tool toggles
- `MCPBuiltinToolsConfig` graph tool fields
- Neo4j services, `agent_ontology` service
- `GraphView.tsx`, `KnowledgeSidebar.tsx` "Graph" nav label — refers to the graph explorer feature
- LangGraph, GraphQL references

---

## Execution Plan (14 Steps)

### Step 1: Core Models — `common/models/rag.py`

**Root of all renames.** Everything else derives from these field names.

| Line | Change |
|------|--------|
| 68 | Description: `"graph entities"` → `"structured entities"` |
| 73 | `is_graph_entity` → `is_structured_entity`, description updated |
| 74 | Description: `"For graph entities"` → `"For structured entities"` |
| 131 | `is_graph_entity` → `is_structured_entity` on `ParallelSearch`, description updated |

### Step 2: Common Ingestor — `common/ingestor.py`

| Line | Change |
|------|--------|
| 358 | `_extract_graph_entity_title` → `_extract_structured_entity_title` |
| 366 | `"Graph entity of type"` → `"Structured entity of type"` |
| 367 | `is_graph_entity=True` → `is_structured_entity=True` |
| 370 | Comment: `graph_entity_type` → `structured_entity_type`, `graph_entity_pk` → `structured_entity_pk` |
| 417 | Method def: `_extract_graph_entity_title` → `_extract_structured_entity_title` |
| 439 | `"Graph Entity"` → `"Structured Entity"` |
| 607 | Docstring: `"graph entity"` → `"structured entity"` |

### Step 3: Common Agent Tools — `common/agent/tools.py`

| Line | Change |
|------|--------|
| 33 | Parameter: `graph_entity_type` → `structured_entity_type` |
| 35-46 | Docstrings: all `"graph entity/entities"` → `"structured entity/entities"` |
| 48 | Log: `graph_entity_type` → `structured_entity_type` |
| 56 | API payload key: `"graph_entity_type"` → `"structured_entity_type"` |
| 72 | Result type: `"graph_entity"` → `"structured_entity"` |
| 75 | Response keys: `"graph_entities"` → `"structured_entities"`, `"total_graph_entities"` → `"total_structured_entities"` |
| 83 | Log: update dict key references |

### Step 4: Server Ingestion — `server/ingestion.py`

This is the heaviest file with the most changes.

**Method renames:**

| Current | New |
|---------|-----|
| `_process_graph_entity_document` | `_process_structured_entity_document` |
| `_parse_graph_entity` | `_parse_structured_entity` |
| `split_nested_graph_entity` | `split_nested_structured_entity` |
| `graph_document_type` | `structured_document_type` |
| `graph_document_id` | `structured_document_id` |
| `parse_graph_entity_from_document_id` | `parse_structured_entity_from_document_id` |

**Stored data prefixes:**

| Current | New |
|---------|-----|
| `f"graph:{entity_type}"` | `f"structured:{entity_type}"` |
| `f"graph:{entity_type}:{entity_pk}"` | `f"structured:{entity_type}:{entity_pk}"` |
| `parts[0] != "graph"` | `parts[0] != "structured"` |

**Metadata keys:**

| Current | New |
|---------|-----|
| `"graph_entity_type"` | `"structured_entity_type"` |
| `"graph_entity_pk"` | `"structured_entity_pk"` |

**Field references:** All `is_graph_entity` → `is_structured_entity` (lines 185, 208, 334, 649, 675, 725, 761)

**Log/job messages:** All 8+ strings containing "graph entity" → "structured entity"

### Step 5: Server REST API — `server/restapi.py`

| Line | Change |
|------|--------|
| 737 | Milvus `output_fields`: `"is_graph_entity"` → `"is_structured_entity"` |
| 763 | Response key: `"is_graph_entity"` → `"is_structured_entity"` |
| 1649 | Healthz key: `"graph_entity_types"` → `"structured_entity_types"` |
| 166, 651 | Log strings: `"stale graph entities"` → `"stale structured entities"` |
| 1286 | Docstring: `"graph data"` → `"structured entity data"` |

### Step 6: Server MCP Tools — `server/tools.py`

| Line | Change |
|------|--------|
| 111 | `ps.is_graph_entity` → `ps.is_structured_entity` |
| 113 | Substring filter: `"graph_entity" not in k` → `"structured_entity" not in k` |
| 150 | `ps.is_graph_entity` → `ps.is_structured_entity` |
| 151 | `q_filters["is_graph_entity"]` → `q_filters["is_structured_entity"]` |

### Step 7: Server Query Service — `server/query_service.py`

| Line | Change |
|------|--------|
| 35 | Docstring: `graph_entity_type` → `structured_entity_type` |

### Step 8: Ingestors (5 files)

All set `is_graph_entity=False` → `is_structured_entity=False`:

| File | Line(s) |
|------|---------|
| `webex/ingestor.py` | 332, 391 |
| `confluence/loader.py` | 396 |
| `webloader/loader/scrapy_worker.py` | 502 (raw dict key) |
| `webloader/loader/pipelines/document.py` | 99 |

### Step 9: Test Dummy Ingestor

**Directory renames:**
1. `ingestors/src/ingestors/test_dummy_graph/` → `ingestors/src/ingestors/dummy_structured_ingestor/`
2. `rag/tests/rag_graph_test/` → `rag/tests/rag_structured_test/`

**Inside `ingestor.py`:**

| Current | New |
|---------|-----|
| `source_type="dummy_graph_entites"` | `source_type="dummy_structured_entities"` (also fixes typo) |
| `"graph entities"` comment | `"structured entities"` |
| `"dummy graph ingestor"` log | `"dummy structured ingestor"` |
| `.name("test_dummy_graph")` | `.name("dummy_structured_ingestor")` |
| `.description("Ingestor for dummy graph entities")` | `"Ingestor for dummy structured entities"` |

**Update `docker-compose.dev.yaml`:**

| Current | New |
|---------|-----|
| Service: `dummy-graph-ingestor` | `dummy-structured-ingestor` |
| Image: `dummy-graph-ingestor:local` | `dummy-structured-ingestor:local` |
| Comments (3 lines) | Update references |
| `INGESTOR_TYPE=test_dummy_graph` | `INGESTOR_TYPE=dummy_structured_ingestor` |
| Volume: `rag/tests/rag_graph_test` | `rag/tests/rag_structured_test` |

### Step 10: Frontend Types (2 files)

**`ui/src/lib/rag-api.ts`:**

| Line | Change |
|------|--------|
| 281 | `graph_entity_type` → `structured_entity_type` |
| 386 | `is_graph_entity` → `is_structured_entity` |

**`ui/src/components/rag/api/index.ts`:**

| Line | Change |
|------|--------|
| 169 | `is_graph_entity` → `is_structured_entity` |

### Step 11: Frontend Components (3 files)

**`MCPToolsView.tsx`:**
- `isGraphEntityOptions` → `isStructuredEntityOptions`
- All `is_graph_entity` → `is_structured_entity` (constant, onClick, conditional)
- Labels: `"Graph"` → `"Structured"`, hint `"Graph entities only"` → `"Structured entities only"`
- Help text: all 3 lines updated
- Tool descriptions: `"graph entities"` → `"structured entities"`
- Badges: `"graph"` → `"structured"`

**`SearchView.tsx`:**
- `isGraphEntityFilter` → `isStructuredEntityFilter`
- `setIsGraphEntityFilter` → `setIsStructuredEntityFilter`
- API key: `'is_graph_entity'` → `'is_structured_entity'`
- Button labels: `'Graph'` → `'Structured'`
- Filter exclusion: `key !== 'is_graph_entity'` → `key !== 'is_structured_entity'`

**`IngestView.tsx`:**
- `chunk.metadata.is_graph_entity` → `chunk.metadata.is_structured_entity`
- Badge: `"Graph"` → `"Structured"`
- Dialog text: `"graph entities"` → `"structured entities"`

### Step 12: Tests — `server/tests/test_e2e.py`

- Method names: `test_graph_entity_types` → `test_structured_entity_types`, `test_graph_entity_ingestion` → `test_structured_entity_ingestion`
- All docstrings, print messages, error messages
- Filter value: `"doc_type": "graph_entity"` → `"doc_type": "structured_entity"`
- Metadata key reads: `metadata.get("graph_entity_type")` → `metadata.get("structured_entity_type")`

### Step 13: Documentation (6 files)

| File | Changes |
|------|---------|
| `server/ARCHITECTURE.md` | Section headings, definitions, filter key docs (12 refs) |
| `docs/docs/knowledge_bases/mcp-tools.md` | Filter table rows, code example (3 refs) |
| `docs/docs/knowledge_bases/architecture.md` | Prose, diagram text (2 refs) |
| `docs/research/rag-milvus-data-cleanup.md` | Example JSON, mockup, metadata table (5 refs) |
| `rag/Architecture.md` | ASCII diagram, feature list (3 refs) |
| `PLAN.md` | Draft code with filter keys (6 refs) |

**Note:** `CHANGELOG.md` is NOT modified — it's a historical record.

### Step 14: Deployment Prompt Configs (4 files)

All 4 files get identical updates:
- `charts/ai-platform-engineering/data/prompt_config.rag.yaml`
- `deployment/.../dev/a/values_prompt_config_rag.yaml`
- `deployment/.../preview/a/values_prompt_config_rag.yaml`
- `deployment/.../prod/a/values_prompt_config_rag.yaml`

Changes per file (8 refs each):
- `"graph_entity_documents"` → `"structured_entity_documents"`
- `graph_entity_type` → `structured_entity_type` (backtick refs)
- `graph_entity_pk` → `structured_entity_pk` (backtick refs)
- `"Graph entities"` → `"Structured entities"` (prose, 4+ occurrences)

---

## Summary Statistics

| Category | Files | References |
|----------|-------|------------|
| Core models | 1 | 4 |
| Common ingestor | 1 | 7 |
| Common agent tools | 1 | 10 |
| Server ingestion | 1 | 28 |
| Server REST API | 1 | 5 |
| Server tools | 1 | 4 |
| Server query service | 1 | 1 |
| Ingestors (non-graph) | 4 | 5 |
| Test dummy ingestor | 1 (+dir) | 5 |
| Docker-compose | 1 | 5 |
| Frontend types | 2 | 3 |
| Frontend components | 3 | 18 |
| Tests | 1 | 13 |
| Documentation | 6 | 32 |
| Prompt configs | 4 | 32 |
| **TOTAL** | **~29 files** | **~170 references** |

## Commit Strategy

Single atomic commit: `refactor(rag): rename graph entity to structured entity`

All changes must be deployed together since they affect:
- Backend field names and stored data prefixes
- Frontend TypeScript types
- LLM-facing tool schemas
- Prompt configurations

## Verification

After implementation:
1. Run `uv run ruff check` in RAG packages
2. Run `npm run lint && npm run build` in UI
3. Run e2e tests with `--with-graph` flag
4. Verify new ingestion creates `structured:` prefixed documents
5. Verify search filters work with `is_structured_entity`
6. Verify periodic cleanup removes old `graph:` prefixed documents

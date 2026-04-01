# RAG: Graph Entity → Structured Entity Rename

## Overview

This document outlines the comprehensive plan to rename "graph entity" to "structured entity" across the entire codebase. The goal is to decouple the concept of structured/entity-based documents from being specifically "graph-based," making the terminology more accurate and flexible.

This includes two related changes:
1. **Milvus layer**: Rename fields/prefixes that identify entity-sourced documents (`is_graph_entity`, `graph:` prefix, etc.)
2. **Core model layer**: Rename and relocate the `Entity` model to decouple it from graph-specific terminology, making it backend-agnostic for future flexibility (e.g., LPG → RDF migration)

## Decisions

| Decision Point | Resolution |
|----------------|------------|
| Backwards compatibility for existing Milvus data | **Not needed** — old documents will be cleaned up by periodic cleanup |
| `graph:` prefix in `document_type`/`document_id` | **Change to `structured:`** — new ingestion will replace old docs, periodic cleanup handles stale ones |
| LLM tool schema changes | **OK** — agents will be redeployed alongside this change |
| Prompt config updates | **Update** — deployed at same time as code |
| Scope | **Pure rename** — no logic changes, no field removal |
| Test ingestor rename | `test_dummy_graph` → `dummy_structured_ingestor` |
| Entity model location | **Move from `graph.py` to `rag.py`** — decouples from graph-specific module |
| Entity model naming | **`Entity` → `StructuredEntity`**, **`EntityIdentifier` → `StructuredEntityId`** |
| `additional_labels` field | **Rename to `additional_types`** — removes Neo4j-specific terminology |
| Dead code (`get_hash`, `summary`) | **Remove** — never called anywhere |

## What Changes vs What Stays

### RENAME (Target of this change)

**Milvus/RAG layer:**
- `is_graph_entity` field → `is_structured_entity`
- `graph_entity_type` metadata key → `structured_entity_type`
- `graph_entity_pk` metadata key → `structured_entity_pk`
- `graph:` prefix in `document_type`/`document_id` → `structured:`
- All method names, variables, UI labels, and documentation containing "graph entity"

**Core model layer:**
- `Entity` class → `StructuredEntity` (moved from `models/graph.py` to `models/rag.py`)
- `EntityIdentifier` class → `StructuredEntityId` (moved from `models/graph.py` to `models/rag.py`)
- `additional_labels` field → `additional_types`
- Remove dead methods: `get_hash()`, `summary()` (never called)
- Keep: `generate_primary_key()`, `get_identifier()`, `get_external_properties()`

### STAYS (Graph RAG Infrastructure)
- `graph_rag_enabled` / `ENABLE_GRAPH_RAG` — feature flag for the graph DB
- `graph_rag` docker profile — activates Neo4j services
- All `/v1/graph/explore/` API routes — graph DB browsing endpoints
- All `graph_explore_*_enabled` / `graph_fetch_*_enabled` config keys — graph DB tool toggles
- `MCPBuiltinToolsConfig` graph tool fields
- Neo4j services, `agent_ontology` service
- `GraphView.tsx`, `KnowledgeSidebar.tsx` "Graph" nav label — refers to the graph explorer feature
- LangGraph, GraphQL references
- `Relation`, `EntityTypeMetaRelation` — stay in `models/graph.py` (pure graph concepts)

---

## Execution Plan (17 Steps)

### Part A: Core Model Rename (Steps 0a-0c)

These steps establish the foundation — the `StructuredEntity` model that everything else references.

### Step 0a: Create `StructuredEntity` and `StructuredEntityId` in `models/rag.py`

Add new classes to `common/models/rag.py`:

```python
class StructuredEntityId(BaseModel):
    """Uniquely identifies a structured entity."""
    entity_type: str
    primary_key: str


class StructuredEntity(BaseModel):
    """
    A structured entity for ingestion and storage.
    Backend-agnostic representation of typed, structured data.
    """
    entity_type: str
    additional_types: Optional[set[str]] = None
    all_properties: dict[str, Any] = Field(description="The properties of the entity")
    primary_key_properties: List[str] = Field(description="The primary key properties of the entity")
    additional_key_properties: Optional[List[List[str]]] = Field(
        description="The secondary key properties of the entity", default=[]
    )

    def generate_primary_key(self) -> str:
        """Generates a primary key from the primary key properties."""
        return PROP_DELIMITER.join([str(self.all_properties[k]) for k in self.primary_key_properties])

    def get_identifier(self) -> StructuredEntityId:
        """Generates an identifier for this entity."""
        return StructuredEntityId(entity_type=self.entity_type, primary_key=self.generate_primary_key())

    def get_external_properties(self) -> dict[str, Any]:
        """Returns all properties that are not internal (i.e., do not start with _)."""
        return {k: v for k, v in self.all_properties.items() if not k.startswith("_")}
```

**Note:** `get_hash()` and `summary()` are **removed** — they are dead code (never called).

### Step 0b: Update `models/graph.py` — Remove `Entity`, `EntityIdentifier`, update `Relation`

After moving the entity classes to `rag.py`:

```python
# models/graph.py — what remains
from common.models.rag import StructuredEntityId

class Relation(BaseModel):
    """Represents a relationship between two entities."""
    from_entity: StructuredEntityId  # was EntityIdentifier
    to_entity: StructuredEntityId    # was EntityIdentifier
    relation_name: str
    relation_pk: str
    relation_properties: Optional[dict[str, Any]] = None


class EntityTypeMetaRelation(BaseModel):
    """Represents a meta relationship between two entity types."""
    from_entity_type: str
    to_entity_type: str
    relation_name: str
```

### Step 0c: Update all imports (18 files)

| File | Before | After |
|------|--------|-------|
| `ingestors/argocdv3/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `ingestors/aws/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `ingestors/backstage/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `ingestors/github/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `ingestors/k8s/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `ingestors/test_dummy_graph/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `common/ingestor.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `common/utils.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `common/agent/tools.py` | `from common.models.graph import EntityIdentifier` | `from common.models.rag import StructuredEntityId` |
| `graph_db/base.py` | `from common.models.graph import Entity, Relation, EntityIdentifier` | `from common.models.rag import StructuredEntity, StructuredEntityId` + `from common.models.graph import Relation` |
| `graph_db/neo4j/graph_db.py` | `from common.models.graph import Entity, EntityIdentifier, Relation` | `from common.models.rag import StructuredEntity, StructuredEntityId` + `from common.models.graph import Relation` |
| `server/ingestion.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `server/tools.py` | `from common.models.graph import Entity, EntityIdentifier` | `from common.models.rag import StructuredEntity, StructuredEntityId` |
| `agent_ontology/heuristics.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `agent_ontology/ontology_cache.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `agent_ontology/relation_manager.py` | `from common.models.graph import Entity, Relation` | `from common.models.rag import StructuredEntity` + `from common.models.graph import Relation` |
| `common/tests/test_neo4j.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |
| `agent_ontology/tests/test_heuristics.py` | `from common.models.graph import Entity` | `from common.models.rag import StructuredEntity` |

**Additionally**, rename all usages within these files:
- `Entity` → `StructuredEntity` (class references, type hints, instantiations)
- `EntityIdentifier` → `StructuredEntityId`
- `additional_labels` → `additional_types` (~31 references across 6 files)

### Step 0d: `additional_labels` → `additional_types` rename details

| File | Line(s) | Context |
|------|---------|---------|
| `models/rag.py` (new) | field def | `additional_types: Optional[set[str]] = None` |
| `graph_db/neo4j/graph_db.py` | 288, 584, 680, 724-731, 737, 742, 764, 776, 783, 1059, 1499, 1538, 1553, 1654 | Entity instantiation and grouping |
| `server/ingestion.py` | 391, 396, 504, 507, 514 | Sub-entity creation, entity processing |
| `agent_ontology/ontology_cache.py` | 41, 77, 80, 101 | Sub-entity detection, ontology entity creation |
| `agent_ontology/heuristics.py` | 211 | Sub-entity label check |
| `server/tests/test_e2e.py` | 351 | Test entity JSON |

**Note:** The constant `SUB_ENTITY_LABEL` stays as-is — it's a value stored in `additional_types`, not a field name.

### Part B: Milvus/RAG Layer Rename (Steps 1-14)

These steps rename the Milvus-layer fields, prefixes, and UI labels.

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
| **Part A: Core Model Rename** | | |
| Model definitions (rag.py, graph.py) | 2 | 8 |
| Import updates | 18 | 18 |
| `Entity` → `StructuredEntity` usages | 18 | ~80 |
| `EntityIdentifier` → `StructuredEntityId` usages | 5 | ~15 |
| `additional_labels` → `additional_types` | 6 | 31 |
| **Part A Subtotal** | **~20 files** | **~150 references** |
| | | |
| **Part B: Milvus/RAG Layer Rename** | | |
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
| **Part B Subtotal** | **~29 files** | **~170 references** |
| | | |
| **TOTAL** | **~35 files** | **~320 references** |

*Note: Some files appear in both Part A and Part B (e.g., ingestors, server/ingestion.py)*

## Commit Strategy

Single atomic commit: `refactor(rag): rename graph entity to structured entity`

All changes must be deployed together since they affect:
- Core model class names and locations
- Backend field names and stored data prefixes
- Frontend TypeScript types
- LLM-facing tool schemas
- Prompt configurations

## Execution Order

1. **Part A first**: Core model rename (`Entity` → `StructuredEntity`, move to `rag.py`)
2. **Part B second**: Milvus layer rename (`is_graph_entity` → `is_structured_entity`, etc.)

This order ensures that when we update ingestors and server code in Part B, they're already using `StructuredEntity`.

## Verification

After implementation:
1. Run `uv run ruff check` in RAG packages
2. Run `npm run lint && npm run build` in UI
3. Run e2e tests with `--with-graph` flag
4. Verify new ingestion creates `structured:` prefixed documents
5. Verify search filters work with `is_structured_entity`
6. Verify periodic cleanup removes old `graph:` prefixed documents
7. Verify all ingestors work with `StructuredEntity` model

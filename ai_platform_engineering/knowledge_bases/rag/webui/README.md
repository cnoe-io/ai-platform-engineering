# RAG Frontend UI

React-based frontend for the RAG (Retrieval-Augmented Generation) knowledge base platform. Provides interfaces for data ingestion, hybrid search, and interactive graph visualization of entity relationships.

## Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS
- **HTTP Client**: Axios
- **Graph Visualization**: Sigma.js 3 with Graphology
- **Graph Layout**: ForceAtlas2

## Architecture

### Core Components

#### `App.tsx`
Main application shell with three-tab navigation (Ingest, Search, Graph). Manages global state including backend health monitoring and graph RAG feature toggle.

#### `IngestView.tsx`
Data source management interface. Displays data sources, ingestors, and ingestion jobs with expandable details. Supports URL ingestion with sitemap discovery and real-time job status polling.

**Key features:**
- WebLoader URL ingestion with sitemap support
- Job status tracking (pending, in_progress, completed, failed)
- Data source reload and deletion
- Filter by source type
- Expandable metadata and error logs

#### `SearchView.tsx`
Hybrid search interface combining semantic (vector) and keyword (BM25) search with adjustable weight sliders.

**Search capabilities:**
- Weighted ranking (semantic vs. keyword balance)
- Dynamic filters (doc_type, data source, entity type)
- Graph entity filtering (all/graph entities/non-graph entities)
- Entity exploration from search results
- Result limit and similarity threshold controls

#### `GraphView.tsx`
Tab switcher between Ontology and Data graph views. Manages entity exploration state from search results.

### Graph Visualization

All graph components use **Sigma.js** with **Graphology** for rendering and **ForceAtlas2** for physics-based layout.

#### `OntologyGraph/OntologyGraphSigma.tsx`
Visualizes entity type relationships and their evaluation status. Agent-driven ontology analysis with relation evaluation workflow.

**Features:**
- Entity type nodes with prefix-based grouping
- Relation edges with evaluation states (accepted/rejected/uncertain)
- Edge thickness based on heuristic match counts (z-score normalization)
- Bidirectional relation detection
- Relation management (evaluate, accept, reject, sync)
- Property mapping configuration
- Agent status monitoring
- ForceAtlas2 layout with configurable parameters
- Entity type filtering
- Relation status filtering

**Graph construction:**
1. Batch fetch all entities and relations from backend
2. Group nodes by entity type prefix (e.g., `argocd_`, `nexus_`)
3. Position groups radially with random distribution within groups
4. Group relations by node pairs and evaluation status
5. Apply ForceAtlas2 layout with Barnes-Hut optimization
6. Fetch heuristics in batch for edge thickness calculation
7. Fetch evaluations in batch for edge coloring

#### `DataGraph/DataGraphSigma.tsx`
Explores entity instances and their actual data relationships through neighborhood queries.

**Features:**
- Start exploration from search results or manual entity selection
- Recursive sub-entity expansion (auto-explores `NxsSubEntity` nodes)
- Incremental graph building (merge mode)
- Focus mode (clear and re-explore from a single entity)
- Keyboard shortcuts (E: explore, F: focus)
- Entity highlighting for explored nodes
- Reset to initial entity

**Graph construction:**
1. Call `/v1/graph/explore/data/entity/neighborhood` with depth=1
2. Recursively explore sub-entities (detected by `NxsSubEntity` label)
3. Store entities and relations in local maps
4. Detect bidirectional relations by node pairs
5. Apply ForceAtlas2 layout
6. Preserve center entity position when merging

#### `shared/SigmaGraph/SigmaGraph.tsx`
Reusable Sigma.js graph wrapper with common controllers.

**Controllers:**
- `CameraController`: Auto-fit viewport on data changes
- `GraphDragController`: Drag-to-move nodes
- `GraphEventsController`: Click, hover, and keyboard handlers
- `GraphSettingsController`: Dynamic node/edge styling based on state
- `GraphDataController`: Filter visibility based on filters prop

**Common features:**
- Zoom and fullscreen controls
- Loading overlay
- Empty state
- Hover cards
- Details cards (positioned to work in fullscreen)

### Graph Styling

#### `graphStyles.ts`
Centralized color mapping and edge styling logic.

**Node colors:**
- Prefix-based (e.g., `argocd_*` → blue, `nexus_*` → purple)
- Default fallback color for unmapped prefixes

**Edge styling:**
- Thickness based on heuristic total_matches (z-score normalization)
- Color based on evaluation result (gray: accepted, red: rejected, orange: uncertain)
- Multiple relation indicator (edge label shows count)
- Bidirectional symbol (⟷) for two-way relations

### API Client (`api/index.ts`)

Axios-based client with endpoints for:
- **Data Sources**: List, delete, reload
- **Ingestion**: URL ingest (webloader), job status polling
- **Search**: Hybrid search with filters and ranking
- **Ontology Graph**: Entity/relation batch fetch, agent operations
- **Data Graph**: Neighborhood exploration
- **Relation Management**: Evaluate, accept, reject, sync operations

Base URL configured via `VITE_API_BASE` environment variable (defaults to proxy mode).

## Data Ingestion Flow

1. User submits URL via `IngestView`
2. Backend creates data source and job
3. Frontend polls job status every 2 seconds
4. Job progress displayed with progress bar (processed/total)
5. On completion, data source appears in list with last job status
6. User can reload (re-ingest) or delete data source

## Search Flow

1. User enters query and adjusts semantic/keyword weight slider
2. Optional: Apply filters (doc_type, is_graph_entity, etc.)
3. Backend performs hybrid search (semantic + BM25)
4. Results displayed with scores and metadata
5. Graph entities show "Explore" button
6. Click "Explore" switches to Data Graph tab and starts neighborhood exploration

## Graph Visualization Flow

### Ontology Graph

1. Batch fetch all entities and relations on mount
2. Build graph with ForceAtlas2 layout
3. Fetch heuristics and evaluations in batch
4. User filters by entity type or relation status
5. Click node to see outgoing/incoming relations
6. Select relation to evaluate, accept, or reject
7. Agent processes updates in background
8. Refresh to see updated graph

### Data Graph

1. Start from search result or manual entity selection
2. Call neighborhood API (depth=1)
3. Auto-expand sub-entities recursively
4. Render graph with ForceAtlas2 layout
5. Hover node + press E to explore (merge)
6. Hover node + press F to focus (clear + explore)
7. Click node to see relations and explore neighbors
8. Reset to return to initial entity

## Graph Rendering with Sigma.js

**Graphology graph structure:**
- `MultiDirectedGraph` allows multiple edges between nodes (important for grouped relations)
- Nodes stored with attributes: `label`, `size`, `color`, `entityType`, `entityData`, `x`, `y`, `hidden`
- Edges stored with attributes: `label`, `type`, `size`, `color`, `relationIds[]`, `hidden`

**ForceAtlas2 layout:**
- Physics-based force-directed graph layout
- Barnes-Hut optimization for large graphs
- Configurable gravity, scaling ratio, slow down
- Applied once on graph construction (not continuous)

**Sigma.js rendering:**
- Canvas-based WebGL rendering for performance
- Edge labels enabled
- Arrow types for directed edges, line types for bidirectional
- Z-index layering for selected/hovered states
- Fullscreen support

**Performance optimizations:**
- Batch API calls for entities, relations, heuristics, evaluations
- Visibility filtering (hidden nodes/edges not rendered)
- Truncated labels for long text
- Degree-based node sizing
- Z-score normalization for edge thickness

## Running Locally

### Prerequisites

- Node.js LTS
- Backend server running at `http://localhost:9446`

### Steps

```bash
cd webui
npm install
npm run dev
```

The application will be available at [http://localhost:5173](http://localhost:5173).

### Environment Variables

- `VITE_API_BASE`: Backend API URL (optional, defaults to proxy mode)

## Build

```bash
npm run build
```

Outputs to `dist/` directory. Serve with any static file server or reverse proxy (nginx).

## Key Technologies

### Sigma.js
WebGL-based graph rendering library. Handles large graphs efficiently with canvas rendering and spatial indexing.

### Graphology
Graph data structure library. Provides efficient graph manipulation, traversal, and algorithm support.

### ForceAtlas2
Force-directed layout algorithm. Positions nodes based on attractive (edges) and repulsive (nodes) forces, creating organic, readable layouts.

### React Sigma
React bindings for Sigma.js with controller pattern. Enables declarative graph rendering with React state management.

## Graph Data Models

### Ontology Entity
```typescript
{
  entity_type: string;
  additional_labels: string[];
  all_properties: Record<string, any>;
  primary_key_properties: string[];
  additional_key_properties: string[];
}
```

### Ontology Relation
```typescript
{
  from_entity: { entity_type: string; primary_key: string };
  to_entity: { entity_type: string; primary_key: string };
  relation_name: string;
  relation_pk: string;
  relation_properties: Record<string, any>;
}
```

### Heuristics Data
```typescript
{
  total_matches: number;
  value_match_quality_avg: number;
  deep_match_quality_avg: number;
  property_mappings: Array<{
    entity_a_property: string;
    entity_b_idkey_property: string;
    match_type: 'exact' | 'prefix' | 'suffix' | 'subset' | 'superset' | 'contains';
  }>;
}
```

### Evaluation Data
```typescript
{
  evaluation: {
    result: 'ACCEPTED' | 'REJECTED' | 'UNSURE';
    relation_name: string;
    directionality?: string;
    property_mappings?: Array<...>;
    is_manual?: boolean;
  } | null;
  sync_status: {
    is_synced: boolean;
    last_synced?: number;
  } | null;
}
```

## Notes

- Graph entity exploration is disabled when `graph_rag_enabled` is false in backend config
- Ontology relations are evaluated by background agent (status polling every 1-5 seconds)
- Data graph sub-entity expansion is recursive with max depth of 10
- Edge thickness normalization uses z-scores to handle outliers
- Bidirectional relations are detected and rendered as undirected lines (no arrow)

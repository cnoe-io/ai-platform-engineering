# DataGraphSigma - Implementation Details

## Overview

DataGraphSigma visualizes data entity relationships by exploring a neighborhood graph up to depth 3 from a given entity.

## How It Works

### 1. Entity Exploration

Users can explore an entity in two ways:

**A. From SearchView**
- User searches for entities in the Search tab
- Graph entity results show an "Explore" button
- Clicking "Explore" sends `exploreEntityData` prop to DataGraphSigma
- Format: `{ entityType: string, primaryKey: string }`

**B. Manual Input**
- User selects entity type from dropdown
- User enters primary key in text input
- Clicks "Explore" button

### 2. API Call

```typescript
exploreDataNeighborhood(primaryKey, 3)
```

Calls: `GET /v1/graph/explore/data?entity_pk={pk}&depth=3`

**Response Format**:
```json
{
    "entity": { /* Main entity being explored */ },
    "entities": [ /* All entities in neighborhood */ ],
    "relations": [ /* All relations between entities */ ]
}
```

See `example-response-neighbourhood.json` for full response structure.

### 3. Graph Building

**Node Creation**:
- All entities from `entities` array are added as nodes
- **Center node** (the explored entity) is **25px** (largest)
- Other nodes are **15px** (then adjusted by degree to 10-22px)
- Nodes are colored by entity type prefix (aws, k8s, backstage, etc.)

**Edge Creation**:
- All relations from `relations` array are added as edges
- Edges are directed (arrows)
- Labeled with `relation_name`

**Layout**:
- Initial random circular positioning
- ForceAtlas2 physics simulation for 100 iterations
- Gravity: 1.0, Scaling: 10, SlowDown: 0.6

**Node Sizing**:
1. Center node: Fixed at **25px** (biggest)
2. Other nodes: Sized by connection degree (10-22px)
3. Ensures center node stands out

### 4. Interaction

**Node Click**:
- Shows `DataEntityDetailsCard` on the right
- Displays entity properties, primary keys, metadata
- Has "Explore This Entity" button to pivot to that entity

**Node Hover**:
- Highlights node and connected edges
- Shows node labels for connected nodes
- Dims unrelated nodes

**Node Drag**:
- Nodes can be dragged to reposition
- Camera movement disabled during drag

**Zoom & Pan**:
- Standard Sigma.js controls in bottom-right
- Mouse wheel to zoom
- Click and drag to pan

## Key Features

### 1. Depth 3 Exploration
Shows entities up to 3 relationships away from the center entity:
- **Depth 0**: Just the center entity
- **Depth 1**: Direct neighbors
- **Depth 2**: Neighbors of neighbors
- **Depth 3**: Third-degree connections

### 2. Center Node Emphasis
The explored entity is always the largest node (25px), making it easy to identify the focus of exploration.

### 3. Entity Type Filtering
- Dropdown populated from `/v1/graph/explore/entity_type`
- Shows all available entity types in the data graph
- Required to construct the entity primary key

### 4. Primary Key Input
- Free-text input for entity primary key
- Format depends on entity type (usually generated from properties)
- Example: `K8sCluster_|||_4f8fa70c-691a-441a-a443-b51e3ead5e6c`

## Data Flow

```
User Action
   │
   ├─► Search in SearchView
   │   └─► Click "Explore" on graph entity result
   │       └─► Pass exploreEntityData prop
   │           └─► DataGraphSigma.exploreEntity()
   │
   └─► Manual input
       └─► Select entity type + enter PK
           └─► Click "Explore" button
               └─► DataGraphSigma.handleExploreEntity()
│
▼
exploreEntity(entityType, primaryKey)
   │
   ├─► Call exploreDataNeighborhood(primaryKey, 3)
   │   └─► GET /v1/graph/explore/data?entity_pk={pk}&depth=3
   │       └─► Returns: { entity, entities, relations }
   │
   ├─► Store all entities in graphData
   │   └─► Map<primaryKey, EntityData>
   │
   ├─► Build graph with graphology
   │   ├─► Add nodes (center=25px, others=15px base)
   │   ├─► Add edges with relation names
   │   ├─► Normalize node sizes by degree (preserve center size)
   │   └─► Apply ForceAtlas2 layout
   │
   └─► Render with SigmaGraph component
       │
       ├─► Node click → Show DataEntityDetailsCard
       ├─► Node hover → Highlight connections
       ├─► Node drag → Reposition
       └─► Zoom/Pan → Navigate graph
```

## Components Used

### SigmaGraph (Base Component)
- Handles Sigma.js rendering
- Applies controllers for interaction
- Shows detail card when node selected

### Controllers (Shared)
- `CameraController`: Auto-fit viewport
- `GraphDragController`: Enable dragging
- `GraphEventsController`: Handle clicks/hovers
- `GraphSettingsController`: Visual appearance

### DataEntityDetailsCard
- Shows entity properties and metadata
- Displays primary keys and additional keys
- Shows freshness status (expired/fresh)
- "Explore This Entity" button to pivot

## Example: Exploring a K8s Cluster

```
User Action:
  Search for "k8s cluster" → Click "Explore" on K8sCluster result

API Call:
  GET /v1/graph/explore/data?entity_pk=K8sCluster_|||_123&depth=3

Response:
  entity: K8sCluster (center)
  entities: [K8sCluster, AWSEksCluster, K8sService, K8sNamespace, ...]
  relations: [
    K8sService → K8sCluster,
    K8sNamespace → K8sCluster,
    K8sCluster → AWSEksCluster,
    ...
  ]

Graph Visualization:
  ┌─────────────────────────────────────────┐
  │     K8sDeployment    K8sCertificate     │
  │            ↓              ↓              │
  │     K8sService ← [K8sCluster] → K8sNS   │
  │                     (25px)               │
  │                        ↓                 │
  │                  AWSEksCluster           │
  └─────────────────────────────────────────┘

Interaction:
  Click K8sService → Show DataEntityDetailsCard
    → Click "Explore This Entity" → Re-center on K8sService
```

## Comparison with OntologyGraph

| Feature | DataGraph | OntologyGraph |
|---------|-----------|---------------|
| **Purpose** | Explore data relationships | Visualize ontology schema |
| **Depth** | 3 (configurable) | Full graph load |
| **Center Node** | Emphasized (25px) | No emphasis |
| **API** | `/v1/graph/explore/data` | `/v1/graph/ontology/start` + neighborhoods |
| **Filtering** | None (show all in neighborhood) | By entity type, evaluation result |
| **Edge Styling** | Simple | Heuristics-based thickness |
| **Actions** | Explore pivot | Accept/Reject/Evaluate |
| **Use Case** | Data exploration | Schema design |

## Technical Notes

### Why Depth 3?
- Depth 1: Too shallow, not much context
- Depth 2: Good but might miss interesting connections
- Depth 3: Sweet spot - enough context without overwhelming
- Beyond 3: Graph becomes too dense to visualize

### Center Node Sizing
```typescript
const isCenterNode = pk === centerEntity.primary_key;
const nodeSize = isCenterNode ? 25 : 15; // Center is 67% larger
```

After degree-based normalization:
- Center: **25px** (preserved)
- Others: **10-22px** (based on connections)

### Entity Primary Key Format
From example-response-neighbourhood.json:
```
{entity_type}_|||_{ontology_version_id}
```

Example: `K8sCluster_|||_4f8fa70c-691a-441a-a443-b51e3ead5e6c`

This is automatically generated by the backend and stored in `all_properties._entity_pk`.

## Future Enhancements

1. **Depth Control**: Add UI slider to change exploration depth (1-5)
2. **Relation Filtering**: Filter by relation name/type
3. **Entity Highlighting**: Highlight entities of specific types
4. **Path Finding**: Show shortest path between two entities
5. **Export**: Export graph as image or JSON
6. **Breadcrumbs**: Show exploration history
7. **Multi-select**: Explore multiple entities simultaneously

## Testing Checklist

- [ ] Explore from SearchView works
- [ ] Manual entity type + PK input works
- [ ] Center node is largest (25px)
- [ ] Node sizes vary by connection degree (10-22px)
- [ ] Click node shows DataEntityDetailsCard
- [ ] "Explore This Entity" button pivots correctly
- [ ] Graph renders at depth 3
- [ ] ForceAtlas2 layout applies correctly
- [ ] Drag, zoom, pan all work
- [ ] Clear button resets the view

---

**Implementation Status**: ✅ Complete  
**API Endpoint**: `/v1/graph/explore/data`  
**Depth**: 3  
**Center Node Size**: 25px (emphasized)  
**Component**: DataGraphSigma.tsx


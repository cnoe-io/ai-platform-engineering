# Ontology Graph - Sigma.js Implementation

## Overview

High-performance ontology graph visualization using Sigma.js (WebGL rendering) instead of React Flow. Designed to handle 250-1000+ entity type nodes smoothly.

## Usage

The component is now the default export:

```typescript
import OntologyGraph from './ui/Graph/OntologyGraph';

<OntologyGraph />
```

## Features

✅ **Full Graph Loading** - Loads all entity types at once (max 1000 nodes)
✅ **Performance** - Handles 1000+ nodes smoothly via WebGL rendering
✅ **Interactive** - Click nodes/edges to view details
✅ **Hover Effects** - Highlights node and connected edges
✅ **Filters** - Entity types and relation status filters
✅ **Actions** - Delete, Re-analyse, Refresh with confirmations
✅ **Status** - Real-time agent status and graph statistics

## Key Files

- **OntologyGraphSigma.tsx** - Main component
- **OntologyGraphDataController.tsx** - Filtering logic
- **OntologyGraphEventsController.tsx** - Click/hover events
- **OntologyGraphSettingsController.tsx** - Hover highlighting
- **CameraController.tsx** - Auto-fit camera on load
- **SigmaInstanceCapture.tsx** - Access Sigma instance for manual controls
- **sigma-styles.css** - Required CSS for Sigma containers

## Edge Styling

- **ACCEPTED** - Gray solid lines, thickness 2-8px based on `total_matches`
- **REJECTED** - Red thin lines (1px), hidden by default
- **UNSURE** - Light gray thin lines (1.5px)

## Node Styling

- Color-coded by entity type prefix (aws=yellow, k8s=blue, etc.)
- Round nodes with labels
- Size: 15px

## API Endpoints Used

- GET `/v1/graph/ontology/start?n=10` - Initial nodes
- GET `/v1/graph/explore/ontology?entity_pk={pk}&depth=1` - Neighborhood exploration
- GET `/v1/graph/explore/ontology/stats` - Graph statistics
- GET `/v1/graph/ontology/agent/status` - Agent status
- GET `/v1/graph/ontology/agent/relation/heuristics/{relation_id}` - Edge thickness data
- POST `/v1/graph/ontology/agent/regenerate_ontology` - Re-analyse
- DELETE `/v1/graph/ontology/agent/clear` - Clear ontology
- POST `/v1/graph/ontology/agent/relation/*` - Relation actions

## Critical Fix for Sigma.js

The `.sigma-container` element needs explicit dimensions. Added to `sigma-styles.css`:

```css
.sigma-container {
  width: 100% !important;
  height: 100% !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
}
```

The `CameraController` also calls `sigma.refresh()` and `renderer.resize()` after mount to ensure proper sizing.

## Performance

Sigma.js provides excellent performance for large graphs:
- **50 nodes**: ⚡ Instant rendering
- **250 nodes**: ✅ Smooth interaction
- **1000+ nodes**: ✅ Fast and responsive



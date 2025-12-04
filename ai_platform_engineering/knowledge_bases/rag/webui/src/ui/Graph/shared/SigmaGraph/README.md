# SigmaGraph - Reusable Graph Visualization Component

This directory contains a reusable Sigma.js-based graph visualization component and shared controllers.

## Overview

The `SigmaGraph` component provides a common foundation for graph visualization using Sigma.js. It includes:
- Drag-and-drop node manipulation
- Zoom and pan controls
- Node/edge filtering
- Customizable detail cards
- Hover and selection states

## Components

### SigmaGraph.tsx
The main graph visualization component. Accepts:
- `graph`: A MultiDirectedGraph instance from graphology
- `dataReady`: Whether the graph data is loaded
- `isLoading`: Whether data is currently loading
- `filters`: Object containing filter configuration
- `customFilterLogic`: Optional custom filtering function
- `detailsCardComponent`: React component to show when a node/edge is selected
- `emptyStateComponent`: React component to show when no data is available
- Event handlers for node interactions

### Controllers

Located in the `controllers/` directory, these components handle specific aspects of graph interaction:

#### CameraController.tsx
Automatically resizes and fits the camera to show all nodes when the graph is first loaded.

#### SigmaInstanceCapture.tsx  
Captures the Sigma.js instance and passes it to parent components for manual control.

#### GraphDragController.tsx
Enables dragging nodes within the graph. Temporarily disables camera movement while dragging to prevent conflicts.

#### GraphEventsController.tsx
Handles mouse events:
- Node clicks
- Node hover (enter/leave)
- Updates cursor style on hover

#### GraphSettingsController.tsx
Manages visual appearance based on interaction state:
- Highlights hovered/selected nodes and their neighbors
- Dims unrelated nodes
- Shows/hides labels based on interaction
- Adjusts edge visibility and styling

#### GraphDataController.tsx
Applies filters to the graph:
- Can use default filtering (show all)
- Accepts custom filter logic for specialized filtering

## Usage

### Basic Example

```typescript
import { SigmaGraph } from './SigmaGraph';
import { MultiDirectedGraph } from 'graphology';

function MyGraph() {
    const graph = useMemo(() => new MultiDirectedGraph(), []);
    const [dataReady, setDataReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [selectedElement, setSelectedElement] = useState<any>(null);
    
    const handleNodeClick = (nodeId: string, nodeData: any) => {
        setSelectedElement({ type: 'node', id: nodeId, data: nodeData });
    };
    
    return (
        <SigmaGraph
            graph={graph}
            dataReady={dataReady}
            isLoading={isLoading}
            hoveredNode={hoveredNode}
            setHoveredNode={setHoveredNode}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            selectedElement={selectedElement}
            onNodeClick={handleNodeClick}
            filters={{}}
        />
    );
}
```

### With Custom Filtering

```typescript
const customFilter = (graph: any, filters: any) => {
    const { entityTypes } = filters;
    
    graph.forEachNode((node: string, attributes: any) => {
        const shouldShow = entityTypes.has(attributes.entityType);
        graph.setNodeAttribute(node, "hidden", !shouldShow);
    });
};

<SigmaGraph
    {...props}
    filters={{ entityTypes: new Set(['Type1', 'Type2']) }}
    customFilterLogic={customFilter}
/>
```

### With Custom Details Card

```typescript
const detailsCard = selectedElement ? (
    <MyCustomDetailsCard
        entity={selectedElement}
        onClose={() => setSelectedElement(null)}
    />
) : null;

<SigmaGraph
    {...props}
    detailsCardComponent={detailsCard}
/>
```

## Examples

### DataGraphSigma
Uses SigmaGraph to visualize data entity relationships. Features:
- Explores data entities and their relations
- Simple filtering (shows all connected entities)
- Uses DataEntityDetailsCard for node details
- ForceAtlas2 layout for automatic positioning

### OntologyGraphSigma
Uses Sigma.js directly with shared controller concepts. Features:
- Complex ontology relation visualization
- Evaluation result filtering (accepted/rejected/uncertain)
- Bidirectional edge detection
- Advanced layout controls and settings
- Heuristics-based edge thickness
- Uses OntologyEntityDetailsCard for detailed node information

## Styling

The component uses `sigma-styles.css` for base Sigma.js styling. This includes:
- Container positioning and sizing
- Mouse cursor changes
- Control button styling
- Dot grid background pattern

## Graph Building

When building a graph to use with SigmaGraph:

```typescript
// Add nodes
graph.addNode('node1', {
    label: 'Node 1',
    size: 15,
    color: '#4CAF50',
    entityType: 'Type1',
    entityData: { /* your data */ },
    x: 0,
    y: 0,
});

// Add edges
graph.addEdgeWithKey('edge1', 'node1', 'node2', {
    label: 'relates_to',
    type: 'arrow',  // or 'line' for bidirectional
    size: 2,
    color: '#9ca3af',
    originalColor: '#9ca3af',
    originalSize: 2,
});
```

## Benefits

1. **Reusability**: Write graph logic once, use across multiple views
2. **Consistency**: Same interaction patterns across all graphs
3. **Maintainability**: Shared controllers mean fixing bugs once
4. **Flexibility**: Customize behavior with props and custom logic
5. **Performance**: Sigma.js efficiently handles large graphs (1000+ nodes)

## Migration from ReactFlow

If migrating from ReactFlow to SigmaGraph:
1. Replace ReactFlow components with SigmaGraph
2. Convert node/edge data to Graphology format
3. Use ForceAtlas2 or other graphology layouts instead of Dagre
4. Update detail cards to work with Sigma node format
5. Remove ReactFlow dependencies

See `DataGraphSigma.tsx` for a complete migration example.


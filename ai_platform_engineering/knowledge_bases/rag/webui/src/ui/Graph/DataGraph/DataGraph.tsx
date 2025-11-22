import React, { useState, useCallback, useEffect } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    applyNodeChanges,
    applyEdgeChanges,
    Node,
    Edge,
    NodeChange,
    EdgeChange,
    MiniMap,
    Position,
    MarkerType,
    Handle,
} from '@xyflow/react';
import { getDataEntity, getEntityTypes } from '../../../api';
import dagre from 'dagre';
import DataEntityDetailsCard from './DataEntityDetailsCard';
import DataRelationDetailsCard from './DataRelationDetailsCard';
import CustomGraphNode from '../CustomGraphNode';
import { colorMap, defaultColor, darkenColor, getColorForNode, getDataEdgeStyle } from '../graphStyles';

import '@xyflow/react/dist/style.css';

interface DataGraphProps {
    exploreEntityData?: { entityType: string; primaryKey: string } | null;
    onExploreComplete?: () => void;
}

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 180;
const nodeHeight = 40;

// Dagre-based auto-layout function for data view (horizontal by default)
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
    // Clear the graph to ensure clean state for each layout
    dagreGraph.setGraph({ 
        rankdir: direction,
        ranksep: 250,   // Vertical spacing between ranks/levels (default is ~50)
    });
    
    // Remove all existing nodes and edges from previous layouts
    dagreGraph.nodes().forEach(nodeId => dagreGraph.removeNode(nodeId));
    
    const isHorizontal = direction === 'LR' || direction === 'RL';

    nodes.forEach((node) => dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight }));
    edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
            sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
            targetPosition: isHorizontal ? Position.Left : Position.Top,
        };
    });

    return { nodes: layoutedNodes, edges };
};

// Node styling is now handled internally by CustomGraphNode
// Edge styling is now handled by shared functions in graphStyles

export default function DataGraph({ exploreEntityData, onExploreComplete }: DataGraphProps) {
    const [selectedElement, setSelectedElement] = useState<any>(null);
    const [selectedElementType, setSelectedElementType] = useState<'node' | 'edge' | null>(null);
    const [entityPrimaryKey, setEntityPrimaryKey] = useState<string>('');
    const [selectedEntityType, setSelectedEntityType] = useState<string>('');
    const [entityTypes, setEntityTypes] = useState<string[]>([]);
    const [isSearching, setIsSearching] = useState<boolean>(false);
    const [exploredEntity, setExploredEntity] = useState<any>(null);
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [graphKey, setGraphKey] = useState(0);

    // Shared exploration logic (DRY principle)
    const exploreEntity = async (entityType: string, primaryKey: string) => {
        if (!entityType || !primaryKey) return;
        
        setIsSearching(true);
        try {
            // Use the actual API endpoint to explore data entity
            const response = await getDataEntity(entityType, primaryKey);

            const { entity, relations } = response;
            
            if (!entity) {
                console.warn('No entity found');
                setIsSearching(false);
                return;
            }

            // Create center node from the main entity
            const centerEntity = {
                primary_key: entity.generate_primary_key ? entity.generate_primary_key() : primaryKey,
                entity_type: entity.entity_type || entityType,
                ...entity
            };

            const centerNode: Node = {
                id: centerEntity.primary_key,
                type: 'dataNode',
                data: centerEntity,
                position: { x: 0, y: 0 },
            };

            // Track unique nodes and edges to avoid duplicates
            const nodesMap = new Map<string, Node>();
            const edgesArray: Edge[] = [];
            nodesMap.set(centerNode.id, centerNode);

            // Process relations to create related nodes and edges
            if (relations && Array.isArray(relations) && relations.length > 0) {
                relations.forEach((relation: any, index: number) => {
                    // Create nodes for relation endpoints if they don't exist
                    const fromId = relation.from_entity?.primary_key || `from_${index}`;
                    const toId = relation.to_entity?.primary_key || `to_${index}`;
                    
                    // Create from node if not exists
                    if (!nodesMap.has(fromId) && relation.from_entity) {
                        const fromEntity = {
                            primary_key: fromId,
                            entity_type: relation.from_entity.entity_type || 'Entity',
                            ...relation.from_entity
                        };
                        
                        nodesMap.set(fromId, {
                            id: fromId,
                            type: 'dataNode',
                            data: fromEntity,
                            position: { x: 0, y: 0 },
                        });
                    }

                    // Create to node if not exists
                    if (!nodesMap.has(toId) && relation.to_entity) {
                        const toEntity = {
                            primary_key: toId,
                            entity_type: relation.to_entity.entity_type || 'Entity',
                            ...relation.to_entity
                        };
                        
                        nodesMap.set(toId, {
                            id: toId,
                            type: 'dataNode',
                            data: toEntity,
                            position: { x: 0, y: 0 },
                        });
                    }

                    // Create edge for this relation
                    const edgeId = `${fromId}_to_${toId}_${index}`;
                    edgesArray.push({
                        id: edgeId,
                        source: fromId,
                        target: toId,
                        label: relation.relation_name || 'related_to',
                        data: relation, // Store the complete relation data
                        style: getDataEdgeStyle(false),
                        labelStyle: {
                            fontSize: '12px',
                            fontWeight: 'normal',
                            fill: '#6b7280'
                        },
                        markerEnd: { 
                            type: MarkerType.ArrowClosed, 
                            width: 20, 
                            height: 20,
                            color: '#6b7280'
                        },
                    });
                });
            }

            const allNodes = Array.from(nodesMap.values());
            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(allNodes, edgesArray, 'LR');
            
            setNodes(layoutedNodes);
            setEdges(layoutedEdges);
            setExploredEntity(centerEntity);
            setGraphKey(k => k + 1);

        } catch (err) {
            console.error('Failed to explore entity:', err);
            alert('Failed to explore entity. Please check the console for details.');
        }
        setIsSearching(false);
    };

    // Handle arrow click to explore new entity
    const handleNodeArrowClick = (entityData: any) => {
        exploreEntity(entityData.entity_type, entityData.primary_key);
    };

    // Define custom node types
    const nodeTypes = {
        dataNode: (props: any) => {
            const isSelected = selectedElement?.id === props.id;
            return (
                <CustomGraphNode 
                    {...props} 
                    showArrowButton={true} 
                    selected={isSelected}
                    onArrowClick={handleNodeArrowClick}
                />
            );
        },
    };

    const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [setNodes]);
    const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [setEdges]);
    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedElement(node);
        setSelectedElementType('node');
    }, []);
    const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
        setSelectedElement(edge);
        setSelectedElementType('edge');
    }, []);

    const handleExploreEntity = () => {
        if (!entityPrimaryKey.trim() || !selectedEntityType.trim()) return;
        exploreEntity(selectedEntityType, entityPrimaryKey.trim());
    };

    const handleClearExploration = () => {
        setExploredEntity(null);
        setNodes([]);
        setEdges([]);
        setEntityPrimaryKey('');
        setSelectedEntityType('');
        setSelectedElement(null);
        setSelectedElementType(null);
    };

    const fetchEntityTypes = useCallback(async () => {
        try {
            const types = await getEntityTypes();
            setEntityTypes(types.sort()); // Sort alphabetically
        } catch (err) {
            console.error('Failed to fetch entity types:', err);
            setEntityTypes([]);
        }
    }, []);

    // Load entity types on component mount
    useEffect(() => {
        fetchEntityTypes();
    }, [fetchEntityTypes]);



    // Node styling is now handled internally by CustomGraphNode

    // Update edge styling when selection changes
    useEffect(() => {
        if (edges.length === 0) return;

        setEdges(currentEdges => 
            currentEdges.map(edge => {
                const isEdgeSelected = selectedElement?.id === edge.id;
                const isNodeSelected = selectedElementType === 'node' && 
                    (selectedElement?.id === edge.source || selectedElement?.id === edge.target);
                const isHighlighted = isEdgeSelected || isNodeSelected;
                
                const edgeStyle = getDataEdgeStyle(isHighlighted);
                return {
                    ...edge,
                    style: edgeStyle,
                    labelStyle: isHighlighted ? {
                        fontSize: '14px',
                        fontWeight: 'bold',
                        fill: '#1f2937',
                    } : {
                        fontSize: '12px',
                        fontWeight: 'normal',
                        fill: '#374151'
                    },
                    markerEnd: { 
                        type: MarkerType.ArrowClosed, 
                        width: 20, 
                        height: 20,
                        color: edgeStyle.stroke
                    },
                };
            })
        );
    }, [selectedElement, selectedElementType]);

    // Handle entity exploration from SearchView
    useEffect(() => {
        if (exploreEntityData) {
            exploreEntity(exploreEntityData.entityType, exploreEntityData.primaryKey);
            onExploreComplete?.();
        }
    }, [exploreEntityData, onExploreComplete]);

    return (
        <div className="relative h-full bg-slate-100 overflow-hidden">
            {/* --- Details Popup --- */}
            {selectedElement && selectedElementType && (
                <>
                    {/* Render DataEntityDetailsCard if selectedElement is a Node */}
                    {selectedElementType === 'node' && (
                        <DataEntityDetailsCard 
                            entity={selectedElement} 
                            onClose={() => {
                                setSelectedElement(null);
                                setSelectedElementType(null);
                            }}
                            onExplore={exploreEntity}
                            isCurrentlyExplored={exploredEntity && selectedElement.data.primary_key === exploredEntity.primary_key}
                        />
                    )}
                    {/* Render DataRelationDetailsCard if selectedElement is an Edge */}
                    {selectedElementType === 'edge' && (
                        <DataRelationDetailsCard 
                            relation={selectedElement} 
                            onClose={() => {
                                setSelectedElement(null);
                                setSelectedElementType(null);
                            }} 
                        />
                    )}
                </>
            )}

            {/* --- Main Content --- */}
            <div className="w-full h-full flex flex-col p-5">
                <div className="flex justify-end items-center mb-4 gap-2">
                    <button
                        className="btn bg-brand-gradient hover:bg-brand-gradient-hover active:bg-brand-gradient-active text-white"
                        onClick={fetchEntityTypes}
                        title="Refresh Data View">
                        Refresh
                    </button>
                </div>
                
                {/* Main Content Area */}
                {exploredEntity ? (
                    // Data Graph View
                    <div style={{ height: '65vh' }} className="flex-grow rounded-lg shadow-md bg-white">
                        <div className="h-full flex flex-col">
                            {/* Graph Header */}
                            <div className="p-4 border-b bg-blue-50">
                                <h3 className="text-lg font-semibold text-blue-800">
                                    Data Exploration: {exploredEntity.label}
                                </h3>
                                <p className="text-sm text-blue-600">
                                    Showing data relationships for: <code className="bg-blue-100 px-1 rounded">{exploredEntity.primary_key}</code>
                                </p>
                            </div>
                            
                            {/* React Flow Graph */}
                            <div className="flex-grow">
                                <ReactFlow
                                    key={graphKey}
                                    nodes={nodes}
                                    edges={edges}
                                    nodeTypes={nodeTypes}
                                    onNodesChange={onNodesChange}
                                    onEdgesChange={onEdgesChange}
                                    onNodeClick={onNodeClick}
                                    onEdgeClick={onEdgeClick}
                                    nodesConnectable={false}
                                    nodesDraggable={true}
                                    elementsSelectable={true}
                                    fitView
                                    fitViewOptions={{ padding: 0.2 }}
                                >
                                    <Controls />
                                    <MiniMap 
                                        nodeColor={(node) => {
                                            const nodeData = node.data as any;
                                            return getColorForNode(nodeData?.entity_type || nodeData?.label || 'default');
                                        }}
                                    />
                                    <Background />
                                </ReactFlow>
                            </div>
                        </div>
                    </div>
                ) : (
                    // Welcome Screen
                    <div style={{ height: '65vh' }} className="flex-grow rounded-lg shadow-md bg-white p-8 flex items-center justify-center">
                        <div className="text-center space-y-4 max-w-md">
                            <div className="text-6xl text-blue-500 mb-4">📊</div>
                            <h3 className="text-2xl font-bold text-gray-800">Data Exploration</h3>
                            <p className="text-gray-600">
                                Search for entities in the 🔍 Search tab; <br/> or select an entity type and enter a primary key below to explore data relationships.
                            </p>
                        </div>
                    </div>
                )}
                
                {/* Search Interface at Bottom */}
                <div className="mt-4 p-4 bg-white rounded-lg shadow-sm border">
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <div className="flex gap-2">
                                <select
                                    value={selectedEntityType}
                                    onChange={(e) => setSelectedEntityType(e.target.value)}
                                    className="px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-white min-w-[150px]"
                                >
                                    <option value="">Select Entity Type</option>
                                    {entityTypes.map((entityType) => (
                                        <option key={entityType} value={entityType}>
                                            {entityType}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={entityPrimaryKey}
                                    onChange={(e) => setEntityPrimaryKey(e.target.value)}
                                    placeholder="Enter entity primary key..."
                                    className="flex-1 px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                    onKeyDown={(e) => e.key === 'Enter' && handleExploreEntity()}
                                />
                                <button
                                    onClick={handleExploreEntity}
                                    disabled={!entityPrimaryKey.trim() || !selectedEntityType.trim() || isSearching}
                                    className="btn bg-brand-gradient hover:bg-brand-gradient-hover active:bg-brand-gradient-active text-white disabled:bg-gray-400"
                                    title="Explore Data">
                                    {isSearching ? 'Exploring...' : 'Explore'}
                                </button>
                                {exploredEntity && (
                                    <button
                                        onClick={handleClearExploration}
                                        className="btn bg-brand-gradient hover:bg-brand-gradient-hover active:bg-brand-gradient-active text-white text-white"
                                        title="Clear Exploration">
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    {/* Search Hint */}
                    {!exploredEntity && (
                        <div className="mt-3 bg-blue-50 p-3 rounded border border-blue-200">
                            <p className="text-sm text-blue-800">
                                <strong>💡 Tip:</strong> Select an entity type and enter the primary key to explore data relationships.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
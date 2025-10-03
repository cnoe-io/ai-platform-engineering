import React, { useState, useCallback, useEffect, useRef } from 'react';
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
} from '@xyflow/react';
import axios from 'axios';
import dagre from 'dagre';
import OntologyEntityDetailsCard from './OntologyEntityDetailsCard';
import OntologyRelationDetailsCard from './OntologyRelationDetailsCard';
import CustomGraphNode from '../CustomGraphNode';
import { colorMap, defaultColor, darkenColor, getColorForNode, getRelationCategory, getOntologyEdgeStyle } from '../graphStyles';

import '@xyflow/react/dist/style.css';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 180;
const nodeHeight = 40;

// Dagre-based auto-layout function
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
    // Clear the graph to ensure clean state for each layout
    dagreGraph.setGraph({ 
        rankdir: direction,
        ranksep: 150,   // Vertical spacing between ranks/levels (default is ~50)
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

// Marquee component for scrolling long text
const Marquee = ({ text }: { text: string }) => {
    return (
        <div className="overflow-hidden whitespace-nowrap w-full">
            <span className="inline-block animate-marquee">{text}</span>
        </div>
    );
};

// Edge styling is now handled by shared functions in graphStyles

// Node styling is now handled internally by CustomGraphNode

interface OntologyGraphProps {
    isAgentProcessing: boolean;
    isAgentEvaluating: boolean;
    acceptanceThreshold: number;
    rejectionThreshold: number;
    onRegenerateOntology: () => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

export default function OntologyGraph({
    isAgentProcessing,
    isAgentEvaluating,
    acceptanceThreshold,
    rejectionThreshold,
    onRegenerateOntology,
    isLoading,
    error
}: OntologyGraphProps) {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [graphKey, setGraphKey] = useState(0);
    const [allLabels, setAllLabels] = useState<string[]>([]);
    const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
    const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR' | 'BT' | 'RL'>('LR');
    const [isPanelOpen, setIsPanelOpen] = useState(false); // State for panel visibility
    const [selectedElement, setSelectedElement] = useState<Node | Edge | null>(null); // State for details popup
    const [selectedElementType, setSelectedElementType] = useState<'node' | 'edge' | null>(null); // State for element type
    const [showAccepted, setShowAccepted] = useState<boolean>(true); // Show accepted relations
    const [showRejected, setShowRejected] = useState<boolean>(true); // Show rejected relations
    const [showUncertain, setShowUncertain] = useState<boolean>(true); // Show uncertain relations
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null); // Track focused node for filtering
    const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false); // Show clear confirmation dialog
    const [showRegenerateConfirm, setShowRegenerateConfirm] = useState<boolean>(false); // Show regenerate confirmation dialog
    const graphData = useRef<{ nodes: Node[], edges: Edge[] }>({ nodes: [], edges: [] });

    const handleLabelChange = (label: string, isChecked: boolean) => {
        setSelectedLabels(prev => {
            const newSelected = new Set(prev);
            if (isChecked) {
                newSelected.add(label);
            } else {
                newSelected.delete(label);
            }
            return newSelected;
        });
    };

    // Handle arrow click to focus on a specific node and its relations
    const handleNodeArrowClick = (nodeData: any) => {
        const nodeId = nodeData.all_properties?._primary_key || nodeData._primary_key || nodeData.id;
        setFocusedNodeId(nodeId);
        setIsPanelOpen(false); // Close filter panel when focusing on a node
    };

    // Define custom node types
    const nodeTypes = {
        ontologyNode: (props: any) => {
            const isSelected = selectedElement?.id === props.id;
            return (
                <CustomGraphNode 
                    {...props} 
                    showArrowButton={true} 
                    showLabel={false} 
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

    const handleClearFocus = () => {
        setFocusedNodeId(null);
    };

    const handleClearOntology = async () => {
        try {
            await axios.delete('/v1/graph/ontology/agent/clear');
            // Clear stored data and trigger refresh
            graphData.current = { nodes: [], edges: [] };
            setAllLabels([]);
            setSelectedLabels(new Set());
            setFocusedNodeId(null);
            // The useEffect will automatically refresh the graph when dependencies change
        } catch (error) {
            console.error('Failed to clear ontology:', error);
        }
        setShowClearConfirm(false);
    };

    const handleRegenerateConfirm = async () => {
        setShowRegenerateConfirm(false);
        await onRegenerateOntology();
    };

    useEffect(() => {
        const processGraphData = async () => {
            // 1. Fetch data only if we don't have any data
            if (graphData.current.nodes.length === 0) {
                try {
                    const entitiesResponse = await axios.post('/v1/graph/explore/ontology/entities', { 'filter_by_properties': {} });
                    const entitiesData = entitiesResponse.data || [];
                    
                    const allNodes: Node[] = entitiesData.map((entity: any) => {
                        const label = entity.entity_type || entity.all_properties._primary_key;
                        const displayLabel = label.length > 20 ? label.substring(0, 20) + '...' : label;
                        return {
                            id: entity.all_properties._primary_key,
                            type: 'ontologyNode',
                            data: { label: displayLabel, originalLabel: label, ...entity }, // Store both display and original label
                            position: { x: 0, y: 0 },
                        };
                    });

                    const relationsResponse = await axios.post('/v1/graph/explore/ontology/relations', { 'filter_by_properties': {} });
                    const relationsData = relationsResponse.data || [];
                    
                    // Group edges by node pairs to deduplicate
                    const edgeGroupsMap = new Map<string, any[]>();
                    relationsData.forEach((relation: any) => {
                        const sourceId = relation.from_entity.primary_key;
                        const targetId = relation.to_entity.primary_key;
                        // Create a key that maintains direction (source -> target)
                        const edgeKey = `${sourceId}->${targetId}`;
                        
                        if (!edgeGroupsMap.has(edgeKey)) {
                            edgeGroupsMap.set(edgeKey, []);
                        }
                        edgeGroupsMap.get(edgeKey)!.push(relation);
                    });
                    
                    const allEdges: Edge[] = Array.from(edgeGroupsMap.entries()).map(([edgeKey, relations]) => {
                        const firstRelation = relations[0]; // Use the first relation as the representative
                        const edgeCount = relations.length;
                        
                        // Add count indicator to label if there are multiple edges
                        let label = firstRelation.relation_name;
                        if (edgeCount > 1) {
                            label += ` [x${edgeCount}]`;
                        }
                        
                        const edgeStyle = getOntologyEdgeStyle(firstRelation, acceptanceThreshold, rejectionThreshold, false);
                        return {
                            id: firstRelation.relation_properties._primary_key,
                            source: firstRelation.from_entity.primary_key,
                            target: firstRelation.to_entity.primary_key,
                            label: label,
                            data: { ...firstRelation, duplicateCount: edgeCount, allRelations: relations }, // Store the representative relation and count
                            animated: false,
                            style: edgeStyle,
                            labelStyle: {
                                fontSize: '12px',
                                fontWeight: 'normal',
                                fill: '#6b7280'
                            },
                            markerEnd: { 
                                type: MarkerType.ArrowClosed, 
                                width: 20, 
                                height: 20,
                                color: edgeStyle.stroke
                            },
                        };
                    });

                    graphData.current = { nodes: allNodes, edges: allEdges };
                    
                    // Only update labels if we have nodes, otherwise keep current selection
                    if (allNodes.length > 0) {
                        const labels = new Set(allNodes.map(n => String(n.data.label)));
                        setAllLabels(Array.from(labels).sort());
                        setSelectedLabels(labels); // Select all by default
                    } else {
                        // No nodes found - set empty arrays but don't update selectedLabels
                        setAllLabels([]);
                        setNodes([]);
                        setEdges([]);
                        return;
                    }
                } catch (err) {
                    console.error('Failed to fetch graph data:', err);
                    return;
                }
            }

            // Filter nodes and edges based on selection and focus
            let filteredNodes: Node[];
            let filteredEdges: Edge[];

            if (focusedNodeId) {
                // When a node is focused, show only that node and its connected nodes
                const focusedNode = graphData.current.nodes.find(node => node.id === focusedNodeId);
                if (!focusedNode) {
                    // If focused node doesn't exist, fallback to regular filtering
                    setFocusedNodeId(null);
                    filteredNodes = graphData.current.nodes.filter(node => selectedLabels.has(String(node.data.label)));
                    
                    // Regular edge filtering
                    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
                    filteredEdges = graphData.current.edges.filter(edge => {
                        if (!filteredNodeIds.has(edge.source) || !filteredNodeIds.has(edge.target)) {
                            return false;
                        }
                        
                        const category = getRelationCategory(edge.data, acceptanceThreshold, rejectionThreshold);
                        if (category === 'accepted' && !showAccepted) return false;
                        if (category === 'rejected' && !showRejected) return false;
                        if (category === 'uncertain' && !showUncertain) return false;
                        
                        return true;
                    });
                } else {
                    // Find all edges connected to the focused node
                    const connectedEdges = graphData.current.edges.filter(edge => 
                        edge.source === focusedNodeId || edge.target === focusedNodeId
                    );
                    
                    // Get all connected node IDs
                    const connectedNodeIds = new Set<string>();
                    connectedNodeIds.add(focusedNodeId);
                    connectedEdges.forEach(edge => {
                        connectedNodeIds.add(edge.source);
                        connectedNodeIds.add(edge.target);
                    });
                    
                    // Filter nodes to show only the focused node and its connections
                    filteredNodes = graphData.current.nodes.filter(node => connectedNodeIds.has(node.id));
                    
                    // Apply relation category filters to connected edges
                    filteredEdges = connectedEdges.filter(edge => {
                        const category = getRelationCategory(edge.data, acceptanceThreshold, rejectionThreshold);
                        if (category === 'accepted' && !showAccepted) return false;
                        if (category === 'rejected' && !showRejected) return false;
                        if (category === 'uncertain' && !showUncertain) return false;
                        
                        return true;
                    });
                }
            } else {
                // Regular filtering by selected labels
                filteredNodes = graphData.current.nodes.filter(node => selectedLabels.has(String(node.data.label)));
                
                // Regular edge filtering when not focused on a specific node
                const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
                filteredEdges = graphData.current.edges.filter(edge => {
                    // First filter by node selection
                    if (!filteredNodeIds.has(edge.source) || !filteredNodeIds.has(edge.target)) {
                        return false;
                    }
                    
                    // Then filter by relation category
                    const category = getRelationCategory(edge.data, acceptanceThreshold, rejectionThreshold);
                    if (category === 'accepted' && !showAccepted) return false;
                    if (category === 'rejected' && !showRejected) return false;
                    if (category === 'uncertain' && !showUncertain) return false;
                    
                    return true;
                });
            }

            // Apply layout and update state
            if (filteredNodes.length > 0) {
                const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(filteredNodes, filteredEdges, layoutDirection);
                setNodes(layoutedNodes);
                setEdges(layoutedEdges);
            } else {
                setNodes([]);
                setEdges([]);
            }
            
            setGraphKey(k => k + 1);
        };

        processGraphData();
    }, [selectedLabels, layoutDirection, acceptanceThreshold, rejectionThreshold, showAccepted, showRejected, showUncertain, focusedNodeId]); // Re-run when filters, layout direction, thresholds, or focused node change

    // Separate effect to handle edge selection styling without re-rendering the entire graph
    useEffect(() => {
        if (graphData.current.nodes.length === 0) return;

        // Update edge styling based on selection without re-layouting
        setEdges(currentEdges => 
            currentEdges.map(edge => {
                const isEdgeSelected = selectedElement?.id === edge.id;
                const isNodeSelected = selectedElementType === 'node' && 
                    (selectedElement?.id === edge.source || selectedElement?.id === edge.target);
                const isHighlighted = isEdgeSelected || isNodeSelected;
                
                const edgeStyle = getOntologyEdgeStyle(edge.data, acceptanceThreshold, rejectionThreshold, isHighlighted);
                return {
                    ...edge,
                    style: edgeStyle,
                    labelStyle: isHighlighted ? {
                        fontSize: '14px',
                        fontWeight: 'bold',
                        fill: '#1f2937',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        zIndex: 1001 // Bring label to front (higher than edge zIndex)
                    } : {
                        fontSize: '12px',
                        fontWeight: 'normal',
                        fill: '#6b7280'
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
    }, [selectedElement, selectedElementType, acceptanceThreshold, rejectionThreshold]); // Only update styling when selection or thresholds change

    // Node selection styling is now handled internally by CustomGraphNode

    const isAgentActive = isAgentProcessing || isAgentEvaluating;

    return (
        <div className="relative h-full bg-slate-100 overflow-hidden">
            {/* --- Toggle Button --- */}
            <button 
                onClick={() => setIsPanelOpen(!isPanelOpen)} 
                className={`absolute top-4 left-4 btn btn-sm z-20 ${focusedNodeId ? 'disabled:bg-gray-400 disabled:cursor-not-allowed' : ''}`}
                disabled={!!focusedNodeId}
                title={focusedNodeId ? "Filters are disabled when focusing on a specific node" : "Open filters panel"}
            >
                {isPanelOpen ? '◀ Filters' : 'Filters ▶'}
            </button>

            {/* --- Details Popup --- */}
            {selectedElement && selectedElementType && (
                <>
                    {/* Render OntologyEntityDetailsCard if selectedElement is a Node */}
                    {selectedElementType === 'node' && (
                        <OntologyEntityDetailsCard 
                            entity={selectedElement as Node} 
                            onClose={() => {
                                setSelectedElement(null);
                                setSelectedElementType(null);
                            }} 
                        />
                    )}
                    {/* Render OntologyRelationDetailsCard if selectedElement is an Edge */}
                    {selectedElementType === 'edge' && (
                        <OntologyRelationDetailsCard 
                            relation={selectedElement as Edge} 
                            acceptanceThreshold={acceptanceThreshold}
                            rejectionThreshold={rejectionThreshold}
                            onClose={() => {
                                setSelectedElement(null);
                                setSelectedElementType(null);
                            }} 
                        />
                    )}
                </>
            )}

            {/* --- Floating Filter Panel --- */}
            <div 
                className={`absolute top-0 left-0 h-full w-64 bg-white p-4 border-r shadow-lg overflow-y-auto z-10 transition-transform duration-300 ease-in-out ${isPanelOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <h4 className="text-lg font-semibold mb-2 text-slate-800 pt-12">Entity Types</h4>
                <div className="flex space-x-2 mb-4">
                    <button onClick={() => setSelectedLabels(new Set(allLabels))} className="btn py-1 px-2 rounded text-xs ml-4">Select All</button>
                    <button onClick={() => setSelectedLabels(new Set())} className="btn py-1 px-2 rounded text-xs ml-4">Deselect All</button>
                </div>
                {allLabels.map(label => (
                    <div key={label} className="flex items-center mb-2">
                        <input
                            type="checkbox"
                            id={`checkbox-${label}`}
                            checked={selectedLabels.has(label)}
                            onChange={(e) => handleLabelChange(label, e.target.checked)}
                            className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="w-40 text-sm">
                            <Marquee text={label} />
                        </div>
                    </div>
                ))}
                
                {/* Relation Filters */}
                <div className="mt-6 pt-4 border-t border-gray-200">
                    <h4 className="text-lg font-semibold mb-2 text-slate-800">Relations</h4>
                    <div className="space-y-2">
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="show-accepted"
                                checked={showAccepted}
                                onChange={(e) => setShowAccepted(e.target.checked)}
                                className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label htmlFor="show-accepted" className="flex items-center gap-2 text-sm">
                                <div className="w-4 h-0 border-t-2 border-gray-500"></div>
                                <span>Accepted (≥{Math.round(acceptanceThreshold * 100)}%)</span>
                            </label>
                        </div>
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="show-rejected"
                                checked={showRejected}
                                onChange={(e) => setShowRejected(e.target.checked)}
                                className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label htmlFor="show-rejected" className="flex items-center gap-2 text-sm">
                                <div className="w-4 h-0 border-t-2 border-red-500" style={{borderStyle: 'dashed', borderTopWidth: '2px', borderTopStyle: 'dashed'}}></div>
                                <span>Rejected (≤{Math.round(rejectionThreshold * 100)}%)</span>
                            </label>
                        </div>
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="show-uncertain"
                                checked={showUncertain}
                                onChange={(e) => setShowUncertain(e.target.checked)}
                                className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label htmlFor="show-uncertain" className="flex items-center gap-2 text-sm">
                                <div className="w-4 h-0 border-t-2 border-gray-500" style={{borderStyle: 'dotted', borderTopWidth: '2px', borderTopStyle: 'dotted'}}></div>
                                <span>Uncertain</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- Graph View --- */}
            <div className="w-full h-full flex flex-col p-5">
                <div className="flex justify-end items-center mb-4 gap-2">
                    {focusedNodeId && (
                        <button
                            onClick={handleClearFocus}
                            className="btn bg-orange-500 hover:bg-orange-600 text-white"
                            title="Clear node focus and show all filtered nodes">
                            Clear Focus
                        </button>
                    )}
                    <button
                        onClick={() => setShowClearConfirm(true)}
                        className="btn bg-red-500 hover:bg-red-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                        disabled={isLoading || isAgentActive}
                        title={isAgentActive ? "Agent is currently active - please wait" : "Clear all ontology data"}>
                        Clear
                    </button>
                    <button
                        onClick={() => setShowRegenerateConfirm(true)}
                        className="btn bg-yellow-500 hover:bg-yellow-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                        disabled={isLoading || isAgentActive}
                        title={isAgentActive ? "Agent is currently active - please wait" : nodes.length === 0 ? "Detect Ontology" : "Re-Detect the Ontology"}>
                        {isLoading ? 'Processing...' : nodes.length === 0 ? 'Detect Ontology' : 'Re-detect Ontology'}
                    </button>
                </div>
                {error && <p className="text-red-500 mt-2">{error}</p>}
                {focusedNodeId && (
                    <div className="mb-2 p-2 bg-blue-50 rounded border border-blue-200">
                        <p className="text-sm text-blue-800">
                            <strong>🎯 Focused on:</strong> <code className="bg-blue-100 px-1 rounded">{focusedNodeId}</code> - Showing only this node and its direct connections
                        </p>
                    </div>
                )}
                <div style={{ height: '65vh' }} className="flex-grow rounded-lg shadow-md bg-white">
                    {nodes.length === 0 ? (
                        // Welcome Screen when no ontology data or loading
                        <div className="h-full p-8 flex items-center justify-center">
                            <div className="text-center space-y-4 max-w-md">
                                {isLoading ? (
                                    // Loading state
                                    <>
                                        <div className="text-6xl mb-4">
                                            <div className="animate-spin">⚙️</div>
                                        </div>
                                        <h3 className="text-2xl font-bold text-gray-800">Loading Ontology...</h3>
                                        <p className="text-gray-600">
                                            {isAgentProcessing || isAgentEvaluating 
                                                ? 'The ontology agent is analyzing data and discovering relationships. This may take a few moments...'
                                                : 'Fetching ontology data...'
                                            }
                                        </p>
                                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                                            <div className="bg-indigo-600 h-2.5 rounded-full animate-pulse" style={{width: '60%'}}></div>
                                        </div>
                                    </>
                                ) : (
                                    // Welcome state when no data
                                    <>
                                        <div className="text-6xl text-indigo-500 mb-4">🌐</div>
                                        <h3 className="text-2xl font-bold text-gray-800">Ontology Graph</h3>
                                        <p className="text-gray-600">
                                            No ontology data found. <br/> Use 🔌 Graph connectors to ingest entities, and click detect ontology to see entity relationships and confidence scores.
                                        </p>
                                        <button
                                            onClick={() => setShowRegenerateConfirm(true)}
                                            className="btn bg-yellow-500 hover:bg-yellow-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                            disabled={isLoading || isAgentActive}
                                            title={isAgentActive ? "Agent is currently active - please wait" : "Detect Ontology"}>
                                            Detect Ontology
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Ontology Graph View
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
                        >
                            <Controls />
                            <MiniMap />
                            <Background />
                        </ReactFlow>
                    )}
                </div>
                
                {/* Relation Legend */}
                <div className="flex justify-center items-center gap-6 text-sm mt-4 p-3 bg-white rounded-lg shadow-sm border">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-0 border-t-2 border-gray-500"></div>
                        <span>Accepted (≥{Math.round(acceptanceThreshold * 100)}%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-0 border-t-2 border-red-500" style={{borderStyle: 'dashed', borderTopWidth: '2px', borderTopStyle: 'dashed'}}></div>
                        <span>Rejected (≤{Math.round(rejectionThreshold * 100)}%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-0 border-t-2 border-gray-500" style={{borderStyle: 'dotted', borderTopWidth: '2px', borderTopStyle: 'dotted'}}></div>
                        <span>Uncertain</span>
                    </div>
                </div>
            </div>

            {/* Clear Ontology Confirmation Dialog */}
            {showClearConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Clear Ontology</h3>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to clear the entire ontology? <b>This will permanently delete all relations & clear the ontology graph.</b> This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowClearConfirm(false)}
                                className="btn bg-gray-500 hover:bg-gray-600 text-white">
                                Cancel
                            </button>
                            <button
                                onClick={handleClearOntology}
                                className="btn bg-red-500 hover:bg-red-600 text-white">
                                Clear Ontology
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Regenerate Ontology Confirmation Dialog */}
            {showRegenerateConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">
                            {nodes.length === 0 ? 'Detect Ontology' : 'Re-detect Ontology'}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {nodes.length === 0 
                                ? 'This will detect and create relations between entities by analyzing the graph data and inferring relationships. This process may take some time.'
                                : 'This will detect and re-create relations between entities by analyzing the graph data and inferring relationships. Existing relations will be updated. This process may take some time.'
                            }
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowRegenerateConfirm(false)}
                                className="btn bg-gray-500 hover:bg-gray-600 text-white">
                                Cancel
                            </button>
                            <button
                                onClick={handleRegenerateConfirm}
                                className="btn bg-yellow-500 hover:bg-yellow-600 text-white">
                                {nodes.length === 0 ? 'Detect' : 'Re-detect'} Ontology
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
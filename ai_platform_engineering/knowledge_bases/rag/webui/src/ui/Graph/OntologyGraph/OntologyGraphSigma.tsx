import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SigmaContainer, ControlsContainer, ZoomControl, FullScreenControl } from "@react-sigma/core";
import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import './sigma-styles.css';

import OntologyEntityDetailsCard from '../shared/EntityDetailsCard';
import OntologyGraphDataController, { OntologyFilters } from './OntologyGraphDataController';
import PropertyMappingsModal, { PropertyMapping } from './PropertyMappingsModal';
import OntologyNodeHoverCard from './OntologyNodeHoverCard';
import CameraController from '../shared/SigmaGraph/controllers/CameraController';
import SigmaInstanceCapture from '../shared/SigmaGraph/controllers/SigmaInstanceCapture';
import GraphDragController from '../shared/SigmaGraph/controllers/GraphDragController';
import GraphEventsController from '../shared/SigmaGraph/controllers/GraphEventsController';
import GraphSettingsController from '../shared/SigmaGraph/controllers/GraphSettingsController';
import { getColorForNode, getSigmaEdgeStyle, EvaluationResult, getEvaluationResult, colorMap } from '../graphStyles';
import { generateNodeId, generateRelationId, generateRelationKey, extractRelationId, generateEdgeKey } from '../shared/graphUtils';

import { 
    getOntologyStartNodes,
    exploreOntologyNeighborhood,
    getOntologyGraphStats,
    clearOntology, 
    regenerateOntology, 
    getOntologyAgentStatus,
    acceptOntologyRelation,
    rejectOntologyRelation,
    undoOntologyRelationEvaluation,
    evaluateOntologyRelation,
    syncOntologyRelation,
    getOntologyRelationHeuristicsBatch,
    getOntologyRelationEvaluationsBatch,
    fetchOntologyEntitiesBatch,
    fetchOntologyRelationsBatch
} from '../../../api';

interface EntityData {
    entity_type: string;
    additional_labels: string[];
    all_properties: any;
    primary_key_properties: string[];
    additional_key_properties: string[];
}

interface RelationData {
    from_entity: { entity_type: string; primary_key: string };
    to_entity: { entity_type: string; primary_key: string };
    relation_name: string;
    relation_pk: string;
    relation_properties: any;
}

interface HeuristicsData {
    entity_a_type: string;
    entity_b_type: string;
    total_matches: number;
    example_matches: any[];
    value_match_quality_avg: number;
    deep_match_quality_avg: number;
    property_mappings?: any[];
}

interface EvaluationData {
    evaluation: {
        relation_name: string;
        result: string;
        directionality?: string;
        property_mappings?: any[];
        justification?: string;
        thought?: string;
        last_evaluated?: number;
        is_manual?: boolean;
        is_sub_entity_relation?: boolean;
    } | null;
    sync_status: {
        is_synced: boolean;
        last_synced?: number;
        error_message?: string;
    } | null;
}

interface OntologyGraphProps {}

// Helper function to truncate long labels
const truncateLabel = (label: string, maxLength: number = 30): string => {
    if (label.length <= maxLength) return label;
    return label.substring(0, maxLength - 3) + '...';
};

// Marquee component for scrolling long text
const Marquee = ({ text }: { text: string }) => {
    return (
        <div className="overflow-hidden whitespace-nowrap w-full">
            <span className="inline-block animate-marquee">{text}</span>
        </div>
    );
};

export default function OntologyGraphSigma({}: OntologyGraphProps) {
    // Graph instance - use MultiDirectedGraph to allow multiple edges between same nodes
    const graph = useMemo(() => new MultiDirectedGraph(), []);
    
    // State management
    const [dataReady, setDataReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true); // Start with loading true
    const [allEntityTypes, setAllEntityTypes] = useState<string[]>([]);
    const [selectedEntityTypes, setSelectedEntityTypes] = useState<Set<string>>(new Set());
    const [showFilterSettings, setShowFilterSettings] = useState(false);
    const [selectedElement, setSelectedElement] = useState<{ type: 'node'; id: string; data: any } | null>(null);
    const [showAccepted, setShowAccepted] = useState<boolean>(true);
    const [showLayoutSettings, setShowLayoutSettings] = useState(false);
    
    // ForceAtlas2 settings
    const [fa2Iterations, setFa2Iterations] = useState(100);
    const [fa2Gravity, setFa2Gravity] = useState(1.0);
    const [fa2ScalingRatio, setFa2ScalingRatio] = useState(10);
    const [fa2SlowDown, setFa2SlowDown] = useState(0.6);
    const [showRejected, setShowRejected] = useState<boolean>(false);
    
    // Initial positioning settings
    const [groupRadius, setGroupRadius] = useState(500); // Distance from center for prefix groups
    const [nodeGroupRadius, setNodeGroupRadius] = useState(600); // Radius for random node distribution within each prefix group
    
    // Minimum distance settings
    const [minNodeDistance, setMinNodeDistance] = useState(100); // Minimum distance between nodes
    
    // Edge thickness settings
    const [edgeThicknessMultiplier, setEdgeThicknessMultiplier] = useState(1.0); // 0.5 to 2.0
    
    const [showUncertain, setShowUncertain] = useState<boolean>(false);
    
    // Relation filter mode: 'accepted-only', 'all', 'rejected-uncertain-only'
    const [relationFilterMode, setRelationFilterMode] = useState<'accepted-only' | 'all' | 'rejected-uncertain-only'>('accepted-only');
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [graphStats, setGraphStats] = useState<{ node_count: number; relation_count: number } | null>(null);
    
    // Agent status related state
    const [isAgentProcessing, setIsAgentProcessing] = useState(false);
    const [isAgentEvaluating, setIsAgentEvaluating] = useState(false);
    const [agentStatusMsg, setAgentStatusMsg] = useState<string>('');
    const [isLoadingAgentStatus, setIsLoadingAgentStatus] = useState(true);
    const [showDeleteOntologyConfirm, setShowDeleteOntologyConfirm] = useState<boolean>(false);
    const [showRegenerateConfirm, setShowRegenerateConfirm] = useState<boolean>(false);
    const [isRelationActionLoading, setIsRelationActionLoading] = useState(false);
    const [relationActionResult, setRelationActionResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [isDeletingOntology, setIsDeletingOntology] = useState(false);
    const [isRegeneratingOntology, setIsRegeneratingOntology] = useState(false);
    
    // Property mappings modal state
    const [showPropertyMappingsModal, setShowPropertyMappingsModal] = useState(false);
    const [pendingAcceptRelation, setPendingAcceptRelation] = useState<{ relationId: string; relationName: string; heuristicsData: any; entityAType: string; entityBType: string } | null>(null);
    
    // Store heuristics data for edges
    const heuristicsCache = useRef<Map<string, HeuristicsData>>(new Map());
    
    // Store evaluation data for edges
    const evaluationsCache = useRef<Map<string, EvaluationData>>(new Map());
    
    // Data storage
    const graphData = useRef<{
        entitiesById: Map<string, EntityData>;
        relationsById: Map<string, RelationData>;
    }>({
        entitiesById: new Map(),
        relationsById: new Map()
    });

    // Derived state for agent activity
    const isAgentActive = isAgentProcessing || isAgentEvaluating || isRegeneratingOntology;
    
    // Sigma instance for manual refresh button
    const [sigmaInstance, setSigmaInstance] = useState<any>(null);
    
    // Manual refresh function for live editing
    const handleManualRefresh = useCallback(() => {
        if (sigmaInstance) {
            try {
                if (sigmaInstance.renderers && sigmaInstance.renderers[0]) {
                    sigmaInstance.renderers[0].resize();
                }
                sigmaInstance.refresh();
                const camera = sigmaInstance.getCamera();
                camera.animatedReset({ duration: 600 });
            } catch (error) {
                console.error('Manual refresh failed:', error);
            }
        }
    }, [sigmaInstance]);

    // Fetch agent status function
    const fetchAgentStatus = useCallback(async () => {
        try {
            const response = await getOntologyAgentStatus();
            const { is_processing, is_evaluating, agent_status_msg } = response;
            setIsAgentProcessing(is_processing);
            setIsAgentEvaluating(is_evaluating);
            setAgentStatusMsg(agent_status_msg || '');
            setIsLoadingAgentStatus(false);
        } catch (error) {
            console.error('Failed to fetch agent status:', error);
            setIsLoadingAgentStatus(false);
        }
    }, []);

    // Fetch graph stats function
    const fetchGraphStats = useCallback(async () => {
        try {
            const stats = await getOntologyGraphStats();
            setGraphStats(stats);
        } catch (error) {
            console.error('Failed to fetch graph stats:', error);
        }
    }, []);

    const handleEntityTypeChange = (entityType: string, isChecked: boolean) => {
        setSelectedEntityTypes(prev => {
            const newSelected = new Set(prev);
            if (isChecked) {
                newSelected.add(entityType);
            } else {
                newSelected.delete(entityType);
            }
            return newSelected;
        });
    };

    const handleClearFocus = () => {
        setFocusedNodeId(null);
    };

    const handleDeleteOntology = async () => {
        setIsDeletingOntology(true);
        try {
            await clearOntology();
            // Clear stored data and graph
            graphData.current = { entitiesById: new Map(), relationsById: new Map() };
            heuristicsCache.current.clear();
            evaluationsCache.current.clear();
            graph.clear();
            setAllEntityTypes([]);
            setSelectedEntityTypes(new Set());
            setFocusedNodeId(null);
            setGraphStats(null); // Clear graph stats to show welcome message
            setDataReady(false);
            setIsLoading(false);
        } catch (error) {
            console.error('Failed to clear ontology:', error);
            alert(`Failed to delete ontology: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsDeletingOntology(false);
            setShowDeleteOntologyConfirm(false);
        }
    };

    const handleRegenerateOntology = async () => {
        setIsRegeneratingOntology(true);
        try {
            await regenerateOntology();
            alert('Submitted for regeneration, an agent will look at all the graph data, and regenerate the ontology soon');
        } catch (error) {
            console.error('Failed to regenerate ontology:', error);
            alert(`Failed to regenerate ontology: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsRegeneratingOntology(false);
        }
    };

    const handleRegenerateConfirm = async () => {
        setShowRegenerateConfirm(false);
        await handleRegenerateOntology();
    };

    const handleRefreshOntology = () => {
        // Clear stored data to force a refresh
        graphData.current = { entitiesById: new Map(), relationsById: new Map() };
        heuristicsCache.current.clear();
        evaluationsCache.current.clear();
        graph.clear();
        setAllEntityTypes([]);
        setSelectedEntityTypes(new Set());
        setRelationActionResult(null);
        setDataReady(false);
        setIsLoading(true);
    };

    // Relation action handlers
    const handleRelationEvaluate = async (relationId: string) => {
        if (!relationId) {
            setRelationActionResult({ type: 'error', message: 'No relation ID found for this relation' });
            return;
        }

        setIsRelationActionLoading(true);
        setRelationActionResult(null);

        try {
            await evaluateOntologyRelation(relationId);
            setRelationActionResult({ type: 'success', message: 'Evaluation submitted successfully' });
            handleRefreshOntology();
        } catch (error) {
            console.error('API call failed:', error);
            setRelationActionResult({ type: 'error', message: 'Failed - ' + (error instanceof Error ? error.message : 'Unknown error') });
        } finally {
            setIsRelationActionLoading(false);
        }
    };

    const handleRelationAccept = async (relationId: string, relationName: string) => {
        if (!relationId) {
            setRelationActionResult({ type: 'error', message: 'No relation ID found for this relation' });
            return;
        }

        // Fetch heuristics data for this relation
        const heuristicsData = heuristicsCache.current.get(relationId);
        
        if (!heuristicsData || !heuristicsData.property_mappings || heuristicsData.property_mappings.length === 0) {
            setRelationActionResult({ type: 'error', message: 'No property mappings found in heuristics data. Cannot accept relation without property mappings.' });
            return;
        }

        // Get entity types from heuristics
        const entityAType = heuristicsData.entity_a_type;
        const entityBType = heuristicsData.entity_b_type;

        // Store pending relation data and show modal (modal will collect relation name)
        setPendingAcceptRelation({
            relationId,
            relationName: relationName || 'related_to', // Use existing or default
            heuristicsData,
            entityAType,
            entityBType
        });
        setShowPropertyMappingsModal(true);
    };

    const handlePropertyMappingsSubmit = async (relationName: string, propertyMappings: PropertyMapping[]) => {
        if (!pendingAcceptRelation) return;

        setShowPropertyMappingsModal(false);
        setIsRelationActionLoading(true);
        setRelationActionResult(null);

        try {
            await acceptOntologyRelation(
                pendingAcceptRelation.relationId, 
                relationName, // Use relation name from modal
                propertyMappings
            );
            setRelationActionResult({ type: 'success', message: 'Relation accepted successfully' });
            
            // Close the entity details card
            setSelectedElement(null);
            
            handleRefreshOntology();
        } catch (error) {
            console.error('API call failed:', error);
            setRelationActionResult({ type: 'error', message: 'Failed - ' + (error instanceof Error ? error.message : 'Unknown error') });
        } finally {
            setIsRelationActionLoading(false);
            setPendingAcceptRelation(null);
        }
    };

    const handleRelationReject = async (relationId: string) => {
        if (!relationId) {
            setRelationActionResult({ type: 'error', message: 'No relation ID found for this relation' });
            return;
        }

        setIsRelationActionLoading(true);
        setRelationActionResult(null);

        try {
            await rejectOntologyRelation(relationId);
            setRelationActionResult({ type: 'success', message: 'Relation rejected successfully' });
            handleRefreshOntology();
        } catch (error) {
            console.error('API call failed:', error);
            setRelationActionResult({ type: 'error', message: 'Failed - ' + (error instanceof Error ? error.message : 'Unknown error') });
        } finally {
            setIsRelationActionLoading(false);
        }
    };

    const handleRelationUndoEvaluation = async (relationId: string) => {
        if (!relationId) {
            setRelationActionResult({ type: 'error', message: 'No relation ID found for this relation' });
            return;
        }

        setIsRelationActionLoading(true);
        setRelationActionResult(null);

        try {
            await undoOntologyRelationEvaluation(relationId);
            setRelationActionResult({ type: 'success', message: 'Evaluation undone successfully' });
            handleRefreshOntology();
        } catch (error) {
            console.error('API call failed:', error);
            setRelationActionResult({ type: 'error', message: 'Failed - ' + (error instanceof Error ? error.message : 'Unknown error') });
        } finally {
            setIsRelationActionLoading(false);
        }
    };

    const handleRelationSync = async (relationId: string) => {
        if (!relationId) {
            setRelationActionResult({ type: 'error', message: 'No relation ID found for this relation' });
            return;
        }

        setIsRelationActionLoading(true);
        setRelationActionResult(null);

        try {
            await syncOntologyRelation(relationId);
            setRelationActionResult({ type: 'success', message: 'Sync completed successfully' });
            handleRefreshOntology();
        } catch (error) {
            console.error('API call failed:', error);
            setRelationActionResult({ type: 'error', message: 'Failed - ' + (error instanceof Error ? error.message : 'Unknown error') });
        } finally {
            setIsRelationActionLoading(false);
        }
    };

    // Node click handler
    const handleNodeClick = useCallback((nodeId: string, nodeData: any) => {
        console.log('Node clicked:', nodeId);
        setSelectedElement({ type: 'node', id: nodeId, data: nodeData });
        
        // Camera animation disabled for now - causing viewport issues
        // TODO: Re-enable with proper viewport calculations
    }, []);


    // Agent status fetching effect
    useEffect(() => {
        fetchAgentStatus();
        fetchGraphStats();

        const pollInterval = isAgentActive ? 1000 : 5000;
        const statusInterval = setInterval(fetchAgentStatus, pollInterval);

        return () => {
            clearInterval(statusInterval);
        };
    }, [fetchAgentStatus, fetchGraphStats, isAgentActive]);

    // Load ontology data
    useEffect(() => {
        const loadOntologyData = async () => {
            if (dataReady) return; // Already loaded

            setIsLoading(true);
            try {
                console.log('Starting batch fetch of all ontology data...');
                
                // Fetch all entities using batch API
                const allEntities: any[] = [];
                let offset = 0;
                const batchSize = 1000; // Maximum allowed by API
                
                while (true) {
                    const entitiesResponse = await fetchOntologyEntitiesBatch({ 
                        offset, 
                        limit: batchSize 
                    });
                    
                    allEntities.push(...entitiesResponse.entities);
                    
                    // Break if we got fewer than requested (means we reached the end)
                    if (entitiesResponse.count < batchSize) {
                        break;
                    }
                    
                    offset += batchSize;
                }
                
                console.log(`Total entities fetched: ${allEntities.length}`);
                
                // Add all entities to the map
                allEntities.forEach(entity => {
                    const pk = entity.all_properties?._entity_pk || entity._entity_pk;
                    const entityType = entity.entity_type || entity.all_properties?._entity_type;
                    if (pk && entityType) {
                        const nodeId = generateNodeId(entityType, pk);
                        graphData.current.entitiesById.set(nodeId, entity);
                    }
                });
                
                // Fetch all relations using batch API
                const allRelations: any[] = [];
                offset = 0;
                
                while (true) {
                    const relationsResponse = await fetchOntologyRelationsBatch({ 
                        offset, 
                        limit: batchSize 
                    });
                    
                    allRelations.push(...relationsResponse.relations);
                    
                    // Break if we got fewer than requested (means we reached the end)
                    if (relationsResponse.count < batchSize) {
                        break;
                    }
                    
                    offset += batchSize;
                }
                
                console.log(`Total relations fetched: ${allRelations.length}`);
                
                // Add all relations to the map using a consistent relation ID generation
                // In ontology graph, _relation_pk === _ontology_relation_id
                allRelations.forEach((relation: any) => {
                    // Extract the relation ID using the common utility
                    const relationId = extractRelationId(relation);
                    
                    if (relationId) {
                        graphData.current.relationsById.set(relationId, relation);
                    } else {
                        // Fallback: generate a relation ID from components
                        const fromPk = relation.from_entity?.primary_key;
                        const toPk = relation.to_entity?.primary_key;
                        const relationName = relation.relation_name || 'related_to';
                        
                        if (fromPk && toPk) {
                            const generatedId = generateRelationId(fromPk, toPk, relationName);
                            graphData.current.relationsById.set(generatedId, relation);
                            console.warn('Relation has no valid ID, generated one:', generatedId, relation);
                        } else {
                            console.warn('Relation has no valid ID and cannot generate one:', relation);
                        }
                    }
                });
                
                console.log(`Loaded ${graphData.current.entitiesById.size} entities, ${graphData.current.relationsById.size} relations`);
                
                // Check if we have any data - if not, show welcome message
                if (graphData.current.entitiesById.size === 0 && graphData.current.relationsById.size === 0) {
                    console.log('No entities or relations found - showing welcome message');
                    setDataReady(false);
                    setIsLoading(false);
                    setGraphStats({ node_count: 0, relation_count: 0 });
                    return;
                }
                
                // Build the graph
                await buildGraph();
                // isLoading will be set to false after rendering completes (handled in buildGraph)
                
            } catch (err) {
                console.error('Failed to fetch graph data:', err);
                setIsLoading(false);
                return;
            }
        };

        loadOntologyData();
    }, [dataReady]);

    // Update edge thickness when multiplier changes
    useEffect(() => {
        if (!dataReady || heuristicsCache.current.size === 0) return;
        
        // Recalculate statistics
        const allMatches: number[] = [];
        heuristicsCache.current.forEach((heuristics) => {
            if (heuristics?.total_matches) {
                allMatches.push(heuristics.total_matches);
            }
        });
        
        if (allMatches.length === 0) return;
        
        const mean = allMatches.reduce((sum, val) => sum + val, 0) / allMatches.length;
        const variance = allMatches.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / allMatches.length;
        const stdDev = Math.sqrt(variance);
        const statsData = { mean, stdDev };
        
        // Update all edge sizes
        graph.forEachEdge((edgeId, attributes) => {
            let maxHeuristics = null;
            let maxMatches = 0;
            
            // Get all relation IDs for this edge
            const relationIds = attributes.relationIds || [];
            
            // Check heuristics for all relations in this edge
            relationIds.forEach((relationId: string) => {
                const heuristics = heuristicsCache.current.get(relationId);
                if (heuristics && heuristics.total_matches > maxMatches) {
                    maxHeuristics = heuristics;
                    maxMatches = heuristics.total_matches;
                }
            });
            
            // Get the primary relation data from the first relation ID
            const primaryRelationId = relationIds[0];
            const primaryRelation = primaryRelationId ? graphData.current.relationsById.get(primaryRelationId) : null;
            
            if (!primaryRelation) return;
            
            const newStyle = getSigmaEdgeStyle(primaryRelation, maxHeuristics, statsData, edgeThicknessMultiplier);
            
            graph.setEdgeAttribute(edgeId, 'size', newStyle.size);
            graph.setEdgeAttribute(edgeId, 'originalSize', newStyle.size);
        });
    }, [edgeThicknessMultiplier, dataReady, graph]);

    // Enforce minimum distance between nodes using a force-based approach
    const enforceMinNodeDistance = (graph: MultiDirectedGraph, minDistance: number, maxIterations: number = 200) => {
        if (minDistance <= 0) {
            return;
        }
        
        const nodes = graph.nodes();
        
        const damping = 0.3; // Reduced damping for stronger effect
        const forceMultiplier = 75; // Much stronger force multiplier
        
        let totalOverlaps = 0;
        let totalMoves = 0;
        
        for (let iteration = 0; iteration < maxIterations; iteration++) {
            // Calculate forces for all nodes
            const forces = new Map<string, { fx: number; fy: number }>();
            
            // Initialize forces to zero
            nodes.forEach(node => {
                forces.set(node, { fx: 0, fy: 0 });
            });
            
            let iterationOverlaps = 0;
            
            // Calculate repulsion forces between all pairs
            for (let i = 0; i < nodes.length; i++) {
                const node1 = nodes[i];
                const x1 = graph.getNodeAttribute(node1, 'x');
                const y1 = graph.getNodeAttribute(node1, 'y');
                const size1 = graph.getNodeAttribute(node1, 'size') || 15;
                const force1 = forces.get(node1)!;
                
                for (let j = i + 1; j < nodes.length; j++) {
                    const node2 = nodes[j];
                    const x2 = graph.getNodeAttribute(node2, 'x');
                    const y2 = graph.getNodeAttribute(node2, 'y');
                    const size2 = graph.getNodeAttribute(node2, 'size') || 15;
                    const force2 = forces.get(node2)!;
                    
                    // Calculate distance between node centers
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Calculate minimum required distance (node sizes + min distance)
                    const requiredDistance = (size1 / 2) + (size2 / 2) + minDistance;
                    
                    if (distance < requiredDistance && distance > 0.001) {
                        iterationOverlaps++;
                        // Calculate repulsion force (stronger when closer)
                        const overlap = requiredDistance - distance;
                        // Use much stronger force calculation
                        const strength = (overlap / requiredDistance) * forceMultiplier;
                        
                        // Normalize direction vector
                        const normX = dx / distance;
                        const normY = dy / distance;
                        
                        // Apply repulsion forces (nodes push each other apart)
                        force1.fx -= normX * strength;
                        force1.fy -= normY * strength;
                        force2.fx += normX * strength;
                        force2.fy += normY * strength;
                    }
                }
            }
            
            totalOverlaps += iterationOverlaps;
            
            // Apply forces with damping
            let maxForce = 0;
            nodes.forEach(node => {
                const force = forces.get(node)!;
                const forceMagnitude = Math.sqrt(force.fx * force.fx + force.fy * force.fy);
                maxForce = Math.max(maxForce, forceMagnitude);
                
                if (forceMagnitude > 0.01) {
                    totalMoves++;
                }
                
                // Apply forces with damping
                const x = graph.getNodeAttribute(node, 'x');
                const y = graph.getNodeAttribute(node, 'y');
                graph.setNodeAttribute(node, 'x', x + force.fx * damping);
                graph.setNodeAttribute(node, 'y', y + force.fy * damping);
            });
            
            // Early termination if forces are small (converged)
            if (maxForce < 0.5) {
                break;
            }
        }
    };
    
    // Build graph from stored data
    const buildGraph = async () => {
        // Clear existing graph
        graph.clear();
        
        // Group node types by prefix using the color map
        const getPrefixForNode = (entityType: string): string | null => {
            const lowerType = entityType.toLowerCase();
            // Check if entity type starts with any prefix from colorMap
            for (const prefix in colorMap) {
                if (lowerType.startsWith(prefix.toLowerCase())) {
                    return prefix;
                }
            }
            return null; // No matching prefix
        };
        
        // Group nodes by prefix
        const nodesByPrefix = new Map<string, Array<{ nodeId: string; entity: EntityData }>>();
        const ungroupedNodes: Array<{ nodeId: string; entity: EntityData }> = [];
        const entityTypes = new Set<string>();
        const nodeDegrees = new Map<string, number>();
        
        graphData.current.entitiesById.forEach((entity, nodeId) => {
            const entityType = entity.entity_type || 'Unknown';
            entityTypes.add(entityType);
            const prefix = getPrefixForNode(entityType);
            
            if (prefix) {
                if (!nodesByPrefix.has(prefix)) {
                    nodesByPrefix.set(prefix, []);
                }
                nodesByPrefix.get(prefix)!.push({ nodeId, entity });
            } else {
                // Nodes that don't match any prefix go to ungrouped
                ungroupedNodes.push({ nodeId, entity });
            }
            nodeDegrees.set(nodeId, 0);
        });
        
        // Debug: Log the grouping
        const prefixCounts = Array.from(nodesByPrefix.entries()).map(([prefix, nodes]) => `${prefix}:${nodes.length}`);
        console.log(`Grouped nodes by prefix: ${prefixCounts.join(', ')}. Ungrouped: ${ungroupedNodes.length}`);
        
        // Calculate positions for each prefix group
        // Arrange groups in a circle, with nodes within each group randomly distributed within a radius
        const prefixes = Array.from(nodesByPrefix.keys());
        
        // Position grouped nodes by prefix
        prefixes.forEach((prefix, groupIndex) => {
            const nodes = nodesByPrefix.get(prefix)!;
            const groupAngle = (2 * Math.PI * groupIndex) / (prefixes.length + (ungroupedNodes.length > 0 ? 1 : 0));
            const groupCenterX = Math.cos(groupAngle) * groupRadius;
            const groupCenterY = Math.sin(groupAngle) * groupRadius;
            
            nodes.forEach(({ nodeId, entity }) => {
                const entityType = entity.entity_type || 'Unknown';
                const color = getColorForNode(entityType);
                
                // Randomly distribute nodes within the group radius
                const randomAngle = Math.random() * 2 * Math.PI;
                const randomRadius = Math.random() * nodeGroupRadius;
                const x = groupCenterX + Math.cos(randomAngle) * randomRadius;
                const y = groupCenterY + Math.sin(randomAngle) * randomRadius;
                
                graph.addNode(nodeId, {
                    label: truncateLabel(entityType),
                    size: 15, // Will be updated based on degree
                    color: color,
                    entityType: entityType,
                    entityData: entity,
                    x: x,
                    y: y,
                });
            });
        });
        
        // Randomly distribute ungrouped nodes
        if (ungroupedNodes.length > 0) {
            const ungroupedGroupAngle = (2 * Math.PI * prefixes.length) / (prefixes.length + 1);
            const ungroupedCenterX = Math.cos(ungroupedGroupAngle) * groupRadius;
            const ungroupedCenterY = Math.sin(ungroupedGroupAngle) * groupRadius;
            
            ungroupedNodes.forEach(({ nodeId, entity }) => {
                const entityType = entity.entity_type || 'Unknown';
                const color = getColorForNode(entityType);
                
                // Random position around the ungrouped center
                const randomAngle = Math.random() * 2 * Math.PI;
                const randomRadius = Math.random() * 300; // Random distance up to 300
                const x = ungroupedCenterX + Math.cos(randomAngle) * randomRadius;
                const y = ungroupedCenterY + Math.sin(randomAngle) * randomRadius;
                
                graph.addNode(nodeId, {
                    label: truncateLabel(entityType),
                    size: 15, // Will be updated based on degree
                    color: color,
                    entityType: entityType,
                    entityData: entity,
                    x: x,
                    y: y,
                });
            });
        }
        
        // Group relations by node pairs AND evaluation status to create separate edges per status
        interface RelationGroup {
            forward: Array<{ relationId: string; relation: any }>;
            backward: Array<{ relationId: string; relation: any }>;
        }
        
        // Map key: "nodeA<->nodeB-STATUS" (normalized)
        const relationGroups = new Map<string, RelationGroup>();
        
        graphData.current.relationsById.forEach((relation, storedRelationId) => {
            const sourceNodeId = generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key);
            const targetNodeId = generateNodeId(relation.to_entity.entity_type, relation.to_entity.primary_key);
            
            if (!graph.hasNode(sourceNodeId) || !graph.hasNode(targetNodeId)) return;
            
            // Get evaluation status for this relation
            const evalResult = getEvaluationResult(relation);
            const status = evalResult || 'NONE'; // Use 'NONE' for relations without evaluation
            
            // Create a normalized key (always smaller node id first) + status
            const normalizedNodeKey = sourceNodeId < targetNodeId ? `${sourceNodeId}<->${targetNodeId}` : `${targetNodeId}<->${sourceNodeId}`;
            const normalizedKey = `${normalizedNodeKey}-${status}`;
            
            if (!relationGroups.has(normalizedKey)) {
                relationGroups.set(normalizedKey, { forward: [], backward: [] });
            }
            
            const group = relationGroups.get(normalizedKey)!;
            
            // Use the stored relation ID (from the map key) to maintain consistency
            const relationId = storedRelationId;
            
            // Determine if this is forward or backward relative to the normalized key
            if ((sourceNodeId < targetNodeId && sourceNodeId === generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key)) ||
                (sourceNodeId > targetNodeId && targetNodeId === generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key))) {
                group.forward.push({ relationId, relation });
            } else {
                group.backward.push({ relationId, relation });
            }
        });
        
        // Add edges and fetch heuristics
        const edgesToAdd: Array<{ key: string; source: string; target: string; attributes: any }> = [];
        const relationIdsForHeuristics: string[] = [];
        
        relationGroups.forEach((group, normalizedKey) => {
            const hasBidirectional = group.forward.length > 0 && group.backward.length > 0;
            
            // Collect all relations (both directions) - they all have the same status
            const allRelations = [...group.forward, ...group.backward];
            
            // Get the evaluation status from the group key (format: "nodeA<->nodeB-STATUS")
            const status = normalizedKey.split('-').pop() || 'NONE';
            const evalResult = status as EvaluationResult;
            
            // Find the relation with the highest weight for primary display data
            let primaryRelation = allRelations[0];
            let maxWeight = primaryRelation.relation.relation_properties?.weight || 0;
            let totalWeight = 0;
            
            allRelations.forEach(({ relationId, relation }) => {
                const weight = relation.relation_properties?.weight || 0;
                totalWeight += weight; // Sum all weights
                if (weight > maxWeight) {
                    maxWeight = weight;
                    primaryRelation = { relationId, relation };
                }
            });
            
            const relation = primaryRelation.relation;
            const sourceNodeId = generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key);
            const targetNodeId = generateNodeId(relation.to_entity.entity_type, relation.to_entity.primary_key);
            
            // Count degrees for node sizing
            nodeDegrees.set(sourceNodeId, (nodeDegrees.get(sourceNodeId) || 0) + 1);
            nodeDegrees.set(targetNodeId, (nodeDegrees.get(targetNodeId) || 0) + 1);
            
            // Get all relation IDs for this edge
            const relationIds = allRelations.map(({ relationId }) => relationId);
            
            // Generate edge key from sorted relation IDs
            const edgeKey = generateEdgeKey(sourceNodeId, targetNodeId, relationIds, status);
            
            // Determine edge color based on status
            let edgeColor: string;
            if (evalResult === EvaluationResult.ACCEPTED) {
                edgeColor = '#d1d5db'; // gray
            } else if (evalResult === EvaluationResult.REJECTED) {
                edgeColor = '#ef4444'; // red
            } else if (evalResult === EvaluationResult.UNSURE) {
                edgeColor = '#f97316'; // orange
            } else {
                edgeColor = '#9ca3af'; // gray for NONE/unknown
            }
            
            // Get edge style (will use the color we determined)
            const edgeStyle = getSigmaEdgeStyle(relation, undefined, undefined, edgeThicknessMultiplier);
            
            // Create label with bidirectional indicator and multiple relations indicator
            let label: string;
            let edgeType = "arrow"; // Default to arrow for directed edges
            
            if (hasBidirectional) {
                edgeType = "line"; // Use undirected line (no arrow) for bidirectional edges
            }
            
            const relationCount = allRelations.length;
            
            if (relationCount === 1) {
                // Single relation - show its name
                label = relation.relation_name;
                if (hasBidirectional) {
                    label = `⟷  ${label}`; // Add bidirectional symbol
                }
            } else {
                // Multiple relations - show count
                if (hasBidirectional) {
                    label = `⟷  ... ×${relationCount}`; // Bidirectional with multiple
                } else {
                    label = `... ×${relationCount}`; // Multiple relations
                }
            }
            
            edgesToAdd.push({
                key: edgeKey,
                source: sourceNodeId,
                target: targetNodeId,
                attributes: {
                    label: truncateLabel(label, 40), // Truncate edge labels at 40 chars
                    type: edgeType, // "line" for bidirectional, "arrow" for directed
                    size: edgeStyle.size,
                    color: edgeColor, // Use status-based color
                    originalColor: edgeColor,
                    originalSize: edgeStyle.size,
                    evaluationResult: evalResult,
                    relationIds: relationIds, // Store array of relation IDs
                    totalWeight: totalWeight, // Sum of all weights
                    isBidirectional: hasBidirectional,
                    relationCount: relationCount,
                }
            });
            
            // Collect all relation IDs for batch heuristics fetch
            relationIds.forEach((relationId) => {
                if (relationId) {
                    relationIdsForHeuristics.push(relationId);
                } else {
                    console.warn(`Relation has no valid ID`, allRelations);
                }
            });
        });
        
        // Add all edges
        edgesToAdd.forEach(({ key, source, target, attributes }) => {
            try {
                graph.addEdgeWithKey(key, source, target, attributes);
            } catch (error) {
                console.error(`Failed to add edge ${key}:`, error);
            }
        });
        
        // Normalize node sizes based on degree (8-25px range)
        const degrees = Array.from(nodeDegrees.values());
        const minDegree = Math.min(...degrees);
        const maxDegree = Math.max(...degrees);
        const degreeRange = maxDegree - minDegree || 1;
        
        nodeDegrees.forEach((degree, nodeId) => {
            const normalized = (degree - minDegree) / degreeRange;
            const nodeSize = 8 + (normalized * 17); // Range: 8-25px
            graph.setNodeAttribute(nodeId, 'size', nodeSize);
        });
        
        // Log bidirectional edge statistics
        const bidirectionalCount = edgesToAdd.filter(e => e.attributes.isBidirectional).length;
        const totalEdgeCount = edgesToAdd.length;
        console.log(`Graph built: ${graph.order} nodes, ${graph.size} edges (${bidirectionalCount} bidirectional). Degree range: ${minDegree}-${maxDegree}`);
        
        // Apply ForceAtlas2 layout
        forceAtlas2.assign(graph, {
            iterations: fa2Iterations,
            settings: {
                gravity: fa2Gravity,
                scalingRatio: fa2ScalingRatio,
                slowDown: fa2SlowDown,
                barnesHutOptimize: true,
                barnesHutTheta: 0.5,
                adjustSizes: true,
                edgeWeightInfluence: 0.2,
            }
        });

         // Enforce minimum distance between nodes
         if (minNodeDistance > 0) {
            enforceMinNodeDistance(graph, minNodeDistance);
        }
        
        // Set entity types for filters
        const entityTypesArray = Array.from(entityTypes).sort();
        setAllEntityTypes(entityTypesArray);
        setSelectedEntityTypes(new Set(entityTypesArray));
        
        // Mark as ready
        setDataReady(true);
        
        // Wait for Sigma.js to render the graph before hiding loading overlay
        // Use requestAnimationFrame to wait for the next render cycle, then add a delay
        // Only hide loading if we're currently loading (not when re-applying layout)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // Give Sigma.js time to render the initial graph - keep loading for 1 second
                setTimeout(() => {
                    setIsLoading(prev => prev ? false : prev); // Only set to false if currently true
                }, 1000);
            });
        });
        
        // Wait for heuristics to load and update edge sizes with normalization
        // Fetch heuristics in batch for better performance
        try {
            const heuristicsMap = await getOntologyRelationHeuristicsBatch(relationIdsForHeuristics);
            
            // Store heuristics in cache
            // Since we collected _ontology_relation_ids and those are also used as map keys,
            // we can store directly
            Object.entries(heuristicsMap).forEach(([ontologyRelationId, heuristics]) => {
                if (heuristics) {
                    heuristicsCache.current.set(ontologyRelationId, heuristics);
                }
            });
            
            // Calculate statistics for z-score based thickness
            const allMatches: number[] = [];
            heuristicsCache.current.forEach((heuristics) => {
                if (heuristics?.total_matches) {
                    allMatches.push(heuristics.total_matches);
                }
            });
            
            // Calculate mean
            const mean = allMatches.length > 0 
                ? allMatches.reduce((sum, val) => sum + val, 0) / allMatches.length 
                : 0;
            
            // Calculate standard deviation
            const variance = allMatches.length > 0
                ? allMatches.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / allMatches.length
                : 0;
            const stdDev = Math.sqrt(variance);
            
            const statsData = { mean, stdDev };
            
            let edgeCount = 0;
            let sampleSizes: number[] = [];
            let thicknessDistribution = { thin: 0, normal: 0, high: 0, extreme: 0 };
            
            // Update edge sizes with z-score based normalization
            graph.forEachEdge((edgeId, attributes) => {
                // Find the maximum heuristics across all relations in this edge
                let maxHeuristics = null;
                let maxMatches = 0;
                
                // Get all relation IDs for this edge
                const relationIds = attributes.relationIds || [];
                
                // Check heuristics for all relations in this edge
                relationIds.forEach((relationId: string) => {
                    const heuristics = heuristicsCache.current.get(relationId);
                    if (heuristics && heuristics.total_matches > maxMatches) {
                        maxHeuristics = heuristics;
                        maxMatches = heuristics.total_matches;
                    }
                });
                
                // Get the primary relation data from the first relation ID
                const primaryRelationId = relationIds[0];
                const primaryRelation = primaryRelationId ? graphData.current.relationsById.get(primaryRelationId) : null;
                
                if (!primaryRelation) {
                    console.warn(`Primary relation not found for edge ${edgeId}`);
                    return;
                }
                
                const evalResult = getEvaluationResult(primaryRelation);
                const newStyle = getSigmaEdgeStyle(primaryRelation, maxHeuristics, statsData, edgeThicknessMultiplier);
                
                // Track thickness distribution
                if (newStyle.size <= 1.2) thicknessDistribution.thin++;
                else if (newStyle.size <= 4) thicknessDistribution.normal++;
                else if (newStyle.size <= 6) thicknessDistribution.high++;
                else thicknessDistribution.extreme++;
                
                graph.setEdgeAttribute(edgeId, 'size', newStyle.size);
                graph.setEdgeAttribute(edgeId, 'originalSize', newStyle.size);
                sampleSizes.push(newStyle.size);
                edgeCount++;
            });
            
            console.log(`Updated ${edgeCount} edges with heuristics. Size range: ${Math.min(...sampleSizes).toFixed(2)}-${Math.max(...sampleSizes).toFixed(2)}px`);
        } catch (error) {
            console.error('Failed to fetch heuristics in batch:', error);
        }
        
        // Fetch evaluations in batch for better performance
        try {
            const evaluationsMap = await getOntologyRelationEvaluationsBatch(relationIdsForHeuristics);
            
            // Store evaluations in cache
            Object.entries(evaluationsMap).forEach(([ontologyRelationId, evaluationData]) => {
                if (evaluationData) {
                    evaluationsCache.current.set(ontologyRelationId, evaluationData as EvaluationData);
                }
            });
            
            console.log(`Loaded evaluations for ${Object.keys(evaluationsMap).length} relations`);
        } catch (error) {
            console.error('Failed to fetch evaluations in batch:', error);
        }
    };

    // Compute filters for controllers - derive from radio button state
    const filters: OntologyFilters = useMemo(() => {
        let showAcceptedValue = false;
        let showRejectedValue = false;
        let showUncertainValue = false;
        
        if (relationFilterMode === 'accepted-only') {
            showAcceptedValue = true;
        } else if (relationFilterMode === 'all') {
            showAcceptedValue = true;
            showRejectedValue = true;
            showUncertainValue = true;
        } else if (relationFilterMode === 'rejected-uncertain-only') {
            showRejectedValue = true;
            showUncertainValue = true;
        }
        
        return {
            entityTypes: selectedEntityTypes,
            showAccepted: showAcceptedValue,
            showRejected: showRejectedValue,
            showUncertain: showUncertainValue,
            focusedNodeId,
        };
    }, [selectedEntityTypes, relationFilterMode, focusedNodeId]);

    // Count visible nodes and edges
    const visibleStats = useMemo(() => {
        let visibleNodes = 0;
        let visibleEdges = 0;
        
        graph.forEachNode((node, attributes) => {
            if (!attributes.hidden) visibleNodes++;
        });
        
        graph.forEachEdge((edge, attributes) => {
            if (!attributes.hidden) visibleEdges++;
        });
        
        return { nodes: visibleNodes, edges: visibleEdges };
    }, [graph, filters]);

    return (
        <div style={{ width: '100%', height: '100%', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
            {/* --- Graph View --- */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', minHeight: 0 }}>
                {focusedNodeId && (
                    <div style={{ flexShrink: 0, marginBottom: '8px', padding: '8px', backgroundColor: '#dbeafe', borderRadius: '4px', border: '1px solid #93c5fd' }}>
                        <p className="text-sm text-blue-800">
                            <strong>🎯 Focused on:</strong> <code className="bg-blue-100 px-1 rounded">{focusedNodeId}</code> - Showing only this node and its direct connections
                        </p>
                    </div>
                )}
                {/* Graph Container - MUST have explicit flex: 1 and minHeight: 0 */}
                <div style={{ flex: 1, borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', backgroundColor: 'white', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    {/* Hover Info Panel - Top Left */}
                    {hoveredNode && (
                        <OntologyNodeHoverCard 
                            hoveredNode={hoveredNode} 
                            graph={graph} 
                            truncateLabel={truncateLabel}
                        />
                    )}
                    
                    {!dataReady && !isLoading ? (
                        <div style={{ flex: 1, width: '100%', padding: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="text-center space-y-4 max-w-md">
                                <div className="text-6xl text-indigo-500 mb-4">🌐</div>
                                <h3 className="text-2xl font-bold text-gray-800">Ontology Graph</h3>
                                <p className="text-gray-600">
                                    No ontology data found. <br/> Use 🔌 Graph connectors to ingest entities, and click detect ontology to see entity relationships and confidence scores.
                                </p>
                                <button
                                    onClick={() => setShowRegenerateConfirm(true)}
                                    className="btn bg-yellow-500 hover:bg-yellow-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                    disabled={isAgentActive || isLoadingAgentStatus}
                                    title={isLoadingAgentStatus ? "Loading agent status..." : isAgentActive ? "Agent is currently active - please wait" : "Analyse Ontology"}>
                                    {isLoadingAgentStatus ? 'Loading...' : 'Analyse Ontology'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ flex: 1, width: '100%', minHeight: 0, position: 'relative' }}>
                            {/* Loading Overlay */}
                            {isLoading && (
                                <div style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 10,
                                    borderRadius: '8px'
                                }}>
                                    <div className="text-center space-y-4">
                                        <svg className="animate-spin h-12 w-12 text-indigo-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <p className="text-lg font-semibold text-gray-700">Loading graph data...</p>
                                        <p className="text-sm text-gray-500">Fetching entities and relations</p>
                                    </div>
                                </div>
                            )}
                            <SigmaContainer 
                                graph={graph}
                                style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
                                settings={{
                                    renderEdgeLabels: true,
                                    defaultEdgeType: "arrow",
                                    labelRenderedSizeThreshold: 8,
                                    labelDensity: 0.5,
                                    labelGridCellSize: 100,
                                    labelFont: "Inter, sans-serif",
                                    zIndex: true,
                                }}
                            >
                                <SigmaInstanceCapture onSigmaReady={setSigmaInstance} />
                                <CameraController />
                                <GraphDragController setIsDragging={setIsDragging} />
                                <GraphSettingsController 
                                    hoveredNode={hoveredNode}
                                    selectedNodeId={selectedElement?.type === 'node' ? selectedElement.id : null}
                                />
                                <GraphEventsController 
                                    setHoveredNode={setHoveredNode}
                                    onNodeClick={handleNodeClick}
                                    isDragging={isDragging}
                                />
                                <OntologyGraphDataController filters={filters} />
                                <ControlsContainer position="bottom-right">
                                    <ZoomControl />
                                    <FullScreenControl />
                                </ControlsContainer>
                                
                        {/* Details Cards - positioned absolutely to appear in fullscreen */}
                        {selectedElement && (
                            <div style={{ 
                                position: 'absolute', 
                                top: 0, 
                                left: 0,
                                height: '100%',
                                zIndex: 1000, 
                                pointerEvents: 'none',
                                display: 'flex',
                                alignItems: 'flex-start',
                                paddingTop: '8px',
                                paddingLeft: '8px'
                            }}>
                                <div style={{ pointerEvents: 'auto', height: '100%', maxHeight: 'calc(100% - 20px)' }}>
                                    {selectedElement && (
                                        <OntologyEntityDetailsCard 
                                            entity={{ id: selectedElement.id, data: selectedElement.data } as any} 
                                            mode="ontology"
                                            onClose={() => setSelectedElement(null)}
                                            graph={graph}
                                            allRelations={graphData.current.relationsById}
                                            heuristicsCache={heuristicsCache.current}
                                            evaluationsCache={evaluationsCache.current}
                                            onEvaluate={handleRelationEvaluate}
                                            onAccept={handleRelationAccept}
                                            onReject={handleRelationReject}
                                            onUndoEvaluation={handleRelationUndoEvaluation}
                                            onSync={handleRelationSync}
                                            isLoading={isRelationActionLoading}
                                            actionResult={relationActionResult}
                                            onClearActionResult={() => setRelationActionResult(null)}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                            </SigmaContainer>
                        </div>
                    )}
                </div>
                
                {/* Stats/Layout Controls and Agent Status Containers */}
                <div className="flex gap-4 mt-4" style={{ flexShrink: 0 }}>
                    {/* Left Container: Action Buttons and Controls */}
                    {graphStats && dataReady && (
                        <div className="flex items-center justify-center text-sm p-3 rounded-lg shadow-sm border w-1/2 bg-white text-gray-500 relative">
                            <div className="flex justify-between items-center w-full">
                                <div className="flex gap-2">
                                    {/* Filters - least scary */}
                                    <button
                                        onClick={() => setShowFilterSettings(!showFilterSettings)}
                                        className="px-2 py-1 text-xs rounded bg-brand-500 hover:bg-brand-600 text-white"
                                        title="Toggle filter settings"
                                        disabled={!!focusedNodeId}
                                    >
                                        Filters
                                    </button>
                                    
                                    {/* Settings */}
                                    <button
                                        onClick={() => setShowLayoutSettings(!showLayoutSettings)}
                                        className="px-2 py-1 text-xs rounded bg-purple-500 hover:bg-purple-600 text-white"
                                        title="Toggle ForceAtlas2 layout settings"
                                    >
                                        Settings
                                    </button>
                                    
                                    {focusedNodeId ? (
                                        <>
                                            {/* Refresh */}
                                            <button
                                                onClick={handleRefreshOntology}
                                                className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                                disabled={isAgentActive || isLoadingAgentStatus}
                                                title={isLoadingAgentStatus ? "Loading agent status..." : isAgentActive ? "Agent is currently active - please wait" : "Refresh ontology data"}>
                                                Refresh
                                            </button>
                                            
                                            {/* Clear Focus */}
                                            <button
                                                onClick={handleClearFocus}
                                                className="px-2 py-1 text-xs rounded bg-orange-500 hover:bg-orange-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                                title="Clear node focus and show all filtered nodes">
                                                Clear Focus
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            {/* Refresh */}
                                            <button
                                                onClick={handleRefreshOntology}
                                                className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                                disabled={isAgentActive || isLoadingAgentStatus}
                                                title={isLoadingAgentStatus ? "Loading agent status..." : isAgentActive ? "Agent is currently active - please wait" : "Refresh ontology data"}>
                                                Refresh
                                            </button>
                                            
                                            {/* Analyse */}
                                            <button
                                                onClick={() => setShowRegenerateConfirm(true)}
                                                className="px-2 py-1 text-xs rounded bg-yellow-500 hover:bg-yellow-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                                disabled={isAgentActive || isLoadingAgentStatus}
                                                title={isLoadingAgentStatus ? "Loading agent status..." : isAgentActive ? "Agent is currently active - please wait" : !dataReady ? "Analyse Ontology" : "Re-analyse the Ontology"}>
                                                {!dataReady ? 'Analyse' : 'Re-analyse'}
                                            </button>
                                            
                                            {/* Delete - most scary */}
                                            <button
                                                onClick={() => setShowDeleteOntologyConfirm(true)}
                                                className="px-2 py-1 text-xs rounded bg-red-500 hover:bg-red-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
                                                disabled={isAgentActive || isLoadingAgentStatus}
                                                title={isLoadingAgentStatus ? "Loading agent status..." : isAgentActive ? "Agent is currently active - please wait" : "Clear all ontology data"}>
                                                Delete
                                            </button>
                                        </>
                                    )}
                                </div>
                                <span 
                                    className="text-xs text-gray-400"
                                    title={`Showing ${visibleStats.nodes}/${graphStats.node_count} nodes with ${visibleStats.edges} relations`}>
                                    {visibleStats.nodes}/{graphStats.node_count} nodes
                                </span>
                            </div>
                            
                            {/* Filter Settings Panel - Absolute positioned to overlay */}
                            {showFilterSettings && (
                                <div className="absolute bottom-full left-0 mb-2 w-96 p-3 bg-white rounded border border-gray-300 shadow-lg z-50 max-h-[600px] overflow-y-auto">
                                    {/* Close button */}
                                    <div className="flex justify-between items-center mb-2 pb-2 border-b sticky top-0 bg-white">
                                        <span className="text-sm font-semibold text-gray-700">Filter Settings</span>
                                        <button
                                            onClick={() => setShowFilterSettings(false)}
                                            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                                            title="Close settings"
                                        >
                                            ×
                                        </button>
                                    </div>
                                    
                                    {/* Entity Types */}
                                    <div className="mb-4">
                                        <h4 className="text-sm font-semibold mb-2 text-gray-800">Entity Types</h4>
                                        <div className="flex gap-2 mb-3">
                                            <button 
                                                onClick={() => setSelectedEntityTypes(new Set(allEntityTypes))} 
                                                className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white"
                                            >
                                                Select All
                                            </button>
                                            <button 
                                                onClick={() => setSelectedEntityTypes(new Set())} 
                                                className="px-2 py-1 text-xs rounded bg-gray-400 hover:bg-gray-500 text-white"
                                            >
                                                Deselect All
                                            </button>
                                        </div>
                                        <div className="space-y-2 max-h-[250px] overflow-y-auto">
                                            {allEntityTypes.map(entityType => (
                                                <div key={entityType} className="flex items-center">
                                                    <input
                                                        type="checkbox"
                                                        id={`filter-checkbox-${entityType}`}
                                                        checked={selectedEntityTypes.has(entityType)}
                                                        onChange={(e) => handleEntityTypeChange(entityType, e.target.checked)}
                                                        className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                    />
                                                    <label htmlFor={`filter-checkbox-${entityType}`} className="text-xs truncate flex-1">
                                                        {entityType}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    
                                    {/* Relation Filters */}
                                    <div className="pt-3 border-t border-gray-200">
                                        <h4 className="text-sm font-semibold mb-2 text-gray-800">Relations</h4>
                                        <div className="space-y-2">
                                            <div className="flex items-center">
                                                <input
                                                    type="radio"
                                                    id="filter-accepted-only"
                                                    name="relation-filter"
                                                    checked={relationFilterMode === 'accepted-only'}
                                                    onChange={() => setRelationFilterMode('accepted-only')}
                                                    className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <label htmlFor="filter-accepted-only" className="flex items-center gap-2 text-xs">
                                                    <div className="w-6 h-0.5 bg-gray-300 rounded"></div>
                                                    <span>Accepted Only</span>
                                                </label>
                                            </div>
                                            <div className="flex items-center">
                                                <input
                                                    type="radio"
                                                    id="filter-all"
                                                    name="relation-filter"
                                                    checked={relationFilterMode === 'all'}
                                                    onChange={() => setRelationFilterMode('all')}
                                                    className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <label htmlFor="filter-all" className="flex items-center gap-2 text-xs">
                                                    <div className="flex gap-1">
                                                        <div className="w-2 h-0.5 bg-gray-300 rounded"></div>
                                                        <div className="w-2 h-0.5 bg-red-300 rounded"></div>
                                                        <div className="w-2 h-0.5 bg-orange-300 rounded"></div>
                                                    </div>
                                                    <span>Show All</span>
                                                </label>
                                            </div>
                                            <div className="flex items-center">
                                                <input
                                                    type="radio"
                                                    id="filter-rejected-uncertain"
                                                    name="relation-filter"
                                                    checked={relationFilterMode === 'rejected-uncertain-only'}
                                                    onChange={() => setRelationFilterMode('rejected-uncertain-only')}
                                                    className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <label htmlFor="filter-rejected-uncertain" className="flex items-center gap-2 text-xs">
                                                    <div className="flex gap-1">
                                                        <div className="w-3 h-0.5 bg-red-300 rounded"></div>
                                                        <div className="w-3 h-0.5 bg-orange-300 rounded"></div>
                                                    </div>
                                                    <span>Rejected & Uncertain Only</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            
                            {/* ForceAtlas2 Settings Panel - Absolute positioned to overlay */}
                            {showLayoutSettings && (
                                <div className="absolute bottom-full left-0 mb-2 w-96 p-3 bg-white rounded border border-gray-300 shadow-lg grid grid-cols-2 gap-3 z-50">
                                    {/* Close button */}
                                    <div className="col-span-2 flex justify-between items-center mb-2 pb-2 border-b">
                                        <span className="text-sm font-semibold text-gray-700">Layout Settings</span>
                                        <button
                                            onClick={() => setShowLayoutSettings(false)}
                                            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                                            title="Close settings"
                                        >
                                            ×
                                        </button>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Iterations: {fa2Iterations}</label>
                                        <input
                                            type="range"
                                            min="50"
                                            max="500"
                                            step="50"
                                            value={fa2Iterations}
                                            onChange={(e) => setFa2Iterations(Number(e.target.value))}
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Gravity: {fa2Gravity}</label>
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="10"
                                            step="0.1"
                                            value={fa2Gravity}
                                            onChange={(e) => setFa2Gravity(Number(e.target.value))}
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Scaling Ratio: {fa2ScalingRatio}</label>
                                        <input
                                            type="range"
                                            min="1"
                                            max="100"
                                            step="1"
                                            value={fa2ScalingRatio}
                                            onChange={(e) => setFa2ScalingRatio(Number(e.target.value))}
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Slow Down: {fa2SlowDown}</label>
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="2"
                                            step="0.1"
                                            value={fa2SlowDown}
                                            onChange={(e) => setFa2SlowDown(Number(e.target.value))}
                                            className="w-full"
                                        />
                                    </div>
                                    
                                    {/* Initial Positioning Controls */}
                                    <div className="col-span-2 pt-3 border-t border-gray-200">
                                        <div className="text-xs font-semibold text-gray-700 mb-2">Initial Positioning</div>
                                        <div>
                                            <label className="block text-xs font-semibold mb-1">Group Radius: {groupRadius}</label>
                                            <input
                                                type="range"
                                                min="200"
                                                max="2000"
                                                step="50"
                                                value={groupRadius}
                                                onChange={(e) => setGroupRadius(Number(e.target.value))}
                                                className="w-full"
                                            />
                                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                <span>Close (200)</span>
                                                <span>Normal (800)</span>
                                                <span>Far (2000)</span>
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <label className="block text-xs font-semibold mb-1">Node Group Radius: {nodeGroupRadius}</label>
                                            <input
                                                type="range"
                                                min="100"
                                                max="1500"
                                                step="50"
                                                value={nodeGroupRadius}
                                                onChange={(e) => setNodeGroupRadius(Number(e.target.value))}
                                                className="w-full"
                                            />
                                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                <span>Tight (100)</span>
                                                <span>Normal (600)</span>
                                                <span>Spread (1500)</span>
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <label className="block text-xs font-semibold mb-1">Min Node Distance: {minNodeDistance}</label>
                                            <input
                                                type="range"
                                                min="0"
                                                max="300"
                                                step="10"
                                                value={minNodeDistance}
                                                onChange={(e) => setMinNodeDistance(Number(e.target.value))}
                                                className="w-full"
                                            />
                                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                <span>None (0)</span>
                                                <span>Normal (100)</span>
                                                <span>Large (300)</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Edge Thickness Control */}
                                    <div className="col-span-2 pt-3 border-t border-gray-200">
                                        <label className="block text-xs font-semibold mb-1">
                                            Edge Thickness: {edgeThicknessMultiplier.toFixed(1)}x
                                        </label>
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="2.0"
                                            step="0.1"
                                            value={edgeThicknessMultiplier}
                                            onChange={(e) => setEdgeThicknessMultiplier(Number(e.target.value))}
                                            className="w-full"
                                        />
                                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                                            <span>Much Thinner (0.1x)</span>
                                            <span>Normal (1.0x)</span>
                                            <span>Thicker (2.0x)</span>
                                        </div>
                                    </div>
                                    
                                    <div className="col-span-2 flex gap-2 justify-end">
                                        <button
                                            onClick={() => {
                                                setFa2Iterations(100);
                                                setFa2Gravity(1.0);
                                                setFa2ScalingRatio(10);
                                                setFa2SlowDown(0.6);
                                                setGroupRadius(500);
                                                setNodeGroupRadius(600);
                                                setMinNodeDistance(100);
                                                setEdgeThicknessMultiplier(1.0);
                                            }}
                                            className="px-3 py-1 text-sm rounded bg-gray-400 hover:bg-gray-500 text-white"
                                        >
                                            Reset to Defaults
                                        </button>
                                        <button
                                            onClick={() => {
                                                buildGraph().then(() => {
                                                    // Refresh and fit the camera view
                                                    if (sigmaInstance) {
                                                        setTimeout(() => {
                                                            const camera = sigmaInstance.getCamera();
                                                            camera.animatedReset({ duration: 600 });
                                                        }, 100);
                                                    }
                                                });
                                            }}
                                            className="px-3 py-1 text-sm rounded bg-purple-500 hover:bg-purple-600 text-white"
                                            title="Re-apply ForceAtlas2 layout with current settings"
                                        >
                                            📐 Apply Layout
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {/* Right Container: Agent Status */}
                    <div className={`flex items-center justify-center text-sm p-3 rounded-lg shadow-sm border w-1/2 ${isLoadingAgentStatus || isAgentActive ? 'bg-blue-500 text-white' : 'bg-white text-gray-500'}`}>
                        {isLoadingAgentStatus ? (
                            <div className="flex items-center gap-3">
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="font-medium">Loading agent status...</span>
                            </div>
                        ) : isRegeneratingOntology ? (
                            <div className="flex items-center gap-3">
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="font-medium">Agent: Requesting...</span>
                            </div>
                        ) : isAgentActive ? (
                            <div className="flex items-center gap-3">
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="font-medium">
                                    {agentStatusMsg || (isAgentProcessing && isAgentEvaluating ? 'Agent: Processing & Evaluating...' :
                                           isAgentProcessing ? 'Agent: Processing...' : 'Agent: Evaluating...')}
                                </span>
                            </div>
                        ) : (
                            <span>Agent: Idle</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Delete Ontology Confirmation Dialog */}
            {showDeleteOntologyConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{ zIndex: 2000 }}>
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Delete Ontology</h3>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to delete the entire ontology? <b>This will permanently delete all relations & clear the ontology graph.</b> This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowDeleteOntologyConfirm(false)}
                                disabled={isDeletingOntology}
                                className="btn bg-gray-500 hover:bg-gray-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed">
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteOntology}
                                disabled={isDeletingOntology}
                                className="btn bg-red-500 hover:bg-red-600 text-white disabled:bg-red-400 disabled:cursor-not-allowed flex items-center gap-2">
                                {isDeletingOntology && (
                                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                )}
                                {isDeletingOntology ? 'Deleting...' : 'Delete Ontology'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Regenerate Ontology Confirmation Dialog */}
            {showRegenerateConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{ zIndex: 2000 }}>
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">
                            {!dataReady ? 'Analyse Ontology' : 'Re-analyse Ontology'}
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {!dataReady 
                                ? 'This will analyse and create relations between entities by analyzing the graph data and inferring relationships. This process may take some time.'
                                : 'This will analyse and re-create relations between entities by analyzing the graph data and inferring relationships. Existing relations will be updated. This process may take some time.'
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
                                {!dataReady ? 'Analyse' : 'Re-analyse'} Ontology
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Property Mappings Modal */}
            {pendingAcceptRelation && (
                <PropertyMappingsModal
                    isOpen={showPropertyMappingsModal}
                    onClose={() => {
                        setShowPropertyMappingsModal(false);
                        setPendingAcceptRelation(null);
                    }}
                    onSubmit={handlePropertyMappingsSubmit}
                    heuristicsData={pendingAcceptRelation.heuristicsData}
                    defaultRelationName={pendingAcceptRelation.relationName}
                    entityAType={pendingAcceptRelation.entityAType}
                    entityBType={pendingAcceptRelation.entityBType}
                />
            )}
        </div>
    );
}


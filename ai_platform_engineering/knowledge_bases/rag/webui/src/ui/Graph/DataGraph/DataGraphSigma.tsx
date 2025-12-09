import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { MultiDirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { exploreDataNeighborhood, getEntityTypes, getDataGraphStats } from '../../../api';
import { SigmaGraph } from '../shared/SigmaGraph';
import EntityDetailsCard from '../shared/EntityDetailsCard';
import DataNodeHoverCard from './DataNodeHoverCard';
import { getColorForNode, getSigmaEdgeStyle } from '../graphStyles';
import { generateNodeId, generateRelationId, extractRelationId, generateEdgeKey } from '../shared/graphUtils';

interface DataGraphSigmaProps {
    exploreEntityData?: { entityType: string; primaryKey: string } | null;
    onExploreComplete?: () => void;
}

interface EntityData {
    entity_type: string;
    primary_key: string;
    all_properties: any;
    [key: string]: any;
}

interface RelationData {
    from_entity: { entity_type: string; primary_key: string };
    to_entity: { entity_type: string; primary_key: string };
    relation_name: string;
    relation_properties: any;
    relation_pk?: string; // Add relation_pk field
}

export default function DataGraphSigma({ exploreEntityData, onExploreComplete }: DataGraphSigmaProps) {
    // Graph instance
    const graph = useMemo(() => new MultiDirectedGraph(), []);
    
    // State management
    const [dataReady, setDataReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedElement, setSelectedElement] = useState<{ type: 'node'; id: string; data: any } | null>(null);
    const [entityTypes, setEntityTypes] = useState<string[]>([]);
    const [exploredEntity, setExploredEntity] = useState<any>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [sigmaInstance, setSigmaInstance] = useState<any>(null);
    const [graphStats, setGraphStats] = useState<{ node_count: number; relation_count: number } | null>(null);
    const [totalGraphStats, setTotalGraphStats] = useState<{ node_count: number; relation_count: number } | null>(null);
    
    // Track all explored/focused nodes
    const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
    
    // Track the initial entity to restore on clear
    const initialEntity = useRef<{ entityType: string; primaryKey: string } | null>(null);
    
    // Filter and settings state
    const [showFilterSettings, setShowFilterSettings] = useState(false);
    const [showLayoutSettings, setShowLayoutSettings] = useState(false);
    const [selectedEntityTypes, setSelectedEntityTypes] = useState<Set<string>>(new Set());
    
    // ForceAtlas2 settings
    const [fa2Iterations, setFa2Iterations] = useState(100);
    const [fa2Gravity, setFa2Gravity] = useState(1.0);
    const [fa2ScalingRatio, setFa2ScalingRatio] = useState(10);
    const [fa2SlowDown, setFa2SlowDown] = useState(0.6);
    
    // Data storage
    const graphData = useRef<{
        entitiesById: Map<string, EntityData>;
        relationsById: Map<string, RelationData>;
        exploredEntities: Set<string>; // Track which entities have been explored
    }>({
        entitiesById: new Map(),
        relationsById: new Map(),
        exploredEntities: new Set()
    });

    // Helper function to check if an entity is a sub-entity
    const isSubEntity = (entity: EntityData): boolean => {
        const additionalLabels = entity.additional_labels || [];
        return additionalLabels.includes('NxsSubEntity');
    };

    // Recursive exploration function that expands sub-entities
    const exploreEntityRecursive = async (
        entityType: string, 
        primaryKey: string, 
        merge: boolean = false,
        centerNodeId: string | null = null,
        depth: number = 0,
        maxDepth: number = 10
    ): Promise<{ centerNodeId: string; relations: RelationData[] }> => {
        if (depth > maxDepth) {
            console.warn(`Max recursion depth ${maxDepth} reached for entity ${entityType}:${primaryKey}`);
            return { centerNodeId: centerNodeId || '', relations: [] };
        }

        const nodeId = generateNodeId(entityType, primaryKey);
        
        // Skip if already explored
        if (graphData.current.exploredEntities.has(nodeId)) {
            console.log(`Entity ${entityType}:${primaryKey} already explored, skipping`);
            return { centerNodeId: centerNodeId || nodeId, relations: [] };
        }

        console.log(`Exploring entity (depth ${depth}): ${entityType}:${primaryKey}`);
        
        try {
            // Call the neighborhood exploration API with depth 1
            const response = await exploreDataNeighborhood(entityType, primaryKey, 1);
            const { entity, entities, relations } = response;
            
            if (!entity) {
                console.warn('No entity found');
                return { centerNodeId: centerNodeId || '', relations: [] };
            }

            // Mark this entity as explored
            graphData.current.exploredEntities.add(nodeId);

            // Get the center entity details
            const centerEntityPk = entity.all_properties?._entity_pk || primaryKey;
            const centerEntityType = entity.entity_type || entityType;
            const actualCenterNodeId = generateNodeId(centerEntityType, centerEntityPk);
            
            // Use the first entity as the center if not provided
            const finalCenterNodeId = centerNodeId || actualCenterNodeId;

            // Store all entities
            const allRelations: RelationData[] = [];
            const subEntitiesToExplore: Array<{ entityType: string; primaryKey: string }> = [];
            
            if (entities && Array.isArray(entities)) {
                for (const ent of entities) {
                    const pk = ent.all_properties?._entity_pk || ent.primary_key;
                    const entType = ent.entity_type || 'Entity';
                    const entNodeId = generateNodeId(entType, pk);
                    
                    if (pk) {
                        const entityData: EntityData = {
                            primary_key: pk,
                            entity_type: entType,
                            all_properties: ent.all_properties || ent,
                            additional_labels: ent.additional_labels || [],
                            ...ent
                        };
                        graphData.current.entitiesById.set(entNodeId, entityData);
                        
                        // Check if this is a sub-entity that needs further exploration
                        if (isSubEntity(entityData) && !graphData.current.exploredEntities.has(entNodeId)) {
                            subEntitiesToExplore.push({ entityType: entType, primaryKey: pk });
                        }
                    }
                }
            }

            // Process relations
            if (relations && Array.isArray(relations) && relations.length > 0) {
                relations.forEach((relation: any) => {
                    const fromPk = relation.from_entity?.primary_key;
                    const toPk = relation.to_entity?.primary_key;
                    const fromType = relation.from_entity?.entity_type;
                    const toType = relation.to_entity?.entity_type;
                    
                    if (fromPk && toPk && fromType && toType) {
                        const relationData: RelationData = {
                            from_entity: { 
                                entity_type: fromType, 
                                primary_key: fromPk 
                            },
                            to_entity: { 
                                entity_type: toType, 
                                primary_key: toPk 
                            },
                            relation_name: relation.relation_name || 'related_to',
                            relation_properties: relation.relation_properties || {},
                            relation_pk: relation.relation_pk || relation.relation_properties?._relation_pk // Copy relation_pk
                        };
                        allRelations.push(relationData);
                    }
                });
            }

            console.log(`Found ${subEntitiesToExplore.length} sub-entities to explore from ${entityType}:${primaryKey}`);

            // Recursively explore sub-entities
            for (const subEntity of subEntitiesToExplore) {
                const result = await exploreEntityRecursive(
                    subEntity.entityType,
                    subEntity.primaryKey,
                    true, // Always merge for recursive calls
                    finalCenterNodeId,
                    depth + 1,
                    maxDepth
                );
                allRelations.push(...result.relations);
            }

            return { centerNodeId: finalCenterNodeId, relations: allRelations };
            
        } catch (err) {
            console.error(`Failed to explore entity ${entityType}:${primaryKey}:`, err);
            return { centerNodeId: centerNodeId || '', relations: [] };
        }
    };

    // Main exploration function that uses recursive exploration
    const exploreEntity = async (entityType: string, primaryKey: string, depth: number = 1, merge: boolean = false) => {
        if (!entityType || !primaryKey) {
            console.error('Missing entityType or primaryKey:', { entityType, primaryKey });
            return;
        }
        
        console.log('Starting exploration:', { entityType, primaryKey, merge });
        
        setIsLoading(true);
        
        try {
            // Clear existing graph data if not merging
            if (!merge) {
                graphData.current = { 
                    entitiesById: new Map(), 
                    relationsById: new Map(),
                    exploredEntities: new Set()
                };
                graph.clear();
            }

            // Start recursive exploration
            const result = await exploreEntityRecursive(entityType, primaryKey, merge);
            
            if (!result.centerNodeId) {
                console.warn('No entity found');
                setIsLoading(false);
                return;
            }

            // Get the center entity
            const centerEntity = graphData.current.entitiesById.get(result.centerNodeId);
            
            if (!centerEntity) {
                console.warn('Center entity not found in entities map');
                setIsLoading(false);
                return;
            }

            // Build the graph
            await buildGraph(result.centerNodeId, result.relations, merge);
            setExploredEntity(centerEntity);
            setDataReady(true);
            
            // Store the initial entity if this is the first exploration
            if (!initialEntity.current) {
                initialEntity.current = { entityType, primaryKey };
            }
            
            // Add the center entity to highlighted nodes
            setHighlightedNodes(prev => new Set([...prev, result.centerNodeId]));
            
            // Update stats
            setGraphStats({
                node_count: graphData.current.entitiesById.size,
                relation_count: result.relations.length
            });

            console.log(`Exploration complete: ${graphData.current.entitiesById.size} entities, ${result.relations.length} relations, ${graphData.current.exploredEntities.size} entities explored`);

        } catch (err) {
            console.error('Failed to explore entity:', err);
            console.error('Details:', { entityType, primaryKey, merge });
            alert(`Failed to explore entity: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        
        setIsLoading(false);
    };
    
    // Focus on a single entity (clear and explore)
    const focusEntity = async (entityType: string, primaryKey: string) => {
        await exploreEntity(entityType, primaryKey, 1, false);
    };

    // Build graph from stored data
    const buildGraph = async (centerNodeId: string, relations: RelationData[], merge: boolean = false) => {
        // Only clear graph if not merging
        if (!merge) {
            graph.clear();
        }
        
        const nodeDegrees = new Map<string, number>();
        const graphEntityTypes = new Set<string>(); // Collect entity types from the graph
        
        // Add all entities as nodes
        graphData.current.entitiesById.forEach((entity, nodeId) => {
            // Skip if node already exists (when merging) - preserve its position
            if (graph.hasNode(nodeId)) {
                return;
            }
            
            const entityType = entity.entity_type || 'Entity';
            graphEntityTypes.add(entityType); // Track entity types in the graph
            const color = getColorForNode(entityType);
            
            // Random initial position
            const angle = Math.random() * 2 * Math.PI;
            const radius = Math.random() * 300;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            
            // Make the center node bigger (25px vs 15px for others)
            const isCenterNode = nodeId === centerNodeId;
            const nodeSize = isCenterNode ? 25 : 15;
            
            graph.addNode(nodeId, {
                label: entityType,
                size: nodeSize,
                color: color,
                entityType: entityType,
                entityData: entity,
                x: x,
                y: y,
                highlighted: isCenterNode, // Mark as highlighted
                hidden: false, // Initialize hidden attribute
            });
            
            nodeDegrees.set(nodeId, 0);
        });
        
        // Update entity types list from the graph (not from system-wide API)
        const entityTypesArray = Array.from(graphEntityTypes).sort();
        setEntityTypes(entityTypesArray);
        // Only update selected entity types if they haven't been set yet or if this is a new graph
        if (selectedEntityTypes.size === 0 || !merge) {
            setSelectedEntityTypes(new Set(entityTypesArray));
        }
        
        // Group relations by node pairs to detect bidirectional relations
        interface RelationGroup {
            forward: Array<{ relationId: string; relation: RelationData }>;
            backward: Array<{ relationId: string; relation: RelationData }>;
        }
        
        const relationGroups = new Map<string, RelationGroup>();
        
        relations.forEach((relation, index) => {
            const sourceNodeId = generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key);
            const targetNodeId = generateNodeId(relation.to_entity.entity_type, relation.to_entity.primary_key);
            
            if (!graph.hasNode(sourceNodeId) || !graph.hasNode(targetNodeId)) return;
            
            // Generate a consistent relation ID using the common utility
            const extractedPk = extractRelationId(relation);
            const relationId = generateRelationId(
                relation.from_entity.primary_key,
                relation.to_entity.primary_key,
                relation.relation_name,
                extractedPk
            );
            
            // Store relation in centralized map
            graphData.current.relationsById.set(relationId, relation);
            
            // Create a normalized key (always smaller node id first)
            const normalizedKey = sourceNodeId < targetNodeId ? `${sourceNodeId}<->${targetNodeId}` : `${targetNodeId}<->${sourceNodeId}`;
            
            if (!relationGroups.has(normalizedKey)) {
                relationGroups.set(normalizedKey, { forward: [], backward: [] });
            }
            
            const group = relationGroups.get(normalizedKey)!;
            
            // Determine if this is forward or backward relative to the normalized key
            if ((sourceNodeId < targetNodeId && sourceNodeId === generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key)) ||
                (sourceNodeId > targetNodeId && targetNodeId === generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key))) {
                group.forward.push({ relationId, relation });
            } else {
                group.backward.push({ relationId, relation });
            }
        });
        
        // Add edges with bidirectional detection
        const edgesToAdd: Array<{ key: string; source: string; target: string; attributes: any }> = [];
        
        relationGroups.forEach((group, normalizedKey) => {
            const hasBidirectional = group.forward.length > 0 && group.backward.length > 0;
            
            // Collect all relations (both directions)
            const allRelations = [...group.forward, ...group.backward];
            
            // Find the relation with the highest weight for primary display data
            let primaryRelation = allRelations[0];
            let maxWeight = 0;
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
            
            // Generate edge key from sorted relation IDs (no status in data graph)
            const edgeKey = generateEdgeKey(sourceNodeId, targetNodeId, relationIds, 'DATA');
            
            // Use simple gray color and consistent size
            const edgeColor = '#d1d5db'; // light gray - same as ontology graph
            const edgeSize = 2; // base size
            
            // Create label with bidirectional indicator and multiple relations indicator
            let label: string;
            let edgeType = "arrow"; // Default to arrow for directed edges
            
            if (hasBidirectional) {
                edgeType = "line"; // Use undirected line (no arrow) for bidirectional edges
            }
            
            // Count unique relations by relation_pk to avoid counting bidirectional as 2
            const uniqueRelationPks = new Set<string>();
            allRelations.forEach(({ relation }) => {
                const relationPk = extractRelationId(relation);
                if (relationPk) {
                    uniqueRelationPks.add(relationPk);
                }
            });
            
            // If we have relation_pks, use that count, otherwise fall back to allRelations length
            const uniqueCount = uniqueRelationPks.size > 0 ? uniqueRelationPks.size : allRelations.length;
            
            if (uniqueCount > 1) {
                // Multiple unique relations - show count
                if (hasBidirectional) {
                    label = `⟷  ... ×${uniqueCount}`; // Bidirectional with multiple
                } else {
                    label = `... ×${uniqueCount}`; // Multiple relations
                }
            } else {
                // Single unique relation - show its name
                label = relation.relation_name;
                if (hasBidirectional) {
                    label = `⟷  ${label}`; // Add bidirectional symbol
                }
            }
            
            edgesToAdd.push({
                key: edgeKey,
                source: sourceNodeId,
                target: targetNodeId,
                attributes: {
                    label: label,
                    type: edgeType, // "line" for bidirectional, "arrow" for directed
                    size: edgeSize,
                    color: edgeColor,
                    originalColor: edgeColor,
                    originalSize: edgeSize,
                    relationIds: relationIds, // Store array of relation IDs
                    totalWeight: totalWeight, // Sum of all weights
                    isBidirectional: hasBidirectional,
                    relationCount: uniqueCount, // Unique relation count
                    hidden: false,
                }
            });
        });
        
        // Add all edges
        edgesToAdd.forEach(({ key, source, target, attributes }) => {
            // Skip if edge already exists (when merging)
            if (graph.hasEdge(key)) return;
            
            try {
                graph.addEdgeWithKey(key, source, target, attributes);
            } catch (error) {
                console.error(`Failed to add edge ${key}:`, error);
            }
        });
        
        // Log bidirectional edge statistics
        const bidirectionalCount = edgesToAdd.filter(e => e.attributes.isBidirectional).length;
        const totalEdgeCount = edgesToAdd.length;
        console.log(`Graph built: ${graph.order} nodes, ${graph.size} edges (${bidirectionalCount} bidirectional)`);
        
        // Normalize node sizes based on degree (8-25px range, preserve center node size)
        // When merging, recalculate degrees for ALL nodes in the graph
        if (merge) {
            // Recalculate degrees for all nodes in the graph
            graph.forEachNode((nodeId) => {
                nodeDegrees.set(nodeId, graph.degree(nodeId));
            });
        }
        
        const degrees = Array.from(nodeDegrees.values());
        const minDegree = Math.min(...degrees, 0);
        const maxDegree = Math.max(...degrees, 1);
        const degreeRange = maxDegree - minDegree || 1;
        
        nodeDegrees.forEach((degree, nodeId) => {
            // Skip if node doesn't exist (safety check)
            if (!graph.hasNode(nodeId)) return;
            
            // Only highlight the current center entity being explored/focused
            const isHighlighted = nodeId === centerNodeId;
            
            if (isHighlighted) {
                // Keep highlighted nodes at larger size with highlighted flag
                graph.setNodeAttribute(nodeId, 'size', 25);
                graph.setNodeAttribute(nodeId, 'highlighted', true);
                return;
            }
            
            const normalized = (degree - minDegree) / degreeRange;
            const nodeSize = 8 + (normalized * 17); // Range: 8-25px (same as ontology graph)
            graph.setNodeAttribute(nodeId, 'size', nodeSize);
            graph.setNodeAttribute(nodeId, 'highlighted', false);
        });
        
        // Apply ForceAtlas2 layout
        console.log('Applying ForceAtlas2 layout...');
        
        // When merging, save positions of existing nodes that we want to preserve
        const savedPositions = new Map<string, {x: number, y: number}>();
        if (merge) {
            graph.forEachNode((nodeId) => {
                // Save position of the center entity being explored
                if (nodeId === centerNodeId) {
                    savedPositions.set(nodeId, {
                        x: graph.getNodeAttribute(nodeId, 'x'),
                        y: graph.getNodeAttribute(nodeId, 'y')
                    });
                }
            });
        }
        
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
        
        // Restore saved positions after layout
        if (merge) {
            savedPositions.forEach((pos, nodeId) => {
                if (graph.hasNode(nodeId)) {
                    graph.setNodeAttribute(nodeId, 'x', pos.x);
                    graph.setNodeAttribute(nodeId, 'y', pos.y);
                }
            });
        }
        
        console.log(`Exploration complete: ${graphData.current.entitiesById.size} entities, ${relations.length} relations, ${graphData.current.exploredEntities.size} entities explored`);
        console.log(`Graph rendered: ${graph.order} nodes, ${graph.size} edges (${bidirectionalCount} bidirectional). Degree range: ${minDegree}-${maxDegree}`);
    };

    // Node click handler
    const handleNodeClick = useCallback((nodeId: string, nodeData: any) => {
        console.log('Node clicked:', nodeId);
        setSelectedElement({ type: 'node', id: nodeId, data: nodeData });
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
    
    // Keyboard shortcuts for explore (E) and focus (F) on hovered node
    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            // Don't trigger if user is typing in an input field
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }
            
            if (!hoveredNode) return;
            
            // Get node data from graph
            const nodeData = graph.getNodeAttributes(hoveredNode);
            if (!nodeData) return;
            
            const entityType = nodeData.entityType || nodeData.entityData?.entity_type;
            const primaryKey = nodeData.entityData?.primary_key || nodeData.entityData?.all_properties?._entity_pk;
            
            if (!entityType || !primaryKey) return;
            
            if (event.key === 'e' || event.key === 'E') {
                console.log('Keyboard shortcut: Exploring node', entityType, primaryKey);
                exploreEntity(entityType, primaryKey, 1, true); // merge = true for explore
                event.preventDefault();
            } else if (event.key === 'f' || event.key === 'F') {
                console.log('Keyboard shortcut: Focusing on node', entityType, primaryKey);
                focusEntity(entityType, primaryKey); // focus clears and explores
                event.preventDefault();
            }
        };
        
        window.addEventListener('keydown', handleKeyPress);
        return () => {
            window.removeEventListener('keydown', handleKeyPress);
        };
    }, [hoveredNode, graph]);

    const handleClearExploration = async () => {
        // Reset by re-exploring the initial entity from scratch
        if (initialEntity.current) {
            // Clear everything first
            graph.clear();
            graphData.current = { 
                entitiesById: new Map(), 
                relationsById: new Map(),
                exploredEntities: new Set()
            };
            setSelectedElement(null);
            
            // Reset highlighted nodes first
            setHighlightedNodes(new Set());
            
            // Small delay to ensure state is updated
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Re-explore the initial entity
            await exploreEntity(initialEntity.current.entityType, initialEntity.current.primaryKey, 1, false);
        } else {
            // If no initial entity, just clear everything
            setExploredEntity(null);
            setDataReady(false);
            graph.clear();
            graphData.current = { 
                entitiesById: new Map(), 
                relationsById: new Map(),
                exploredEntities: new Set()
            };
            setSelectedElement(null);
            setHighlightedNodes(new Set());
        }
    };
    
    const handleRefreshData = () => {
        fetchTotalGraphStats();
    };

    const fetchTotalGraphStats = useCallback(async () => {
        try {
            const stats = await getDataGraphStats();
            setTotalGraphStats(stats);
        } catch (err) {
            console.error('Failed to fetch total graph stats:', err);
        }
    }, []);

    // Load total graph stats on mount
    useEffect(() => {
        fetchTotalGraphStats();
    }, [fetchTotalGraphStats]);
    
    // Update selected entity types when entity types change
    useEffect(() => {
        if (entityTypes.length > 0 && selectedEntityTypes.size === 0) {
            setSelectedEntityTypes(new Set(entityTypes));
        }
    }, [entityTypes]);
    
    // Apply entity type filters to the graph
    useEffect(() => {
        if (!dataReady) return;
        
        // Filter nodes by entity type
        graph.forEachNode((nodeId, attributes) => {
            const entityType = attributes.entityType || '';
            const shouldHide = !selectedEntityTypes.has(entityType);
            graph.setNodeAttribute(nodeId, 'hidden', shouldHide);
        });
        
        // Filter edges - hide if either source or target is hidden
        graph.forEachEdge((edgeId, attributes) => {
            const source = graph.source(edgeId);
            const target = graph.target(edgeId);
            const sourceHidden = graph.getNodeAttribute(source, 'hidden');
            const targetHidden = graph.getNodeAttribute(target, 'hidden');
            graph.setEdgeAttribute(edgeId, 'hidden', sourceHidden || targetHidden);
        });
    }, [selectedEntityTypes, dataReady, graph]);

    // Handle entity exploration from SearchView
    useEffect(() => {
        if (exploreEntityData) {
            exploreEntity(exploreEntityData.entityType, exploreEntityData.primaryKey, 1, false);
            onExploreComplete?.();
        }
    }, [exploreEntityData, onExploreComplete]);

    // Details card component
    const detailsCard = selectedElement ? (
        <EntityDetailsCard 
            entity={{ id: selectedElement.id, data: selectedElement.data } as any}
            mode="data"
            onClose={() => setSelectedElement(null)}
            allRelations={graphData.current.relationsById}
            onExplore={(entityType, primaryKey, depth) => exploreEntity(entityType, primaryKey, depth || 1, true)}
            onFocus={focusEntity}
            isCurrentlyExplored={exploredEntity && selectedElement.data.primary_key === exploredEntity.primary_key && selectedElement.data.entity_type === exploredEntity.entity_type}
        />
    ) : null;
    
    // Calculate visible stats
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
    }, [graph, selectedEntityTypes, dataReady]);

    // Empty state component
    const emptyState = (
        <div style={{ flex: 1, width: '100%', padding: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="text-center space-y-4 max-w-md">
                <div className="text-6xl text-blue-500 mb-4">📊</div>
                <h3 className="text-2xl font-bold text-gray-800">Data Exploration</h3>
                <p className="text-gray-600">
                    Search for entities in the 🔍 Search tab; <br/> or select an entity type and enter a primary key below to explore data relationships.
                </p>
            </div>
        </div>
    );

    return (
        <div style={{ width: '100%', height: '100%', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', minHeight: 0 }}>
                {/* Small exploration indicator */}
                {exploredEntity && (
                    <div style={{ flexShrink: 0, marginBottom: '8px', padding: '4px 0' }}>
                        <p className="text-sm">
                            <strong className="text-gray-700">🎯 Focusing:</strong>{' '}
                            <span 
                                className="font-semibold px-1.5 py-0.5 rounded"
                                style={{ 
                                    backgroundColor: `${getColorForNode(exploredEntity.entity_type)}20`,
                                    color: getColorForNode(exploredEntity.entity_type),
                                    filter: 'brightness(0.6)' // Darken the color
                                }}
                            >
                                {exploredEntity.entity_type}
                            </span>
                            {' → '}
                            <code className="bg-gray-200 text-gray-800 px-1.5 py-0.5 rounded font-mono text-xs">
                                {exploredEntity.primary_key}
                            </code>
                        </p>
                    </div>
                )}
                
                {/* Graph Container */}
                <div style={{ flex: 1, borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', backgroundColor: 'white', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    {/* Hover Info Panel - Top Left */}
                    {hoveredNode && <DataNodeHoverCard hoveredNode={hoveredNode} graph={graph} />}
                    
                    {/* Keyboard Shortcut Tip - Top Right */}
                    {exploredEntity && (
                        <div style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            zIndex: 999,
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            padding: '8px 12px',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                            pointerEvents: 'none'
                        }}>
                            <p className="text-xs text-gray-600">
                                💡 Hover: <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">E</kbd> explore · <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">F</kbd> focus
                            </p>
                        </div>
                    )}
                    
                    <div className="flex-1 min-h-0 w-full">
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
                            onSigmaReady={setSigmaInstance}
                            filters={{}}
                            detailsCardComponent={detailsCard}
                            emptyStateComponent={emptyState}
                        />
                    </div>
                </div>
                
                {/* Bottom panels - similar to OntologyGraph */}
                <div className="flex gap-4 mt-4" style={{ flexShrink: 0 }}>
                    {/* Left Panel: Controls */}
                    {graphStats && dataReady && (
                        <div className="flex items-center justify-center text-sm p-3 rounded-lg shadow-sm border w-1/2 bg-white text-gray-500 relative">
                            <div className="flex justify-between items-center w-full">
                                <div className="flex gap-2">
                                    {/* Filters */}
                                    <button
                                        onClick={() => setShowFilterSettings(!showFilterSettings)}
                                        className="px-2 py-1 text-xs rounded bg-brand-500 hover:bg-brand-600 text-white"
                                        title="Toggle filter settings"
                                    >
                                        Filters
                                    </button>
                                    
                                    {/* Settings */}
                                    <button
                                        onClick={() => setShowLayoutSettings(!showLayoutSettings)}
                                        className="px-2 py-1 text-xs rounded bg-purple-500 hover:bg-purple-600 text-white"
                                        title="Toggle layout settings"
                                    >
                                        Settings
                                    </button>
                                    
                                    {/* Reset */}
                                    {exploredEntity && (
                                        <button
                                            onClick={handleClearExploration}
                                            className="px-2 py-1 text-xs rounded bg-orange-500 hover:bg-orange-600 text-white"
                                            title="Reset to initial entity">
                                            Reset
                                        </button>
                                    )}
                                    
                                    {/* Refresh */}
                                    <button
                                        onClick={handleRefreshData}
                                        className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white"
                                        title="Refresh data">
                                        Refresh
                                    </button>
                                </div>
                                <span 
                                    className="text-xs text-gray-400"
                                    title={`Showing ${visibleStats.nodes}/${graphStats.node_count} nodes with ${visibleStats.edges} relations`}>
                                    {visibleStats.nodes}/{graphStats.node_count} nodes
                                </span>
                            </div>
                            
                            {/* Filter Settings Panel */}
                            {showFilterSettings && (
                                <div className="absolute bottom-full left-0 mb-2 w-96 p-3 bg-white rounded border border-gray-300 shadow-lg z-50 max-h-[600px] overflow-y-auto">
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
                                                onClick={() => setSelectedEntityTypes(new Set(entityTypes))} 
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
                                            {entityTypes.map(entityType => (
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
                                </div>
                            )}
                            
                            {/* Layout Settings Panel */}
                            {showLayoutSettings && (
                                <div className="absolute bottom-full left-0 mb-2 w-96 p-3 bg-white rounded border border-gray-300 shadow-lg grid grid-cols-2 gap-3 z-50">
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
                                    
                                    <div className="col-span-2 flex gap-2 justify-end">
                                        <button
                                            onClick={() => {
                                                setFa2Iterations(100);
                                                setFa2Gravity(1.0);
                                                setFa2ScalingRatio(10);
                                                setFa2SlowDown(0.6);
                                            }}
                                            className="px-3 py-1 text-sm rounded bg-gray-400 hover:bg-gray-500 text-white"
                                        >
                                            Reset to Defaults
                                        </button>
                                        <button
                                            onClick={() => {
                                                // Re-apply layout with current settings
                                                if (exploredEntity && initialEntity.current) {
                                                    handleClearExploration();
                                                }
                                            }}
                                            className="px-3 py-1 text-sm rounded bg-purple-500 hover:bg-purple-600 text-white"
                                            title="Re-apply layout with current settings"
                                        >
                                            📐 Apply Layout
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {/* Right Panel: Stats */}
                    <div className="flex items-center justify-center text-sm p-3 rounded-lg shadow-sm border w-1/2 bg-white text-gray-500">
                        {graphStats && totalGraphStats ? (
                            <span className="text-xs">
                                {graphStats.node_count}/{totalGraphStats.node_count} nodes, {graphStats.relation_count} relations
                            </span>
                        ) : graphStats ? (
                            <span className="text-xs">
                                {graphStats.node_count} nodes, {graphStats.relation_count} relations
                            </span>
                        ) : (
                            <span className="text-xs text-gray-400">No data</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}


"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MultiDirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Loader2, RefreshCw } from 'lucide-react';
import { exploreEntityNeighborhood, getEntityTypes, getDataGraphStats } from '../../api';
import { SigmaGraph } from '../shared/SigmaGraph';
import DataNodeHoverCard from './DataNodeHoverCard';
import { getColorForNode } from '../shared/graphStyles';
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
    relation_pk?: string;
}

export default function DataGraphSigma({ exploreEntityData, onExploreComplete }: DataGraphSigmaProps) {
    // Graph instance
    const graph = useMemo(() => new MultiDirectedGraph(), []);

    // State management
    const [dataReady, setDataReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedElement, setSelectedElement] = useState<{ type: 'node'; id: string; data: any } | null>(null);
    const [exploredEntity, setExploredEntity] = useState<any>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [sigmaInstance, setSigmaInstance] = useState<any>(null);
    const [graphStats, setGraphStats] = useState<{ node_count: number; relation_count: number } | null>(null);

    // Data storage
    const graphData = useRef<{
        entitiesById: Map<string, EntityData>;
        relationsById: Map<string, RelationData>;
    }>({
        entitiesById: new Map(),
        relationsById: new Map()
    });

    // Initial entity to restore on clear
    const initialEntity = useRef<{ entityType: string; primaryKey: string } | null>(null);

    // Main exploration function
    const exploreEntity = async (entityType: string, primaryKey: string, merge: boolean = false) => {
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
                    relationsById: new Map()
                };
                graph.clear();
            }

            // Call the neighborhood exploration API
            const response = await exploreEntityNeighborhood(entityType, primaryKey, 1);
            const { entity, entities, relations } = response;

            if (!entity) {
                console.warn('No entity found');
                setIsLoading(false);
                return;
            }

            const centerEntityPk = entity.all_properties?._entity_pk || primaryKey;
            const centerEntityType = entity.entity_type || entityType;
            const centerNodeId = generateNodeId(centerEntityType, centerEntityPk);

            // Store all entities
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
                            ...ent
                        };
                        graphData.current.entitiesById.set(entNodeId, entityData);
                    }
                }
            }

            // Build the graph
            await buildGraph(centerNodeId, relations || []);
            setExploredEntity(entity);
            setDataReady(true);

            // Store the initial entity if this is the first exploration
            if (!initialEntity.current) {
                initialEntity.current = { entityType, primaryKey };
            }

            // Update stats
            setGraphStats({
                node_count: graphData.current.entitiesById.size,
                relation_count: (relations || []).length
            });

        } catch (err) {
            console.error('Failed to explore entity:', err);
        }

        setIsLoading(false);
    };

    // Build graph from stored data
    const buildGraph = async (centerNodeId: string, relations: RelationData[]) => {
        const nodeDegrees = new Map<string, number>();

        // Add all entities as nodes
        graphData.current.entitiesById.forEach((entity, nodeId) => {
            if (graph.hasNode(nodeId)) return;

            const entityType = entity.entity_type || 'Entity';
            const color = getColorForNode(entityType);

            const angle = Math.random() * 2 * Math.PI;
            const radius = Math.random() * 300;

            const isCenterNode = nodeId === centerNodeId;
            const nodeSize = isCenterNode ? 25 : 15;

            graph.addNode(nodeId, {
                label: entityType,
                size: nodeSize,
                color: color,
                entityType: entityType,
                entityData: entity,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                highlighted: isCenterNode,
                hidden: false,
            });

            nodeDegrees.set(nodeId, 0);
        });

        // Group relations
        const relationGroups = new Map<string, any[]>();

        relations.forEach((relation) => {
            const sourceNodeId = generateNodeId(relation.from_entity.entity_type, relation.from_entity.primary_key);
            const targetNodeId = generateNodeId(relation.to_entity.entity_type, relation.to_entity.primary_key);

            if (!graph.hasNode(sourceNodeId) || !graph.hasNode(targetNodeId)) return;

            const normalizedKey = sourceNodeId < targetNodeId
                ? `${sourceNodeId}<->${targetNodeId}`
                : `${targetNodeId}<->${sourceNodeId}`;

            if (!relationGroups.has(normalizedKey)) {
                relationGroups.set(normalizedKey, []);
            }
            relationGroups.get(normalizedKey)!.push(relation);
        });

        // Add edges
        relationGroups.forEach((groupRelations, normalizedKey) => {
            const primaryRelation = groupRelations[0];
            const sourceNodeId = generateNodeId(
                primaryRelation.from_entity.entity_type,
                primaryRelation.from_entity.primary_key
            );
            const targetNodeId = generateNodeId(
                primaryRelation.to_entity.entity_type,
                primaryRelation.to_entity.primary_key
            );

            const hasBidirectional = groupRelations.some((r: any) =>
                r.from_entity.primary_key === primaryRelation.to_entity.primary_key
            );

            const relationIds = groupRelations.map((r: any) => extractRelationId(r) || '');
            const edgeKey = generateEdgeKey(sourceNodeId, targetNodeId, relationIds, 'DATA');

            const edgeColor = '#d1d5db';
            const label = groupRelations.length === 1
                ? primaryRelation.relation_name
                : `${hasBidirectional ? '⟷  ' : ''}... ×${groupRelations.length}`;

            if (!graph.hasEdge(edgeKey)) {
                try {
                    graph.addEdgeWithKey(edgeKey, sourceNodeId, targetNodeId, {
                        label: label,
                        type: hasBidirectional ? "line" : "arrow",
                        size: 2,
                        color: edgeColor,
                        originalColor: edgeColor,
                        originalSize: 2,
                        relationCount: groupRelations.length,
                        isBidirectional: hasBidirectional,
                        hidden: false,
                    });

                    nodeDegrees.set(sourceNodeId, (nodeDegrees.get(sourceNodeId) || 0) + 1);
                    nodeDegrees.set(targetNodeId, (nodeDegrees.get(targetNodeId) || 0) + 1);
                } catch (error) {
                    console.error('Failed to add edge:', error);
                }
            }
        });

        // Normalize node sizes
        const degrees = Array.from(nodeDegrees.values());
        const minDegree = Math.min(...degrees, 0);
        const maxDegree = Math.max(...degrees, 1);
        const degreeRange = maxDegree - minDegree || 1;

        nodeDegrees.forEach((degree, nodeId) => {
            if (!graph.hasNode(nodeId)) return;

            const isHighlighted = nodeId === centerNodeId;
            if (isHighlighted) {
                graph.setNodeAttribute(nodeId, 'size', 25);
                graph.setNodeAttribute(nodeId, 'highlighted', true);
                return;
            }

            const normalized = (degree - minDegree) / degreeRange;
            const nodeSize = 8 + (normalized * 17);
            graph.setNodeAttribute(nodeId, 'size', nodeSize);
        });

        // Apply ForceAtlas2 layout
        forceAtlas2.assign(graph, {
            iterations: 100,
            settings: {
                gravity: 1.0,
                scalingRatio: 10,
                slowDown: 0.6,
                barnesHutOptimize: true,
            }
        });

        console.log(`Graph built: ${graph.order} nodes, ${graph.size} edges`);
    };

    // Node click handler
    const handleNodeClick = useCallback((nodeId: string, nodeData: any) => {
        console.log('Node clicked:', nodeId);
        setSelectedElement({ type: 'node', id: nodeId, data: nodeData });
    }, []);

    const handleClearExploration = async () => {
        if (initialEntity.current) {
            graph.clear();
            graphData.current = { entitiesById: new Map(), relationsById: new Map() };
            setSelectedElement(null);
            await exploreEntity(initialEntity.current.entityType, initialEntity.current.primaryKey, false);
        } else {
            setExploredEntity(null);
            setDataReady(false);
            graph.clear();
            graphData.current = { entitiesById: new Map(), relationsById: new Map() };
            setSelectedElement(null);
        }
    };

    // Handle entity exploration from SearchView
    useEffect(() => {
        if (exploreEntityData) {
            exploreEntity(exploreEntityData.entityType, exploreEntityData.primaryKey, false);
            onExploreComplete?.();
        }
    }, [exploreEntityData, onExploreComplete]);

    // Empty state component
    const emptyState = (
        <div className="flex-1 w-full p-8 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
                <div className="text-6xl text-blue-500 mb-4">📊</div>
                <h3 className="text-2xl font-bold text-foreground">Data Exploration</h3>
                <p className="text-muted-foreground">
                    Search for entities in the Search tab, then click "Explore" to visualize their relationships.
                </p>
            </div>
        </div>
    );

    return (
        <div className="w-full h-full bg-background flex flex-col">
            <div className="flex-1 flex flex-col p-4 min-h-0">
                {/* Small exploration indicator */}
                {exploredEntity && (
                    <div className="flex-shrink-0 mb-2 p-1">
                        <p className="text-sm">
                            <strong className="text-foreground">🎯 Exploring:</strong>{' '}
                            <span
                                className="font-semibold px-1.5 py-0.5 rounded"
                                style={{
                                    backgroundColor: `${getColorForNode(exploredEntity.entity_type)}20`,
                                    color: getColorForNode(exploredEntity.entity_type),
                                }}
                            >
                                {exploredEntity.entity_type}
                            </span>
                            {' → '}
                            <code className="bg-muted text-foreground px-1.5 py-0.5 rounded font-mono text-xs">
                                {exploredEntity.primary_key || exploredEntity.all_properties?._entity_pk}
                            </code>
                        </p>
                    </div>
                )}

                {/* Graph Container */}
                <div className="flex-1 rounded-lg shadow-sm bg-card min-h-0 flex flex-col relative border border-border overflow-hidden">
                    {/* Hover Card */}
                    {hoveredNode && <DataNodeHoverCard hoveredNode={hoveredNode} graph={graph} />}

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
                            emptyStateComponent={emptyState}
                        />
                    </div>
                </div>

                {/* Bottom Controls */}
                {graphStats && dataReady && (
                    <div className="flex gap-4 mt-4 flex-shrink-0">
                        <div className="flex items-center justify-between text-sm p-3 rounded-lg shadow-sm border bg-card text-muted-foreground flex-1">
                            <div className="flex gap-2">
                                {exploredEntity && (
                                    <button
                                        onClick={handleClearExploration}
                                        className="px-2 py-1 text-xs rounded bg-orange-500 hover:bg-orange-600 text-white"
                                        title="Reset to initial entity"
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
                            <span className="text-xs">
                                {graphStats.node_count} nodes, {graphStats.relation_count} relations
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

import React, { useState, useEffect } from 'react';
import { Node } from '@xyflow/react';
import { MultiDirectedGraph } from 'graphology';
import { getColorForNode, darkenColor, EvaluationResult } from '../graphStyles';
import { getOntologyRelationHeuristicsBatch } from '../../../api';

// TypeScript interfaces based on the Python Entity model
interface EntityData {
    entity_type: string;
    additional_labels?: string[];
    all_properties: Record<string, any>;
    primary_key_properties: string[];
    additional_key_properties?: string[][];
}

interface RelationEdge {
    edgeId: string;
    source: string;
    target: string;
    relationData: any;
    attributes: any;
}

interface OntologyEntityDetailsCardProps {
    entity: Node;
    onClose: () => void;
    // Graph and relation data
    graph?: MultiDirectedGraph;
    // All relations data - map of relationId to relation data
    allRelations?: Map<string, any>;
    // Cached heuristics data - map of relationId to heuristics
    heuristicsCache?: Map<string, any>;
    // API action handlers
    onEvaluate?: (relationId: string) => Promise<void>;
    onAccept?: (relationId: string, relationName: string) => Promise<void>;
    onReject?: (relationId: string) => Promise<void>;
    onUndoEvaluation?: (relationId: string) => Promise<void>;
    onSync?: (relationId: string) => Promise<void>;
    // Loading and result states
    isLoading?: boolean;
    actionResult?: { type: 'success' | 'error', message: string } | null;
    onClearActionResult?: () => void;
}

export default function OntologyEntityDetailsCard({ 
    entity, 
    onClose,
    graph,
    allRelations,
    heuristicsCache,
    onEvaluate,
    onAccept,
    onReject,
    onUndoEvaluation,
    onSync,
    isLoading = false,
    actionResult,
    onClearActionResult
}: OntologyEntityDetailsCardProps) {
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    const [isAllPropertiesCollapsed, setIsAllPropertiesCollapsed] = useState(true);
    const [expandedRelations, setExpandedRelations] = useState<Set<string>>(new Set());
    const [expandedExampleMatches, setExpandedExampleMatches] = useState<Set<string>>(new Set());
    const [relationHeuristics, setRelationHeuristics] = useState<Map<string, any>>(new Map());
    const [loadingHeuristics, setLoadingHeuristics] = useState<Set<string>>(new Set());
    
    // Initialize heuristics from cache for all connected relations
    useEffect(() => {
        if (heuristicsCache && heuristicsCache.size > 0 && allRelations) {
            const cachedHeuristics = new Map<string, any>();
            
            // For each relation connected to this entity, check if we have cached heuristics
            allRelations.forEach((relation, relationId) => {
                const relationProps = relation?.relation_properties || {};
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || relation?._ontology_relation_id 
                    || relation?.relation_pk
                    || relationId;
                
                // Check cache with both relationId and ontologyRelationId
                const cached = heuristicsCache.get(relationId) || heuristicsCache.get(ontologyRelationId);
                if (cached) {
                    cachedHeuristics.set(ontologyRelationId, cached);
                    cachedHeuristics.set(relationId, cached); // Also store with relationId for lookup
                }
            });
            
            if (cachedHeuristics.size > 0) {
                setRelationHeuristics(prev => {
                    // Merge with existing heuristics
                    const merged = new Map(prev);
                    cachedHeuristics.forEach((value, key) => {
                        merged.set(key, value);
                    });
                    return merged;
                });
            }
        }
    }, [heuristicsCache, allRelations, entity.id]);
    
    // Extract entity data from the node
    // The node data can be either EntityData directly or graph node attributes with entityData property
    const nodeAttributes = entity.data as any;
    const entityData: EntityData = nodeAttributes.entityData || nodeAttributes;
    const entityType = entityData.entity_type || nodeAttributes.entityType || 'Ontology Entity';
    const backgroundColor = getColorForNode(entityType);
    const borderColor = darkenColor(backgroundColor, 20);
    
    // Get primary key for the entity
    const getPrimaryKeyValue = (): string => {
        // Try to get from entityData first
        if (entityData.primary_key_properties && entityData.all_properties) {
            const pk = entityData.primary_key_properties
                .map(prop => entityData.all_properties[prop] || '')
                .join(' | ');
            if (pk) return pk;
        }
        // Fallback to node ID
        return entity.id;
    };
    
    const entityPk = getPrimaryKeyValue();
    
    // Get all relations for this entity from the relations data
    const getConnectedRelations = (): Array<{ relationId: string; relation: any }> => {
        if (!allRelations) {
            console.warn('No relations data available');
            return [];
        }
        
        // The node ID in the graph is the composite ID (entityType::primaryKey)
        const nodeId = entity.id;
        
        if (!nodeId) {
            console.warn('No node ID found for entity');
            return [];
        }
        
        const relations: Array<{ relationId: string; relation: any }> = [];
        
        // Helper function to generate composite node ID
        const generateNodeId = (entityType: string, primaryKey: string): string => {
            return `${entityType}::${primaryKey}`;
        };
        
        // Get all relations where this entity is either the source or target
        allRelations.forEach((relation, relationId) => {
            const fromEntityType = relation.from_entity?.entity_type;
            const fromPk = relation.from_entity?.primary_key;
            const toEntityType = relation.to_entity?.entity_type;
            const toPk = relation.to_entity?.primary_key;
            
            if (!fromEntityType || !fromPk || !toEntityType || !toPk) {
                return; // Skip malformed relations
            }
            
            // Generate composite node IDs for comparison
            const sourceNodeId = generateNodeId(fromEntityType, fromPk);
            const targetNodeId = generateNodeId(toEntityType, toPk);
            
            if (sourceNodeId === nodeId || targetNodeId === nodeId) {
                relations.push({ relationId, relation });
            }
        });
        
        console.log('Entity node ID:', nodeId);
        console.log('Entity PK (calculated):', entityPk);
        console.log('Found relations:', relations.length);
        console.log('Total relations in data:', allRelations.size);
        if (relations.length > 0) {
            console.log('Sample relation:', relations[0]);
        }
        
        return relations;
    };
    
    const connectedRelations = getConnectedRelations();
    
    // Helper function to generate composite node ID (used for comparison)
    const generateNodeIdForComparison = (entityType: string, primaryKey: string): string => {
        return `${entityType}::${primaryKey}`;
    };
    
    // Group relations by direction
    const groupedRelations = connectedRelations.reduce((acc, { relationId, relation }) => {
        const fromEntityType = relation?.from_entity?.entity_type;
        const fromPk = relation?.from_entity?.primary_key;
        
        if (!fromEntityType || !fromPk) {
            return acc; // Skip malformed relations
        }
        
        const sourceNodeId = generateNodeIdForComparison(fromEntityType, fromPk);
        const isOutgoing = sourceNodeId === entity.id;
        
        if (isOutgoing) {
            acc.outgoing.push({ relationId, relation });
        } else {
            acc.incoming.push({ relationId, relation });
        }
        
        return acc;
    }, { outgoing: [] as Array<{ relationId: string; relation: any }>, incoming: [] as Array<{ relationId: string; relation: any }> });
    
    // Debug: Log when component mounts or relations data changes
    useEffect(() => {
        console.log('EntityDetailsCard mounted/updated:', {
            hasGraph: !!graph,
            hasRelationsData: !!allRelations,
            relationsDataSize: allRelations?.size || 0,
            entityId: entity.id,
            connectedRelationsCount: connectedRelations.length
        });
    }, [graph, allRelations, entity.id, connectedRelations.length]);
    
    // Render a single relation item
    const renderRelationItem = (relationId: string, relation: any, isOutgoing: boolean) => {
        const relationData = relation;
        const relationProps = relationData?.relation_properties || {};
        // Get the actual ontology relation ID for API calls
        const ontologyRelationId = relationProps?._ontology_relation_id 
            || relationData?._ontology_relation_id 
            || relationData?.relation_pk
            || relationId;
        const relationName = relationProps.eval_relation_name || relationData?.relation_name || 'Unknown Relation';
        const isExpanded = expandedRelations.has(ontologyRelationId);
        const heuristics = relationHeuristics.get(ontologyRelationId);
        const isLoadingHeur = loadingHeuristics.has(ontologyRelationId);
        
        // Determine neighbor entity
        const sourcePk = relationData?.from_entity?.primary_key;
        const targetPk = relationData?.to_entity?.primary_key;
        const neighborPk = isOutgoing ? targetPk : sourcePk;
        
        // Get neighbor entity type
        const neighborEntityType = isOutgoing 
            ? relationData?.to_entity?.entity_type 
            : relationData?.from_entity?.entity_type;
        const neighborColor = neighborEntityType ? getColorForNode(neighborEntityType) : '#gray';
        
        // Evaluation status
        const hasEvaluation = relationProps.eval_last_evaluated !== undefined && 
                             relationProps.eval_last_evaluated !== null &&
                             relationProps.eval_last_evaluated > 0;
        const evalResult = relationProps.eval_result || 'Not Evaluated';
        
        return (
            <div key={relationId} className="bg-white rounded border border-gray-200">
                {/* Collapsed Header */}
                <button
                    onClick={() => toggleRelation(ontologyRelationId)}
                    className="w-full flex items-center justify-between p-2 hover:bg-gray-50 transition-colors text-left"
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span 
                                className="font-semibold text-sm truncate"
                                style={{ color: darkenColor(neighborColor, 40) }}
                            >
                                {isOutgoing ? '→' : '←'} {neighborEntityType || 'Unknown'}
                                {(() => {
                                    // Get entity_a_property from multiple sources
                                    // First check cached heuristics (from prop)
                                    const cachedHeuristics = heuristicsCache?.get(ontologyRelationId) || heuristicsCache?.get(relationId);
                                    const cachedHeuristicData = cachedHeuristics?.heuristic || cachedHeuristics;
                                    
                                    let entityAProperty = 
                                        // First check heuristics from state (if already loaded)
                                        heuristics?.entity_a_property 
                                        || heuristics?.heuristic?.entity_a_property
                                        // Then check cached heuristics from prop
                                        || cachedHeuristics?.entity_a_property
                                        || cachedHeuristicData?.entity_a_property
                                        // Then check relation properties
                                        || relationProps?.entity_a_property
                                        // Then check relation data
                                        || relationData?.entity_a_property
                                        // Check graph edge attributes if available
                                        || (graph && (() => {
                                            try {
                                                const edge = graph.edge(relationId);
                                                if (edge) {
                                                    const edgeAttrs = graph.getEdgeAttributes(edge);
                                                    return edgeAttrs?.relationData?.relation_properties?.entity_a_property
                                                        || edgeAttrs?.relationData?.entity_a_property;
                                                }
                                            } catch (e) {
                                                // Ignore errors
                                            }
                                            return null;
                                        })());
                                    
                                    // If not found, try to get from property mappings in relation properties
                                    if (!entityAProperty && relationProps?.heuristic_property_mappings) {
                                        try {
                                            const mappings = typeof relationProps.heuristic_property_mappings === 'string' 
                                                ? JSON.parse(relationProps.heuristic_property_mappings) 
                                                : relationProps.heuristic_property_mappings;
                                            if (Array.isArray(mappings) && mappings.length > 0) {
                                                entityAProperty = mappings[0].entity_a_property;
                                            }
                                        } catch (e) {
                                            // Ignore parse errors
                                        }
                                    }
                                    
                                    // Also check cached heuristics property_mappings
                                    if (!entityAProperty && cachedHeuristicData?.property_mappings && Array.isArray(cachedHeuristicData.property_mappings) && cachedHeuristicData.property_mappings.length > 0) {
                                        entityAProperty = cachedHeuristicData.property_mappings[0].entity_a_property;
                                    }
                                    
                                    // Also check heuristics property_mappings if available
                                    if (!entityAProperty && heuristics) {
                                        const heuristicData = heuristics.heuristic || heuristics;
                                        if (heuristicData?.property_mappings && Array.isArray(heuristicData.property_mappings) && heuristicData.property_mappings.length > 0) {
                                            entityAProperty = heuristicData.property_mappings[0].entity_a_property;
                                        }
                                    }
                                    
                                    return entityAProperty ? (
                                        <span className="text-gray-600 font-normal">.{entityAProperty}</span>
                                    ) : null;
                                })()}
                            </span>
                            {hasEvaluation && (
                                <span className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                                    evalResult === EvaluationResult.ACCEPTED ? 'bg-green-100 text-green-800' :
                                    evalResult === EvaluationResult.REJECTED ? 'bg-red-100 text-red-800' :
                                    'bg-yellow-100 text-yellow-800'
                                }`}>
                                    {evalResult}
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                            <span className="text-gray-600 font-bold">{relationName}</span>
                            <span className="text-gray-400 ml-2">({neighborPk?.substring(0, 20) || 'N/A'}...)</span>
                        </div>
                    </div>
                    <span className="text-brand-600 text-sm ml-2 flex-shrink-0">
                        {isExpanded ? '▲' : '▼'}
                    </span>
                </button>
                
                {/* Expanded Content */}
                {isExpanded && (
                    <div className="p-3 border-t border-gray-200 space-y-3">
                        {/* Relation Details */}
                        <div className="bg-white p-2 rounded border">
                            <div className="space-y-1 text-xs">
                                                            <div className="flex items-start gap-2">
                                                                <span className="w-24 flex-shrink-0 font-bold text-gray-700">Relation ID:</span>
                                                                <span className="text-gray-600 font-mono break-all">{ontologyRelationId}</span>
                                                            </div>
                                <div className="flex items-start gap-2">
                                    <span className="w-24 flex-shrink-0 font-bold text-gray-700">Status:</span>
                                    <span className="text-gray-600">{hasEvaluation ? evalResult : 'Not Evaluated'}</span>
                                </div>
                                {relationProps.heuristic_count !== undefined && (
                                    <div className="flex items-start gap-2">
                                        <span className="w-24 flex-shrink-0 font-bold text-gray-700">Match Count:</span>
                                        <span className="text-gray-600">{relationProps.heuristic_count}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* Action Buttons */}
                        {onEvaluate && onAccept && onReject && (
                            <div className="flex flex-wrap gap-1">
                                                            <button
                                                                onClick={() => onEvaluate(ontologyRelationId)}
                                                                disabled={isLoading || !ontologyRelationId}
                                                                className="bg-blue-500 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-1 px-2 rounded text-xs"
                                                            >
                                                                {isLoading ? 'Evaluating...' : 'Re-Evaluate'}
                                                            </button>
                                                            {!hasEvaluation && (
                                                                <>
                                                                    <button
                                                                        onClick={() => onAccept(ontologyRelationId, relationName)}
                                                                        disabled={isLoading || !ontologyRelationId}
                                                                        className="bg-green-500 hover:bg-green-700 disabled:bg-green-300 text-white font-bold py-1 px-2 rounded text-xs"
                                                                    >
                                                                        {isLoading ? 'Processing...' : 'Accept'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => onReject(ontologyRelationId)}
                                                                        disabled={isLoading || !ontologyRelationId}
                                                                        className="bg-red-500 hover:bg-red-700 disabled:bg-red-300 text-white font-bold py-1 px-2 rounded text-xs"
                                                                    >
                                                                        {isLoading ? 'Processing...' : 'Reject'}
                                                                    </button>
                                                                </>
                                                            )}
                                                            {hasEvaluation && onUndoEvaluation && (
                                                                <button
                                                                    onClick={() => onUndoEvaluation(ontologyRelationId)}
                                                                    disabled={isLoading || !ontologyRelationId}
                                                                    className="bg-orange-500 hover:bg-orange-700 disabled:bg-orange-300 text-white font-bold py-1 px-2 rounded text-xs"
                                                                >
                                                                    {isLoading ? 'Processing...' : 'Undo'}
                                                                </button>
                                                            )}
                                                            {onSync && (
                                                                <button
                                                                    onClick={() => onSync(ontologyRelationId)}
                                                                    disabled={isLoading || !ontologyRelationId}
                                                                    className="bg-purple-500 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold py-1 px-2 rounded text-xs"
                                                                >
                                                                    {isLoading ? 'Syncing...' : 'Sync'}
                                                                </button>
                                                            )}
                            </div>
                        )}
                        
                        {/* Heuristics Data */}
                        {isLoadingHeur && (
                            <div className="flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="text-gray-700 text-xs">Loading heuristics...</span>
                            </div>
                        )}
                        
                        {heuristics && !isLoadingHeur && !heuristics.error && (
                            <>
                                <div className="font-semibold text-gray-900 text-xs">📊 Heuristics Data</div>
                                {/* Handle both nested (heuristic) and flat structures */}
                                {(() => {
                                    const heuristicData = heuristics.heuristic || heuristics;
                                    const totalMatches = heuristicData?.total_matches ?? heuristicData?.count;
                                    
                                    return (
                                        <>
                                            {totalMatches !== undefined && (
                                                <div className="flex items-center justify-between p-1 rounded border border-gray-200 text-xs">
                                                    <span className="text-gray-700">Total Matches:</span>
                                                    <span className="font-semibold text-gray-900">{totalMatches}</span>
                                                </div>
                                            )}
                                            {heuristicData?.property_mappings && heuristicData.property_mappings.length > 0 && (
                                                <div className="p-1 rounded border border-gray-200 text-xs">
                                                    <div className="font-semibold text-gray-800 mb-1">Property Mappings:</div>
                                                    <div className="space-y-1">
                                                        {heuristicData.property_mappings.map((mapping: any, idx: number) => {
                                                            // For incoming relations: key = neighbor color, value = selected color
                                                            // For outgoing relations: key = selected color, value = neighbor color
                                                            const keyColor = isOutgoing ? backgroundColor : neighborColor;
                                                            const valueColor = isOutgoing ? neighborColor : backgroundColor;
                                                            
                                                            return (
                                                                <div key={idx} className="text-xs p-1 rounded">
                                                                    <span 
                                                                        className="font-semibold"
                                                                        style={{ color: darkenColor(keyColor, 40) }}
                                                                    >
                                                                        {mapping.entity_a_property || 'N/A'}
                                                                    </span>
                                                                    <span className="text-gray-600 mx-1">→</span>
                                                                    <span 
                                                                        className="font-semibold"
                                                                        style={{ color: darkenColor(valueColor, 40) }}
                                                                    >
                                                                        {mapping.entity_b_idkey_property || mapping.entity_b_property || 'N/A'}
                                                                    </span>
                                                                    {mapping.match_type && (
                                                                        <span className="text-gray-500 ml-2 text-xs">
                                                                            ({mapping.match_type})
                                                                        </span>
                                                                    )}
                                                                    {mapping.value_match_quality !== undefined && (
                                                                        <span className="text-gray-500 ml-2 text-xs">
                                                                            quality: {typeof mapping.value_match_quality === 'number' ? mapping.value_match_quality.toFixed(2) : mapping.value_match_quality}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {(heuristicData?.value_match_quality_avg !== undefined || heuristicData?.deep_match_quality_avg !== undefined || heuristicData?.match_type_counts) && (
                                                <div className="p-1 rounded border border-gray-200 text-xs">
                                                    <div className="font-semibold text-gray-800 mb-1">Quality Metrics:</div>
                                                    <div className="grid grid-cols-2 gap-1">
                                                        {heuristicData.value_match_quality_avg !== undefined && (
                                                            <div className="flex items-center justify-between p-1 rounded border border-gray-200">
                                                                <span className="text-gray-700 capitalize text-xs">Value Match Quality:</span>
                                                                <span className="font-semibold text-gray-900 text-xs">
                                                                    {typeof heuristicData.value_match_quality_avg === 'number' ? heuristicData.value_match_quality_avg.toFixed(2) : String(heuristicData.value_match_quality_avg)}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {heuristicData.deep_match_quality_avg !== undefined && (
                                                            <div className="flex items-center justify-between p-1 rounded border border-gray-200">
                                                                <span className="text-gray-700 capitalize text-xs">Deep Match Quality:</span>
                                                                <span className="font-semibold text-gray-900 text-xs">
                                                                    {typeof heuristicData.deep_match_quality_avg === 'number' ? heuristicData.deep_match_quality_avg.toFixed(2) : String(heuristicData.deep_match_quality_avg)}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {heuristicData.match_type_counts && Object.entries(heuristicData.match_type_counts).map(([key, value]) => (
                                                            <div key={key} className="flex items-center justify-between p-1 rounded border border-gray-200">
                                                                <span className="text-gray-700 capitalize text-xs">{key.replace(/_/g, ' ')} count:</span>
                                                                <span className="font-semibold text-gray-900 text-xs">
                                                                    {String(value)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                        {heuristicData.quality_metrics && Object.entries(heuristicData.quality_metrics).map(([key, value]) => (
                                                            <div key={key} className="flex items-center justify-between p-1 rounded border border-gray-200">
                                                                <span className="text-gray-700 capitalize text-xs">{key.replace(/_/g, ' ')}:</span>
                                                                <span className="font-semibold text-gray-900 text-xs">
                                                                    {typeof value === 'number' ? value.toFixed(2) : String(value)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {heuristicData?.example_matches && heuristicData.example_matches.length > 0 && (
                                                <div className="p-1 rounded border border-gray-200 text-xs">
                                                    <button
                                                        onClick={() => {
                                                            const newSet = new Set(expandedExampleMatches);
                                                            if (newSet.has(ontologyRelationId)) {
                                                                newSet.delete(ontologyRelationId);
                                                            } else {
                                                                newSet.add(ontologyRelationId);
                                                            }
                                                            setExpandedExampleMatches(newSet);
                                                        }}
                                                        className="w-full flex items-center justify-between text-left"
                                                    >
                                                        <div className="font-semibold text-gray-800">Example Matches:</div>
                                                        <span className="text-gray-600 text-xs">
                                                            {expandedExampleMatches.has(ontologyRelationId) ? '▲' : '▼'}
                                                        </span>
                                                    </button>
                                                    {expandedExampleMatches.has(ontologyRelationId) && (
                                                        <div className="space-y-1 mt-1">
                                                            {heuristicData.example_matches.map((match: any, idx: number) => (
                                                                <div key={idx} className="text-xs p-1 rounded">
                                                                    <span className="font-semibold">{match.entity_a_pk || 'N/A'}</span>
                                                                    <span className="text-gray-600 mx-1">→</span>
                                                                    <span className="font-semibold">{match.entity_b_pk || 'N/A'}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </>
                        )}
                        
                        {heuristics?.error && (
                            <div className="bg-red-50 p-2 rounded border border-red-200">
                                <p className="text-red-700 text-xs">⚠️ {heuristics.error}</p>
                            </div>
                        )}
                        
                        {/* Property Mappings */}
                        {relationProps.heuristic_property_mappings && (
                            <div className="bg-white p-2 rounded border">
                                <div className="font-semibold text-gray-800 text-xs mb-1">Property Mappings</div>
                                <div className="space-y-1">
                                    {(() => {
                                        try {
                                            const mappings = typeof relationProps.heuristic_property_mappings === 'string' 
                                                ? JSON.parse(relationProps.heuristic_property_mappings) 
                                                : relationProps.heuristic_property_mappings;
                                            if (Array.isArray(mappings)) {
                                                return mappings.slice(0, 3).map((mapping: any, idx: number) => (
                                                    <div key={idx} className="text-xs text-gray-600">
                                                        {mapping.entity_a_property || 'N/A'} → {mapping.entity_b_idkey_property || 'N/A'}
                                                    </div>
                                                ));
                                            }
                                        } catch (e) {
                                            return <div className="text-xs text-gray-500">Unable to parse mappings</div>;
                                        }
                                        return null;
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };
    
    // Toggle relation expansion
    const toggleRelation = (relationId: string) => {
        setExpandedRelations(prev => {
            const newSet = new Set(prev);
            if (newSet.has(relationId)) {
                newSet.delete(relationId);
            } else {
                newSet.add(relationId);
                // Fetch heuristics when expanding
                if (!relationHeuristics.has(relationId) && !loadingHeuristics.has(relationId)) {
                    fetchRelationHeuristics(relationId);
                }
            }
            return newSet;
        });
    };
    
    // Fetch heuristics for a relation - check cache first
    const fetchRelationHeuristics = async (relationId: string) => {
        // First check if we already have it in our state
        if (relationHeuristics.has(relationId)) {
            return;
        }
        
        // Check the cache passed as prop
        if (heuristicsCache?.has(relationId)) {
            const cachedHeuristics = heuristicsCache.get(relationId);
            setRelationHeuristics(prev => {
                const newMap = new Map(prev);
                newMap.set(relationId, cachedHeuristics);
                return newMap;
            });
            return;
        }
        
        console.log(`Heuristics not found in cache for: ${relationId}`);
        console.log(`Cache has keys:`, Array.from(heuristicsCache?.keys() || []).slice(0, 5));
        
        // If not in cache, fetch from API using batch endpoint
        setLoadingHeuristics(prev => new Set(prev).add(relationId));
        try {
            const heuristicsMap = await getOntologyRelationHeuristicsBatch([relationId]);
            const heuristics = heuristicsMap[relationId];
            if (heuristics) {
                setRelationHeuristics(prev => {
                    const newMap = new Map(prev);
                    newMap.set(relationId, heuristics);
                    return newMap;
                });
            } else {
                throw new Error('Heuristics not found in response');
            }
        } catch (error) {
            console.error('Failed to fetch heuristics for relation:', relationId, error);
            setRelationHeuristics(prev => {
                const newMap = new Map(prev);
                newMap.set(relationId, { error: 'Failed to load heuristics' });
                return newMap;
            });
        } finally {
            setLoadingHeuristics(prev => {
                const newSet = new Set(prev);
                newSet.delete(relationId);
                return newSet;
            });
        }
    };
    
    // Helper function to check if a property is internal (starts with _)
    const isInternalProperty = (key: string): boolean => key.startsWith('_');
    
    // Render property value with appropriate formatting
    const renderPropertyValue = (value: any): React.ReactNode => {
        if (value === null || value === undefined) {
            return <span className="text-gray-400 italic">null</span>;
        }
        if (typeof value === 'boolean') {
            return <span className={`font-medium ${value ? 'text-green-600' : 'text-red-600'}`}>{String(value)}</span>;
        }
        if (typeof value === 'object') {
            return <pre className="text-xs bg-gray-50 p-1 rounded max-w-xs overflow-auto">{JSON.stringify(value, null, 2)}</pre>;
        }
        return <span className="break-words">{String(value)}</span>;
    };
    
    return (
        <div className="absolute top-0 right-4 w-[600px] bg-white border rounded-lg shadow-lg z-20 flex flex-col overflow-hidden" style={{ height: 'calc(100% - 20px)', maxHeight: 'calc(100% - 20px)' }}>
            {/* Colored Header */}
            <div 
                className="p-4 rounded-t-lg border-b flex-shrink-0"
                style={{ 
                    backgroundColor, 
                    borderColor: borderColor 
                }}
            >
                <div className="flex justify-between items-center">
                    <div className="flex-1">
                        <h5 className="text-lg font-bold text-gray-800">Ontology Entity Details</h5>
                        <p className="text-sm font-bold text-gray-700">{entityType}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={onClose} 
                            className="w-9 h-9 flex items-center justify-center rounded bg-white bg-opacity-70 hover:bg-opacity-40 text-gray-800 hover:text-gray-900 transition-all duration-200 text-lg"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Action Result Status */}
            {actionResult && (
                <div className={`mx-4 mt-2 p-3 rounded-lg flex-shrink-0 ${
                    actionResult.type === 'success' 
                        ? 'bg-green-100 border border-green-200 text-green-800' 
                        : 'bg-red-100 border border-red-200 text-red-800'
                }`}>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold">
                            {actionResult.type === 'success' ? '✅' : '❌'}
                        </span>
                        <span className="text-sm">{actionResult.message}</span>
                        {onClearActionResult && (
                            <button 
                                onClick={onClearActionResult}
                                className="ml-auto text-lg hover:opacity-70"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>
            )}
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
                <div className="space-y-4">
                    {/* Primary Keys Section */}
                    {entityData.primary_key_properties && entityData.primary_key_properties.length > 0 && (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <h6 className="font-semibold text-gray-800 mb-2">Primary Keys</h6>
                            <div className="space-y-1">
                                {entityData.primary_key_properties.map((key: string, index: number) => {
                                    const isEntityTypeName = key === 'entity_type_name' || key === '_entity_type_name';
                                    const value = entityData.all_properties?.[key] || 'N/A';
                                    
                                    return (
                                        <div key={index} className="flex items-start gap-2 text-sm">
                                            <div className="w-32 flex-shrink-0">
                                                <span className="font-bold text-gray-700 break-words">{key}:</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                {isEntityTypeName ? (
                                                    <span 
                                                        className="font-semibold break-words"
                                                        style={{ color: darkenColor(backgroundColor, 40) }}
                                                    >
                                                        {value}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-600 break-words">{value}</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="mt-2 pt-2 border-t border-gray-200">
                                    <div className="flex items-start gap-2 text-sm">
                                        <div className="w-32 flex-shrink-0">
                                            <span className="font-bold text-gray-700 break-words">Primary Key:</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-gray-600 font-mono text-xs break-words">{getPrimaryKeyValue()}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* All Properties Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <button
                            onClick={() => setIsAllPropertiesCollapsed(!isAllPropertiesCollapsed)}
                            className="flex items-center justify-between w-full text-left hover:bg-gray-100 p-1 rounded transition-colors"
                        >
                            <h6 className="font-semibold text-gray-800">
                                All Properties ({Object.keys(entityData.all_properties || {}).length})
                            </h6>
                            <span className="text-gray-600 text-sm">
                                {isAllPropertiesCollapsed ? '▼' : '▲'}
                            </span>
                        </button>
                        {!isAllPropertiesCollapsed && (
                            <div className="mt-3 space-y-2">
                                {Object.entries(entityData.all_properties || {}).map(([key, value]) => (
                                    <div key={key} className="bg-white p-2 rounded border">
                                        <div className="flex items-start gap-2">
                                            <div className="w-32 flex-shrink-0">
                                                <div className={`font-bold text-gray-700 text-sm break-words ${isInternalProperty(key) ? 'font-mono' : ''}`}>
                                                    {key}:
                                                    {entityData.primary_key_properties?.includes(key) && (
                                                        <span className="ml-1 px-1 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">PK</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm text-gray-600 break-words">
                                                    {renderPropertyValue(value)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {/* Relations Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-900 mb-3">
                            Relations ({connectedRelations.length})
                            {!allRelations && <span className="text-xs text-red-600 ml-2">(Relations data not available)</span>}
                        </h6>
                        {connectedRelations.length === 0 ? (
                            <div className="text-sm text-gray-600 italic">
                                No relations found for this entity.
                                {allRelations && <div className="text-xs mt-1">Node ID: {entity.id}</div>}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Outgoing Relations */}
                                {groupedRelations.outgoing.length > 0 && (
                                    <div>
                                        <h7 className="text-xs font-semibold text-gray-800 mb-2 block">
                                            Outgoing ({groupedRelations.outgoing.length})
                                        </h7>
                                        <div className="space-y-2">
                                            {groupedRelations.outgoing.map(({ relationId, relation }) => {
                                                return renderRelationItem(relationId, relation, true);
                                            })}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Incoming Relations */}
                                {groupedRelations.incoming.length > 0 && (
                                    <div>
                                        <h7 className="text-xs font-semibold text-gray-800 mb-2 block">
                                            Incoming ({groupedRelations.incoming.length})
                                        </h7>
                                        <div className="space-y-2">
                                            {groupedRelations.incoming.map(({ relationId, relation }) => {
                                                return renderRelationItem(relationId, relation, false);
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {/* Raw Entity Data Section */}
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <button
                            onClick={() => setIsRawDataCollapsed(!isRawDataCollapsed)}
                            className="flex items-center justify-between w-full text-left hover:bg-slate-100 p-1 rounded transition-colors"
                        >
                            <h6 className="font-semibold text-slate-800">Raw Entity Data</h6>
                            <span className="text-slate-600 text-sm">
                                {isRawDataCollapsed ? '▼' : '▲'}
                            </span>
                        </button>
                        {!isRawDataCollapsed && (
                            <pre className="mt-3 text-xs bg-white p-3 rounded border overflow-auto max-h-60">
                                {JSON.stringify(entity.data, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
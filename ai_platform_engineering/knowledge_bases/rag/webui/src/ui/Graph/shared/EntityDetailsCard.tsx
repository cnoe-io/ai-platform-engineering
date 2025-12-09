import React, { useState, useEffect } from 'react';
import { Node } from '@xyflow/react';
import { MultiDirectedGraph } from 'graphology';
import { getColorForNode, darkenColor, EvaluationResult } from '../graphStyles';
import { getOntologyRelationHeuristicsBatch } from '../../../api';

// TypeScript interfaces
interface EntityData {
    entity_type: string;
    primary_key?: string;
    additional_labels?: string[];
    all_properties: Record<string, any>;
    primary_key_properties: string[];
    additional_key_properties?: string[][];
    _fresh_until?: string | number;
}

interface RelationData {
    from_entity: { entity_type: string; primary_key: string };
    to_entity: { entity_type: string; primary_key: string };
    relation_name: string;
    relation_pk?: string;
    relation_properties?: any;
    _ontology_relation_id?: string;
    entity_a_property?: string;
}

interface EntityDetailsCardProps {
    entity: Node | { id: string; data: any };
    onClose: () => void;
    
    // Mode controls which features are available and sets appropriate defaults
    mode: 'data' | 'ontology';
    
    // Data graph specific props
    onExplore?: (entityType: string, primaryKey: string, depth?: number) => void;
    onFocus?: (entityType: string, primaryKey: string) => void;
    isCurrentlyExplored?: boolean;
    
    // Ontology graph specific props - optional
    graph?: MultiDirectedGraph;
    allRelations?: Map<string, RelationData>;
    heuristicsCache?: Map<string, any>;
    evaluationsCache?: Map<string, any>;
    
    // Ontology relation action handlers - optional
    onEvaluate?: (relationId: string) => Promise<void>;
    onAccept?: (relationId: string, relationName: string) => Promise<void>;
    onReject?: (relationId: string) => Promise<void>;
    onUndoEvaluation?: (relationId: string) => Promise<void>;
    onSync?: (relationId: string) => Promise<void>;
    
    // Loading and result states (ontology mode only)
    isLoading?: boolean;
    actionResult?: { type: 'success' | 'error', message: string } | null;
    onClearActionResult?: () => void;
}

export default function EntityDetailsCard({ 
    entity, 
    onClose,
    mode,
    onExplore,
    onFocus,
    isCurrentlyExplored = false,
    graph,
    allRelations,
    heuristicsCache,
    evaluationsCache,
    onEvaluate,
    onAccept,
    onReject,
    onUndoEvaluation,
    onSync,
    isLoading = false,
    actionResult,
    onClearActionResult
}: EntityDetailsCardProps) {
    // Set flags based on mode
    const showRelations = true; // Always show relations when allRelations is provided
    const allPropertiesCollapsedByDefault = true; // Always collapsed by default
    const parseRelationStatus = mode === 'ontology'; // Only parse/filter by status in ontology mode
    const show_related_node_pk = mode === 'data'; // Only show related node PK in data mode
    
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    const [isAllPropertiesCollapsed, setIsAllPropertiesCollapsed] = useState(allPropertiesCollapsedByDefault);
    const [isInternalPropertiesCollapsed, setIsInternalPropertiesCollapsed] = useState(true);
    const [expandedRelations, setExpandedRelations] = useState<Set<string>>(new Set());
    const [expandedExampleMatches, setExpandedExampleMatches] = useState<Set<string>>(new Set());
    const [expandedEvaluations, setExpandedEvaluations] = useState<Set<string>>(new Set());
    const [expandedHeuristics, setExpandedHeuristics] = useState<Set<string>>(new Set());
    const [relationHeuristics, setRelationHeuristics] = useState<Map<string, any>>(new Map());
    const [relationEvaluations, setRelationEvaluations] = useState<Map<string, any>>(new Map());
    const [loadingHeuristics, setLoadingHeuristics] = useState<Set<string>>(new Set());
    const [showNonAcceptedRelations, setShowNonAcceptedRelations] = useState(false);
    const [isRelationsSectionCollapsed, setIsRelationsSectionCollapsed] = useState(false);
    
    // Extract entity data from the node
    const nodeAttributes = entity.data as any;
    const entityData: EntityData = nodeAttributes.entityData || nodeAttributes;
    const entityType = entityData.entity_type || nodeAttributes.entityType || (mode === 'ontology' ? 'Ontology Entity' : 'Data Entity');
    const backgroundColor = getColorForNode(entityType);
    const borderColor = darkenColor(backgroundColor, 20);
    
    // Initialize heuristics from cache for all connected relations (ontology mode only)
    useEffect(() => {
        if (mode === 'ontology' && heuristicsCache && heuristicsCache.size > 0 && allRelations) {
            const cachedHeuristics = new Map<string, any>();
            
            allRelations.forEach((relation, relationId) => {
                const relationProps = relation?.relation_properties || {};
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || relation?._ontology_relation_id 
                    || relation?.relation_pk
                    || relationId;
                
                const cached = heuristicsCache.get(relationId) || heuristicsCache.get(ontologyRelationId);
                if (cached) {
                    cachedHeuristics.set(ontologyRelationId, cached);
                    cachedHeuristics.set(relationId, cached);
                }
            });
            
            if (cachedHeuristics.size > 0) {
                setRelationHeuristics(prev => {
                    const merged = new Map(prev);
                    cachedHeuristics.forEach((value, key) => {
                        merged.set(key, value);
                    });
                    return merged;
                });
            }
        }
    }, [mode, heuristicsCache, allRelations, entity.id]);
    
    // Initialize evaluations from cache for all connected relations (ontology mode only)
    useEffect(() => {
        if (mode === 'ontology' && evaluationsCache && evaluationsCache.size > 0 && allRelations) {
            const cachedEvaluations = new Map<string, any>();
            
            allRelations.forEach((relation, relationId) => {
                const relationProps = relation?.relation_properties || {};
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || relation?._ontology_relation_id 
                    || relation?.relation_pk
                    || relationId;
                
                const cached = evaluationsCache.get(relationId) || evaluationsCache.get(ontologyRelationId);
                if (cached) {
                    cachedEvaluations.set(ontologyRelationId, cached);
                    cachedEvaluations.set(relationId, cached);
                }
            });
            
            if (cachedEvaluations.size > 0) {
                setRelationEvaluations(prev => {
                    const merged = new Map(prev);
                    cachedEvaluations.forEach((value, key) => {
                        merged.set(key, value);
                    });
                    return merged;
                });
            }
        }
    }, [mode, evaluationsCache, allRelations, entity.id]);
    
    // Helper function to format date from timestamp
    const formatDate = (timestamp: string | number) => {
        try {
            const date = new Date(typeof timestamp === 'string' ? parseInt(timestamp) : timestamp);
            return date.toLocaleString();
        } catch {
            return timestamp?.toString() || 'Invalid date';
        }
    };

    // Helper function to get expiry status (data mode only)
    const getExpiryStatus = (freshUntil: string | number) => {
        try {
            const expiryTime = new Date(typeof freshUntil === 'string' ? parseInt(freshUntil) : freshUntil);
            const now = new Date();
            const isExpired = now > expiryTime;
            return {
                isExpired,
                status: isExpired ? 'Expired' : 'Fresh',
                color: isExpired ? 'text-red-600' : 'text-green-600',
                bgColor: isExpired ? 'bg-red-50' : 'bg-green-50',
                borderColor: isExpired ? 'border-red-200' : 'border-green-200'
            };
        } catch {
            return {
                isExpired: null,
                status: 'Unknown',
                color: 'text-gray-600',
                bgColor: 'bg-gray-50',
                borderColor: 'border-gray-200'
            };
        }
    };

    // Get primary key for the entity
    const getPrimaryKeyValue = (): string => {
        if (entityData.primary_key_properties && entityData.all_properties) {
            const pk = entityData.primary_key_properties
                .map(prop => entityData.all_properties[prop] || '')
                .join(' | ');
            if (pk) return pk;
        }
        if (entityData.primary_key) return entityData.primary_key;
        return entity.id;
    };
    
    const entityPk = getPrimaryKeyValue();
    
    // Helper function to generate composite node ID
    const generateNodeId = (entityType: string, primaryKey: string): string => {
        return `${entityType}::${primaryKey}`;
    };
    
    // Get all relations for this entity (ontology mode only)
    const getConnectedRelations = (): Array<{ relationId: string; relation: RelationData }> => {
        if (!showRelations || !allRelations) {
            return [];
        }
        
        const nodeId = entity.id;
        if (!nodeId) {
            return [];
        }
        
        const relations: Array<{ relationId: string; relation: RelationData }> = [];
        
        allRelations.forEach((relation, relationId) => {
            const fromEntityType = relation.from_entity?.entity_type;
            const fromPk = relation.from_entity?.primary_key;
            const toEntityType = relation.to_entity?.entity_type;
            const toPk = relation.to_entity?.primary_key;
            
            if (!fromEntityType || !fromPk || !toEntityType || !toPk) {
                return;
            }
            
            const sourceNodeId = generateNodeId(fromEntityType, fromPk);
            const targetNodeId = generateNodeId(toEntityType, toPk);
            
            if (sourceNodeId === nodeId || targetNodeId === nodeId) {
                relations.push({ relationId, relation });
            }
        });
        
        return relations;
    };
    
    const connectedRelations = getConnectedRelations();
    
    // Group relations by direction and sort by entity type
    const groupedRelations = connectedRelations.reduce((acc, { relationId, relation }) => {
        const fromEntityType = relation?.from_entity?.entity_type;
        const fromPk = relation?.from_entity?.primary_key;
        
        if (!fromEntityType || !fromPk) {
            return acc;
        }
        
        const sourceNodeId = generateNodeId(fromEntityType, fromPk);
        const isOutgoing = sourceNodeId === entity.id;
        
        if (isOutgoing) {
            acc.outgoing.push({ relationId, relation });
        } else {
            acc.incoming.push({ relationId, relation });
        }
        
        return acc;
    }, { outgoing: [] as Array<{ relationId: string; relation: RelationData }>, incoming: [] as Array<{ relationId: string; relation: RelationData }> });
    
    // Sort by entity type
    groupedRelations.outgoing.sort((a, b) => {
        const typeA = a.relation.to_entity?.entity_type || '';
        const typeB = b.relation.to_entity?.entity_type || '';
        return typeA.localeCompare(typeB);
    });
    
    groupedRelations.incoming.sort((a, b) => {
        const typeA = a.relation.from_entity?.entity_type || '';
        const typeB = b.relation.from_entity?.entity_type || '';
        return typeA.localeCompare(typeB);
    });
    
    // If parseRelationStatus is true, filter by evaluation status
    const filteredGroupedRelations = parseRelationStatus ? {
        outgoing: {
            accepted: groupedRelations.outgoing.filter(({ relation }) => {
                const relationProps = relation?.relation_properties || {};
                // Get evaluation data for this relation
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || (relation as any)?._ontology_relation_id 
                    || relation?.relation_pk;
                const evalData = evaluationsCache?.get(ontologyRelationId);
                // Only show non-sub-entity accepted relations
                return relationProps.eval_result === EvaluationResult.ACCEPTED && 
                       !evalData?.evaluation?.is_sub_entity_relation;
            }),
            other: groupedRelations.outgoing.filter(({ relation }) => {
                const relationProps = relation?.relation_properties || {};
                // Get evaluation data for this relation
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || (relation as any)?._ontology_relation_id 
                    || relation?.relation_pk;
                const evalData = evaluationsCache?.get(ontologyRelationId);
                // Show rejected/uncertain OR sub-entity relations
                return relationProps.eval_result !== EvaluationResult.ACCEPTED || 
                       evalData?.evaluation?.is_sub_entity_relation;
            })
        },
        incoming: {
            accepted: groupedRelations.incoming.filter(({ relation }) => {
                const relationProps = relation?.relation_properties || {};
                // Get evaluation data for this relation
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || (relation as any)?._ontology_relation_id 
                    || relation?.relation_pk;
                const evalData = evaluationsCache?.get(ontologyRelationId);
                // Only show non-sub-entity accepted relations
                return relationProps.eval_result === EvaluationResult.ACCEPTED && 
                       !evalData?.evaluation?.is_sub_entity_relation;
            }),
            other: groupedRelations.incoming.filter(({ relation }) => {
                const relationProps = relation?.relation_properties || {};
                // Get evaluation data for this relation
                const ontologyRelationId = relationProps?._ontology_relation_id 
                    || (relation as any)?._ontology_relation_id 
                    || relation?.relation_pk;
                const evalData = evaluationsCache?.get(ontologyRelationId);
                // Show rejected/uncertain OR sub-entity relations
                return relationProps.eval_result !== EvaluationResult.ACCEPTED || 
                       evalData?.evaluation?.is_sub_entity_relation;
            })
        }
    } : null;
    
    const totalOtherRelations = filteredGroupedRelations 
        ? (filteredGroupedRelations.outgoing.other.length + filteredGroupedRelations.incoming.other.length)
        : 0;
    
    // Data graph action handlers
    const handleExplore = () => {
        if (onExplore && entityData.entity_type && entityData.primary_key) {
            onExplore(entityData.entity_type, entityData.primary_key, 1);
            onClose();
        }
    };
    
    const handleFocus = () => {
        if (onFocus && entityData.entity_type && entityData.primary_key) {
            onFocus(entityData.entity_type, entityData.primary_key);
            onClose();
        }
    };
    
    // Toggle relation expansion
    const toggleRelation = (uniqueRelationId: string) => {
        setExpandedRelations(prev => {
            const newSet = new Set(prev);
            if (newSet.has(uniqueRelationId)) {
                newSet.delete(uniqueRelationId);
            } else {
                newSet.add(uniqueRelationId);
                // For fetching heuristics, we need the ontology relation ID
                // Extract it from the relation data
                if (mode === 'ontology' && allRelations) {
                    const relation = allRelations.get(uniqueRelationId);
                    if (relation) {
                        const relationProps = relation?.relation_properties || {};
                        const ontologyRelationId = relationProps?._ontology_relation_id 
                            || (relation as any)?._ontology_relation_id 
                            || relation?.relation_pk
                            || uniqueRelationId;
                        
                        if (!relationHeuristics.has(ontologyRelationId) && !loadingHeuristics.has(ontologyRelationId)) {
                            fetchRelationHeuristics(ontologyRelationId);
                        }
                    }
                }
            }
            return newSet;
        });
    };
    
    // Fetch heuristics for a relation (ontology mode only)
    const fetchRelationHeuristics = async (relationId: string) => {
        if (relationHeuristics.has(relationId)) {
            return;
        }
        
        if (heuristicsCache?.has(relationId)) {
            const cachedHeuristics = heuristicsCache.get(relationId);
            setRelationHeuristics(prev => {
                const newMap = new Map(prev);
                newMap.set(relationId, cachedHeuristics);
                return newMap;
            });
            return;
        }
        
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
    
    // Helper function to check if a property is internal
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
    
    // Render a single relation item
    const renderRelationItem = (relationId: string, relation: RelationData, isOutgoing: boolean) => {
        const relationData = relation;
        const relationProps = relationData?.relation_properties || {};
        
        // Create a unique ID for this specific relation instance using all four components
        // that make a relation unique: from, to, relation_id, and relation_name
        const fromEntityType = relationData?.from_entity?.entity_type || '';
        const fromPk = relationData?.from_entity?.primary_key || '';
        const toEntityType = relationData?.to_entity?.entity_type || '';
        const toPk = relationData?.to_entity?.primary_key || '';
        const relationName = relationProps.eval_relation_name || relationData?.relation_name || 'Unknown Relation';
        
        const uniqueRelationId = `${fromEntityType}::${fromPk}--${relationName}-->${toEntityType}::${toPk}::${relationId}`;
        
        // Get the ontology relation ID for API calls and heuristics lookup
        const ontologyRelationId = relationProps?._ontology_relation_id 
            || relationData?._ontology_relation_id 
            || relationData?.relation_pk
            || relationId;
            
        const isExpanded = expandedRelations.has(uniqueRelationId);
        const heuristics = relationHeuristics.get(ontologyRelationId);
        const evaluation = relationEvaluations.get(ontologyRelationId);
        const isLoadingHeur = loadingHeuristics.has(ontologyRelationId);
        
        const sourcePk = relationData?.from_entity?.primary_key;
        const targetPk = relationData?.to_entity?.primary_key;
        const neighborPk = isOutgoing ? targetPk : sourcePk;
        
        const neighborEntityType = isOutgoing 
            ? relationData?.to_entity?.entity_type 
            : relationData?.from_entity?.entity_type;
        const neighborColor = neighborEntityType ? getColorForNode(neighborEntityType) : '#gray';
        
        const hasEvaluation = relationProps.eval_last_evaluated !== undefined && 
                             relationProps.eval_last_evaluated !== null &&
                             relationProps.eval_last_evaluated > 0;
        const evalResult = relationProps.eval_result || 'Not Evaluated';
        
        // Get entity_a_property for display
        const cachedHeuristics = heuristicsCache?.get(ontologyRelationId) || heuristicsCache?.get(relationId);
        const cachedHeuristicData = cachedHeuristics?.heuristic || cachedHeuristics;
        
        let entityAProperty = 
            heuristics?.entity_a_property 
            || heuristics?.heuristic?.entity_a_property
            || cachedHeuristics?.entity_a_property
            || cachedHeuristicData?.entity_a_property
            || relationProps?.entity_a_property
            || relationData?.entity_a_property;
        
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
        
        if (!entityAProperty && cachedHeuristicData?.property_mappings && Array.isArray(cachedHeuristicData.property_mappings) && cachedHeuristicData.property_mappings.length > 0) {
            entityAProperty = cachedHeuristicData.property_mappings[0].entity_a_property;
        }
        
        if (!entityAProperty && heuristics) {
            const heuristicData = heuristics.heuristic || heuristics;
            if (heuristicData?.property_mappings && Array.isArray(heuristicData.property_mappings) && heuristicData.property_mappings.length > 0) {
                entityAProperty = heuristicData.property_mappings[0].entity_a_property;
            }
        }
        
        return (
            <div key={uniqueRelationId} className="border border-gray-200 rounded bg-gray-50">
                <button
                    onClick={() => toggleRelation(uniqueRelationId)}
                    className="w-full flex items-center justify-between px-2 py-1 hover:bg-gray-100 text-left"
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                            {/* Show Entity Flow: EntityType → NeighborEntityType or NeighborEntityType ← EntityType */}
                            <span className="text-xs font-semibold text-gray-900 flex items-center gap-1 min-w-0">
                                {isOutgoing ? (
                                    <>
                                        <span 
                                            className="truncate"
                                            style={{ color: darkenColor(backgroundColor, 40) }}
                                        >
                                            {entityType}
                                        </span>
                                        <span className="text-gray-400 flex-shrink-0">→</span>
                                        <span 
                                            className="truncate"
                                            style={{ color: darkenColor(neighborColor, 40) }}
                                        >
                                            {neighborEntityType || 'Unknown'}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <span 
                                            className="truncate"
                                            style={{ color: darkenColor(neighborColor, 40) }}
                                        >
                                            {neighborEntityType || 'Unknown'}
                                        </span>
                                        <span className="text-gray-400 flex-shrink-0">→</span>
                                        <span 
                                            className="truncate"
                                            style={{ color: darkenColor(backgroundColor, 40) }}
                                        >
                                            {entityType}
                                        </span>
                                    </>
                                )}
                            </span>
                            {hasEvaluation ? (
                                <span className={`px-1 py-0.5 text-[9px] font-semibold rounded flex-shrink-0 ${
                                    evalResult === EvaluationResult.ACCEPTED ? 'bg-green-50 text-green-700' :
                                    evalResult === EvaluationResult.REJECTED ? 'bg-red-50 text-red-700' :
                                    'bg-yellow-50 text-yellow-700'
                                }`}>
                                    {evalResult}
                                </span>
                            ) : (
                                <span className="px-1 py-0.5 text-[9px] font-semibold rounded flex-shrink-0 bg-gray-50 text-gray-600">
                                    NOT EVALUATED
                                </span>
                            )}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 truncate flex items-center gap-1">
                            <span className="font-semibold">{relationName}</span>
                            {evaluation?.evaluation?.is_sub_entity_relation && (
                                <span className="px-1 py-0.5 text-[9px] font-semibold rounded flex-shrink-0 bg-indigo-50 text-indigo-700">
                                    Auto-accepted structural
                                </span>
                            )}
                        </div>
                    </div>
                    <span className="text-gray-400 text-xs ml-2 flex-shrink-0">
                        {isExpanded ? '▲' : '▼'}
                    </span>
                </button>
                
                {isExpanded && (
                    <div className="px-2 py-1.5 border-t border-gray-200 space-y-1.5 bg-white">
                        {/* Sub-entity relation banner */}
                        {evaluation?.evaluation?.is_sub_entity_relation && (
                            <div className="bg-indigo-50 border border-indigo-200 rounded px-2 py-1.5 text-xs text-indigo-800">
                                <div className="flex items-start gap-1.5">
                                    <span className="text-indigo-600 flex-shrink-0 mt-0.5">ℹ️</span>
                                    <span>
                                        This relation was auto-accepted as it's part of a JSON/YAML document structure
                                    </span>
                                </div>
                            </div>
                        )}
                        
                        <div className="space-y-0.5 text-xs">
                            {/* Full Entity Types */}
                            <div className="flex gap-2">
                                <span className="w-20 flex-shrink-0 text-gray-500">From Entity:</span>
                                <span 
                                    className="text-gray-900 font-medium break-all"
                                    style={{ color: isOutgoing ? darkenColor(backgroundColor, 40) : darkenColor(neighborColor, 40) }}
                                >
                                    {relation.from_entity?.entity_type || 'N/A'}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <span className="w-20 flex-shrink-0 text-gray-500">To Entity:</span>
                                <span 
                                    className="text-gray-900 font-medium break-all"
                                    style={{ color: isOutgoing ? darkenColor(neighborColor, 40) : darkenColor(backgroundColor, 40) }}
                                >
                                    {relation.to_entity?.entity_type || 'N/A'}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <span className="w-20 flex-shrink-0 text-gray-500">Relation:</span>
                                <span className="text-gray-900 font-semibold break-all">{relationName}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="w-20 flex-shrink-0 text-gray-500">Relation ID:</span>
                                <span className="text-gray-900 font-mono break-all">{ontologyRelationId}</span>
                            </div>
                            {show_related_node_pk && (() => {
                                // Try to get the related entity's data from the graph
                                const neighborNodeId = generateNodeId(neighborEntityType || '', neighborPk || '');
                                let relatedEntityData = null;
                                
                                if (graph && graph.hasNode(neighborNodeId)) {
                                    const nodeAttrs = graph.getNodeAttributes(neighborNodeId);
                                    relatedEntityData = nodeAttrs.entityData;
                                }
                                
                                // Extract primary key property values if available
                                let pkDisplay = neighborPk || 'N/A';
                                if (relatedEntityData?.primary_key_properties && relatedEntityData?.all_properties) {
                                    const pkValues = relatedEntityData.primary_key_properties
                                        .map((prop: string) => `${prop}: ${relatedEntityData.all_properties[prop] || 'N/A'}`)
                                        .join(', ');
                                    if (pkValues) {
                                        pkDisplay = pkValues;
                                    }
                                }
                                
                                return (
                                    <div className="flex gap-2">
                                        <span className="w-20 flex-shrink-0 text-gray-500">Related Node:</span>
                                        <span className="text-gray-900 font-mono text-[10px] break-all">{pkDisplay}</span>
                                    </div>
                                );
                            })()}
                            {parseRelationStatus && (
                                <div className="flex gap-2 items-center">
                                    <span className="w-20 flex-shrink-0 text-gray-500">Status:</span>
                                    {hasEvaluation ? (
                                        <span className={`px-1 py-0.5 text-[10px] font-semibold rounded ${
                                            evalResult === EvaluationResult.ACCEPTED ? 'bg-green-50 text-green-700' :
                                            evalResult === EvaluationResult.REJECTED ? 'bg-red-50 text-red-700' :
                                            'bg-yellow-50 text-yellow-700'
                                        }`}>
                                            {evalResult}
                                        </span>
                                    ) : (
                                        <span className="text-gray-900">Not Evaluated</span>
                                    )}
                                </div>
                            )}
                            {relationProps.heuristic_count !== undefined && (
                                <div className="flex gap-2">
                                    <span className="w-20 flex-shrink-0 text-gray-500">Match Count:</span>
                                    <span className="text-gray-900 font-medium">{relationProps.heuristic_count}</span>
                                </div>
                            )}
                        </div>
                        
                        {/* Property Mappings - Show BEFORE action buttons if heuristics available */}
                        {mode === 'ontology' && heuristics && !isLoadingHeur && !heuristics.error && (() => {
                            const heuristicData = heuristics.heuristic || heuristics;
                            return heuristicData?.property_mappings && heuristicData.property_mappings.length > 0;
                        })() && (
                            <div className="border-t border-gray-100 pt-1">
                                <div className="font-medium text-gray-700 text-xs mb-0.5">Property Mappings:</div>
                                <div className="space-y-0.5">
                                    {(() => {
                                        const heuristicData = heuristics.heuristic || heuristics;
                                        return heuristicData.property_mappings.map((mapping: any, idx: number) => {
                                            const keyColor = isOutgoing ? backgroundColor : neighborColor;
                                            const valueColor = isOutgoing ? neighborColor : backgroundColor;
                                            
                                            return (
                                                <div key={idx} className="text-xs">
                                                    <span 
                                                        className="font-medium"
                                                        style={{ color: darkenColor(keyColor, 40) }}
                                                    >
                                                        {mapping.entity_a_property || 'N/A'}
                                                    </span>
                                                    <span className="text-gray-400 mx-1">→</span>
                                                    <span 
                                                        className="font-medium"
                                                        style={{ color: darkenColor(valueColor, 40) }}
                                                    >
                                                        {mapping.entity_b_idkey_property || mapping.entity_b_property || 'N/A'}
                                                    </span>
                                                    {mapping.match_type && (
                                                        <span className="text-gray-600 ml-1 text-[10px]">
                                                            ({mapping.match_type})
                                                        </span>
                                                    )}
                                                    {mapping.value_match_quality !== undefined && (
                                                        <span className="text-gray-400 ml-1 text-[10px]">
                                                            q: {typeof mapping.value_match_quality === 'number' ? mapping.value_match_quality.toFixed(2) : mapping.value_match_quality}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>
                        )}
                        
                        {/* Evaluation Data - Collapsible section */}
                        {mode === 'ontology' && evaluation && evaluation.evaluation && (
                            <div className="border-t border-gray-100 pt-1.5 bg-blue-50/60 -mx-2 px-2 pb-1.5">
                                <button
                                    onClick={() => {
                                        const newSet = new Set(expandedEvaluations);
                                        if (newSet.has(uniqueRelationId)) {
                                            newSet.delete(uniqueRelationId);
                                        } else {
                                            newSet.add(uniqueRelationId);
                                        }
                                        setExpandedEvaluations(newSet);
                                    }}
                                    className="w-full flex items-center justify-between text-left hover:bg-blue-50 px-2 py-2 rounded transition-colors"
                                >
                                    <div className="font-medium text-blue-600 hover:text-blue-700 text-xs underline decoration-dotted underline-offset-2">
                                        Evaluation Details
                                    </div>
                                    <span className="text-blue-500 text-xs ml-2 flex-shrink-0">
                                        {expandedEvaluations.has(uniqueRelationId) ? '▲' : '▼'}
                                    </span>
                                </button>
                                
                                {expandedEvaluations.has(uniqueRelationId) && (
                                    <div className="mt-0.5">
                                        <div className="space-y-0.5 text-xs">
                                            <div className="flex gap-2">
                                                <span className="w-20 flex-shrink-0 text-gray-500">Result:</span>
                                                <span className={`font-semibold ${
                                                    evaluation.evaluation.result === 'ACCEPTED' ? 'text-green-700' :
                                                    evaluation.evaluation.result === 'REJECTED' ? 'text-red-700' :
                                                    'text-yellow-700'
                                                }`}>
                                                    {evaluation.evaluation.result}
                                                </span>
                                            </div>
                                            {evaluation.evaluation.relation_name && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Rel. Name:</span>
                                                    <span className="text-gray-900 font-medium">{evaluation.evaluation.relation_name}</span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.directionality && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Direction:</span>
                                                    <span className="text-gray-900">{evaluation.evaluation.directionality}</span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.is_manual !== undefined && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Is Manual:</span>
                                                    <span className={`font-medium ${evaluation.evaluation.is_manual ? 'text-blue-700' : 'text-gray-700'}`}>
                                                        {evaluation.evaluation.is_manual ? 'Yes' : 'No'}
                                                    </span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.is_sub_entity_relation !== undefined && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Sub-Entity:</span>
                                                    <span className="text-gray-900">{evaluation.evaluation.is_sub_entity_relation ? 'Yes' : 'No'}</span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.last_evaluated && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Evaluated:</span>
                                                    <span className="text-gray-900 text-[10px]">{formatDate(evaluation.evaluation.last_evaluated * 1000)}</span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.justification && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Justification:</span>
                                                    <span className="text-gray-900 text-[10px] italic break-words">{evaluation.evaluation.justification}</span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.thought && (
                                                <div className="flex gap-2">
                                                    <span className="w-20 flex-shrink-0 text-gray-500">Thought:</span>
                                                    <span className="text-gray-900 text-[10px] italic break-words">{evaluation.evaluation.thought}</span>
                                                </div>
                                            )}
                                            {evaluation.evaluation.property_mappings && evaluation.evaluation.property_mappings.length > 0 && (
                                                <div className="mt-1">
                                                    <div className="text-gray-500 mb-0.5">Eval Property Mappings:</div>
                                                    <div className="space-y-0.5 pl-2">
                                                        {evaluation.evaluation.property_mappings.map((mapping: any, idx: number) => {
                                                            const keyColor = isOutgoing ? backgroundColor : neighborColor;
                                                            const valueColor = isOutgoing ? neighborColor : backgroundColor;
                                                            
                                                            return (
                                                                <div key={idx} className="text-xs">
                                                                    <span 
                                                                        className="font-medium"
                                                                        style={{ color: darkenColor(keyColor, 40) }}
                                                                    >
                                                                        {mapping.entity_a_property || 'N/A'}
                                                                    </span>
                                                                    <span className="text-gray-400 mx-1">→</span>
                                                                    <span 
                                                                        className="font-medium"
                                                                        style={{ color: darkenColor(valueColor, 40) }}
                                                                    >
                                                                        {mapping.entity_b_idkey_property || 'N/A'}
                                                                    </span>
                                                                    {mapping.match_type && (
                                                                        <span className="text-gray-600 ml-1 text-[10px]">
                                                                            ({mapping.match_type})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Sync Status */}
                                        {evaluation.sync_status && (
                                            <div className="mt-1 pt-1 border-t border-gray-50">
                                                <div className="text-gray-500 text-xs mb-0.5">Sync Status:</div>
                                                <div className="space-y-0.5 text-xs">
                                                    <div className="flex gap-2">
                                                        <span className="w-20 flex-shrink-0 text-gray-500">Is Synced:</span>
                                                        <span className={`font-medium ${
                                                            evaluation.sync_status.is_synced ? 'text-green-700' : 'text-orange-700'
                                                        }`}>
                                                            {evaluation.sync_status.is_synced ? 'Yes' : 'No'}
                                                        </span>
                                                    </div>
                                                    {evaluation.sync_status.last_synced && (
                                                        <div className="flex gap-2">
                                                            <span className="w-20 flex-shrink-0 text-gray-500">Last Synced:</span>
                                                            <span className="text-gray-900 text-[10px]">{formatDate(evaluation.sync_status.last_synced * 1000)}</span>
                                                        </div>
                                                    )}
                                                    {evaluation.sync_status.error_message && (
                                                        <div className="flex gap-2">
                                                            <span className="w-20 flex-shrink-0 text-gray-500">Error:</span>
                                                            <span className="text-red-700 text-[10px]">{evaluation.sync_status.error_message}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Heuristics Data - Collapsible section, only in ontology mode */}
                        {mode === 'ontology' && (heuristics || isLoadingHeur) && (
                            <div className="border-t border-gray-100 pt-1.5 bg-purple-50/60 -mx-2 px-2 pb-1.5">
                                <button
                                    onClick={() => {
                                        const newSet = new Set(expandedHeuristics);
                                        if (newSet.has(uniqueRelationId)) {
                                            newSet.delete(uniqueRelationId);
                                        } else {
                                            newSet.add(uniqueRelationId);
                                        }
                                        setExpandedHeuristics(newSet);
                                    }}
                                    className="w-full flex items-center justify-between text-left hover:bg-blue-50 px-2 py-2 rounded transition-colors"
                                >
                                    <div className="font-medium text-blue-600 hover:text-blue-700 text-xs underline decoration-dotted underline-offset-2">
                                        Fuzzy Match Metrics
                                    </div>
                                    <span className="text-blue-500 text-xs ml-2 flex-shrink-0">
                                        {expandedHeuristics.has(uniqueRelationId) ? '▲' : '▼'}
                                    </span>
                                </button>
                                
                                {expandedHeuristics.has(uniqueRelationId) && (
                                    <div className="mt-0.5">
                                        {isLoadingHeur && (
                                            <div className="flex items-center gap-1.5 pt-1">
                                                <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                <span className="text-gray-600 text-xs">Loading heuristics...</span>
                                            </div>
                                        )}
                                        
                                        {!isLoadingHeur && heuristics && !heuristics.error && (
                                            <>
                                                {(() => {
                                                    const heuristicData = heuristics.heuristic || heuristics;
                                                    const totalMatches = heuristicData?.total_matches ?? heuristicData?.count;
                                                    
                                                    return (
                                                        <>
                                                            {totalMatches !== undefined && (
                                                                <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-1">
                                                                    <span className="text-gray-500">Total Matches:</span>
                                                                    <span className="font-semibold text-gray-900">{totalMatches}</span>
                                                                </div>
                                                            )}
                                                            
                                                            {/* Property Match Patterns - Detailed per-mapping info */}
                                                            {heuristicData?.property_match_patterns && Object.keys(heuristicData.property_match_patterns).length > 0 && (
                                                                <div className="border-t border-gray-100 pt-1">
                                                                    <div className="font-medium text-gray-700 text-xs mb-0.5">Property Mappings Details:</div>
                                                                    <div className="space-y-1">
                                                                        {Object.entries(heuristicData.property_match_patterns).map(([pattern, matchTypes]: [string, any], idx: number) => {
                                                                            // Split pattern by "->" to get entity_a and entity_b properties
                                                                            const [entityAProp, entityBProp] = pattern.split('->').map(p => p.trim());
                                                                            
                                                                            // Get quality data for this pattern
                                                                            const qualityData = heuristicData.property_match_quality?.[pattern] || {};
                                                                            
                                                                            const keyColor = isOutgoing ? backgroundColor : neighborColor;
                                                                            const valueColor = isOutgoing ? neighborColor : backgroundColor;
                                                                            
                                                                            return (
                                                                                <div key={idx} className="bg-gray-50 p-1.5 rounded border border-gray-200">
                                                                                    {/* Property mapping display */}
                                                                                    <div className="text-xs mb-1">
                                                                                        <span 
                                                                                            className="font-medium"
                                                                                            style={{ color: darkenColor(keyColor, 40) }}
                                                                                        >
                                                                                            {entityAProp || 'N/A'}
                                                                                        </span>
                                                                                        <span className="text-gray-400 mx-1">→</span>
                                                                                        <span 
                                                                                            className="font-medium"
                                                                                            style={{ color: darkenColor(valueColor, 40) }}
                                                                                        >
                                                                                            {entityBProp || 'N/A'}
                                                                                        </span>
                                                                                    </div>
                                                                                    
                                                                                    {/* Match types and counts */}
                                                                                    <div className="space-y-0.5 pl-2">
                                                                                        {Object.entries(matchTypes).map(([matchType, count]: [string, any]) => {
                                                                                            // Clean up match type (remove "ValueMatchType." prefix)
                                                                                            const cleanMatchType = matchType.replace('ValueMatchType.', '').toLowerCase();
                                                                                            const quality = qualityData[matchType];
                                                                                            
                                                                                            return (
                                                                                                <div key={matchType} className="flex items-center justify-end text-[10px] gap-2">
                                                                                                    <span className="text-gray-900 font-medium">
                                                                                                        {String(count)} matches
                                                                                                    </span>
                                                                                                    <span className="text-gray-600">
                                                                                                        ({cleanMatchType})
                                                                                                    </span>
                                                                                                    {quality !== undefined && (
                                                                                                        <span className="text-blue-600 font-medium">
                                                                                                            q: {typeof quality === 'number' ? quality.toFixed(2) : quality}
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {(heuristicData?.value_match_quality_avg !== undefined || heuristicData?.deep_match_quality_avg !== undefined || heuristicData?.match_type_counts || heuristicData?.quality_metrics) && (
                                                                <div className="border-t border-gray-100 pt-1">
                                                                    <div className="font-medium text-gray-700 text-xs mb-0.5">Overall Quality Metrics:</div>
                                                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                                                        {heuristicData.value_match_quality_avg !== undefined && (
                                                                            <div className="flex items-center justify-between text-xs">
                                                                                <span className="text-gray-500">Value Match:</span>
                                                                                <span className="font-medium text-gray-900">
                                                                                    {typeof heuristicData.value_match_quality_avg === 'number' ? heuristicData.value_match_quality_avg.toFixed(2) : String(heuristicData.value_match_quality_avg)}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        {heuristicData.deep_match_quality_avg !== undefined && (
                                                                            <div className="flex items-center justify-between text-xs">
                                                                                <span className="text-gray-500">Deep Match:</span>
                                                                                <span className="font-medium text-gray-900">
                                                                                    {typeof heuristicData.deep_match_quality_avg === 'number' ? heuristicData.deep_match_quality_avg.toFixed(2) : String(heuristicData.deep_match_quality_avg)}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        {heuristicData.match_type_counts && Object.entries(heuristicData.match_type_counts).map(([key, value]) => (
                                                                            <div key={key} className="flex items-center justify-between text-xs">
                                                                                <span className="text-gray-500 truncate">{key.replace(/_/g, ' ')}:</span>
                                                                                <span className="font-medium text-gray-900">
                                                                                    {String(value)}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                        {heuristicData.quality_metrics && Object.entries(heuristicData.quality_metrics).map(([key, value]) => (
                                                                            <div key={key} className="flex items-center justify-between text-xs">
                                                                                <span className="text-gray-500 truncate">{key.replace(/_/g, ' ')}:</span>
                                                                                <span className="font-medium text-gray-900">
                                                                                    {typeof value === 'number' ? value.toFixed(2) : String(value)}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {heuristicData?.example_matches && heuristicData.example_matches.length > 0 && (
                                                                <div className="border-t border-gray-100 pt-1">
                                                                    <button
                                                                        onClick={() => {
                                                                            const newSet = new Set(expandedExampleMatches);
                                                                            if (newSet.has(uniqueRelationId)) {
                                                                                newSet.delete(uniqueRelationId);
                                                                            } else {
                                                                                newSet.add(uniqueRelationId);
                                                                            }
                                                                            setExpandedExampleMatches(newSet);
                                                                        }}
                                                                        className="w-full flex items-center justify-between text-left hover:bg-gray-50 px-1 rounded"
                                                                    >
                                                                        <div className="font-medium text-gray-700 text-xs">Example Matches:</div>
                                                                        <span className="text-gray-400 text-[10px]">
                                                                            {expandedExampleMatches.has(uniqueRelationId) ? '▲' : '▼'}
                                                                        </span>
                                                                    </button>
                                                                    {expandedExampleMatches.has(uniqueRelationId) && (
                                                                        <div className="space-y-0.5 mt-0.5">
                                                                            {heuristicData.example_matches.map((match: any, idx: number) => (
                                                                                <div key={idx} className="text-xs pl-2">
                                                                                    <span className="font-medium text-gray-900">{match.entity_a_pk || 'N/A'}</span>
                                                                                    <span className="text-gray-400 mx-1">→</span>
                                                                                    <span className="font-medium text-gray-900">{match.entity_b_pk || 'N/A'}</span>
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
                                        
                                        {!isLoadingHeur && heuristics?.error && (
                                            <div className="bg-red-50 px-1.5 py-1 rounded border border-red-100 text-xs text-red-700">
                                                ⚠️ {heuristics.error}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Action Buttons - Only in ontology mode with handlers */}
                        {mode === 'ontology' && onEvaluate && onAccept && onReject && (
                            <div className="border-t border-gray-100 pt-1">
                                <div className="font-medium text-gray-700 text-xs mb-1">Actions:</div>
                                <div className="flex flex-wrap gap-1">
                                <button
                                    onClick={() => onEvaluate(ontologyRelationId)}
                                    disabled={isLoading || !ontologyRelationId}
                                    className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium py-0.5 px-1.5 rounded text-xs"
                                >
                                    {isLoading ? 'Evaluating...' : 'Re-Evaluate'}
                                </button>
                                {!hasEvaluation && (
                                    <>
                                        <button
                                            onClick={() => onAccept(ontologyRelationId, relationName)}
                                            disabled={isLoading || !ontologyRelationId}
                                            className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white font-medium py-0.5 px-1.5 rounded text-xs"
                                        >
                                            {isLoading ? 'Processing...' : 'Accept'}
                                        </button>
                                        <button
                                            onClick={() => onReject(ontologyRelationId)}
                                            disabled={isLoading || !ontologyRelationId}
                                            className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-medium py-0.5 px-1.5 rounded text-xs"
                                        >
                                            {isLoading ? 'Processing...' : 'Reject'}
                                        </button>
                                    </>
                                )}
                                {hasEvaluation && onUndoEvaluation && (
                                    <button
                                        onClick={() => onUndoEvaluation(ontologyRelationId)}
                                        disabled={isLoading || !ontologyRelationId}
                                        className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium py-0.5 px-1.5 rounded text-xs"
                                    >
                                        {isLoading ? 'Processing...' : 'Undo'}
                                    </button>
                                )}
                                {onSync && (
                                    <button
                                        onClick={() => onSync(ontologyRelationId)}
                                        disabled={isLoading || !ontologyRelationId}
                                        className="bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-medium py-0.5 px-1.5 rounded text-xs"
                                    >
                                        {isLoading ? 'Syncing...' : 'Sync'}
                                    </button>
                                )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };
    
    return (
        <div className="absolute top-0 left-2 w-[600px] bg-white border border-gray-300 rounded shadow-lg z-20 flex flex-col overflow-hidden" style={{ height: 'calc(100% - 20px)', maxHeight: 'calc(100% - 20px)' }}>
            {/* Header */}
            <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0 bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div 
                            style={{ 
                                width: '16px', 
                                height: '16px', 
                                borderRadius: '50%', 
                                backgroundColor,
                                flexShrink: 0
                            }} 
                        />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-500 uppercase">
                                {mode === 'ontology' ? 'Ontology Entity' : 'Data Entity'}
                            </div>
                            <div 
                                className="text-sm font-semibold truncate" 
                                style={{ 
                                    color: darkenColor(backgroundColor, 40)
                                }}
                            >
                                {entityType}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Data mode action buttons */}
                        {mode === 'data' && onExplore && (
                            <button 
                                onClick={handleExplore}
                                className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white"
                                title="Add this entity's neighbors to the graph"
                            >
                                Explore
                            </button>
                        )}
                        {mode === 'data' && onFocus && (
                            <button 
                                onClick={handleFocus}
                                className="px-2 py-1 text-xs rounded bg-purple-500 hover:bg-purple-600 text-white"
                                title="Clear graph and focus on this entity"
                            >
                                Focus
                            </button>
                        )}
                        <button 
                            onClick={onClose} 
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900 text-sm"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Action Result Status - Only in ontology mode */}
            {mode === 'ontology' && actionResult && (
                <div className={`mx-2 mt-2 px-2 py-1.5 rounded text-xs flex-shrink-0 ${
                    actionResult.type === 'success' 
                        ? 'bg-green-50 border border-green-200 text-green-800' 
                        : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                    <div className="flex items-center gap-2">
                        <span className="text-xs">
                            {actionResult.type === 'success' ? '✓' : '✗'}
                        </span>
                        <span className="flex-1">{actionResult.message}</span>
                        {onClearActionResult && (
                            <button 
                                onClick={onClearActionResult}
                                className="hover:opacity-70 text-sm leading-none"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>
            )}
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-2 min-h-0">
                <div className="space-y-2">
                    {/* Primary Keys Section */}
                    {entityData.primary_key_properties && entityData.primary_key_properties.length > 0 && (
                        <div className="border-b border-gray-200 pb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Primary Keys</div>
                            <div className="space-y-0.5">
                                {entityData.primary_key_properties.map((key: string, index: number) => {
                                    const isEntityTypeName = key === 'entity_type_name' || key === '_entity_type_name';
                                    const value = entityData.all_properties?.[key] || 'N/A';
                                    
                                    return (
                                        <div key={index} className="text-xs grid grid-cols-[auto_1fr] gap-2 items-start">
                                            <span className="text-gray-500 whitespace-nowrap">{key}:</span>
                                            {isEntityTypeName && mode === 'ontology' ? (
                                                <span 
                                                    className="font-semibold break-all"
                                                    style={{ color: darkenColor(backgroundColor, 40) }}
                                                >
                                                    {value}
                                                </span>
                                            ) : (
                                                <span className="text-gray-900 font-medium break-all">
                                                    {value}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                                <div className="text-xs grid grid-cols-[auto_1fr] gap-2 items-start mt-1 pt-1 border-t border-gray-100">
                                    <span className="text-gray-500 whitespace-nowrap">
                                        {mode === 'ontology' ? 'Primary Key:' : 'Generated PK:'}
                                    </span>
                                    <span className="text-gray-900 font-mono text-[10px] break-all">{entityPk}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Expiry Section - Only in data mode */}
                    {mode === 'data' && entityData._fresh_until && (
                        <div className="border-b border-gray-200 pb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Data Freshness</div>
                            <div className="space-y-0.5">
                                <div className="text-xs flex justify-between">
                                    <span className="text-gray-500">Status:</span>
                                    <span className={`font-medium ${getExpiryStatus(entityData._fresh_until).color}`}>
                                        {getExpiryStatus(entityData._fresh_until).status}
                                    </span>
                                </div>
                                <div className="text-xs flex justify-between">
                                    <span className="text-gray-500">Fresh Until:</span>
                                    <span className="text-gray-900 text-[10px]">{formatDate(entityData._fresh_until)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Additional Key Properties Section */}
                    {entityData.additional_key_properties && entityData.additional_key_properties.length > 0 && (
                        <div className="border-b border-gray-200 pb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Additional Key Properties</div>
                            <div className="space-y-2">
                                {entityData.additional_key_properties.map((keyGroup: string[], groupIndex: number) => (
                                    <div key={groupIndex} className={groupIndex > 0 ? "pt-2 border-t border-gray-200" : ""}>
                                        <div className="space-y-0.5">
                                            {keyGroup.map((key: string, keyIndex: number) => (
                                                <div key={keyIndex} className="text-xs grid grid-cols-[auto_1fr] gap-2 items-start">
                                                    <span className="text-gray-500 whitespace-nowrap">{key}:</span>
                                                    <span className="text-gray-900 font-medium break-all">
                                                        {entityData.all_properties?.[key] || 'N/A'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* All Properties Section */}
                    <div className="border-b border-gray-200 pb-2">
                        <button
                            onClick={() => setIsAllPropertiesCollapsed(!isAllPropertiesCollapsed)}
                            className="flex items-center justify-between w-full text-left hover:bg-gray-50 px-1 py-0.5 rounded"
                        >
                            <div className="text-xs font-semibold text-gray-500 uppercase">
                                All Properties ({Object.keys(entityData.all_properties || {}).filter(key => !isInternalProperty(key)).length})
                            </div>
                            <span className="text-gray-400 text-xs">
                                {isAllPropertiesCollapsed ? '▼' : '▲'}
                            </span>
                        </button>
                        {!isAllPropertiesCollapsed && (
                            <div className="mt-1.5 space-y-2">
                                {/* Regular (non-internal) properties */}
                                <div className="space-y-0.5">
                                    {Object.entries(entityData.all_properties || {})
                                        .filter(([key]) => !isInternalProperty(key))
                                        .map(([key, value]) => (
                                        <div key={key} className="text-xs grid grid-cols-[120px_1fr] gap-2 items-start">
                                            <div className="text-gray-500 break-words">
                                                <span>
                                                    {key}
                                                    {entityData.primary_key_properties?.includes(key) && (
                                                        <span className="ml-1 px-1 bg-blue-50 text-blue-600 text-[9px] rounded">PK</span>
                                                    )}
                                                </span>
                                                :
                                            </div>
                                            <div className="min-w-0">
                                                {typeof value === 'object' ? (
                                                    <pre className="text-[10px] text-gray-900 font-mono bg-gray-50 px-1 rounded overflow-auto max-h-16">
                                                        {JSON.stringify(value, null, 2)}
                                                    </pre>
                                                ) : (
                                                    <span className="text-gray-900 break-words">
                                                        {mode === 'ontology' ? renderPropertyValue(value) : (value?.toString() || 'N/A')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                
                                {/* Internal properties collapsible section */}
                                {Object.keys(entityData.all_properties || {}).filter(key => isInternalProperty(key)).length > 0 && (
                                    <div className="border-t border-gray-200 pt-2">
                                        <button
                                            onClick={() => setIsInternalPropertiesCollapsed(!isInternalPropertiesCollapsed)}
                                            className="flex items-center justify-between w-full text-left hover:bg-gray-50 px-1 py-0.5 rounded"
                                        >
                                            <div className="text-xs font-medium text-gray-500">
                                                Internal Properties ({Object.keys(entityData.all_properties || {}).filter(key => isInternalProperty(key)).length})
                                            </div>
                                            <span className="text-gray-400 text-xs">
                                                {isInternalPropertiesCollapsed ? '▼' : '▲'}
                                            </span>
                                        </button>
                                        {!isInternalPropertiesCollapsed && (
                                            <div className="mt-1 space-y-0.5">
                                                {Object.entries(entityData.all_properties || {})
                                                    .filter(([key]) => isInternalProperty(key))
                                                    .map(([key, value]) => (
                                                    <div key={key} className="text-xs grid grid-cols-[120px_1fr] gap-2 items-start">
                                                        <div className="text-gray-500 break-words">
                                                            <span className="font-mono text-[10px]">
                                                                {key}
                                                                {entityData.primary_key_properties?.includes(key) && (
                                                                    <span className="ml-1 px-1 bg-blue-50 text-blue-600 text-[9px] rounded">PK</span>
                                                                )}
                                                            </span>
                                                            :
                                                        </div>
                                                        <div className="min-w-0">
                                                            {typeof value === 'object' ? (
                                                                <pre className="text-[10px] text-gray-900 font-mono bg-gray-50 px-1 rounded overflow-auto max-h-16">
                                                                    {JSON.stringify(value, null, 2)}
                                                                </pre>
                                                            ) : (
                                                                <span className="text-gray-900 break-words font-mono text-[10px]">
                                                                    {mode === 'ontology' ? renderPropertyValue(value) : (value?.toString() || 'N/A')}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {/* Relations Section - Only when showRelations is true */}
                    {showRelations && (
                        <div className="border-b border-gray-200 pb-2">
                            {connectedRelations.length > 3 ? (
                                // Collapsible header for > 3 relations
                                <button
                                    onClick={() => setIsRelationsSectionCollapsed(!isRelationsSectionCollapsed)}
                                    className="flex items-center justify-between w-full text-left hover:bg-gray-50 px-1 py-0.5 rounded mb-1.5"
                                >
                                    <div className="text-xs font-semibold text-gray-500 uppercase">
                                        Relations ({connectedRelations.length})
                                        {!allRelations && <span className="text-red-600 ml-1 font-normal normal-case">(not available)</span>}
                                    </div>
                                    <span className="text-gray-400 text-xs">
                                        {isRelationsSectionCollapsed ? '▼' : '▲'}
                                    </span>
                                </button>
                            ) : (
                                // Static header for <= 3 relations
                                <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                                    Relations ({connectedRelations.length})
                                    {!allRelations && <span className="text-red-600 ml-1 font-normal normal-case">(not available)</span>}
                                </div>
                            )}
                            {connectedRelations.length === 0 ? (
                                <div className="text-xs text-gray-400 italic">
                                    No relations found
                                </div>
                            ) : (
                                (!isRelationsSectionCollapsed || connectedRelations.length <= 3) && (
                                    <div className="space-y-2">
                                    {/* Show accepted relations first if parseRelationStatus is true */}
                                    {parseRelationStatus && filteredGroupedRelations ? (
                                        <>
                                            {(filteredGroupedRelations.outgoing.accepted.length > 0 || filteredGroupedRelations.incoming.accepted.length > 0) && (
                                                <>
                                                    {filteredGroupedRelations.outgoing.accepted.length > 0 && (
                                                        <div>
                                                            <div className="text-[10px] text-gray-400 uppercase mb-1">
                                                                Outgoing - Accepted ({filteredGroupedRelations.outgoing.accepted.length})
                                                            </div>
                                                            <div className="space-y-1">
                                                                {filteredGroupedRelations.outgoing.accepted.map(({ relationId, relation }) => {
                                                                    return renderRelationItem(relationId, relation, true);
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                    
                                                    {filteredGroupedRelations.incoming.accepted.length > 0 && (
                                                        <div>
                                                            <div className="text-[10px] text-gray-400 uppercase mb-1">
                                                                Incoming - Accepted ({filteredGroupedRelations.incoming.accepted.length})
                                                            </div>
                                                            <div className="space-y-1">
                                                                {filteredGroupedRelations.incoming.accepted.map(({ relationId, relation }) => {
                                                                    return renderRelationItem(relationId, relation, false);
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            
                                            {/* Other relations (not accepted) - collapsible */}
                                            {totalOtherRelations > 0 && (
                                                <div className="border-t border-gray-200 pt-2">
                                                    <button
                                                        onClick={() => setShowNonAcceptedRelations(!showNonAcceptedRelations)}
                                                        className="w-full flex items-center justify-between text-left hover:bg-gray-50 px-1 py-0.5 rounded"
                                                    >
                                                        <div className="text-xs font-semibold text-gray-500 uppercase">
                                                            Other Relations - Structural, Rejected, Uncertain ({totalOtherRelations})
                                                        </div>
                                                        <span className="text-gray-400 text-xs">
                                                            {showNonAcceptedRelations ? '▲' : '▼'}
                                                        </span>
                                                    </button>
                                                    {showNonAcceptedRelations && (
                                                        <div className="space-y-2 mt-1">
                                                            {filteredGroupedRelations.outgoing.other.length > 0 && (
                                                                <div>
                                                                    <div className="text-[10px] text-gray-400 uppercase mb-1">
                                                                        Outgoing ({filteredGroupedRelations.outgoing.other.length})
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        {filteredGroupedRelations.outgoing.other.map(({ relationId, relation }) => {
                                                                            return renderRelationItem(relationId, relation, true);
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {filteredGroupedRelations.incoming.other.length > 0 && (
                                                                <div>
                                                                    <div className="text-[10px] text-gray-400 uppercase mb-1">
                                                                        Incoming ({filteredGroupedRelations.incoming.other.length})
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        {filteredGroupedRelations.incoming.other.map(({ relationId, relation }) => {
                                                                            return renderRelationItem(relationId, relation, false);
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            {groupedRelations.outgoing.length > 0 && (
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase mb-1">
                                                        Outgoing ({groupedRelations.outgoing.length})
                                                    </div>
                                                    <div className="space-y-1">
                                                        {groupedRelations.outgoing.map(({ relationId, relation }) => {
                                                            return renderRelationItem(relationId, relation, true);
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {groupedRelations.incoming.length > 0 && (
                                                <div>
                                                    <div className="text-[10px] text-gray-400 uppercase mb-1">
                                                        Incoming ({groupedRelations.incoming.length})
                                                    </div>
                                                    <div className="space-y-1">
                                                        {groupedRelations.incoming.map(({ relationId, relation }) => {
                                                            return renderRelationItem(relationId, relation, false);
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                )
                            )}
                        </div>
                    )}
                    
                    {/* Raw Entity Data Section */}
                    <div>
                        <button
                            onClick={() => setIsRawDataCollapsed(!isRawDataCollapsed)}
                            className="flex items-center justify-between w-full text-left hover:bg-gray-50 px-1 py-0.5 rounded"
                        >
                            <div className="text-xs font-semibold text-gray-500 uppercase">Raw Entity Data</div>
                            <span className="text-gray-400 text-xs">
                                {isRawDataCollapsed ? '▼' : '▲'}
                            </span>
                        </button>
                        {!isRawDataCollapsed && (
                            <pre className="mt-1.5 text-[10px] bg-gray-50 px-2 py-1.5 rounded border border-gray-200 overflow-auto max-h-48 font-mono">
                                {JSON.stringify(entity.data, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}


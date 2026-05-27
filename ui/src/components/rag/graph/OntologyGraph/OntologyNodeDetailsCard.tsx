"use client";

import React, { useState, useCallback } from 'react';
import { MultiDirectedGraph } from 'graphology';
import { X, ChevronDown, ChevronRight, Settings2, Loader2, RefreshCw, Check, XIcon, RotateCcw, ArrowLeftRight } from 'lucide-react';
import { getColorForNode } from '../shared/graphStyles';
import { 
    evaluateOntologyRelation, 
    acceptOntologyRelation, 
    rejectOntologyRelation, 
    undoOntologyRelationEvaluation,
    syncOntologyRelation,
    getOntologyRelationHeuristicsBatch,
    getOntologyRelationEvaluationsBatch
} from '../../api';
import { useRagPermissions, Permission } from '@/hooks/useRagPermissions';

interface OntologyNodeDetailsCardProps {
    nodeId: string;
    nodeData: any;
    graph: MultiDirectedGraph;
    onClose: () => void;
    advancedMode?: boolean;
    onToggleAdvanced?: () => void;
    onRefreshGraph?: () => void;
}

interface RelationInfo {
    label: string;
    entityType: string;
    entityColor: string;
    evaluationResult?: string;
    isOutgoing: boolean;
    edgeId: string;
    relationIds: string[];
}

export default function OntologyNodeDetailsCard({
    nodeId,
    nodeData,
    graph,
    onClose,
    advancedMode = false,
    onToggleAdvanced,
    onRefreshGraph
}: OntologyNodeDetailsCardProps) {
    const { hasPermission } = useRagPermissions();
    
    const [showRejected, setShowRejected] = useState(false);
    const [showProperties, setShowProperties] = useState(false);
    const [showInternal, setShowInternal] = useState(false);
    const [showRawData, setShowRawData] = useState(false);
    const [showPrimaryKeys, setShowPrimaryKeys] = useState(false);
    
    // Expanded relation state (for Advanced mode)
    const [expandedRelationId, setExpandedRelationId] = useState<string | null>(null);
    const [relationDetails, setRelationDetails] = useState<{
        heuristics?: any[];
        evaluations?: any[];
        rawHeuristics?: any;
        rawEvaluations?: any;
        loading: boolean;
        error?: string;
    }>({ loading: false });
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [showRawRelationData, setShowRawRelationData] = useState(false);

    const entityData = nodeData.entityData || nodeData;
    const entityType = entityData?.entity_type || nodeData.entityType || 'Entity';
    const nodeColor = nodeData.color || getColorForNode(entityType);

    // Get all properties
    const allProperties = entityData?.all_properties || {};
    
    // Get primary key properties (for Advanced mode)
    const primaryKeyProperties = entityData?.primary_key_properties || [];
    
    // Filter properties - in ontology graph, values are arrays
    const displayProperties = Object.entries(allProperties).filter(
        ([key]) => !key.startsWith('_')
    );
    const internalProperties = Object.entries(allProperties).filter(
        ([key]) => key.startsWith('_')
    );

    // Collect all relations
    const allRelations: RelationInfo[] = [];

    graph.forEachOutEdge(nodeId, (edge, attributes, _source, target) => {
        const targetAttrs = graph.getNodeAttributes(target);
        const targetType = targetAttrs.entityType || 'Unknown';
        allRelations.push({
            label: attributes.label || 'related_to',
            entityType: targetType,
            entityColor: targetAttrs.color || getColorForNode(targetType),
            evaluationResult: attributes.evaluationResult,
            isOutgoing: true,
            edgeId: edge,
            relationIds: attributes.relationIds || []
        });
    });

    graph.forEachInEdge(nodeId, (edge, attributes, source) => {
        if (attributes.isBidirectional) return;
        const sourceAttrs = graph.getNodeAttributes(source);
        const sourceType = sourceAttrs.entityType || 'Unknown';
        allRelations.push({
            label: attributes.label || 'related_to',
            entityType: sourceType,
            entityColor: sourceAttrs.color || getColorForNode(sourceType),
            evaluationResult: attributes.evaluationResult,
            isOutgoing: false,
            edgeId: edge,
            relationIds: attributes.relationIds || []
        });
    });

    // Split into active and rejected
    const activeRelations = allRelations.filter(r => r.evaluationResult !== 'REJECTED');
    const rejectedRelations = allRelations.filter(r => r.evaluationResult === 'REJECTED');

    // Format property value (handles arrays)
    const formatValue = (value: any): string => {
        if (Array.isArray(value)) {
            return value.join(', ');
        }
        if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
        }
        return String(value ?? '');
    };

    // Handle expanding a relation to show details (Advanced mode only)
    const handleRelationClick = useCallback(async (rel: RelationInfo) => {
        if (!advancedMode) return;
        
        // Toggle expansion
        if (expandedRelationId === rel.edgeId) {
            setExpandedRelationId(null);
            setRelationDetails({ loading: false });
            setShowRawRelationData(false);
            return;
        }
        
        setExpandedRelationId(rel.edgeId);
        setRelationDetails({ loading: true });
        setShowRawRelationData(false);
        
        // Fetch heuristics and evaluations for this relation
        if (rel.relationIds.length > 0) {
            try {
                const [heuristicsResponse, evaluationsResponse] = await Promise.all([
                    getOntologyRelationHeuristicsBatch(rel.relationIds).catch((e) => {
                        console.error('Failed to fetch heuristics:', e);
                        return {};
                    }),
                    getOntologyRelationEvaluationsBatch(rel.relationIds).catch((e) => {
                        console.error('Failed to fetch evaluations:', e);
                        return {};
                    })
                ]);
                
                console.log('Heuristics response:', heuristicsResponse);
                console.log('Evaluations response:', evaluationsResponse);
                
                // Response structure is: { heuristics: { [relationId]: { ...heuristicData } }, evaluations: { [relationId]: { evaluation: {...}, sync_status: {...} } } }
                let heuristics: any[] = [];
                let evaluations: any[] = [];
                
                // Parse heuristics - keyed by relation ID
                const heuristicsData = (heuristicsResponse as any).heuristics || heuristicsResponse;
                if (heuristicsData && typeof heuristicsData === 'object') {
                    heuristics = Object.entries(heuristicsData).map(([relationId, data]: [string, any]) => ({
                        relationId,
                        ...data
                    }));
                }
                
                // Parse evaluations - keyed by relation ID, with nested evaluation object
                const evaluationsData = (evaluationsResponse as any).evaluations || evaluationsResponse;
                if (evaluationsData && typeof evaluationsData === 'object') {
                    evaluations = Object.entries(evaluationsData).map(([relationId, data]: [string, any]) => ({
                        relationId,
                        ...(data.evaluation || {}),
                        sync_status: data.sync_status
                    }));
                }
                
                setRelationDetails({
                    loading: false,
                    heuristics,
                    evaluations,
                    // Store raw responses for debugging
                    rawHeuristics: heuristicsResponse,
                    rawEvaluations: evaluationsResponse
                } as any);
            } catch (err) {
                console.error('Failed to load relation details:', err);
                setRelationDetails({ loading: false, error: 'Failed to load details' });
            }
        } else {
            setRelationDetails({ loading: false, error: 'No relation IDs available' });
        }
    }, [advancedMode, expandedRelationId]);

    // Relation action handlers
    const handleEvaluate = useCallback(async (relationId: string) => {
        setActionLoading('evaluate');
        try {
            await evaluateOntologyRelation(relationId);
            onRefreshGraph?.();
        } catch (err) {
            console.error('Failed to evaluate relation:', err);
        } finally {
            setActionLoading(null);
        }
    }, [onRefreshGraph]);

    const handleAccept = useCallback(async (relationId: string) => {
        setActionLoading('accept');
        try {
            await acceptOntologyRelation(relationId, '', []);
            onRefreshGraph?.();
        } catch (err) {
            console.error('Failed to accept relation:', err);
        } finally {
            setActionLoading(null);
        }
    }, [onRefreshGraph]);

    const handleReject = useCallback(async (relationId: string) => {
        setActionLoading('reject');
        try {
            await rejectOntologyRelation(relationId, 'Manually rejected');
            onRefreshGraph?.();
        } catch (err) {
            console.error('Failed to reject relation:', err);
        } finally {
            setActionLoading(null);
        }
    }, [onRefreshGraph]);

    const handleUndo = useCallback(async (relationId: string) => {
        setActionLoading('undo');
        try {
            await undoOntologyRelationEvaluation(relationId);
            onRefreshGraph?.();
        } catch (err) {
            console.error('Failed to undo evaluation:', err);
        } finally {
            setActionLoading(null);
        }
    }, [onRefreshGraph]);

    const handleSync = useCallback(async (relationId: string) => {
        setActionLoading('sync');
        try {
            await syncOntologyRelation(relationId);
            onRefreshGraph?.();
        } catch (err) {
            console.error('Failed to sync relation:', err);
        } finally {
            setActionLoading(null);
        }
    }, [onRefreshGraph]);

    // Evaluation badge
    const EvalBadge = ({ result }: { result?: string }) => {
        if (!result || result === 'REJECTED') return null;
        const styles: Record<string, string> = {
            'ACCEPTED': 'bg-green-500/20 text-green-600',
            'UNSURE': 'bg-orange-500/20 text-orange-600'
        };
        const icons: Record<string, string> = {
            'ACCEPTED': '✓',
            'UNSURE': '?'
        };
        return (
            <span className={`px-1 text-[10px] font-bold rounded ${styles[result] || ''}`}>
                {icons[result] || ''}
            </span>
        );
    };

    // Entity chip component
    const EntityChip = ({ type, color, isSelf }: { type: string; color: string; isSelf?: boolean }) => (
        <span 
            className="inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap"
            style={{ color: isSelf ? undefined : color }}
        >
            <span 
                className="w-2 h-2 rounded-full inline-block shrink-0" 
                style={{ backgroundColor: color }}
            />
            <span className={isSelf ? 'text-muted-foreground' : ''}>
                {isSelf ? 'this' : type}
            </span>
        </span>
    );

    // Relation row component
    const RelationRow = ({ rel, dimmed }: { rel: RelationInfo; dimmed?: boolean }) => {
        const isExpanded = expandedRelationId === rel.edgeId;
        const canIngest = hasPermission(Permission.INGEST);
        
        return (
            <div className={`${dimmed ? 'opacity-50' : ''}`}>
                <div 
                    className={`flex items-center gap-1.5 leading-tight ${advancedMode ? 'cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 -mx-1' : ''}`}
                    onClick={() => handleRelationClick(rel)}
                >
                    {/* Expand indicator in Advanced mode */}
                    {advancedMode && (
                        isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )
                    )}
                    
                    {rel.isOutgoing ? (
                        <>
                            <EntityChip type={entityType} color={nodeColor} isSelf />
                            <span className="text-muted-foreground">-&gt;</span>
                            <span 
                                className="font-mono text-[11px] text-foreground max-w-[140px] truncate inline-block"
                                title={rel.label}
                            >
                                {rel.label}
                            </span>
                            <span className="text-muted-foreground">-&gt;</span>
                            <EntityChip type={rel.entityType} color={rel.entityColor} />
                        </>
                    ) : (
                        <>
                            <EntityChip type={rel.entityType} color={rel.entityColor} />
                            <span className="text-muted-foreground">-&gt;</span>
                            <span 
                                className="font-mono text-[11px] text-foreground max-w-[140px] truncate inline-block"
                                title={rel.label}
                            >
                                {rel.label}
                            </span>
                            <span className="text-muted-foreground">-&gt;</span>
                            <EntityChip type={entityType} color={nodeColor} isSelf />
                        </>
                    )}
                    <EvalBadge result={rel.evaluationResult} />
                    {rel.relationIds.length > 1 && (
                        <span className="text-[10px] text-muted-foreground">x{rel.relationIds.length}</span>
                    )}
                </div>
                
                {/* Expanded relation details and actions (Advanced mode) */}
                {advancedMode && isExpanded && (
                    <div className="ml-4 mt-1 mb-2 p-2 bg-muted/30 rounded border border-border/50 space-y-2">
                        {/* Loading state */}
                        {relationDetails.loading && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span className="text-[10px]">Loading details...</span>
                            </div>
                        )}
                        
                        {/* Error state */}
                        {relationDetails.error && (
                            <div className="text-[10px] text-destructive">{relationDetails.error}</div>
                        )}
                        
                        {/* Relation IDs */}
                        <div className="text-[10px]">
                            <span className="text-muted-foreground">Relation IDs: </span>
                            <span className="font-mono text-foreground break-all">
                                {rel.relationIds.join(', ') || 'None'}
                            </span>
                        </div>
                        
                        {/* Action buttons */}
                        {rel.relationIds.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleEvaluate(rel.relationIds[0]); }}
                                    disabled={actionLoading !== null || !canIngest}
                                    className="px-2 py-1 text-[10px] rounded bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canIngest ? 'Insufficient permissions' : 'Re-evaluate this relation'}
                                >
                                    {actionLoading === 'evaluate' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                                    Re-Evaluate
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleAccept(rel.relationIds[0]); }}
                                    disabled={actionLoading !== null || !canIngest}
                                    className="px-2 py-1 text-[10px] rounded bg-green-500 hover:bg-green-600 text-white font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canIngest ? 'Insufficient permissions' : 'Accept this relation'}
                                >
                                    {actionLoading === 'accept' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                                    Accept
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleReject(rel.relationIds[0]); }}
                                    disabled={actionLoading !== null || !canIngest}
                                    className="px-2 py-1 text-[10px] rounded bg-red-500 hover:bg-red-600 text-white font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canIngest ? 'Insufficient permissions' : 'Reject this relation'}
                                >
                                    {actionLoading === 'reject' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <XIcon className="h-2.5 w-2.5" />}
                                    Reject
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleUndo(rel.relationIds[0]); }}
                                    disabled={actionLoading !== null || !canIngest}
                                    className="px-2 py-1 text-[10px] rounded bg-orange-500 hover:bg-orange-600 text-white font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canIngest ? 'Insufficient permissions' : 'Undo evaluation'}
                                >
                                    {actionLoading === 'undo' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
                                    Undo
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleSync(rel.relationIds[0]); }}
                                    disabled={actionLoading !== null || !canIngest}
                                    className="px-2 py-1 text-[10px] rounded bg-purple-500 hover:bg-purple-600 text-white font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canIngest ? 'Insufficient permissions' : 'Sync to graph database'}
                                >
                                    {actionLoading === 'sync' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ArrowLeftRight className="h-2.5 w-2.5" />}
                                    Sync
                                </button>
                            </div>
                        )}
                        
                        {/* Heuristics info (if loaded) */}
                        {!relationDetails.loading && relationDetails.heuristics && relationDetails.heuristics.length > 0 && (
                            <div className="text-[10px] border-t border-border/50 pt-2 mt-1 space-y-2">
                                <div className="text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                                    <span>Heuristics</span>
                                    <span className="px-1 py-0.5 bg-blue-500/20 text-blue-600 rounded text-[9px]">
                                        {relationDetails.heuristics.length}
                                    </span>
                                </div>
                                {relationDetails.heuristics.map((h: any, idx: number) => (
                                    <div key={idx} className="bg-muted/20 rounded border border-border/30 p-2 space-y-2">
                                        {/* Entity types header */}
                                        <div className="flex items-center gap-2 font-medium">
                                            <span style={{ color: getColorForNode(h.entity_a_type) }}>{h.entity_a_type}</span>
                                            <span className="text-muted-foreground">→</span>
                                            <span style={{ color: getColorForNode(h.entity_b_type) }}>{h.entity_b_type}</span>
                                        </div>
                                        
                                        {/* Total Matches - prominent display */}
                                        {h.total_matches !== undefined && (
                                            <div className="flex items-center justify-between p-1.5 rounded border border-border/50 bg-background">
                                                <span className="text-muted-foreground">Total Matches:</span>
                                                <span className="font-bold text-foreground">{h.total_matches}</span>
                                            </div>
                                        )}
                                        
                                        {/* Property Mappings */}
                                        {h.property_mappings && h.property_mappings.length > 0 && (
                                            <div className="p-1.5 rounded border border-border/50 bg-background">
                                                <div className="font-medium text-muted-foreground mb-1">Property Mappings:</div>
                                                <div className="space-y-1">
                                                    {h.property_mappings.map((pm: any, pmIdx: number) => (
                                                        <div key={pmIdx} className="flex items-center gap-1 flex-wrap">
                                                            <span className="font-mono font-medium" style={{ color: getColorForNode(h.entity_a_type) }}>
                                                                {pm.entity_a_property}
                                                            </span>
                                                            <span className="text-muted-foreground">→</span>
                                                            <span className="font-mono font-medium" style={{ color: getColorForNode(h.entity_b_type) }}>
                                                                {pm.entity_b_idkey_property || pm.entity_b_property}
                                                            </span>
                                                            {pm.match_type && (
                                                                <span className="text-muted-foreground text-[9px]">({pm.match_type})</span>
                                                            )}
                                                            {pm.value_match_quality !== undefined && (
                                                                <span className="text-[9px] px-1 py-0.5 bg-green-500/20 text-green-600 rounded">
                                                                    quality: {(pm.value_match_quality * 100).toFixed(0)}%
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Quality Metrics - grid layout */}
                                        {(h.value_match_quality_avg !== undefined || h.deep_match_quality_avg !== undefined) && (
                                            <div className="p-1.5 rounded border border-border/50 bg-background">
                                                <div className="font-medium text-muted-foreground mb-1">Quality Metrics:</div>
                                                <div className="grid grid-cols-2 gap-1">
                                                    {h.value_match_quality_avg !== undefined && (
                                                        <div className="flex items-center justify-between p-1 rounded border border-border/30">
                                                            <span className="text-muted-foreground text-[9px]">Value Match Avg:</span>
                                                            <span className="font-medium text-foreground">{(h.value_match_quality_avg * 100).toFixed(0)}%</span>
                                                        </div>
                                                    )}
                                                    {h.deep_match_quality_avg !== undefined && (
                                                        <div className="flex items-center justify-between p-1 rounded border border-border/30">
                                                            <span className="text-muted-foreground text-[9px]">Deep Match Avg:</span>
                                                            <span className="font-medium text-foreground">{h.deep_match_quality_avg.toFixed(1)}%</span>
                                                        </div>
                                                    )}
                                                    {h.value_match_quality_sum !== undefined && (
                                                        <div className="flex items-center justify-between p-1 rounded border border-border/30">
                                                            <span className="text-muted-foreground text-[9px]">Value Match Sum:</span>
                                                            <span className="font-medium text-foreground">{h.value_match_quality_sum}</span>
                                                        </div>
                                                    )}
                                                    {h.deep_match_quality_sum !== undefined && (
                                                        <div className="flex items-center justify-between p-1 rounded border border-border/30">
                                                            <span className="text-muted-foreground text-[9px]">Deep Match Sum:</span>
                                                            <span className="font-medium text-foreground">{h.deep_match_quality_sum.toFixed(1)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Match Patterns */}
                                        {h.property_match_patterns && Object.keys(h.property_match_patterns).length > 0 && (
                                            <div className="p-1.5 rounded border border-border/50 bg-background">
                                                <div className="font-medium text-muted-foreground mb-1">Match Patterns:</div>
                                                <div className="space-y-1">
                                                    {Object.entries(h.property_match_patterns).map(([mapping, patterns]: [string, any], pIdx: number) => (
                                                        <div key={pIdx} className="flex items-center gap-1 flex-wrap">
                                                            <span className="font-mono text-foreground text-[9px]">{mapping}:</span>
                                                            {Object.entries(patterns).map(([matchType, count]: [string, any], mtIdx: number) => (
                                                                <span key={mtIdx} className="px-1 py-0.5 bg-blue-500/10 text-blue-600 rounded text-[9px]">
                                                                    {matchType.replace('ValueMatchType.', '')}: {count}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Example Matches - collapsible */}
                                        {h.example_matches && h.example_matches.length > 0 && (
                                            <div className="p-1.5 rounded border border-border/50 bg-background">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const el = e.currentTarget.nextElementSibling;
                                                        if (el) el.classList.toggle('hidden');
                                                        e.currentTarget.querySelector('span:last-child')!.textContent = 
                                                            el?.classList.contains('hidden') ? '▼' : '▲';
                                                    }}
                                                    className="w-full flex items-center justify-between text-left"
                                                >
                                                    <span className="font-medium text-muted-foreground">
                                                        Example Matches ({h.example_matches.length}):
                                                    </span>
                                                    <span className="text-muted-foreground text-[9px]">▼</span>
                                                </button>
                                                <div className="hidden mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                                                    {h.example_matches.map((ex: any, exIdx: number) => (
                                                        <div key={exIdx} className="font-mono text-[9px] p-1 rounded bg-muted/30 flex items-start gap-1">
                                                            <span className="text-muted-foreground shrink-0">{exIdx + 1}.</span>
                                                            <div className="min-w-0">
                                                                <div className="truncate text-foreground" title={ex.entity_a_pk}>
                                                                    {ex.entity_a_pk}
                                                                </div>
                                                                <div className="text-muted-foreground">→</div>
                                                                <div className="truncate text-foreground" title={ex.entity_b_pk}>
                                                                    {ex.entity_b_pk}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {/* Evaluations info (if loaded) */}
                        {!relationDetails.loading && relationDetails.evaluations && relationDetails.evaluations.length > 0 && (
                            <div className="text-[10px] border-t border-border/50 pt-2 mt-1 space-y-2">
                                <span className="text-muted-foreground font-medium uppercase tracking-wide">Evaluations ({relationDetails.evaluations.length}):</span>
                                {relationDetails.evaluations.map((e: any, idx: number) => (
                                    <div key={idx} className="pl-2 border-l-2 border-green-500/30 ml-1 space-y-1">
                                        {/* Result and relation name */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`px-1.5 py-0.5 rounded font-medium ${
                                                e.result === 'ACCEPTED' ? 'bg-green-500/20 text-green-600' :
                                                e.result === 'REJECTED' ? 'bg-red-500/20 text-red-600' :
                                                e.result === 'UNSURE' ? 'bg-orange-500/20 text-orange-600' :
                                                'bg-muted text-foreground'
                                            }`}>
                                                {e.result || 'PENDING'}
                                            </span>
                                            {e.relation_name && (
                                                <span className="font-mono text-foreground">{e.relation_name}</span>
                                            )}
                                            {e.directionality && (
                                                <span className="text-muted-foreground text-[9px]">({e.directionality})</span>
                                            )}
                                            {e.is_manual && (
                                                <span className="px-1 py-0.5 bg-yellow-500/20 text-yellow-600 rounded text-[9px]">Manual</span>
                                            )}
                                        </div>
                                        
                                        {/* Justification */}
                                        {e.justification && (
                                            <div className="text-muted-foreground italic text-[9px] leading-tight">
                                                {e.justification}
                                            </div>
                                        )}
                                        
                                        {/* Property mappings */}
                                        {e.property_mappings && e.property_mappings.length > 0 && (
                                            <div className="text-muted-foreground text-[9px]">
                                                <span className="font-medium">Mappings: </span>
                                                {e.property_mappings.map((pm: any, pmIdx: number) => (
                                                    <span key={pmIdx} className="font-mono">
                                                        {pm.entity_a_property} → {pm.entity_b_idkey_property || pm.entity_b_property}
                                                        {pm.match_type && ` (${pm.match_type})`}
                                                        {pmIdx < e.property_mappings.length - 1 ? ', ' : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {/* Sync status and timestamps */}
                                        <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground">
                                            {e.last_evaluated && (
                                                <span>Evaluated: {new Date(e.last_evaluated * 1000).toLocaleString()}</span>
                                            )}
                                            {e.sync_status?.is_synced && (
                                                <span className="text-green-600">Synced</span>
                                            )}
                                            {e.sync_status?.last_synced && (
                                                <span>Last sync: {new Date(e.sync_status.last_synced * 1000).toLocaleString()}</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {/* No data message */}
                        {!relationDetails.loading && !relationDetails.error && 
                         (!relationDetails.heuristics || relationDetails.heuristics.length === 0) && 
                         (!relationDetails.evaluations || relationDetails.evaluations.length === 0) && (
                            <div className="text-[10px] text-muted-foreground italic border-t border-border/50 pt-1 mt-1">
                                No heuristics or evaluations found for this relation.
                            </div>
                        )}
                        
                        {/* Raw data toggle */}
                        {!relationDetails.loading && (relationDetails.rawHeuristics || relationDetails.rawEvaluations) && (
                            <div className="border-t border-border/50 pt-1 mt-1">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowRawRelationData(!showRawRelationData); }}
                                    className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                                >
                                    {showRawRelationData ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                                    Raw API Response
                                </button>
                                {showRawRelationData && (
                                    <pre className="mt-1 text-[9px] bg-background p-1.5 rounded border border-border overflow-auto max-h-32 font-mono">
                                        {JSON.stringify({ heuristics: relationDetails.rawHeuristics, evaluations: relationDetails.rawEvaluations }, null, 2)}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="absolute top-2 left-2 z-[1000] bg-card border border-border rounded-lg shadow-xl w-[456px] h-[60%] min-w-[280px] max-w-[800px] min-h-[200px] max-h-[calc(100%-16px)] overflow-hidden flex flex-col text-sm resize overflow-auto">
            {/* Compact Header */}
            <div 
                className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0"
                style={{ backgroundColor: `${nodeColor}15` }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: nodeColor }}
                    />
                    <span className="font-semibold text-foreground truncate">
                        {entityType}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Advanced Toggle */}
                    {onToggleAdvanced && (
                        <button
                            onClick={onToggleAdvanced}
                            className={`px-2 py-0.5 text-[10px] rounded-full flex items-center gap-1 transition-colors ${
                                advancedMode 
                                    ? 'bg-primary text-primary-foreground' 
                                    : 'bg-muted text-muted-foreground hover:text-foreground'
                            }`}
                            title={advancedMode ? 'Hide advanced details' : 'Show advanced details'}
                        >
                            <Settings2 className="h-3 w-3" />
                            Advanced
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-muted rounded transition-colors"
                    >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto text-xs">
                {/* Active Relations */}
                {activeRelations.length > 0 && (
                    <div className="px-3 py-2 border-b border-border">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                            Relations ({activeRelations.length})
                        </div>
                        <div className="space-y-1">
                            {activeRelations.map((rel, idx) => (
                                <RelationRow key={idx} rel={rel} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Rejected Relations (collapsible) */}
                {rejectedRelations.length > 0 && (
                    <div className="px-3 py-2 border-b border-border">
                        <button
                            onClick={() => setShowRejected(!showRejected)}
                            className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                        >
                            {showRejected ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            <span>Rejected Relations ({rejectedRelations.length})</span>
                        </button>
                        {showRejected && (
                            <div className="mt-1.5 space-y-1">
                                {rejectedRelations.map((rel, idx) => (
                                    <RelationRow key={idx} rel={rel} dimmed />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* No relations message */}
                {allRelations.length === 0 && (
                    <div className="px-3 py-2 border-b border-border text-muted-foreground italic">
                        No relations
                    </div>
                )}

                {/* Properties (collapsible) */}
                {displayProperties.length > 0 && (
                    <div className="px-3 py-2 border-b border-border">
                        <button
                            onClick={() => setShowProperties(!showProperties)}
                            className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                        >
                            {showProperties ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            <span>Properties ({displayProperties.length})</span>
                        </button>
                        {showProperties && (
                            <div className="mt-1.5 space-y-0.5">
                                {displayProperties.map(([key, value]) => {
                                    // Properties are arrays of strings in ontology graph
                                    const values = Array.isArray(value) ? value : [value];
                                    return values.map((v, idx) => (
                                        <div key={`${key}-${idx}`} className="flex items-start gap-1.5 text-foreground">
                                            <span className="text-muted-foreground shrink-0">•</span>
                                            <span className="break-all">{String(v ?? '')}</span>
                                        </div>
                                    ));
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Internal Properties (collapsible) */}
                {internalProperties.length > 0 && (
                    <div className={`px-3 py-2 ${advancedMode ? 'border-b border-border' : ''}`}>
                        <button
                            onClick={() => setShowInternal(!showInternal)}
                            className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                        >
                            {showInternal ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            <span>Internal ({internalProperties.length})</span>
                        </button>
                        {showInternal && (
                            <div className="mt-1.5 space-y-1 font-mono text-[10px]">
                                {internalProperties.map(([key, value]) => (
                                    <div key={key} className="flex flex-col">
                                        <span className="text-muted-foreground">{key}</span>
                                        <span className="text-foreground break-all pl-2">
                                            {formatValue(value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* === ADVANCED MODE SECTIONS === */}
                {advancedMode && (
                    <>
                        {/* Primary Keys Section (Advanced) */}
                        {primaryKeyProperties.length > 0 && (
                            <div className="px-3 py-2 border-b border-border bg-muted/30">
                                <button
                                    onClick={() => setShowPrimaryKeys(!showPrimaryKeys)}
                                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                                >
                                    {showPrimaryKeys ? (
                                        <ChevronDown className="h-3 w-3" />
                                    ) : (
                                        <ChevronRight className="h-3 w-3" />
                                    )}
                                    <span className="flex items-center gap-1">
                                        Primary Keys ({primaryKeyProperties.length})
                                        <span className="px-1 py-0.5 bg-blue-500/20 text-blue-600 text-[9px] rounded">ADV</span>
                                    </span>
                                </button>
                                {showPrimaryKeys && (
                                    <div className="mt-1.5 space-y-1">
                                        {primaryKeyProperties.map((key: string, index: number) => (
                                            <div key={index} className="flex items-start gap-2 text-foreground">
                                                <span className="text-muted-foreground font-medium shrink-0">{key}:</span>
                                                <span className="break-all font-mono text-[10px]">
                                                    {formatValue(allProperties[key])}
                                                </span>
                                            </div>
                                        ))}
                                        {/* Generated Primary Key */}
                                        <div className="pt-1 mt-1 border-t border-border/50">
                                            <div className="flex items-start gap-2 text-foreground">
                                                <span className="text-muted-foreground font-medium shrink-0">Generated PK:</span>
                                                <span className="break-all font-mono text-[10px] text-primary">
                                                    {primaryKeyProperties
                                                        .map((prop: string) => allProperties[prop])
                                                        .filter(Boolean)
                                                        .map((v: any) => formatValue(v))
                                                        .join(' | ') || 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Raw Entity Data Section (Advanced) */}
                        <div className="px-3 py-2 bg-muted/30">
                            <button
                                onClick={() => setShowRawData(!showRawData)}
                                className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                            >
                                {showRawData ? (
                                    <ChevronDown className="h-3 w-3" />
                                ) : (
                                    <ChevronRight className="h-3 w-3" />
                                )}
                                <span className="flex items-center gap-1">
                                    Raw Entity Data
                                    <span className="px-1 py-0.5 bg-blue-500/20 text-blue-600 text-[9px] rounded">ADV</span>
                                </span>
                            </button>
                            {showRawData && (
                                <pre className="mt-1.5 text-[10px] bg-background p-2 rounded border border-border overflow-auto max-h-48 font-mono">
                                    {JSON.stringify(entityData, null, 2)}
                                </pre>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

import React, { useState } from 'react';
import { Edge } from '@xyflow/react';
import { getColorForNode, darkenColor, EvaluationResult } from '../graphStyles';

interface OntologyRelationDetailsCardProps {
    relation: Edge;
    onClose: () => void;
    // API action handlers
    onEvaluate: (relationId: string) => Promise<void>;
    onAccept: (relationId: string, relationName: string) => Promise<void>;
    onReject: (relationId: string) => Promise<void>;
    onUndoEvaluation: (relationId: string) => Promise<void>;
    onSync: (relationId: string) => Promise<void>;
    // Loading and result states
    isLoading: boolean;
    actionResult: { type: 'success' | 'error', message: string } | null;
    onClearActionResult: () => void;
}

export default function OntologyRelationDetailsCard({ 
    relation, 
    onClose, 
    onEvaluate,
    onAccept,
    onReject,
    onUndoEvaluation,
    onSync,
    isLoading,
    actionResult,
    onClearActionResult
}: OntologyRelationDetailsCardProps) {
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    
    const data = relation.data as any || {};
    const relationProps = data.relation_properties || {};
    const relationName = relationProps.evaluation_relation_name || relation.label || 'Unknown Relation';
    
    // Get relation ID for API calls
    const relationId = relation.id
    
    console.log('Relation data:', JSON.stringify(relation.data, null, 2));

    // Helper function to format property values
    const formatValue = (value: any): string => {
        if (value === null || value === undefined) return 'N/A';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
    };

    // Helper function to format timestamps
    const formatTimestamp = (timestamp: any): string => {
        if (!timestamp || typeof timestamp !== 'number') return 'N/A';
        return new Date(timestamp * 1000).toLocaleString();
    };

    // Helper function to safely get number value
    const getNumberValue = (value: any): number => {
        return typeof value === 'number' ? value : 0;
    };

    // Helper function to check if a value exists and is truthy
    const hasValue = (value: any): boolean => {
        return value !== null && value !== undefined && value !== '';
    };

    // Parse property mappings
    const parsePropertyMappings = () => {
        if (!hasValue(relationProps.heuristic_property_mappings)) return [];
        
        try {
            const mappings = typeof relationProps.heuristic_property_mappings === 'string' 
                ? JSON.parse(relationProps.heuristic_property_mappings) 
                : relationProps.heuristic_property_mappings;
            
            if (Array.isArray(mappings)) {
                return mappings;
            }
            return [];
        } catch (e) {
            console.error('Error parsing property mappings:', e);
            return [];
        }
    };

    const propertyMappings = parsePropertyMappings();

    // Get entity types for coloring
    const entityAType = formatValue(relationProps.heuristic_entity_a_type || data.from_entity?.entity_type);
    const entityBType = formatValue(relationProps.heuristic_entity_b_type || data.to_entity?.entity_type);
    
    // Get colors for entity types
    const entityAColor = getColorForNode(entityAType);
    const entityBColor = getColorForNode(entityBType);

    // Check if there's already an evaluation
    const hasEvaluation = relationProps.evaluation_last_evaluated !== undefined && 
                         relationProps.evaluation_last_evaluated !== null &&
                         relationProps.evaluation_last_evaluated > 0;

    // Helper function to format time ago
    const formatTimeAgo = (timestamp: any): string => {
        if (!timestamp || typeof timestamp !== 'number') return 'Never';
        const now = Date.now() / 1000; // Current time in seconds
        const diffMinutes = Math.floor((now - timestamp) / 60);
        
        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
        
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours} hours ago`;
        
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} days ago`;
    };

    // Handler functions that delegate to parent component
    const handleEvaluate = async () => {
        await onEvaluate(relationId);
    };
    
    const handleAccept = async () => {
        await onAccept(relationId, relationName);
    };
    
    const handleReject = async () => {
        await onReject(relationId);
    };
    
    const handleUndoEvaluation = async () => {
        await onUndoEvaluation(relationId);
    };
    
    const handleSync = async () => {
        await onSync(relationId);
    };
    
    // Generate sync tooltip based on relation status
    const getSyncTooltip = () => {
        if (!relationId) return "No relation ID available";
        
        const baseMessage = "Sync with data graph. ";
        
        if (hasEvaluation) {
            const result = relationProps.evaluation_result;
            if (result === EvaluationResult.ACCEPTED) {
                return baseMessage + "This will apply this relation across the data graph";
            } else if (result === EvaluationResult.REJECTED) {
                return baseMessage + "This will remove this relation from data graph";
            }
        }
        return baseMessage + "Ensure this relation is not applied to data";
    };

    return (
        <div className="absolute top-4 right-4 w-[600px] h-[700px] bg-white border rounded-lg shadow-lg z-20 flex flex-col">
            {/* Grey Header */}
            <div className="p-4 rounded-t-lg border-b bg-gray-100 border-gray-200">
                <div className="flex justify-between items-center">
                    <div className="flex-1">
                        <h5 className="text-lg font-bold text-gray-800">Ontology Relation Details</h5>
                        <p className="text-sm font-bold text-gray-700">{relationName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Action Buttons */}
                        <button 
                            onClick={handleEvaluate}
                            disabled={isLoading || !relationId}
                            className="bg-blue-500 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-1 px-2 rounded text-xs"
                            title={!relationId ? "No relation ID available" : "Re-evaluate this relation"}
                        >
                            {isLoading ? 'Evaluating...' : 'Re-Evaluate'}
                        </button>
                        
                        {!hasEvaluation && (
                            <button 
                                onClick={handleAccept}
                                disabled={isLoading || !relationId}
                                className="bg-green-500 hover:bg-green-700 disabled:bg-green-300 text-white font-bold py-1 px-2 rounded text-xs"
                                title={!relationId ? "No relation ID available" : "Accept this relation"}
                            >
                                {isLoading ? 'Processing...' : 'Accept'}
                            </button>
                        )}
                        
                        {!hasEvaluation && (
                            <button 
                                onClick={handleReject}
                                disabled={isLoading || !relationId}
                                className="bg-red-500 hover:bg-red-700 disabled:bg-red-300 text-white font-bold py-1 px-2 rounded text-xs"
                                title={!relationId ? "No relation ID available" : "Reject this relation"}
                            >
                                {isLoading ? 'Processing...' : 'Reject'}
                            </button>
                        )}
                        
                        {hasEvaluation && (
                            <button 
                                onClick={handleUndoEvaluation}
                                disabled={isLoading || !relationId}
                                className="bg-orange-500 hover:bg-orange-700 disabled:bg-orange-300 text-white font-bold py-1 px-2 rounded text-xs"
                                title={!relationId ? "No relation ID available" : "Remove current evaluation"}
                            >
                                {isLoading ? 'Processing...' : 'Undo Evaluation'}
                            </button>
                        )}
                        
                        <button 
                            onClick={handleSync}
                            disabled={isLoading || !relationId}
                            className="bg-purple-500 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold py-1 px-2 rounded text-xs"
                            title={getSyncTooltip()}
                        >
                            {isLoading ? 'Syncing...' : 'Sync'}
                        </button>
                        
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
                <div className={`mx-4 mt-2 p-3 rounded-lg ${
                    actionResult.type === 'success' 
                        ? 'bg-green-100 border border-green-200 text-green-800' 
                        : 'bg-red-100 border border-red-200 text-red-800'
                }`}>
                    <div className="flex items-center gap-2">
                        <span className="font-semibold">
                            {actionResult.type === 'success' ? '✅' : '❌'}
                        </span>
                        <span className="text-sm">{actionResult.message}</span>
                        <button 
                            onClick={onClearActionResult}
                            className="ml-auto text-lg hover:opacity-70"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                    {/* Relation Details Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-2">Relation Details</h6>
                        <div className="space-y-1">
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Relation ID:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words font-mono text-xs">
                                        {relationId || 'No ID found'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Relation Name:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">{relationName}</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Entity Types:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="break-words">
                                        <span 
                                            className="font-semibold"
                                            style={{ color: darkenColor(entityAColor, 40) }}
                                        >
                                            {entityAType}
                                        </span>
                                        <span className="text-gray-600 mx-2">→</span>
                                        <span 
                                            className="font-semibold"
                                            style={{ color: darkenColor(entityBColor, 40) }}
                                        >
                                            {entityBType}
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Status:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-600 break-words">
                                            {hasEvaluation ? (relationProps.evaluation_result || EvaluationResult.UNSURE) : 'Not Evaluated'}
                                        </span>
                                        {hasEvaluation && relationProps.evaluation_result && (
                                            <>
                                                {relationProps.evaluation_result === EvaluationResult.ACCEPTED && (
                                                    <span className="px-2 py-1 text-xs font-bold bg-green-100 text-green-800 rounded">
                                                        {EvaluationResult.ACCEPTED}
                                                    </span>
                                                )}
                                                {relationProps.evaluation_result === EvaluationResult.REJECTED && (
                                                    <span className="px-2 py-1 text-xs font-bold bg-red-100 text-red-800 rounded">
                                                        {EvaluationResult.REJECTED}
                                                    </span>
                                                )}
                                                {relationProps.evaluation_result === EvaluationResult.UNSURE && (
                                                    <span className="px-2 py-1 text-xs font-bold bg-yellow-100 text-yellow-800 rounded">
                                                        {EvaluationResult.UNSURE}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Match Count:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">{formatValue(relationProps.heuristic_count)}</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Last Evaluated:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">
                                        {formatTimeAgo(relationProps.evaluation_last_evaluated)}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Last Synced:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">
                                        {formatTimeAgo(relationProps.last_synced)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Property Mappings Section */}
                    {propertyMappings.length > 0 && (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <h6 className="font-semibold text-gray-800 mb-2">Property Mappings</h6>
                            <div className="bg-white rounded border">
                                {/* Header Row with Entity Types */}
                                <div className="flex items-center gap-2 text-sm p-2 rounded-t border-b">
                                    <div className="w-1/2 flex-shrink-0">
                                        <span 
                                            className="font-bold truncate block"
                                            style={{ color: darkenColor(entityAColor, 40) }}
                                        >
                                            {entityAType}
                                        </span>
                                    </div>
                                    <div className="w-1/2 min-w-0">
                                        <span 
                                            className="font-bold truncate block"
                                            style={{ color: darkenColor(entityBColor, 40) }}
                                        >
                                            → {entityBType}
                                        </span>
                                    </div>
                                </div>
                                {/* Property Mappings */}
                                <div className="divide-y">
                                    {propertyMappings.map((mapping: any, index: number) => (
                                        <div key={index} className="p-2">
                                            <div className="flex items-start gap-2 text-sm">
                                                <div className="w-1/2 flex-shrink-0">
                                                    <span className="text-gray-700 break-words">
                                                        {mapping.entity_a_property || `Property ${index + 1}`}
                                                    </span>
                                                </div>
                                                <div className="w-1/2 min-w-0">
                                                    <span className="text-gray-600 break-words">
                                                        → {mapping.entity_b_idkey_property || 'Unknown Target Property'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* All Properties Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-3">All Properties</h6>
                        <div className="space-y-2">
                            {Object.entries(relationProps).map(([key, value]) => (
                                <div key={key} className="bg-white p-2 rounded border">
                                    <div className="flex items-start gap-2">
                                        <div className="w-32 flex-shrink-0">
                                            <div className="font-bold text-gray-700 text-sm break-words">
                                                {key}:
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {typeof value === 'object' ? (
                                                <pre className="text-xs text-gray-600 bg-gray-50 p-1 rounded overflow-auto max-h-20">
                                                    {JSON.stringify(value, null, 2)}
                                                </pre>
                                            ) : key.includes('timestamp') || key.includes('last_processed') || key.includes('last_evaluated') ? (
                                                <div className="text-sm text-gray-600 break-words">
                                                    {formatTimestamp(value)}
                                                </div>
                                            ) : key.includes('example_matches') || key.includes('property_values') || key.includes('property_counts') ? (
                                                <pre className="text-xs text-gray-600 bg-gray-50 p-1 rounded overflow-auto max-h-20">
                                                    {typeof value === 'string' ? JSON.stringify(JSON.parse(value), null, 2) : JSON.stringify(value, null, 2)}
                                                </pre>
                                            ) : (
                                                <div className="text-sm text-gray-600 break-words">
                                                    {formatValue(value)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    {/* Raw Data Section */}
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <button
                            onClick={() => setIsRawDataCollapsed(!isRawDataCollapsed)}
                            className="flex items-center justify-between w-full text-left hover:bg-slate-100 p-1 rounded transition-colors"
                        >
                            <h6 className="font-semibold text-slate-800">Raw Data</h6>
                            <span className="text-slate-600 text-sm">
                                {isRawDataCollapsed ? '▼' : '▲'}
                            </span>
                        </button>
                        {!isRawDataCollapsed && (
                            <pre className="mt-3 text-xs bg-white p-3 rounded border overflow-auto max-h-60">
                                {JSON.stringify(relation.data, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
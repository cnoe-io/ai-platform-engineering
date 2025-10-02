import React, { useState } from 'react';
import { Edge } from '@xyflow/react';
import { getColorForNode, darkenColor } from '../graphStyles';

interface OntologyRelationDetailsCardProps {
    relation: Edge;
    onClose: () => void;
    acceptanceThreshold: number;
    rejectionThreshold: number;
}

export default function OntologyRelationDetailsCard({ relation, onClose, acceptanceThreshold, rejectionThreshold }: OntologyRelationDetailsCardProps) {
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    
    const data = relation.data as any || {};
    const relationProps = data.relation_properties || {};
    const relationName = relationProps.evaluation_relation_name || relation.label || 'Unknown Relation';
    
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

    // Determine relation status based on confidence
    const confidence = getNumberValue(relationProps.evaluation_relation_confidence);
    const isAccepted = confidence >= acceptanceThreshold;
    const isRejected = confidence <= rejectionThreshold;
    const isUncertain = confidence > rejectionThreshold && confidence < acceptanceThreshold;

    // Handler for coming soon buttons
    const handleComingSoon = (action: string) => {
        alert(`${action} - Coming Soon!`);
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
                            onClick={() => handleComingSoon('Re-Evaluate')}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-xs"
                        >
                            Re-Evaluate
                        </button>
                        
                        {isUncertain && (
                            <button 
                                onClick={() => handleComingSoon('Accept')}
                                className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded text-xs"
                            >
                                Accept
                            </button>
                        )}
                        
                        {(isAccepted || isUncertain) && (
                            <button 
                                onClick={() => handleComingSoon('Reject')}
                                className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
                            >
                                Reject
                            </button>
                        )}
                        
                        {isRejected && (
                            <button 
                                onClick={() => handleComingSoon('Un-Reject')}
                                className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-1 px-2 rounded text-xs"
                            >
                                Un-Reject
                            </button>
                        )}
                        
                        <button 
                            onClick={onClose} 
                            className="w-9 h-9 flex items-center justify-center rounded bg-white bg-opacity-70 hover:bg-opacity-40 text-gray-800 hover:text-gray-900 transition-all duration-200 text-lg"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                    {/* Relation Details Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-2">Relation Details</h6>
                        <div className="space-y-1">
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
                                    <span className="font-bold text-gray-700 break-words">Confidence:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-600 break-words">
                                            {relationProps.evaluation_relation_confidence !== undefined && relationProps.evaluation_relation_confidence !== null 
                                                ? `${(getNumberValue(relationProps.evaluation_relation_confidence) * 100).toFixed(1)}%` 
                                                : 'N/A'}
                                        </span>
                                        {relationProps.evaluation_relation_confidence !== undefined && relationProps.evaluation_relation_confidence !== null && (
                                            <>
                                                {getNumberValue(relationProps.evaluation_relation_confidence) >= acceptanceThreshold && (
                                                    <span className="px-2 py-1 text-xs font-bold bg-green-100 text-green-800 rounded">
                                                        ACCEPTED
                                                    </span>
                                                )}
                                                {getNumberValue(relationProps.evaluation_relation_confidence) <= rejectionThreshold && (
                                                    <span className="px-2 py-1 text-xs font-bold bg-red-100 text-red-800 rounded">
                                                        REJECTED
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
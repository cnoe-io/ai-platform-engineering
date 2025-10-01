import React, { useState } from 'react';
import { Edge } from '@xyflow/react';

interface DataRelationDetailsCardProps {
    relation: Edge;
    onClose: () => void;
}

export default function DataRelationDetailsCard({ relation, onClose }: DataRelationDetailsCardProps) {
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    
    const relationData = relation.data as any || {};
    const relationName = relation.label || relationData.relation_name || 'Unknown Relation';
    const hasOntologyRelationId = relationData._ontology_relation_id || relationData.relation_properties?._ontology_relation_id;
    
    console.log('Relation Data:', relationData);

    const handleInvestigate = () => {
        // TODO: Implement investigation functionality
        alert(`Investigating ontology relation: ${hasOntologyRelationId}`);
    };

    return (
        <div className="absolute top-4 right-4 w-[600px] h-[700px] bg-white border rounded-lg shadow-lg z-20 flex flex-col">
            {/* Grey Header */}
            <div className="p-4 rounded-t-lg border-b bg-gray-100 border-gray-200">
                <div className="flex justify-between items-center">
                    <div className="flex-1">
                        <h5 className="text-lg font-bold text-gray-800">Data Relation Details</h5>
                        <p className="text-sm font-bold text-gray-700">{relationName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasOntologyRelationId && (
                            <button 
                                onClick={handleInvestigate}
                                className="px-3 py-1 flex items-center justify-center gap-1 rounded bg-white bg-opacity-70 hover:bg-opacity-90 text-gray-800 hover:text-gray-900 transition-all duration-200 text-sm font-medium"
                                title="Check ontology relation"
                            >
                                🌐 Check Ontology
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
                    {/* Basic Relation Information */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-2">Relationship Information</h6>
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
                                    <span className="font-bold text-gray-700 break-words">Source Entity:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">{relation.source}</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Target Entity:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">{relation.target}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Primary Keys Section */}
                    {relationData.primary_key_properties && relationData.primary_key_properties.length > 0 && (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <h6 className="font-semibold text-gray-800 mb-2">Primary Keys</h6>
                            <div className="space-y-1">
                                {relationData.primary_key_properties.map((key: string, index: number) => (
                                    <div key={index} className="flex items-start gap-2 text-sm">
                                        <div className="w-32 flex-shrink-0">
                                            <span className="font-bold text-gray-700 break-words">{key}:</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-gray-600 break-words">{relationData.relation_properties?.[key] || relationData[key] || 'N/A'}</span>
                                        </div>
                                    </div>
                                ))}
                                {relationData.generate_primary_key && (
                                    <div className="mt-2 pt-2 border-t border-gray-200">
                                        <div className="flex items-start gap-2 text-sm">
                                            <div className="w-32 flex-shrink-0">
                                                <span className="font-bold text-gray-700 break-words">Generated Primary Key:</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="text-gray-600 font-mono text-xs break-words">{relationData.generate_primary_key()}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* All Properties Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-3">All Properties</h6>
                        <div className="space-y-2">
                            {Object.entries(relationData.relation_properties || relationData).map(([key, value]) => (
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
                                            ) : (
                                                <div className="text-sm text-gray-600 break-words">
                                                    {value?.toString() || 'N/A'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    {/* Raw Relation Data Section */}
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <button
                            onClick={() => setIsRawDataCollapsed(!isRawDataCollapsed)}
                            className="flex items-center justify-between w-full text-left hover:bg-slate-100 p-1 rounded transition-colors"
                        >
                            <h6 className="font-semibold text-slate-800">Raw Relation Data</h6>
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
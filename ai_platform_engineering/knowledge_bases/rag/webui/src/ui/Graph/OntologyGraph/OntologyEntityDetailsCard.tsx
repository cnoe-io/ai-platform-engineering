import React, { useState } from 'react';
import { Node } from '@xyflow/react';
import { getColorForNode, darkenColor } from '../graphStyles';

// TypeScript interfaces based on the Python Entity model
interface EntityData {
    entity_type: string;
    additional_labels?: string[];
    all_properties: Record<string, any>;
    primary_key_properties: string[];
    additional_key_properties?: string[][];
}

interface OntologyEntityDetailsCardProps {
    entity: Node;
    onClose: () => void;
}

export default function OntologyEntityDetailsCard({ entity, onClose }: OntologyEntityDetailsCardProps) {
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    
    // Extract entity data from the node
    const entityData = entity.data as unknown as EntityData;
    const entityType = entityData.entity_type || 'Ontology Entity';
    const backgroundColor = getColorForNode(entityType);
    const borderColor = darkenColor(backgroundColor, 20);
    
    // Helper function to check if a property is internal (starts with _)
    const isInternalProperty = (key: string): boolean => key.startsWith('_');
    
    // Generate primary key value
    const getPrimaryKeyValue = (): string => {
        if (!entityData.primary_key_properties || !entityData.all_properties) {
            return 'N/A';
        }
        return entityData.primary_key_properties
            .map(prop => entityData.all_properties[prop] || '')
            .join(' | ');
    };
    
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
        <div className="absolute top-4 right-4 w-[600px] h-[700px] bg-white border rounded-lg shadow-lg z-20 flex flex-col">
            {/* Colored Header */}
            <div 
                className="p-4 rounded-t-lg border-b"
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
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                    {/* Primary Keys Section */}
                    {entityData.primary_key_properties && entityData.primary_key_properties.length > 0 && (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <h6 className="font-semibold text-gray-800 mb-2">Primary Keys</h6>
                            <div className="space-y-1">
                                {entityData.primary_key_properties.map((key: string, index: number) => (
                                    <div key={index} className="flex items-start gap-2 text-sm">
                                        <div className="w-32 flex-shrink-0">
                                            <span className="font-bold text-gray-700 break-words">{key}:</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-gray-600 break-words">{entityData.all_properties?.[key] || 'N/A'}</span>
                                        </div>
                                    </div>
                                ))}
                                <div className="mt-2 pt-2 border-t border-gray-200">
                                    <div className="flex items-start gap-2 text-sm">
                                        <div className="w-32 flex-shrink-0">
                                            <span className="font-bold text-gray-700 break-words">Generated Primary Key:</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-gray-600 font-mono text-xs break-words">{getPrimaryKeyValue()}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Entity Type Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-2">Entity Type</h6>
                        <div className="flex items-start gap-2 text-sm">
                            <div className="w-32 flex-shrink-0">
                                <span className="font-bold text-gray-700 break-words">Type:</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <span className="text-gray-600 break-words">{entityData.entity_type || 'Not specified'}</span>
                            </div>
                        </div>
                        {entityData.additional_labels && entityData.additional_labels.length > 0 && (
                            <div className="flex items-start gap-2 text-sm mt-1">
                                <div className="w-32 flex-shrink-0">
                                    <span className="font-bold text-gray-700 break-words">Additional Labels:</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <span className="text-gray-600 break-words">{entityData.additional_labels.join(', ')}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* All Properties Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-3">All Properties</h6>
                        <div className="space-y-2">
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
import React, { useState } from 'react';
import { Node } from '@xyflow/react';
import { getColorForNode, darkenColor } from '../graphStyles';

interface DataEntityDetailsCardProps {
    entity: Node;
    onClose: () => void;
    onExplore?: (entityType: string, primaryKey: string) => void;
    isCurrentlyExplored?: boolean;
}

export default function DataEntityDetailsCard({ entity, onClose, onExplore, isCurrentlyExplored = false }: DataEntityDetailsCardProps) {
    const [isRawDataCollapsed, setIsRawDataCollapsed] = useState(true);
    
    // Extract entity data from the node
    const entityData = entity.data as any;
    const entityType = entityData.entity_type || 'Data Entity';
    const backgroundColor = getColorForNode(entityType);
    const borderColor = darkenColor(backgroundColor, 20);
    
    // Helper function to format date from timestamp
    const formatDate = (timestamp: string | number) => {
        try {
            const date = new Date(typeof timestamp === 'string' ? parseInt(timestamp) : timestamp);
            return date.toLocaleString();
        } catch {
            return timestamp?.toString() || 'Invalid date';
        }
    };

    // Helper function to get expiry status
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

    const handleExplore = () => {
        if (onExplore && entityData.entity_type && entityData.primary_key) {
            onExplore(entityData.entity_type, entityData.primary_key);
            onClose(); // Close the card after exploring
        }
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
                        <h5 className="text-lg font-bold text-gray-800">Data Entity Details</h5>
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
                                                <span className="text-gray-600 break-words">{entityData.all_properties?.[key] || entityData[key] || 'N/A'}</span>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="mt-2 pt-2 border-t border-gray-200">
                                        <div className="flex items-start gap-2 text-sm">
                                            <div className="w-32 flex-shrink-0">
                                                <span className="font-bold text-gray-700 break-words">Generated Primary Key:</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="text-gray-600 font-mono text-xs break-words">{entityData.primary_key}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Expiry Section */}
                        {entityData._fresh_until && (
                            <div className={`p-3 rounded-lg border ${getExpiryStatus(entityData._fresh_until).bgColor} ${getExpiryStatus(entityData._fresh_until).borderColor}`}>
                                <h6 className={`font-semibold mb-2 ${getExpiryStatus(entityData._fresh_until).color}`}>Data Freshness</h6>
                                <div className="space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <span className="font-medium">Status:</span>
                                        <span className={`font-medium ${getExpiryStatus(entityData._fresh_until).color}`}>
                                            {getExpiryStatus(entityData._fresh_until).status}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="font-medium">Fresh Until:</span>
                                        <span className="text-gray-600">{formatDate(entityData._fresh_until)}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Additional Key Properties Section */}
                        {entityData.additional_key_properties && entityData.additional_key_properties.length > 0 && (
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                <h6 className="font-semibold text-gray-800 mb-2">Additional Key Properties</h6>
                                <div className="space-y-2">
                                    {entityData.additional_key_properties.map((keyGroup: string[], groupIndex: number) => (
                                        <div key={groupIndex} className="bg-white p-2 rounded border border-gray-300">
                                            <div className="text-xs font-medium text-gray-700 mb-1">Key Group {groupIndex + 1}:</div>
                                            <div className="space-y-1">
                                                {keyGroup.map((key: string, keyIndex: number) => (
                                                    <div key={keyIndex} className="flex justify-between text-sm">
                                                        <span className="font-bold text-gray-600">{key}:</span>
                                                        <span className="text-gray-500">{entityData.all_properties?.[key] || entityData[key] || 'N/A'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    
                        {/* All Properties Section */}
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <h6 className="font-semibold text-gray-800 mb-3">All Properties</h6>
                        <div className="space-y-2">
                            {Object.entries(entityData.all_properties || entityData).map(([key, value]) => (
                                <div key={key} className="bg-white p-2 rounded border">
                                    <div className="flex items-start gap-2">
                                        <div className="w-32 flex-shrink-0">
                                            <div className="font-bold text-gray-700 text-sm break-words">
                                                {key}:
                                                {entityData.primary_key_properties?.includes(key) && (
                                                    <span className="ml-1 px-1 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">PK</span>
                                                )}
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
                    
                    {/* Explore Button Section */}
                    {!isCurrentlyExplored && onExplore && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <button 
                                onClick={handleExplore}
                                className="w-full py-3 px-4 text-base font-semibold rounded-lg text-gray-800 hover:text-gray-900 transition-all duration-200 hover:shadow-md"
                                style={{ 
                                    backgroundColor, 
                                    borderColor: borderColor,
                                    border: `1px solid ${borderColor}`
                                }}
                                title="Explore this entity"
                            >
                                🔍 Explore This Entity
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
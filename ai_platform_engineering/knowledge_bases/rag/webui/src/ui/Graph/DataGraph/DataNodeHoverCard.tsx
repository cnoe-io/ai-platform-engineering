import React from 'react';
import { MultiDirectedGraph } from 'graphology';

interface DataNodeHoverCardProps {
    hoveredNode: string;
    graph: MultiDirectedGraph;
}

export default function DataNodeHoverCard({ hoveredNode, graph }: DataNodeHoverCardProps) {
    if (!hoveredNode || !graph.hasNode(hoveredNode)) {
        return null;
    }

    const nodeData = graph.getNodeAttributes(hoveredNode);
    const entityData = nodeData.entityData;
    const entityType = entityData?.entity_type || 'Entity';
    const isSubEntity = entityType.includes('_');
    const nodeColor = nodeData.color;
    
    // Helper function to truncate text with high limits
    const truncate = (text: string, maxLength: number) => {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    };
    
    // Get all properties
    const allProperties = entityData?.all_properties || {};
    const primaryKeyProps = entityData?.primary_key_properties || [];
    
    // Filter out primary key properties from regular properties
    const regularProperties = Object.entries(allProperties).filter(
        ([key]) => !primaryKeyProps.includes(key) && !key.startsWith('_')
    );
    
    const maxPropertiesToShow = 10; // Show more properties
    const propertiesToDisplay = regularProperties.slice(0, maxPropertiesToShow);
    const remainingCount = regularProperties.length - maxPropertiesToShow;
    
    return (
        <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 1000,
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            maxWidth: '500px', // Increased from 400px
            pointerEvents: 'none'
        }}>
            {/* Entity Type Header with color */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
                <div 
                    style={{ 
                        width: '12px', 
                        height: '12px', 
                        borderRadius: '50%', 
                        backgroundColor: nodeColor,
                        flexShrink: 0
                    }} 
                />
                <span className="text-sm font-semibold text-gray-800 break-words">{truncate(entityType, 80)}</span>
            </div>
            
            {/* Primary Key Properties (only for non-subentities) */}
            {!isSubEntity && primaryKeyProps.length > 0 && (
                <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Primary Keys</div>
                    <div className="space-y-1">
                        {primaryKeyProps.map((pkProp: string, idx: number) => {
                            const value = allProperties[pkProp];
                            if (value === undefined || value === null) return null;
                            
                            const displayKey = truncate(pkProp, 60); // Increased from 30
                            const displayValue = truncate(String(value), 200); // Increased from 50
                            
                            return (
                                <div key={idx} className="text-xs">
                                    <span className="text-gray-500 break-words">{displayKey}:</span>{' '}
                                    <span className="text-gray-900 font-bold font-mono break-words">{displayValue}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            
            {/* Regular Properties */}
            {propertiesToDisplay.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Properties</div>
                    <div className="space-y-1">
                        {propertiesToDisplay.map(([key, value], idx) => {
                            const displayKey = truncate(key, 60); // Increased from 30
                            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                            const displayValue = truncate(stringValue, 200); // Increased from 50
                            
                            return (
                                <div key={idx} className="text-xs">
                                    <span className="text-gray-500 break-words">{displayKey}:</span>{' '}
                                    <span className="text-gray-900 font-bold break-words">{displayValue}</span>
                                </div>
                            );
                        })}
                        {remainingCount > 0 && (
                            <div className="text-xs text-gray-400 italic mt-1">
                                ...{remainingCount} more
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}


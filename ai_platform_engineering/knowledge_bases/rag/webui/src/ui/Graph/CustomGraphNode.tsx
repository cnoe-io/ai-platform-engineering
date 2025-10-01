import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { getColorForNode, darkenColor } from './graphStyles';

interface CustomGraphNodeProps {
    data: any;
    isConnectable: boolean;
    onArrowClick?: (data: any) => void;
    showArrowButton?: boolean;
    showLabel?: boolean;
    selected?: boolean;
    nodeWidth?: number;
    nodeHeight?: number;
}

// Helper function to get entity label with priority: name > *name* > primary_key
const getEntityLabel = (entityData: any) => {
    // First, check for exact 'name' property
    if (entityData.name) {
        return entityData.name;
    }
    
    // Then, check for any property that contains 'name'
    const nameKeys = Object.keys(entityData).filter(key => 
        key.toLowerCase().includes('name') && entityData[key]
    );
    
    if (nameKeys.length > 0) {
        return entityData[nameKeys[0]];
    }
    
    // For ontology nodes, use the display label if available, otherwise originalLabel
    if (entityData.label || entityData.originalLabel) {
        return entityData.originalLabel || entityData.label;
    }
    
    // Finally, fall back to primary_key
    return entityData.primary_key || 'Unknown';
};

// Internal styling function
const getNodeStyle = (entity: any, isSelected: boolean = false, nodeWidth: number = 180, nodeHeight: number = 40) => {
    // Determine the label for color selection
    const label = entity.entity_type || entity.all_properties?._primary_key || entity.primary_key || 'Entity';
    const backgroundColor = getColorForNode(label);
    
    const baseStyle = {
        backgroundColor, 
        color: '#333', 
        border: `1px solid ${darkenColor(backgroundColor, 20)}`,
        borderRadius: '3px',
        width: nodeWidth,
        height: nodeHeight,
        padding: '4px',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: 'pointer',
    };

    // Apply selection styling
    if (isSelected) {
        // Convert hex background color to rgba for the halo effect
        const hexToRgba = (hex: string, alpha: number) => {
            const num = parseInt(hex.replace("#", ""), 16);
            const r = (num >> 16) & 255;
            const g = (num >> 8) & 255;
            const b = num & 255;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        return {
            ...baseStyle,
            border: `4px solid ${darkenColor(backgroundColor, 20)}`,
            filter: `drop-shadow(0 0 16px ${hexToRgba(backgroundColor, 0.8)})`,
            zIndex: 1000,
            fontWeight: 'bold' as const,
        };
    }

    return baseStyle;
};

export default function CustomGraphNode({ 
    data, 
    isConnectable, 
    onArrowClick, 
    showArrowButton = false, 
    showLabel = true, 
    selected = false,
    nodeWidth = 180,
    nodeHeight = 40
}: CustomGraphNodeProps) {
    const handleArrowClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onArrowClick) {
            onArrowClick(data);
        }
    };

    // Get the entity label using the priority logic
    const entityLabel = getEntityLabel(data);
    const entityType = data.entity_type || 'Entity';
    
    // Truncate both texts - show last characters for label, first characters for type
    const truncatedLabel = entityLabel.length > 18 ? '...' + entityLabel.substring(entityLabel.length - 18) : entityLabel;
    const truncatedType = entityType.length > 18 ? entityType.substring(0, 18) + '...' : entityType;

    // Get the computed style for this node
    const computedStyle = getNodeStyle(data, selected, nodeWidth, nodeHeight);

    return (
        <div className="relative group w-full h-full" style={computedStyle}>
            <Handle
                type="target"
                position={Position.Left}
                style={{ background: '#555' }}
                isConnectable={isConnectable}
            />
            <div className="flex items-center w-full h-full">
                <div 
                    className="flex flex-col justify-center items-center px-2 py-1" 
                    style={{ width: showArrowButton ? '85%' : '100%' }}
                >
                    <span 
                        className="text-xs font-medium text-center truncate w-full leading-tight" 
                        title={entityType}
                    >
                        {truncatedType}
                    </span>
                    {showLabel && (
                        <span 
                            className="text-xs text-center truncate w-full leading-tight opacity-75" 
                            style={{ fontSize: '10px' }}
                            title={entityLabel}
                        >
                            {truncatedLabel}
                        </span>
                    )}
                </div>
                {showArrowButton && (
                    <button
                        onClick={handleArrowClick}
                        className="h-full flex items-center justify-center text-xs font-bold text-white hover:text-gray-100 hover:bg-white hover:bg-opacity-20 transition-all duration-200 border-l border-white border-opacity-30"
                        style={{ width: '15%' }}
                        title="Explore further"
                    >
                        →
                    </button>
                )}
            </div>
            <Handle
                type="source"
                position={Position.Right}
                style={{ background: '#555' }}
                isConnectable={isConnectable}
            />
        </div>
    );
}
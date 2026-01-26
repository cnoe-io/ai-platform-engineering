"use client";

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
        <div className="absolute top-2.5 left-2.5 z-[1000] bg-card border border-border rounded-lg p-3 shadow-lg max-w-[500px] pointer-events-none">
            {/* Entity Type Header with color */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: nodeColor }}
                />
                <span className="text-sm font-semibold text-foreground break-words">{truncate(entityType, 80)}</span>
            </div>

            {/* Primary Key Properties (only for non-subentities) */}
            {!isSubEntity && primaryKeyProps.length > 0 && (
                <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Primary Keys</div>
                    <div className="space-y-1">
                        {primaryKeyProps.map((pkProp: string, idx: number) => {
                            const value = allProperties[pkProp];
                            if (value === undefined || value === null) return null;

                            const displayKey = truncate(pkProp, 60);
                            const displayValue = truncate(String(value), 200);

                            return (
                                <div key={idx} className="text-xs">
                                    <span className="text-muted-foreground break-words">{displayKey}:</span>{' '}
                                    <span className="text-foreground font-bold font-mono break-words">{displayValue}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Regular Properties */}
            {propertiesToDisplay.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Properties</div>
                    <div className="space-y-1">
                        {propertiesToDisplay.map(([key, value], idx) => {
                            const displayKey = truncate(key, 60);
                            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                            const displayValue = truncate(stringValue, 200);

                            return (
                                <div key={idx} className="text-xs">
                                    <span className="text-muted-foreground break-words">{displayKey}:</span>{' '}
                                    <span className="text-foreground font-bold break-words">{displayValue}</span>
                                </div>
                            );
                        })}
                        {remainingCount > 0 && (
                            <div className="text-xs text-muted-foreground italic mt-1">
                                ...{remainingCount} more
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

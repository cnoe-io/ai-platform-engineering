"use client";

import React from 'react';
import { MultiDirectedGraph } from 'graphology';

interface OntologyNodeHoverCardProps {
    hoveredNode: string;
    graph: MultiDirectedGraph;
    truncateLabel?: (label: string, maxLength?: number) => string;
}

const defaultTruncate = (label: string, maxLength: number = 30): string => {
    if (label.length <= maxLength) return label;
    return label.substring(0, maxLength - 3) + '...';
};

export default function OntologyNodeHoverCard({
    hoveredNode,
    graph,
    truncateLabel = defaultTruncate
}: OntologyNodeHoverCardProps) {
    if (!hoveredNode || !graph.hasNode(hoveredNode)) {
        return null;
    }

    const nodeData = graph.getNodeAttributes(hoveredNode);
    const entityData = nodeData.entityData;
    const entityType = entityData?.entity_type || 'Entity';
    const nodeColor = nodeData.color;

    // Get all relations for this node
    const nodeId = hoveredNode;
    const outgoingRelations: Array<{ label: string; count: number; isBidirectional: boolean }> = [];
    const incomingRelations: Array<{ label: string; count: number; isBidirectional: boolean }> = [];

    graph.forEachOutEdge(nodeId, (_edge, attributes) => {
        // Extract clean label (remove bidirectional symbol and truncation)
        let cleanLabel = attributes.label || 'unknown';
        cleanLabel = cleanLabel.replace(/^⟷\s*/, ''); // Remove bidirectional symbol
        cleanLabel = cleanLabel.replace(/^…\s*/, ''); // Remove ellipsis

        outgoingRelations.push({
            label: cleanLabel,
            count: attributes.relationCount || 1,
            isBidirectional: attributes.isBidirectional || false
        });
    });

    graph.forEachInEdge(nodeId, (_edge, attributes) => {
        // Skip if bidirectional (already counted in outgoing)
        if (attributes.isBidirectional) return;

        // Extract clean label (remove bidirectional symbol and truncation)
        let cleanLabel = attributes.label || 'unknown';
        cleanLabel = cleanLabel.replace(/^⟷\s*/, ''); // Remove bidirectional symbol
        cleanLabel = cleanLabel.replace(/^…\s*/, ''); // Remove ellipsis

        incomingRelations.push({
            label: cleanLabel,
            count: attributes.relationCount || 1,
            isBidirectional: false
        });
    });

    // Group relations by label for display
    const groupedOutgoing = new Map<string, number>();
    outgoingRelations.forEach(({ label, count }) => {
        groupedOutgoing.set(label, (groupedOutgoing.get(label) || 0) + count);
    });

    const groupedIncoming = new Map<string, number>();
    incomingRelations.forEach(({ label, count }) => {
        groupedIncoming.set(label, (groupedIncoming.get(label) || 0) + count);
    });

    const totalOutgoing = Array.from(groupedOutgoing.values()).reduce((sum, count) => sum + count, 0);
    const totalIncoming = Array.from(groupedIncoming.values()).reduce((sum, count) => sum + count, 0);

    return (
        <div className="absolute top-2.5 left-2.5 z-[1000] bg-card border border-border rounded-lg p-3 shadow-lg max-w-[350px] pointer-events-none">
            {/* Entity Type Header with color */}
            <div className="flex items-start gap-2 mb-3 pb-2 border-b border-border">
                <div
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: nodeColor }}
                />
                <span className="text-sm font-semibold text-foreground break-words">
                    {entityType}
                </span>
            </div>

            {/* Relations Summary */}
            <div className="space-y-2">
                {/* Outgoing Relations */}
                {totalOutgoing > 0 && (
                    <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                            Outgoing ({totalOutgoing})
                        </div>
                        <div className="space-y-1">
                            {Array.from(groupedOutgoing.entries()).slice(0, 3).map(([label, count], idx) => (
                                <div key={idx} className="text-xs flex items-center gap-1">
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-foreground font-medium">{truncateLabel(label, 25)}</span>
                                    {count > 1 && <span className="text-muted-foreground">×{count}</span>}
                                </div>
                            ))}
                            {groupedOutgoing.size > 3 && (
                                <div className="text-xs text-muted-foreground italic">
                                    ...{groupedOutgoing.size - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Incoming Relations */}
                {totalIncoming > 0 && (
                    <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                            Incoming ({totalIncoming})
                        </div>
                        <div className="space-y-1">
                            {Array.from(groupedIncoming.entries()).slice(0, 3).map(([label, count], idx) => (
                                <div key={idx} className="text-xs flex items-center gap-1">
                                    <span className="text-muted-foreground">←</span>
                                    <span className="text-foreground font-medium">{truncateLabel(label, 25)}</span>
                                    {count > 1 && <span className="text-muted-foreground">×{count}</span>}
                                </div>
                            ))}
                            {groupedIncoming.size > 3 && (
                                <div className="text-xs text-muted-foreground italic">
                                    ...{groupedIncoming.size - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* No Relations */}
                {totalOutgoing === 0 && totalIncoming === 0 && (
                    <div className="text-xs text-muted-foreground italic">
                        No relations
                    </div>
                )}

                {/* Total count */}
                {(totalOutgoing > 0 || totalIncoming > 0) && (
                    <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                        Total: {totalOutgoing + totalIncoming} relation{totalOutgoing + totalIncoming !== 1 ? 's' : ''}
                    </div>
                )}
            </div>
        </div>
    );
}

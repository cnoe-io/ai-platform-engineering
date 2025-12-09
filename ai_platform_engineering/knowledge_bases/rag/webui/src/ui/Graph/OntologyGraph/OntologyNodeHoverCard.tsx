import React from 'react';
import { MultiDirectedGraph } from 'graphology';

interface OntologyNodeHoverCardProps {
    hoveredNode: string;
    graph: MultiDirectedGraph;
    truncateLabel: (label: string, maxLength?: number) => string;
}

export default function OntologyNodeHoverCard({ hoveredNode, graph, truncateLabel }: OntologyNodeHoverCardProps) {
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
            maxWidth: '350px',
            pointerEvents: 'none'
        }}>
            {/* Entity Type Header with color */}
            <div className="flex items-start gap-2 mb-3 pb-2 border-b border-gray-200">
                <div 
                    style={{ 
                        width: '12px', 
                        height: '12px', 
                        borderRadius: '50%', 
                        backgroundColor: nodeColor,
                        flexShrink: 0,
                        marginTop: '2px'
                    }} 
                />
                <span className="text-sm font-semibold text-gray-800 break-words" style={{ wordBreak: 'break-word' }}>
                    {entityType}
                </span>
            </div>
            
            {/* Relations Summary */}
            <div className="space-y-2">
                {/* Outgoing Relations */}
                {totalOutgoing > 0 && (
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Outgoing ({totalOutgoing})
                        </div>
                        <div className="space-y-1">
                            {Array.from(groupedOutgoing.entries()).slice(0, 3).map(([label, count], idx) => {
                                return (
                                    <div key={idx} className="text-xs flex items-center gap-1">
                                        <span className="text-gray-400">→</span>
                                        <span className="text-gray-900 font-medium">{truncateLabel(label, 25)}</span>
                                        {count > 1 && <span className="text-gray-400">×{count}</span>}
                                    </div>
                                );
                            })}
                            {groupedOutgoing.size > 3 && (
                                <div className="text-xs text-gray-400 italic">
                                    ...{groupedOutgoing.size - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {/* Incoming Relations */}
                {totalIncoming > 0 && (
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Incoming ({totalIncoming})
                        </div>
                        <div className="space-y-1">
                            {Array.from(groupedIncoming.entries()).slice(0, 3).map(([label, count], idx) => {
                                return (
                                    <div key={idx} className="text-xs flex items-center gap-1">
                                        <span className="text-gray-400">←</span>
                                        <span className="text-gray-900 font-medium">{truncateLabel(label, 25)}</span>
                                        {count > 1 && <span className="text-gray-400">×{count}</span>}
                                    </div>
                                );
                            })}
                            {groupedIncoming.size > 3 && (
                                <div className="text-xs text-gray-400 italic">
                                    ...{groupedIncoming.size - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {/* No Relations */}
                {totalOutgoing === 0 && totalIncoming === 0 && (
                    <div className="text-xs text-gray-400 italic">
                        No relations
                    </div>
                )}
                
                {/* Total count */}
                {(totalOutgoing > 0 || totalIncoming > 0) && (
                    <div className="pt-2 border-t border-gray-200 text-xs text-gray-500">
                        Total: {totalOutgoing + totalIncoming} relation{totalOutgoing + totalIncoming !== 1 ? 's' : ''}
                    </div>
                )}
            </div>
        </div>
    );
}


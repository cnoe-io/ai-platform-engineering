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
    const outgoingRelations: string[] = [];
    const incomingRelations: string[] = [];
    
    graph.forEachOutEdge(nodeId, (_edge, attributes) => {
        const relationName = attributes.relationData?.relation_name || 'unknown';
        outgoingRelations.push(relationName);
    });
    
    graph.forEachInEdge(nodeId, (_edge, attributes) => {
        const relationName = attributes.relationData?.relation_name || 'unknown';
        incomingRelations.push(relationName);
    });
    
    // Count unique relation names
    const uniqueOutgoing = [...new Set(outgoingRelations)];
    const uniqueIncoming = [...new Set(incomingRelations)];
    
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
                {outgoingRelations.length > 0 && (
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Outgoing ({outgoingRelations.length})
                        </div>
                        <div className="space-y-1">
                            {uniqueOutgoing.slice(0, 3).map((relationName, idx) => {
                                const count = outgoingRelations.filter(r => r === relationName).length;
                                return (
                                    <div key={idx} className="text-xs flex items-center gap-1">
                                        <span className="text-gray-400">→</span>
                                        <span className="text-gray-900 font-medium">{truncateLabel(relationName, 25)}</span>
                                        {count > 1 && <span className="text-gray-400">×{count}</span>}
                                    </div>
                                );
                            })}
                            {uniqueOutgoing.length > 3 && (
                                <div className="text-xs text-gray-400 italic">
                                    ...{uniqueOutgoing.length - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {/* Incoming Relations */}
                {incomingRelations.length > 0 && (
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Incoming ({incomingRelations.length})
                        </div>
                        <div className="space-y-1">
                            {uniqueIncoming.slice(0, 3).map((relationName, idx) => {
                                const count = incomingRelations.filter(r => r === relationName).length;
                                return (
                                    <div key={idx} className="text-xs flex items-center gap-1">
                                        <span className="text-gray-400">←</span>
                                        <span className="text-gray-900 font-medium">{truncateLabel(relationName, 25)}</span>
                                        {count > 1 && <span className="text-gray-400">×{count}</span>}
                                    </div>
                                );
                            })}
                            {uniqueIncoming.length > 3 && (
                                <div className="text-xs text-gray-400 italic">
                                    ...{uniqueIncoming.length - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {/* No Relations */}
                {outgoingRelations.length === 0 && incomingRelations.length === 0 && (
                    <div className="text-xs text-gray-400 italic">
                        No relations
                    </div>
                )}
                
                {/* Total count */}
                {(outgoingRelations.length > 0 || incomingRelations.length > 0) && (
                    <div className="pt-2 border-t border-gray-200 text-xs text-gray-500">
                        Total: {outgoingRelations.length + incomingRelations.length} relation{outgoingRelations.length + incomingRelations.length !== 1 ? 's' : ''}
                    </div>
                )}
            </div>
        </div>
    );
}


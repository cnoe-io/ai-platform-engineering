"use client";

import React, { useState } from 'react';
import { MultiDirectedGraph } from 'graphology';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { getColorForNode } from '../shared/graphStyles';

interface DataNodeDetailsCardProps {
    nodeId: string;
    nodeData: any;
    graph: MultiDirectedGraph;
    onClose: () => void;
    onExplore?: (entityType: string, primaryKey: string) => void;
}

export default function DataNodeDetailsCard({
    nodeId,
    nodeData,
    graph,
    onClose,
    onExplore
}: DataNodeDetailsCardProps) {
    const [showProperties, setShowProperties] = useState(true);
    const [showInternal, setShowInternal] = useState(false);

    const entityData = nodeData.entityData || nodeData;
    const entityType = entityData?.entity_type || nodeData.entityType || 'Entity';
    const nodeColor = nodeData.color || getColorForNode(entityType);
    const primaryKey = entityData?.primary_key || entityData?.all_properties?._entity_pk || '';

    // Get all properties
    const allProperties = entityData?.all_properties || {};
    
    // Filter properties
    const displayProperties = Object.entries(allProperties).filter(
        ([key]) => !key.startsWith('_')
    );
    const internalProperties = Object.entries(allProperties).filter(
        ([key]) => key.startsWith('_')
    );

    // Get relations count
    const outDegree = graph.hasNode(nodeId) ? graph.outDegree(nodeId) : 0;
    const inDegree = graph.hasNode(nodeId) ? graph.inDegree(nodeId) : 0;

    // Format value for display
    const formatValue = (value: any): string => {
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    };

    return (
        <div className="absolute top-2 left-2 z-[1000] bg-card border border-border rounded-lg shadow-xl w-[400px] h-[50%] min-w-[280px] max-w-[600px] min-h-[200px] max-h-[calc(100%-16px)] overflow-hidden flex flex-col text-sm resize overflow-auto">
            {/* Header */}
            <div 
                className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0"
                style={{ backgroundColor: `${nodeColor}15` }}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: nodeColor }}
                    />
                    <span className="font-semibold text-foreground truncate">
                        {entityType}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {onExplore && (
                        <button
                            onClick={() => onExplore(entityType, primaryKey)}
                            className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white font-medium"
                            title="Expand this node's neighbors"
                        >
                            Expand
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-muted rounded transition-colors"
                    >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto text-xs">
                {/* Primary Key */}
                {primaryKey && (
                    <div className="px-3 py-2 border-b border-border">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                            Primary Key
                        </div>
                        <code className="text-foreground font-mono text-xs break-all">
                            {primaryKey}
                        </code>
                    </div>
                )}

                {/* Connection Stats */}
                <div className="px-3 py-2 border-b border-border">
                    <div className="flex gap-4 text-xs">
                        <div>
                            <span className="text-muted-foreground">Outgoing:</span>{' '}
                            <span className="font-medium text-foreground">{outDegree}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Incoming:</span>{' '}
                            <span className="font-medium text-foreground">{inDegree}</span>
                        </div>
                    </div>
                </div>

                {/* Properties (collapsible) */}
                {displayProperties.length > 0 && (
                    <div className="px-3 py-2 border-b border-border">
                        <button
                            onClick={() => setShowProperties(!showProperties)}
                            className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                        >
                            {showProperties ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            <span>Properties ({displayProperties.length})</span>
                        </button>
                        {showProperties && (
                            <div className="mt-1.5 space-y-1.5">
                                {displayProperties.map(([key, value]) => (
                                    <div key={key} className="flex flex-col">
                                        <span className="text-muted-foreground text-[10px]">{key}</span>
                                        <span className="text-foreground break-all pl-2">
                                            {formatValue(value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Internal Properties (collapsible) */}
                {internalProperties.length > 0 && (
                    <div className="px-3 py-2">
                        <button
                            onClick={() => setShowInternal(!showInternal)}
                            className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full"
                        >
                            {showInternal ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            <span>Internal ({internalProperties.length})</span>
                        </button>
                        {showInternal && (
                            <div className="mt-1.5 space-y-1 font-mono text-[10px]">
                                {internalProperties.map(([key, value]) => (
                                    <div key={key} className="flex flex-col">
                                        <span className="text-muted-foreground">{key}</span>
                                        <span className="text-foreground break-all pl-2">
                                            {formatValue(value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

"use client";

import React, { ReactNode } from 'react';
import { SigmaContainer } from "@react-sigma/core";
import { MultiDirectedGraph } from "graphology";
import { Loader2 } from 'lucide-react';
import '../sigma-styles.css';

// Import shared controllers
import CameraController from './controllers/CameraController';
import SigmaInstanceCapture from './controllers/SigmaInstanceCapture';
import GraphDragController from './controllers/GraphDragController';
import GraphSettingsController from './controllers/GraphSettingsController';
import GraphEventsController from './controllers/GraphEventsController';
import GraphDataController from './controllers/GraphDataController';

export interface GraphFilters {
    [key: string]: any;
}

export interface SigmaGraphProps {
    // Graph data
    graph: MultiDirectedGraph;

    // State management
    dataReady: boolean;
    isLoading: boolean;
    hoveredNode: string | null;
    setHoveredNode: (node: string | null) => void;
    isDragging: boolean;
    setIsDragging: (dragging: boolean) => void;
    selectedElement: { type: 'node'; id: string; data: any } | null;

    // Event handlers
    onNodeClick: (nodeId: string, nodeData: any, event?: any) => void;
    onSigmaReady?: (sigma: any) => void;

    // Filters
    filters: GraphFilters;
    customFilterLogic?: (graph: any, filters: GraphFilters) => void;

    // Custom components
    detailsCardComponent?: ReactNode;
    emptyStateComponent?: ReactNode;

    // Styling
    containerClassName?: string;
    containerStyle?: React.CSSProperties;
}

/**
 * SigmaGraph - A reusable Sigma.js graph visualization component
 *
 * This component provides a common foundation for graph visualization using Sigma.js.
 * It includes drag-and-drop, zoom controls, filtering, and customizable detail cards.
 */
export default function SigmaGraph({
    graph,
    dataReady,
    isLoading,
    hoveredNode,
    setHoveredNode,
    isDragging,
    setIsDragging,
    selectedElement,
    onNodeClick,
    onSigmaReady,
    filters,
    customFilterLogic,
    detailsCardComponent,
    emptyStateComponent,
    containerClassName = '',
    containerStyle = {},
}: SigmaGraphProps) {

    return (
        <div
            style={{
                flex: 1,
                width: '100%',
                height: '100%',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                backgroundColor: 'hsl(var(--background))',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                ...containerStyle
            }}
            className={containerClassName}
        >
            {!dataReady && !isLoading ? (
                // Empty state
                emptyStateComponent || (
                    <div style={{ flex: 1, width: '100%', padding: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="text-center space-y-4 max-w-md">
                            <div className="text-6xl text-primary mb-4">🌐</div>
                            <h3 className="text-2xl font-bold text-foreground">No Data</h3>
                            <p className="text-muted-foreground">No graph data available.</p>
                        </div>
                    </div>
                )
            ) : (
                <div style={{ flex: 1, width: '100%', minHeight: 0, position: 'relative' }}>
                    {/* Loading Overlay */}
                    {isLoading && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'hsl(var(--background) / 0.9)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10,
                            borderRadius: '8px'
                        }}>
                            <div className="text-center space-y-4">
                                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                                <p className="text-lg font-semibold text-foreground">Loading graph data...</p>
                                <p className="text-sm text-muted-foreground">Fetching entities and relations</p>
                            </div>
                        </div>
                    )}

                    <SigmaContainer
                        graph={graph}
                        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
                        settings={{
                            renderEdgeLabels: true,
                            defaultEdgeType: "arrow",
                            labelRenderedSizeThreshold: 10,
                            labelDensity: 0.3,
                            labelGridCellSize: 150,
                            labelFont: "Inter, system-ui, sans-serif",
                            labelWeight: "600",
                            labelSize: 12,
                            labelColor: { color: "#ffffff" },
                            zIndex: true,
                            allowInvalidContainer: true,
                        }}
                    >
                        {onSigmaReady && <SigmaInstanceCapture onSigmaReady={onSigmaReady} />}
                        <CameraController />
                        <GraphDragController setIsDragging={setIsDragging} />
                        <GraphSettingsController
                            hoveredNode={hoveredNode}
                            selectedNodeId={selectedElement?.type === 'node' ? selectedElement.id : null}
                        />
                        <GraphEventsController
                            setHoveredNode={setHoveredNode}
                            onNodeClick={onNodeClick}
                            isDragging={isDragging}
                        />
                        <GraphDataController filters={filters} customFilterLogic={customFilterLogic} />

                        

                        {/* Details Cards - positioned absolutely to appear in fullscreen */}
                        {detailsCardComponent && (
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                height: '100%',
                                zIndex: 1000,
                                pointerEvents: 'none',
                                display: 'flex',
                                alignItems: 'flex-start',
                                paddingTop: '8px',
                                paddingLeft: '8px'
                            }}>
                                <div style={{ pointerEvents: 'auto', height: '100%', maxHeight: 'calc(100% - 20px)' }}>
                                    {detailsCardComponent}
                                </div>
                            </div>
                        )}
                    </SigmaContainer>
                </div>
            )}
        </div>
    );
}

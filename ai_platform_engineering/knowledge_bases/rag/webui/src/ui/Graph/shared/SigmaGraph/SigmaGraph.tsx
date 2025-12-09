import React, { ReactNode, useMemo } from 'react';
import { SigmaContainer, ControlsContainer, ZoomControl, FullScreenControl } from "@react-sigma/core";
import { MultiDirectedGraph } from "graphology";
import './sigma-styles.css';

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
                backgroundColor: 'white', 
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
                            <div className="text-6xl text-indigo-500 mb-4">🌐</div>
                            <h3 className="text-2xl font-bold text-gray-800">No Data</h3>
                            <p className="text-gray-600">No graph data available.</p>
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
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10,
                            borderRadius: '8px'
                        }}>
                            <div className="text-center space-y-4">
                                <svg className="animate-spin h-12 w-12 text-indigo-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <p className="text-lg font-semibold text-gray-700">Loading graph data...</p>
                                <p className="text-sm text-gray-500">Fetching entities and relations</p>
                            </div>
                        </div>
                    )}
                    
                    <SigmaContainer 
                        graph={graph}
                        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
                        settings={{
                            renderEdgeLabels: true,
                            defaultEdgeType: "arrow",
                            labelRenderedSizeThreshold: 8,
                            labelDensity: 0.5,
                            labelGridCellSize: 100,
                            labelFont: "Inter, sans-serif",
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
                        
                        <ControlsContainer position="bottom-right">
                            <ZoomControl />
                            <FullScreenControl />
                        </ControlsContainer>
                        
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


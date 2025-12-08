import { useSetSettings, useSigma } from "@react-sigma/core";
import { FC, PropsWithChildren, useEffect } from "react";

interface GraphSettingsControllerProps {
    hoveredNode: string | null;
    selectedNodeId: string | null;
}

const GraphSettingsController: FC<PropsWithChildren<GraphSettingsControllerProps>> = ({ 
    children, 
    hoveredNode,
    selectedNodeId 
}) => {
    const sigma = useSigma();
    const setSettings = useSetSettings();
    const graph = sigma.getGraph();

    /**
     * Update node and edge appearance based on hover state
     */
    useEffect(() => {
        setSettings({
            nodeReducer: (node, data) => {
                const res: any = { ...data };
                
                // Check if node is marked as highlighted (explored/focused nodes)
                const isExploredNode = data.highlighted === true;
                
                // Check if this node is selected
                const isSelected = node === selectedNodeId;

                // Determine which node to use for highlighting (hovered node only)
                const activeNode = hoveredNode;

                if (activeNode) {
                    // When a node is hovered, highlight it and its neighbors
                    if (node === activeNode || graph.neighbors(activeNode).includes(node)) {
                        res.zIndex = 1;
                        // Show label for connected nodes
                        res.forceLabel = true;
                    } else {
                        res.color = "#E2E2E2";
                        res.zIndex = 0;
                        // Hide label for non-connected nodes
                        res.label = null;
                    }
                } else {
                    // When not hovering, show all node labels
                    res.forceLabel = false;
                }
                
                // Add visual border to explored/focused nodes
                if (isExploredNode) {
                    res.borderSize = 3;
                    res.borderColor = '#3b82f6'; // Blue border
                    res.zIndex = Math.max(res.zIndex || 0, 2); // Keep them on top
                }
                
                // Add distinct visual marker for selected nodes
                if (isSelected) {
                    // Darken the node color by reducing brightness
                    // Parse the original color and make it darker
                    const originalColor = data.color || '#999999';
                    
                    // Simple darkening: convert hex to RGB, multiply by 0.5 (50% darker)
                    const darkenColor = (hex: string): string => {
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        
                        const newR = Math.max(0, Math.floor(r * 0.5));
                        const newG = Math.max(0, Math.floor(g * 0.5));
                        const newB = Math.max(0, Math.floor(b * 0.5));
                        
                        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
                    };
                    
                    res.color = darkenColor(originalColor); // 50% darker version of original color
                    res.zIndex = Math.max(res.zIndex || 0, 3); // Keep selected on top
                    res.forceLabel = true; // Always show label for selected node
                    // Make the node significantly larger
                    res.size = (data.size || 15) * 1.8;
                    // Make the label bold
                    res.labelWeight = 'bold';
                    res.labelSize = 14; // Slightly larger label
                }

                return res;
            },
            edgeReducer: (edge, data) => {
                const res: any = { ...data };

                // Determine which node to use for highlighting (hovered node only)
                const activeNode = hoveredNode;
                
                const source = graph.source(edge);
                const target = graph.target(edge);

                if (activeNode) {
                    // Highlight edges connected to hovered node with the node's color
                    if (source === activeNode || target === activeNode) {
                        // Check if this edge is currently hidden by filters
                        const isHiddenByFilter = graph.getEdgeAttribute(edge, 'hidden');
                        
                        // Only show if not hidden by filters
                        if (!isHiddenByFilter) {
                            // Get the active node's color
                            const nodeColor = graph.getNodeAttribute(activeNode, 'color');
                            res.color = nodeColor;
                            res.size = (data.originalSize || data.size) * 1.5;
                            res.zIndex = 1;
                            res.hidden = false; // Keep visible
                            
                            // Show edge label
                            // Note: With status-based edges, each edge already has its correct label
                            // No need to count edges between same nodes anymore
                            res.label = data.label;
                        } else {
                            // Edge is hidden by filters - keep it hidden
                            res.hidden = true;
                            res.label = null;
                        }
                    } else {
                        // Hide unhighlighted edges when a node is hovered
                        res.hidden = true;
                        res.zIndex = 0;
                        res.label = null;
                    }
                } else {
                    // When not hovering, check if edge connects to a highlighted/focused node
                    const sourceHighlighted = graph.getNodeAttribute(source, 'highlighted');
                    const targetHighlighted = graph.getNodeAttribute(target, 'highlighted');
                    
                    if (sourceHighlighted || targetHighlighted) {
                        // Use the color of the highlighted node
                        const highlightedNode = sourceHighlighted ? source : target;
                        const nodeColor = graph.getNodeAttribute(highlightedNode, 'color');
                        res.color = nodeColor;
                        res.size = (data.originalSize || data.size) * 1.2; // Slightly thicker
                    } else {
                        // Reset color and size to original values
                        res.color = data.originalColor || data.color;
                        res.size = data.originalSize || data.size;
                    }
                    
                    // Hide edge labels
                    res.label = null;
                }

                return res;
            },
        });
    }, [hoveredNode, selectedNodeId, setSettings, graph]);

    return <>{children}</>;
};

export default GraphSettingsController;


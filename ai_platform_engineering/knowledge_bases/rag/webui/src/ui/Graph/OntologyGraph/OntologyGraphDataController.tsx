import { useSigma } from "@react-sigma/core";
import { FC, PropsWithChildren, useEffect } from "react";

export interface OntologyFilters {
    entityTypes: Set<string>;
    showAccepted: boolean;
    showRejected: boolean;
    showUncertain: boolean;
    focusedNodeId: string | null;
}

const OntologyGraphDataController: FC<PropsWithChildren<{ filters: OntologyFilters }>> = ({ filters, children }) => {
    const sigma = useSigma();
    const graph = sigma.getGraph();

    /**
     * Apply filters to graphology graph:
     */
    useEffect(() => {
        const { entityTypes, showAccepted, showRejected, showUncertain, focusedNodeId } = filters;
        
        // If a node is focused, show only that node and its connections
        if (focusedNodeId) {
            const focusedNode = graph.hasNode(focusedNodeId) ? focusedNodeId : null;
            
            if (focusedNode) {
                // Get all edges connected to the focused node
                const connectedNodes = new Set<string>();
                connectedNodes.add(focusedNode);
                
                graph.forEachEdge((edge, attributes, source, target) => {
                    if (source === focusedNode || target === focusedNode) {
                        connectedNodes.add(source);
                        connectedNodes.add(target);
                    }
                });
                
                // Hide all nodes except the focused node and its connections
                graph.forEachNode((node) => {
                    graph.setNodeAttribute(node, "hidden", !connectedNodes.has(node));
                });
                
                // Filter edges based on relation category
                graph.forEachEdge((edge, attributes) => {
                    const source = attributes.source || graph.source(edge);
                    const target = attributes.target || graph.target(edge);
                    
                    if (!connectedNodes.has(source) || !connectedNodes.has(target)) {
                        graph.setEdgeAttribute(edge, "hidden", true);
                        return;
                    }
                    
                    const evalResult = attributes.evaluationResult;
                    let shouldHide = false;
                    
                    if (evalResult === 'ACCEPTED' && !showAccepted) shouldHide = true;
                    if (evalResult === 'REJECTED' && !showRejected) shouldHide = true;
                    if ((evalResult === 'UNSURE' || evalResult === null || evalResult === undefined) && !showUncertain) shouldHide = true;
                    
                    graph.setEdgeAttribute(edge, "hidden", shouldHide);
                });
            }
        } else {
            // Regular filtering by entity types
            graph.forEachNode((node, attributes) => {
                const entityType = attributes.entityType || '';
                graph.setNodeAttribute(node, "hidden", !entityTypes.has(entityType));
            });
            
            // Filter edges based on both node visibility and relation category
            graph.forEachEdge((edge, attributes) => {
                const source = attributes.source || graph.source(edge);
                const target = attributes.target || graph.target(edge);
                const sourceHidden = graph.getNodeAttribute(source, "hidden");
                const targetHidden = graph.getNodeAttribute(target, "hidden");
                
                if (sourceHidden || targetHidden) {
                    graph.setEdgeAttribute(edge, "hidden", true);
                    return;
                }
                
                const evalResult = attributes.evaluationResult;
                let shouldHide = false;
                
                if (evalResult === 'ACCEPTED' && !showAccepted) shouldHide = true;
                if (evalResult === 'REJECTED' && !showRejected) shouldHide = true;
                if ((evalResult === 'UNSURE' || evalResult === null || evalResult === undefined) && !showUncertain) shouldHide = true;
                
                graph.setEdgeAttribute(edge, "hidden", shouldHide);
            });
        }
    }, [graph, filters]);

    return <>{children}</>;
};

export default OntologyGraphDataController;


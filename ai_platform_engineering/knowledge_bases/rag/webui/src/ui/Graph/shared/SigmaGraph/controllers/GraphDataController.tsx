import { useSigma } from "@react-sigma/core";
import { FC, PropsWithChildren, useEffect } from "react";

export interface GraphFilters {
    [key: string]: any;
}

interface GraphDataControllerProps {
    filters: GraphFilters;
    customFilterLogic?: (graph: any, filters: GraphFilters) => void;
}

/**
 * Generic graph data controller that applies filters to the graph.
 * Can be customized with custom filter logic or uses default entity type filtering.
 */
const GraphDataController: FC<PropsWithChildren<GraphDataControllerProps>> = ({ filters, customFilterLogic, children }) => {
    const sigma = useSigma();
    const graph = sigma.getGraph();

    /**
     * Apply filters to graphology graph
     */
    useEffect(() => {
        if (customFilterLogic) {
            customFilterLogic(graph, filters);
        } else {
            // Default filtering: just show all nodes and edges
            graph.forEachNode((node) => {
                graph.setNodeAttribute(node, "hidden", false);
            });
            
            graph.forEachEdge((edge) => {
                graph.setEdgeAttribute(edge, "hidden", false);
            });
        }
    }, [graph, filters, customFilterLogic]);

    return <>{children}</>;
};

export default GraphDataController;


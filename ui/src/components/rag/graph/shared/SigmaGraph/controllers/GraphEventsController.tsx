"use client";

import { useRegisterEvents,useSigma } from "@react-sigma/core";
import { FC,PropsWithChildren,useEffect } from "react";
import type { SigmaNodeEventPayload } from 'sigma/types';
import type { GraphEdgeAttributes,GraphNodeAttributes } from '../../graphTypes';

interface GraphEventsControllerProps {
    setHoveredNode: (node: string | null) => void;
    onNodeClick: (nodeId: string, nodeData: GraphNodeAttributes, event?: SigmaNodeEventPayload) => void;
    isDragging: boolean;
}

function getMouseLayer() {
    return document.querySelector(".sigma-mouse");
}

const GraphEventsController: FC<PropsWithChildren<GraphEventsControllerProps>> = ({
    setHoveredNode,
    onNodeClick,
    isDragging,
    children,
}) => {
    const sigma = useSigma<GraphNodeAttributes,GraphEdgeAttributes>();
    const graph = sigma.getGraph();
    const registerEvents = useRegisterEvents<GraphNodeAttributes,GraphEdgeAttributes>();

    /**
     * Initialize event handlers
     */
    useEffect(() => {
        registerEvents({
            clickNode(event) {
                const { node } = event;
                if (!graph.getNodeAttribute(node, "hidden")) {
                    const nodeData = graph.getNodeAttributes(node);
                    onNodeClick(node, nodeData, event);
                }
            },
            enterNode({ node }) {
                // Ignore hover events during dragging
                if (isDragging) return;

                if (!graph.getNodeAttribute(node, "hidden")) {
                    setHoveredNode(node);
                    const mouseLayer = getMouseLayer();
                    if (mouseLayer) mouseLayer.classList.add("mouse-pointer");
                }
            },
            leaveNode() {
                // Ignore hover events during dragging
                if (isDragging) return;

                setHoveredNode(null);
                const mouseLayer = getMouseLayer();
                if (mouseLayer) mouseLayer.classList.remove("mouse-pointer");
            },
        });
    }, [registerEvents, graph, setHoveredNode, onNodeClick, isDragging]);

    return <>{children}</>;
};

export default GraphEventsController;

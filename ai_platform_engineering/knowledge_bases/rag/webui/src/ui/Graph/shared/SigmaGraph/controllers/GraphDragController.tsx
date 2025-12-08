import { useEffect } from 'react';
import { useSigma, useRegisterEvents } from '@react-sigma/core';

interface GraphDragControllerProps {
    setIsDragging: (dragging: boolean) => void;
}

/**
 * Component to enable node dragging in the Sigma graph.
 */
const GraphDragController: React.FC<GraphDragControllerProps> = ({ setIsDragging }) => {
    const sigma = useSigma();
    const registerEvents = useRegisterEvents();

    useEffect(() => {
        let draggedNode: string | null = null;
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        const handleDown = (event: any) => {
            if (!event.node) return;
            
            const node = event.node;
            isDragging = true;
            draggedNode = node;
            setIsDragging(true);
            
            const graph = sigma.getGraph();
            
            // Get the node position in graph coordinates
            const nodeX = graph.getNodeAttribute(node, 'x');
            const nodeY = graph.getNodeAttribute(node, 'y');
            
            // Get mouse position in graph coordinates
            const mousePos = sigma.viewportToGraph(event.event);
            
            // Calculate offset in graph coordinates
            dragOffset = {
                x: nodeX - mousePos.x,
                y: nodeY - mousePos.y
            };
            
            // Disable camera movement during drag
            sigma.getCamera().disable();
        };

        const handleMove = (event: MouseEvent) => {
            if (!isDragging || !draggedNode) return;

            // Get the container bounding rect
            const container = sigma.getContainer();
            const rect = container.getBoundingClientRect();
            
            // Calculate mouse position relative to container
            let x = event.clientX - rect.left;
            let y = event.clientY - rect.top;
            
            // Clamp to container bounds with margin to reduce zoom trigger
            const margin = 100;
            x = Math.max(margin, Math.min(x, rect.width - margin));
            y = Math.max(margin, Math.min(y, rect.height - margin));
            
            // Convert to graph coordinates
            const mousePos = sigma.viewportToGraph({ x, y });
            
            // Apply the offset to maintain grab point
            const newNodePos = {
                x: mousePos.x + dragOffset.x,
                y: mousePos.y + dragOffset.y
            };

            // Update node position
            const graph = sigma.getGraph();
            graph.setNodeAttribute(draggedNode, 'x', newNodePos.x);
            graph.setNodeAttribute(draggedNode, 'y', newNodePos.y);
        };

        const handleUp = () => {
            if (isDragging) {
                isDragging = false;
                draggedNode = null;
                setIsDragging(false);
                
                // Re-enable camera movement
                sigma.getCamera().enable();
            }
        };

        const handleLeave = () => {
            if (isDragging) {
                isDragging = false;
                draggedNode = null;
                setIsDragging(false);
                sigma.getCamera().enable();
            }
        };

        // Register Sigma events
        registerEvents({
            downNode: handleDown,
        });

        // Register document events for mouse move/up
        document.addEventListener('mousemove', handleMove, { passive: false });
        document.addEventListener('mouseup', handleUp);
        document.addEventListener('mouseleave', handleLeave);

        return () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
            document.removeEventListener('mouseleave', handleLeave);
        };
    }, [sigma, registerEvents, setIsDragging]);

    return null;
};

export default GraphDragController;


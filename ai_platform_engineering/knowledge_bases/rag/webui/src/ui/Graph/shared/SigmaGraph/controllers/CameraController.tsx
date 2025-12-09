import { useSigma } from "@react-sigma/core";
import { FC, PropsWithChildren, useEffect } from "react";

const CameraController: FC<PropsWithChildren> = ({ children }) => {
    const sigma = useSigma();
    
    useEffect(() => {
        // Force Sigma to recalculate container dimensions and fit camera
        // This is needed because Sigma initializes before the flex container is fully sized
        const resizeAndFit = () => {
            try {
                // Force renderer resize
                if (sigma.renderers && sigma.renderers[0]) {
                    sigma.renderers[0].resize();
                }
                
                // Refresh sigma (recalculates container size)
                sigma.refresh();
                
                // Fit camera to show all nodes
                const graph = sigma.getGraph();
                if (graph.order > 0) {
                    sigma.getCamera().animatedReset({ duration: 600 });
                }
            } catch (error) {
                console.error('Failed to resize/fit camera:', error);
            }
        };
        
        // Call immediately and after a short delay
        resizeAndFit();
        const timeout = setTimeout(resizeAndFit, 100);
        
        return () => clearTimeout(timeout);
    }, [sigma]);
    
    return <>{children}</>;
};

export default CameraController;


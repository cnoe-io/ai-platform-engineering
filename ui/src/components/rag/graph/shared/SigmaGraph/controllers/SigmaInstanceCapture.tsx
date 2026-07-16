"use client";

import { useSigma } from "@react-sigma/core";
import { FC,PropsWithChildren,useEffect } from "react";
import type Sigma from 'sigma';
import type { GraphEdgeAttributes,GraphNodeAttributes } from '../../graphTypes';

interface SigmaInstanceCaptureProps {
    onSigmaReady: (sigma: Sigma<GraphNodeAttributes,GraphEdgeAttributes>) => void;
}

const SigmaInstanceCapture: FC<PropsWithChildren<SigmaInstanceCaptureProps>> = ({ 
    children, 
    onSigmaReady,
}) => {
    const sigma = useSigma<GraphNodeAttributes,GraphEdgeAttributes>();

    useEffect(() => {
        onSigmaReady(sigma);
    }, [sigma, onSigmaReady]);

    return <>{children}</>;
};

export default SigmaInstanceCapture;

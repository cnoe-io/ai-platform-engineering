import { useSigma } from "@react-sigma/core";
import { FC, PropsWithChildren, useEffect } from "react";

interface SigmaInstanceCaptureProps {
    onSigmaReady: (sigma: any) => void;
}

const SigmaInstanceCapture: FC<PropsWithChildren<SigmaInstanceCaptureProps>> = ({ children, onSigmaReady }) => {
    const sigma = useSigma();
    
    useEffect(() => {
        onSigmaReady(sigma);
    }, [sigma, onSigmaReady]);
    
    return <>{children}</>;
};

export default SigmaInstanceCapture;


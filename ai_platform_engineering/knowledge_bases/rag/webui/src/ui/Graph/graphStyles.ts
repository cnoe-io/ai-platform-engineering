// Shared color scheme for graph nodes across Ontology and Data views

import { colorMap, defaultColor, getColorForType } from '../typeConfig';

// Re-export for backward compatibility
export { colorMap, defaultColor };

// Evaluation result enum matching the backend
export enum EvaluationResult {
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    UNSURE = 'UNSURE'
}

export const darkenColor = (hex: string, percent: number): string => {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = (num >> 8 & 0x00FF) - amt;
    const B = (num & 0x0000FF) - amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
};

export const getColorForNode = (label: string): string => {
    return getColorForType(label);
};

// Helper to get evaluation result from relation data
export const getEvaluationResult = (relation: any): EvaluationResult | null => {
    const hasEvaluation = relation.relation_properties?.eval_last_evaluated !== undefined && 
                          relation.relation_properties?.eval_last_evaluated !== null &&
                          relation.relation_properties?.eval_last_evaluated > 0;
    
    return hasEvaluation ? relation.relation_properties?.eval_result : null;
};

// Simple edge styling for data graphs
export const getDataEdgeStyle = (isSelected: boolean = false) => {
    const baseStyle = {
        stroke: '#6b7280',
        strokeWidth: 2,
    };

    if (isSelected) {
        return {
            ...baseStyle,
            strokeWidth: 4,
            zIndex: 1000,
        };
    }

    return baseStyle;
};

// Complex edge styling for ontology graphs with evaluation result-based styling
export const getOntologyEdgeStyle = (relation: any, isSelected: boolean = false) => {
    const hasEvaluation = relation.relation_properties?.evaluation_last_evaluated !== undefined && 
                          relation.relation_properties?.evaluation_last_evaluated !== null &&
                          relation.relation_properties?.evaluation_last_evaluated > 0;

    const result = hasEvaluation ? relation.relation_properties?.evaluation_result : null;
    
    let baseStyle: any;
    
    if (result === EvaluationResult.ACCEPTED) {
        baseStyle = {
            stroke: '#6b7280',
            strokeWidth: 2
        };
    } else if (result === EvaluationResult.REJECTED) {
        baseStyle = {
            stroke: '#ef4444', // red
            strokeDasharray: '10 5',
            strokeWidth: 2
        };
    } else {
        // UNSURE or no evaluation
        baseStyle = {
            stroke: '#6b7280', // gray
            strokeDasharray: '5 5',
            strokeWidth: 2
        };
    }

    // Apply selection styling
    if (isSelected) {
        return {
            ...baseStyle,
            strokeWidth: 4, // Much thicker when selected
            zIndex: 1000 // Bring to front
        };
    }

    return baseStyle;
};

// Sigma.js specific edge styling - returns color and size only
// Note: Sigma doesn't support dashed/dotted edges out of the box
// We'll use color and size to differentiate edge types
export const getSigmaEdgeStyle = (
    relation: any, 
    heuristicsData?: any, 
    statsData?: { mean: number; stdDev: number },
    thicknessMultiplier: number = 1.0
) => {
    const evalResult = getEvaluationResult(relation);
    
    let color = '#d1d5db'; // very light gray
    let size = 2;
    
    if (evalResult === EvaluationResult.ACCEPTED) {
        color = '#d1d5db'; // very light gray (was #9ca3af)
        // Scale thickness based on total_matches using z-score statistics
        if (heuristicsData?.total_matches && statsData && statsData.stdDev > 0) {
            const matches = heuristicsData.total_matches;
            const mean = statsData.mean;
            const stdDev = statsData.stdDev;
            
            // Calculate z-score (how many standard deviations from mean)
            const zScore = (matches - mean) / stdDev;
            
            // Base thickness ranges (before multiplier)
            const minThickness = 1.2;
            const normalMin = 1.5;
            const normalMax = 4.0;
            const highMax = 6.0;
            
            // Map z-scores to thickness ranges
            if (zScore <= -1.5) {
                // Well below average: minimum size
                size = minThickness;
            } else if (zScore <= 1.5) {
                // Normal range (-1.5 to 1.5 std devs, ~86% of data)
                // Maps to normalMin-normalMax
                const normalizedZ = (zScore + 1.5) / 3.0; // 0 to 1 range
                size = normalMin + (normalizedZ * (normalMax - normalMin));
            } else if (zScore <= 3.0) {
                // High outliers (1.5 to 3 std devs)
                // Maps to normalMax-highMax
                const normalizedZ = (zScore - 1.5) / 1.5; // 0 to 1 range
                size = normalMax + (normalizedZ * (highMax - normalMax));
            } else {
                // Extreme outliers (>3 std devs)
                // Capped at highMax
                size = highMax;
            }
            
            // Apply multiplier
            size = size * thicknessMultiplier;
        } else {
            size = 2 * thicknessMultiplier; // Default for accepted without heuristics
        }
    } else if (evalResult === EvaluationResult.REJECTED) {
        color = '#fca5a5'; // very light red (was #f87171)
        size = 2.5 * thicknessMultiplier;
    } else {
        // UNSURE or no evaluation
        color = '#fdba74'; // light orange
        size = 2.5 * thicknessMultiplier;
    }
    
    return { color, size };
};
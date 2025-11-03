// Shared color scheme for graph nodes across Ontology and Data views

// Evaluation result enum matching the backend
export enum EvaluationResult {
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    UNSURE = 'UNSURE'
}

export const colorMap: { [key: string]: string } = {
    'aws': '#FFC107',
    'backstage': '#4CAF50',
    'k8s': '#2196F3',
    'event': '#F44336',
};

export const defaultColor = '#FFFFFF';

export const darkenColor = (hex: string, percent: number): string => {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = (num >> 8 & 0x00FF) - amt;
    const B = (num & 0x0000FF) - amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
};

export const getColorForNode = (label: string): string => {
    for (const prefix in colorMap) {
        if (label.toLowerCase().startsWith(prefix.toLowerCase())) {
            return colorMap[prefix];
        }
    }
    return defaultColor;
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
/**
 * Type Configuration - Ported from RAG WebUI
 *
 * Centralized configuration for entity/datasource types
 * This includes color schemes and icon mappings
 */

// Color map for entity types
export const colorMap: { [key: string]: string } = {
    'aws': '#FFC107',
    'backstage': '#4CAF50',
    'k8s': '#2196F3',
    'kubernetes': '#2196F3',
    'argo': '#ef7b4d',
    'github': '#3f3f3f',
    'slack': '#4A154B',
    'webex': '#07C1E4',
};

// Icon map for ingestor/datasource types
// Using emojis for simplicity - can be replaced with image paths if needed
export const iconMap: { [key: string]: string } = {
    'aws': '☁️',
    'backstage': '🎭',
    'k8s': '⚙️',
    'kubernetes': '⚙️',
    'argo': '🔶',
    'github': '🐙',
    'slack': '💬',
    'webex': '💻',
    'web': '🌐',
    'confluence': '📚️',
};

export const defaultColor = '#9E9E9E';

// Helper function to get icon for a given type/label
export const getIconForType = (label: string): string | null => {
    const lowerLabel = label.toLowerCase();
    for (const prefix in iconMap) {
        if (lowerLabel.startsWith(prefix.toLowerCase())) {
            return iconMap[prefix];
        }
    }
    return null;
};

// Helper function to get color for a given type/label
export const getColorForType = (label: string): string => {
    const lowerLabel = label.toLowerCase();
    for (const prefix in colorMap) {
        if (lowerLabel.startsWith(prefix.toLowerCase())) {
            return colorMap[prefix];
        }
    }
    return defaultColor;
};

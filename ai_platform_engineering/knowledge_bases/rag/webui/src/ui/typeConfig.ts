// Centralized configuration for entity/datasource types
// This includes color schemes and icon mappings

// Import icons
import awsIcon from '../assets/icons/aws-icon.png';
import backstageIcon from '../assets/icons/backstage-icon.png';
import k8sIcon from '../assets/icons/k8s-icon.png';
import argocdIcon from '../assets/icons/argocd-icon.png';
import githubIcon from '../assets/icons/github-icon.png';
import slackIcon from '../assets/icons/slack-icon.png';
import webexIcon from '../assets/icons/webex-icon.png';

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
export const iconMap: { [key: string]: string } = {
    'aws': awsIcon,
    'backstage': backstageIcon,
    'k8s': k8sIcon,
    'kubernetes': k8sIcon,
    'argo': argocdIcon,
    'github': githubIcon,
    'slack': slackIcon,
    'webex': webexIcon,
    'web': '🌐',
    'confluence': '📚️',
};

export const defaultColor = '#9E9E9E';

// Mapping between ingest UI types and required ingestor types
// This defines which ingestor types are needed for each UI option to be enabled
export interface IngestTypeConfig {
    label: string;              // Display label for the UI button
    requiredIngestorType: string;  // Required ingestor type to enable this option
    icon?: string;              // Optional icon override
}

export const ingestTypeConfigs: Record<string, IngestTypeConfig> = {
    'web': {
        label: 'Web',
        requiredIngestorType: 'webloader',
        icon: '🌐'
    },
    'confluence': {
        label: 'Confluence',
        requiredIngestorType: 'confluence',
        icon: '📚️'
    },
    // Add future ingestor types here:
    // 'github': {
    //     label: 'GitHub',
    //     requiredIngestorType: 'github',
    //     icon: githubIcon
    // },
};

// Helper function to check if an ingest type is available based on ingestors
export const isIngestTypeAvailable = (
    ingestType: string,
    availableIngestors: { ingestor_type: string }[]
): boolean => {
    const config = ingestTypeConfigs[ingestType];
    if (!config) return false;
    
    return availableIngestors.some(
        ingestor => ingestor.ingestor_type === config.requiredIngestorType
    );
};

// Helper function to get all available ingest types based on ingestors
export const getAvailableIngestTypes = (
    availableIngestors: { ingestor_type: string }[]
): string[] => {
    return Object.keys(ingestTypeConfigs).filter(ingestType =>
        isIngestTypeAvailable(ingestType, availableIngestors)
    );
};

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

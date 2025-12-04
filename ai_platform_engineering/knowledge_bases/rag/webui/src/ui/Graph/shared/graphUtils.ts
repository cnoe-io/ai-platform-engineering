/**
 * Common utility functions for graph visualization
 */

/**
 * Generate a unique node ID from entity type and entity primary key
 */
export const generateNodeId = (entityType: string, entityPk: string): string => {
    return `${entityType}::${entityPk}`;
};

/**
 * Generate a unique relation ID based on relation components
 * Priority order:
 * 1. Use relation_pk if available (most specific)
 * 2. Generate from from_entity_pk + to_entity_pk + relation_name (deterministic)
 * 
 * @param fromEntityPk - Primary key of the source entity
 * @param toEntityPk - Primary key of the target entity
 * @param relationName - Name of the relation
 * @param relationPk - Optional relation primary key (if available, takes precedence)
 * @returns A unique relation ID string
 */
export const generateRelationId = (
    fromEntityPk: string,
    toEntityPk: string,
    relationName: string,
    relationPk?: string
): string => {
    // If relation_pk is provided, use it directly (most specific identifier)
    if (relationPk) {
        return relationPk;
    }
    
    // Otherwise, generate a deterministic ID from the relation components
    return `${fromEntityPk}--[${relationName}]-->${toEntityPk}`;
};

/**
 * Extract relation ID from various relation data structures
 * Handles different data formats returned by different APIs
 * 
 * @param relation - The relation object
 * @returns The extracted relation ID or undefined if not found
 */
export const extractRelationId = (relation: any): string | undefined => {
    // Try different possible locations for relation ID
    return (
        relation.relation_pk ||
        relation.relation_properties?._relation_pk ||
        relation.relation_properties?._ontology_relation_id ||
        (relation as any)._ontology_relation_id ||
        (relation as any)._relation_pk
    );
};

/**
 * Generate relation key for graph edge
 * Uses extracted relation ID if available, otherwise generates one
 * 
 * @param relation - The relation object
 * @returns A unique key for the graph edge
 */
export const generateRelationKey = (relation: any): string => {
    const extractedId = extractRelationId(relation);
    
    if (extractedId) {
        return extractedId;
    }
    
    // Fallback: generate from relation components
    const fromPk = relation.from_entity?.primary_key || '';
    const toPk = relation.to_entity?.primary_key || '';
    const relationName = relation.relation_name || 'related_to';
    
    return generateRelationId(fromPk, toPk, relationName);
};

/**
 * Simple hash function for generating consistent edge keys
 * Uses FNV-1a hash algorithm for string hashing
 */
export const hashString = (str: string): string => {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36); // Convert to base36 for shorter strings
};

/**
 * Generate edge key from sorted relation IDs and evaluation status
 * This ensures the same set of relations always produces the same edge key
 * 
 * @param sourceNodeId - Source node ID
 * @param targetNodeId - Target node ID  
 * @param relationIds - Array of relation IDs (will be sorted)
 * @param evaluationStatus - Evaluation status (ACCEPTED, REJECTED, UNCERTAIN, or NONE)
 * @returns A unique edge key
 */
export const generateEdgeKey = (
    sourceNodeId: string,
    targetNodeId: string,
    relationIds: string[],
    evaluationStatus: string
): string => {
    // Sort relation IDs for consistency
    const sortedIds = [...relationIds].sort();
    
    // Create a deterministic hash from the sorted IDs
    const idsHash = hashString(sortedIds.join('|'));
    
    // Edge key format: source-target-status-hash
    return `${sourceNodeId}-${targetNodeId}-${evaluationStatus}-${idsHash}`;
};


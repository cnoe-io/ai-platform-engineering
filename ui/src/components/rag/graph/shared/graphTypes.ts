import type { MultiDirectedGraph } from 'graphology';

export type GraphProperties = Record<string, unknown> & {
    _entity_pk?: string;
    _entity_type?: string;
};

export type GraphEntity = Record<string, unknown> & {
    all_properties?: GraphProperties;
    entity_type?: string;
    primary_key?: string;
    primary_key_properties?: string[];
    _entity_pk?: string;
};

export type GraphEntityReference = {
    entity_type: string;
    primary_key: string;
};

export type RelationEvaluationResult = 'ACCEPTED' | 'REJECTED' | 'UNSURE';

export type RelationProperties = Record<string, unknown> & {
    _ontology_relation_id?: string;
    _relation_pk?: string;
    eval_last_evaluated?: number;
    eval_result?: RelationEvaluationResult;
    evaluation_last_evaluated?: number;
    evaluation_result?: RelationEvaluationResult;
};

export type GraphRelation = Record<string, unknown> & {
    from_entity: GraphEntityReference;
    relation_name: string;
    relation_pk?: string;
    relation_properties?: RelationProperties;
    to_entity: GraphEntityReference;
    _ontology_relation_id?: string;
    _relation_pk?: string;
};

export interface GraphNeighborhoodResponse {
    entity?: GraphEntity;
    entities?: GraphEntity[];
    relations?: GraphRelation[];
}

export type GraphNodeAttributes = Record<string, unknown> & {
    color: string;
    entityData: GraphEntity;
    entityType: string;
    forceLabel?: boolean;
    hidden?: boolean;
    highlighted?: boolean;
    label: string;
    labelColor?: string;
    labelSize?: number;
    labelWeight?: string;
    size: number;
    x: number;
    y: number;
    zIndex?: number;
};

export type GraphEdgeAttributes = Record<string, unknown> & {
    color: string;
    evaluationResult?: string;
    hidden?: boolean;
    isBidirectional?: boolean;
    label: string;
    originalColor?: string;
    originalSize?: number;
    relationCount?: number;
    relationIds?: string[];
    size: number;
    type?: string;
    zIndex?: number;
};

export type KnowledgeGraph = MultiDirectedGraph<GraphNodeAttributes,GraphEdgeAttributes>;

export interface SelectedGraphNode {
    data: GraphNodeAttributes;
    id: string;
    type: 'node';
}

export type RelationDetailRecord = Record<string, unknown> & {
    relationId: string;
};

export interface PropertyMapping {
    entity_a_property?: string;
    entity_b_idkey_property?: string;
    entity_b_property?: string;
    match_type?: string;
    value_match_quality?: number;
}

export interface RelationEvaluation extends RelationDetailRecord {
    directionality?: string;
    is_manual?: boolean;
    justification?: string;
    last_evaluated?: number;
    property_mappings?: PropertyMapping[];
    relation_name?: string;
    result?: string;
    sync_status?: {
        is_synced?: boolean;
        last_synced?: number;
    };
}

export interface RelationExampleMatch {
    entity_a_pk?: string;
    entity_b_pk?: string;
}

export interface RelationHeuristic extends RelationDetailRecord {
    deep_match_quality_avg?: number;
    deep_match_quality_sum?: number;
    entity_a_type: string;
    entity_b_type: string;
    example_matches?: RelationExampleMatch[];
    property_match_patterns?: Record<string,Record<string,number>>;
    property_mappings?: PropertyMapping[];
    total_matches?: number;
    value_match_quality_avg?: number;
    value_match_quality_sum?: number;
}

export type RelationHeuristicsResponse = Record<string, unknown> & {
    heuristics?: Record<string, Omit<RelationHeuristic, 'relationId'>>;
};

export type RelationEvaluationsResponse = Record<string, unknown> & {
    evaluations?: Record<string, {
        evaluation?: Omit<RelationEvaluation, 'relationId' | 'sync_status'>;
        sync_status?: RelationEvaluation['sync_status'];
    }>;
};

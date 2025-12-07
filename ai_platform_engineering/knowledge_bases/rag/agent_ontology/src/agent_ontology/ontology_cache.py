"""
Lightweight cache for entity types and properties discovered during heuristics processing.
"""
from typing import Dict, Set, List
from common.models.graph import Entity
from common.graph_db.base import GraphDB
from common import constants
from common import utils

logger = utils.get_logger("ontology_cache")


class OntologyCache:
    """
    Local cache for entity types, properties, and sub-entity relations.
    Minimizes DB writes by batching everything at flush time.
    """
    
    def __init__(self):
        self.entity_types: Set[str] = set()
        self.entity_properties: Dict[str, Set[str]] = {}  # entity_type -> set of properties
        self.sub_entity_types: Set[str] = set()  # Track which entity types are sub-entities
        self.sub_entity_parent_types: Dict[str, str] = {}  # sub_entity_type -> parent_entity_type
        self.sub_entity_candidates: List[Dict] = []  # Sub-entity evaluation data to create
        
    def add_entity(self, entity: Entity):
        """
        Record entity type and its properties locally (no DB write).
        Also tracks if the entity type is a sub-entity.
        
        Args:
            entity: The entity to record
        """
        self.entity_types.add(entity.entity_type)
        
        if entity.entity_type not in self.entity_properties:
            self.entity_properties[entity.entity_type] = set()
        
        # Check if this is a sub-entity type
        is_sub_entity = entity.additional_labels and constants.SUB_ENTITY_LABEL in entity.additional_labels
        
        # Record properties for schema
        for prop_name in entity.all_properties.keys():
            # Only include non-internal (business/domain) properties
            if not prop_name.startswith("_"):
                self.entity_properties[entity.entity_type].add(prop_name)
        
        # Track sub-entity types and their parent types
        if is_sub_entity:
            self.sub_entity_types.add(entity.entity_type)
            # Extract parent type from entity properties (set during ingestion) and record it for schema creation later (in flush method)
            parent_type = entity.all_properties.get(constants.PARENT_ENTITY_TYPE_KEY)
            if parent_type:
                self.sub_entity_parent_types[entity.entity_type] = parent_type
    

    async def flush(self, ontology_db: GraphDB, ontology_version_id: str):
        """
        Write all cached entity types, properties to the ontology database.
        
        Args:
            ontology_db: The ontology graph database
            ontology_version_id: The current ontology version ID
        """
        if not self.entity_types:
            logger.info("No entity types to flush")
            return
        
        logger.info(f"Flushing {len(self.entity_types)} entity types to ontology database")
        
        # Build all entities for batch update
        entities = []
        for entity_type in self.entity_types:
            properties = self.entity_properties.get(entity_type, set())
            
            # Build additional labels - include entity type name and sub-entity label if applicable
            additional_labels = {entity_type}
            is_sub_entity = entity_type in self.sub_entity_types
            if is_sub_entity:
                additional_labels.add(constants.SUB_ENTITY_LABEL)
            
            # Build properties dict
            all_props = {
                constants.ENTITY_TYPE_NAME_KEY: entity_type,
                constants.ONTOLOGY_VERSION_ID_KEY: ontology_version_id,
                "properties": list(properties)  # Store discovered properties
            }
            
            # For sub-entity schema entities, compute parent entity PK to create schema-level relationship (we use the parent type we recorded during add_entity)
            if is_sub_entity:
                parent_type = self.sub_entity_parent_types.get(entity_type)
                if parent_type:
                    # Parent entity PK points to parent type's schema entity
                    parent_entity_pk = f"{parent_type}{constants.PROP_DELIMITER}{ontology_version_id}"
                    all_props[constants.PARENT_ENTITY_TYPE_KEY] = parent_type
                    all_props[constants.PARENT_ENTITY_PK_KEY] = parent_entity_pk
                    logger.debug(f"Sub-entity schema '{entity_type}' -> parent schema '{parent_type}' (pk: {parent_entity_pk})")
                else:
                    logger.warning(f"Sub-entity '{entity_type}' has no parent type, skipping schema creation")
                    continue
            entity = Entity(
                entity_type=entity_type,
                primary_key_properties=[constants.ENTITY_TYPE_NAME_KEY, constants.ONTOLOGY_VERSION_ID_KEY],
                all_properties=all_props,
                additional_labels=additional_labels
            )
            entities.append(entity)
        
        try:
            # Use batch update for all entities in one call
            await ontology_db.update_entity_batch(entities, batch_size=1000)
            logger.info(f"Successfully flushed {len(self.entity_types)} entity types in one batch")
        except Exception as e:
            logger.error(f"Failed to flush entity types in batch: {e}")
            raise
    
    def get_stats(self) -> dict:
        """Get statistics about cached data."""
        return {
            "total_entity_types": len(self.entity_types),
            "sub_entity_types": len(self.sub_entity_types),
            "sub_entity_candidates": len(self.sub_entity_candidates),
            "total_unique_properties": sum(len(props) for props in self.entity_properties.values()),
            "entity_types": list(self.entity_types)
        }


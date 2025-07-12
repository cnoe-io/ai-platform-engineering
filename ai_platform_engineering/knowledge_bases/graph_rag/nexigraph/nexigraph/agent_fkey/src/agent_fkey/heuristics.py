from typing import List
from core import utils as utils
from core.constants import DEFAULT_LABEL
from core.graph_db.base import GraphDB
from core.models import CompositeKeyPropertyMapping, Entity

from agent_fkey.relation_manager import RelationCandidateManager

class HeuristicsProcessor:
    """
    Heuristic processor class for determining foreign key relations between entities.
    """

    def __init__(self, graph_db: GraphDB, rc_manager: RelationCandidateManager):
        self.graph_db = graph_db
        self.rc_manager = rc_manager
    
    async def process(self, entity: Entity):
        """
        Processes an entity and computes heuristics.
        """
        logger = utils.get_logger(f"heuristics[{hash(entity.generate_primary_key())}]")
        logger.info(f"======== Processing Entity {entity.entity_type} ({entity.generate_primary_key()}) ========")
        if not entity:
            logger.warning(f"Entity type={entity.entity_type}, id={entity.generate_primary_key()} not found in the graph database.")
            return
        
         # Skip if the entity is not a valid entity type
        if entity.entity_type == DEFAULT_LABEL:
            logger.warning(f"Entity type={entity.entity_type} is the default entity type, skipping processing.")
            return

        # Create a reverse lookup array for easy access to values
        entity_value_lookup = {}
        for k,v in entity.all_properties.items():
            # Skip non useful properties
            if k[0] == "_" or v == "" or v is None:
                continue
            if v is None or v == "":
                continue
            if isinstance(v, (list, set)):
                # If the value is a list or set, we need to iterate over the items, and add the value to the lookup for each item
                if len(v) == 0:
                    continue
                for item in v:
                    if item is None or item == "":
                        continue
                    keys = entity_value_lookup.get(item, [])
                    keys.append(k)
                    entity_value_lookup[item] = keys
            else:
                keys = entity_value_lookup.get(v, [])
                keys.append(k)
                entity_value_lookup[v] = keys

        
        # Create a reverse lookup array for identity keys only for this entity
        id_key_value_lookup = {}
        for keys in [entity.primary_key_properties] + (entity.additional_key_properties or []):
            for k in keys:
                if k[0] == "_" or k == "" or k is None:
                    continue
                v = entity.all_properties.get(k, None)
                if v is None or v == "":
                    continue
                if isinstance(v, (list, set)):
                    logger.warning(f"Identity key property {k} has a list/set value, this is not supported for identity keys, casting to str.")
                    v = str(v)  # Cast to string if it's a list or set
                keys = id_key_value_lookup.get(v, [])
                keys.append(k)
                id_key_value_lookup[v] = keys

        # Iterate over all properties values and find matches
        for entity_property, entity_property_value_raw in entity.all_properties.items():
            logger.debug(f"---- Processing Entity property {entity.entity_type}.{entity_property} ----")
            # Skip non useful properties
            if entity_property[0] == "_" or entity_property_value_raw == ""  or entity_property_value_raw is None:
                logger.debug(f"Skipping property {entity_property} with value in entity {entity.entity_type}.")
                continue

            # If the property value is a list or set, we need to iterate over the items, and do matching separately for each item
            if not isinstance(entity_property_value_raw, (list, set)):
                entity_property_value_raw = [entity_property_value_raw]
            
            # Iterate over each value of the property (if its an array, otherwise the array will only have a single item)
            for entity_property_value in entity_property_value_raw:
                
                # Check if the property we are doing a search for is part of the identity key - special handling for them later
                entity_property_id_key = None
                if entity.additional_key_properties is None:
                        entity.additional_key_properties = []
                for id_key in entity.additional_key_properties + [entity.primary_key_properties]:
                    for prop in id_key:
                        if prop == entity_property:
                            logger.debug(f"Property {entity_property} is part of the identity key: {id_key} in entity {entity.entity_type}.")
                            entity_property_id_key = id_key
                            break

                logger.info(f"Fuzzy searching (initial) for property value: {entity_property_value}")
                # Do a fuzzy search for the property value in all entity identity values
                matches = await self.graph_db.fuzzy_search([[entity_property_value]], type_filter=[], num_record_per_type=0)

                # More than one match means its not a 1-1 matching, it might be a composite key (for e.g. same resource name in different accounts)
                if len(matches) > 1:
                    # Do a fuzzy search of all property values in the entity, the hope is that there will be multiple matches, 
                    # and the entity with the highest score (in its type) will be the ideal candidate for doing the deep matching later
                    # We also only search for the types returned by the first search to avoid noise
                    logger.info(f"Found {len(matches)} matches for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}, doing a multi key search.")
                    type_filter = set([entity.entity_type for entity, score in matches])

                    # Special rule for when the property is part of an identity key, i.e. the property is a foreign key to another entity
                    # We don't want to search for all properties, but only the identity key properties - this prevents false positives
                    if entity_property_id_key:
                        # Only search for the identity key properties in the matched entities
                        vals = []
                        for id_key_prop in entity_property_id_key:
                            vals.append(entity.all_properties.get(id_key_prop, None))
                        matches = await self.graph_db.fuzzy_search([[entity_property_value],vals], type_filter=list(type_filter), num_record_per_type=1)
                    else:
                        vals = []
                        for id_key_prop, val in entity.all_properties.items():
                            if id_key_prop[0] == "_": # skip internal properties
                                continue
                            vals.append(val)

                        # Do a fuzzy search with all property values
                        logger.debug(f"Entity property is NOT an identity key, doing a fuzzy search for all property values in entity types {type_filter}")
                        matches = await self.graph_db.fuzzy_search([[entity_property_value],vals], type_filter=list(type_filter), num_record_per_type=1)

                logger.info(f"Found TOTAL of {len(matches)} matches for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}")
                
                # Iterate through all matched entities and do a deep property matching
                # We will try to find the foreign key in the matched entities
                # Find the foreign key in the matched entities
                for (matched_entity, score) in matches:
                    # Matching is done as follows:
                    # We find the property in the matched entity that has the same value as the entity property
                    # Since keys can be composed of multiple properties, we need to find the identity key in the matched entity that matches fully with the any other entity property,
                    # i.e. all properties of the identity key in the matched entity must map to properties in the entity being processed

                    if matched_entity is None: # unusual, but it can happen if the fuzzy search fails
                        continue

                    logger.debug(f"Matched entity type={matched_entity.entity_type}, id={matched_entity.generate_primary_key()} with score={score}")

                    if entity.entity_type == matched_entity.entity_type: 
                        # TODO: Support this in the future.
                        # We matched the same entity, so we can skip it
                        logger.debug(f"Matched the same entity type {entity.entity_type}, skipping.")
                        continue

                    if matched_entity.additional_key_properties is None:
                        matched_entity.additional_key_properties = []

                    # Get the identity keys for the matched entity - we only care about those since they are likely to be the foreign keys referenced in the entity
                    id_keys = matched_entity.additional_key_properties + [matched_entity.primary_key_properties] # type: ignore

                    logger.debug(f"Identity keys for matched entity: {id_keys}")

                    # Find the identity key that matches the entity property value - as indicated by the fuzzy search
                    # We should find atleast one since fuzzy matching found at least one match
                    matched_id_keys: List[List[str]] = [] # list of identity keys that match the entity property
                    matched_id_key_prop: str = "" # the property in the identity key that matched the entity property
                    matched_single_part_key = False
                    for id_key in id_keys:
                        logger.debug(f"Checking id key: {id_key}")
                        for id_key_prop in id_key:
                            # Get the value of the id key property in the matched entity
                            id_key_val = matched_entity.all_properties.get(id_key_prop, None)
                            if id_key_val is None: # unusual - assume property is not part of the identity key
                                logger.debug(f"Id key property {id_key_prop} not found in matched entity")
                                continue

                            # If the value is a list or set, we cast it to a string
                            if isinstance(id_key_val, (list, set)):
                                logger.warning(f"Matched entity Id key property {id_key_prop} has a list/set value, this is not supported for identity keys, casting to str.")
                                id_key_val = str(id_key_val)  # Cast to string if it's a list or set 
                            
                            if id_key_val == entity_property_value:
                                if len(id_key) == 1:
                                    # This is a single-part identity key, so we can assume that the entity property is a foreign key to the matched entity
                                    logger.debug(f"Matched single-part identity key {id_key} for property {entity_property} -> {id_key_prop} with value {id_key_val}")
                                    matched_id_keys = [id_key] #  we assume that this is the only identity key that matches
                                    matched_id_key_prop = id_key_prop # store the property that matched
                                    matched_single_part_key = True
                                else:
                                    # The property matched a composite identity key, so we need to check if all properties of the key match
                                    # This will be done later, so we just store the id key and the property that matched
                                    logger.debug(f"Matched composite identity key {id_key} for property {entity_property} -> {id_key_prop} with value {id_key_val}")
                                    matched_id_keys.append(id_key)
                        
                        if matched_single_part_key:
                            # We found a single-part identity key that matches the entity property, so we can stop checking the rest of the identity keys
                            break

                    if len(matched_id_keys) <= 0:
                        # This is unusual, since fuzzy matching found at least one
                        logger.warning(f"No matching id key found for {entity_property},{entity_property_value} in {matched_entity.entity_type}, fuzzy matching may have failed.")
                        continue

                    composite_key_properties: List[CompositeKeyPropertyMapping] = []
                    if not matched_single_part_key:
                        # We found composite identity keys
                        # So for each key, check if all properties of the composite key match with some property in the original entity
                        # If they do, then its a potential foreign key relation
                        # If not, its only a partial match, so we discard it
                        # Example:
                        # For a K8s Ingress entity, we may have matched to the name property of a Service entity
                        # But we must also check if all other identity properties of the key match such as cluster_name and namespace, so we know the match is valid
                        for index, id_key in enumerate(matched_id_keys):
                            full_match = True
                            matching_props = []
                            main_matching_prop = ""
                            # Find the additional identity key properties that fully match the entity property
                            for id_key_prop in id_key:
                                # Get the value of the id key property in the matched entity
                                id_key_val = matched_entity.all_properties.get(id_key_prop, None)
                                if id_key_val is None: # unusual - dont consider this key
                                    break
                                
                                if id_key_val == entity_property_value:
                                    # The value matches the original entity property value
                                    # This is probably the id property that matched, so we can skip it
                                    # If there are multiple id properties with the same value, we will just use the last one
                                    main_matching_prop = id_key_prop
                                    continue

                                # Get the property that has the same value in the original entity
                                if entity_property_id_key:
                                    matching_properties = id_key_value_lookup.get(id_key_val, None)
                                else:
                                    matching_properties = entity_value_lookup.get(id_key_val, None)
                                if matching_properties is None:
                                    full_match = False
                                    break # No matching properties found for this id key property, so we can ignore the key, since we need a full match
                                
                                logger.debug(f"Found matching properties {matching_properties} for id key property {id_key_prop} with value {id_key_val} in entity {entity.entity_type}")
                                for matching_property in matching_properties:
                                    # We found atleast one matching property, add it to the mapping
                                    matching_props.append(CompositeKeyPropertyMapping(
                                        entity_a_property=matching_property,
                                        entity_b_idkey_property=id_key_prop,
                                        count=1
                                    ))

                            if full_match:
                                # We found a full match for the composite identity key, so we can add it to the list and stop checking the rest of the identity keys
                                logger.debug(f"Found full match for composite identity key {id_key} for property {entity_property} -> {main_matching_prop} with value {id_key_val}")
                                matched_id_key_prop = main_matching_prop
                                composite_key_properties.extend(matching_props) 
                                break

                    if not matched_single_part_key and len(composite_key_properties) == 0:
                        # We found composite identity keys, but none of them matched fully with the entity properties
                        # So we can skip this entity-property match
                        logger.debug(f"No full match found for composite identity keys for {entity.entity_type}.{entity_property} -> {matched_entity.entity_type}")
                        continue

                    # Check if its a self-relation, i.e. the entity and matched entity are the same type and the property keys match
                    if entity.entity_type == matched_entity.entity_type and entity_property == matched_id_key_prop:
                        # This is a self-relation, so we can skip it
                        logger.debug(f"Skipping self-relation for {entity.entity_type}.{entity_property} -> {matched_entity.entity_type}.{matched_id_key_prop}")
                        continue
                    
                    # Update the heuristic for the potential relation
                    await self.rc_manager.update_heuristic(
                        entity=entity,
                        entity_property_key=entity_property,
                        matched_entity=matched_entity,
                        matched_entity_property_key=matched_id_key_prop,
                        count=1,
                        composite_property_key_mappings=composite_key_properties,
                        matching_entity_id_key=id_key,
                    )

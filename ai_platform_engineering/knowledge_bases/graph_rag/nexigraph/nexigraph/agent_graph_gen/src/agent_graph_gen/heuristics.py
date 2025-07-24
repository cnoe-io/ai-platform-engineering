from itertools import combinations
import logging
from typing import Any, List, Tuple
from core import utils as utils
from core.constants import DEFAULT_LABEL
from core.graph_db.base import GraphDB
from core.models import PropertyMapping, Entity

from agent_graph_gen.relation_manager import RelationCandidateManager


class DeepPropertyMatch:
    """
    Represents a deep property match between two entities.
    """
    search_entity: Entity               # Entity being searched for a foreign key relation
    search_entity_property: str         # Property being searched for a foreign key relation
    search_entity_property_value: str  # Value of the property being searched for a foreign key relation

    matched_entity: Entity               # Matched entity that is a candidate for the foreign key relation
    matched_entity_idkey: dict[str, Any] # Identity key of the matched entity
    matched_entity_idkey_property: str   # The property of the matched entity that matches the search value

    matching_properties: List[PropertyMapping]  # Properties of the search entity that match the properties of the identity key the matched entity


class HeuristicsProcessor:
    """
    Heuristic processor class for determining foreign key relations between entities.
    """
    
    def __init__(self, graph_db: GraphDB, rc_manager: RelationCandidateManager):
        self.graph_db = graph_db
        self.rc_manager = rc_manager


    async def targeted_fuzzy_search(self, entity: Entity, entity_property: str, entity_property_value: str, logger: logging.Logger) -> List[Tuple[Entity, float]]:
        """
        Targeted fuzzy search does the following:
        1. Searches the property value in all entity identity values.
        2. If only one match is found, it returns the match, all good.
        3. If multiple matches are found, the value might be a composite key:
            a. It does another fuzzy search with all values of the entity in the query, the hope is that the right entity will have multiple values that match, and hence the highest score (for each type) will be the ideal candidate for doing the deep matching later.
            b. If the property value we are searching for is part of the identity key, then instead of including all values in the query, we only include the  identity values.
        4. Return one entity per type (with the highest score), so we can do a deep property matching later.
        
        :param entity: The entity involved in the search.
        :param entity_property: The property of the entity.
        :param entity_property_value: The value of the property to search for.
        :param logger: Logger instance for logging.
        :return: List of matched entities with their scores.
        """
        
        logger.info(f"Fuzzy searching for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}")
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
            # Do a fuzzy search of all property values in the entity
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

        return matches
    
    def get_identity_keys(self, entity: Entity, entity_property_value: str) :
        """
        Returns list of dictionaries with the identity keys of the entity that match the given property value.
        :param entity: The entity to get the identity keys from.
        :param entity_property_value: The value of the property to match against the identity keys. empty string means all identity keys.
        :return: dict[str, Any]
        """
        keys = [entity.primary_key_properties] + (entity.additional_key_properties or [])
        dicts =  [{k: entity.all_properties[k] for k in key} for key in keys]
        if entity_property_value == "":
            return dicts
        dicts = [d for d in dicts if entity_property_value in d.values()]
        return dicts

    def is_matching(self, value1 : Any, value2: Any) -> bool:
        """
        This is the matching heuristic that determines if two values match - used for deep property matching.
        :param value1: The first value to compare.
        :param value2: The second value to compare.
        :return: True if the values match, False otherwise.
        """
        is_value1_iterable = isinstance(value1, (list, set, frozenset))
        is_value2_iterable = isinstance(value2, (list, set, frozenset))

        if is_value1_iterable and is_value2_iterable: # both are iterable
            # Check if value1 is a subset of value2 or vice versa
            a = set(value1)
            b = set(value2)
            return a.issubset(b) or b.issubset(a)
        elif is_value1_iterable:
            return value2 in value1
        elif is_value2_iterable:
            return value1 in value2
        else:
            return value1 == value2
        
    def find_matching_key_mappings(self, reference_dict: dict[str, Any], target_dict: dict[str, Any], must_have_mapping: dict[str, str], logger: logging.Logger) -> List[dict[str, Any]]:
        """
        Returns a list of dictionaries containing the keys from the reference_dict as key, and the keys from the target_dict as values. Such that the values in the target_dict match the values in the reference_dict.
        Example:
        If reference_dict = {"a": "1", "b": "2"} and target_dict = {"x": "1", "y": "2", "z": "3"},
        the result will be [{"a": "x", "b": "y"}, {"a": "y", "b": "x"}].
        :param reference_dict: The dictionary to match against.
        :param target_dict: The dictionary to search for matching values.
        :param must_have_mapping: The mapping of keys that must be present in the result.
        :param logger: Logger instance for logging.
        :return: List of dictionaries containing the matching values.
        """

        # Find all keys in the reference_dict that match the values in the target_dict, and create a list of tuples (reference_key, target_dict_key)
        matching_keys: List[Tuple[Any, Any]] = []
        for reference_key, reference_val in reference_dict.items():
            for target_dict_key, target_dict_value in target_dict.items():
                if self.is_matching(reference_val, target_dict_value):
                    matching_keys.append((reference_key, target_dict_key))
        
        if not matching_keys:
            logger.warning(f"No matching keys found for reference_dict: {reference_dict} and target_dict: {target_dict}.")
            return []
        
        # Generate all combinations of matching keys
        combos = combinations(matching_keys, len(reference_dict))
        result = []
        for combo in combos:
            result_dict = dict(combo)
            if set(result_dict.keys()) != set(reference_dict.keys()):  # Ensure that the keys in the result_dict match the keys in the reference_dict
                # logger.debug(f"Skipping combination {combo} as it does not match the reference_dict keys {reference_dict.keys()}.")
                continue

            for must_have_key, must_have_value in must_have_mapping.items():
                if must_have_key not in result_dict or result_dict[must_have_key] != must_have_value:
                    # logger.debug(f"Skipping combination {combo} as it does not match the must-have mapping {must_have_mapping}.")
                    break
            else:
                result.append(result_dict)
        
        return result

    async def deep_property_match(self, entity: Entity, entity_property: str, entity_property_value: str, matches: List[Tuple[Entity, float]], logger: logging.Logger) -> List[DeepPropertyMatch]:
        """
        Performs deep property matching for the given entity and its property value against a list of matched entities.
        Checks for identity keys in the matched entities and then finds properties in the original entity that match the identity keys of the matched entities.
        Returns a list of DeepPropertyMatch objects containing the matched entities and their properties.
        """
        deep_matches = []
        for matched_entity, _ in matches:

            logger.debug(f"Processing fuzzy matched entity: {matched_entity.entity_type} ({matched_entity.generate_primary_key()}) for property {entity_property} with value {entity_property_value}.")

            if not matched_entity: # Odd, but can happen if fuzzy match failed
                logger.warning(f"Matched entity is None, skipping deep property match for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}.")
                continue
            
            if matched_entity.entity_type == entity.entity_type: # TODO: Support for self-references and relations to same type
                logger.warning(f"Matched entity {matched_entity.entity_type} is the same as the search entity {entity.entity_type}, skipping deep property match for property {entity_property} with value {entity_property_value}.")
                continue

            # Fetch the identity keys of the matched entity
            matched_entity_identity_keys = self.get_identity_keys(matched_entity, entity_property_value)

            logger.debug(f"Found {len(matched_entity_identity_keys)} identity keys in matched entity.")

            # Find properties in the original entity that match the identity keys of the matched entity
            for identity_key in matched_entity_identity_keys:

                # Find the property in the identity key that matches the entity_property value
                matched_entity_idkey_property = next((k for k,v in identity_key.items() if v == entity_property_value), None)
                
                if not matched_entity_idkey_property:
                    logger.warning(f"Could not find matching property {entity_property} with value {entity_property_value} in identity key {identity_key}.")
                    continue
                
                # Find properties from the original entity that match all properties of the identity keys
                # This is the heavy lifting part
                entity_prop_dict = {k: entity.all_properties[k] for k in entity.all_properties if k[0] != "_"}  # Skip internal properties
                matching_props = self.find_matching_key_mappings(identity_key, entity_prop_dict, {matched_entity_idkey_property: entity_property}, logger)

                logger.debug(f"Found {len(matching_props)} matching properties in entity {entity.entity_type} for identity key {identity_key}.")

                # Iterate over the matches and create DeepPropertyMatch objects
                for m in matching_props:
                    deep_match = DeepPropertyMatch()
                    deep_match.search_entity = entity
                    deep_match.search_entity_property = entity_property
                    deep_match.search_entity_property_value = entity_property_value

                    deep_match.matched_entity = matched_entity
                    deep_match.matched_entity_idkey = identity_key
                    deep_match.matched_entity_idkey_property = matched_entity_idkey_property

                    # logger.debug(f"Identity key dict:  {identity_key}")
                    # logger.debug(f"Matching prop dict: {m}")
                    property_mappings = []
                    for k, v in m.items():
                        property_mapping = PropertyMapping(
                                entity_a_property=v,
                                entity_b_idkey_property=k
                        )
                        property_mappings.append(property_mapping)

                    deep_match.matching_properties = property_mappings

                    # Append the deep match to the list
                    deep_matches.append(deep_match)
                    logger.debug(f"Found deep property match: {deep_match.matched_entity.entity_type}\n matched_entity_idkey: {deep_match.matched_entity_idkey}\n matched_entity_idkey_property: {deep_match.matched_entity_idkey_property}\n matched_properties: {deep_match.matching_properties}")

        # Only keep the matches with lowest length of matched_properties - as we want the most specific match
        logger.info(f"Found {len(deep_matches)} deep property matches for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}.")
        return deep_matches

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

        # Iterate over all properties values and find matches
        for entity_property, prop_value_raw in entity.all_properties.items():
            logger.debug(f"---- Processing Entity property {entity.entity_type}.{entity_property} ----")
            
            # Skip non useful properties
            if entity_property[0] == "_" or prop_value_raw == ""  or prop_value_raw is None:
                logger.debug(f"Skipping property {entity_property} with value in entity {entity.entity_type}.")
                continue

            # If the property value is a list or set, we need to iterate over the items, and do matching separately for each item
            if not isinstance(prop_value_raw, (list, set)):
                prop_value_raw = [prop_value_raw]
            
            # Iterate over each value of the property (if its an array, otherwise the array will only have a single item)
            for entity_property_value in prop_value_raw:
                
                # Do a fuzzy search for the property value in the entity
                fuzzy_matches = await self.targeted_fuzzy_search(entity, entity_property, entity_property_value, logger)
                if len(fuzzy_matches) == 0:
                    logger.debug(f"No fuzzy matches found for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}.")
                    continue
                
                logger.info(f"(Fuzzy search) Found {len(fuzzy_matches)} matches for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}")
                logger.debug(f"Matched entity types: {[m[0].entity_type for m in fuzzy_matches]}")

                # Do a deep property match for the entity and its property value against the matched entities
                deep_matches = await self.deep_property_match(entity, entity_property, entity_property_value, fuzzy_matches, logger)

                if len(deep_matches) == 0:
                    logger.debug(f"No deep property matches found for property {entity_property} with value {entity_property_value} in entity {entity.entity_type}.")
                    continue

                logger.info(f"Found {len(deep_matches)} deep property matches for property {entity_property} ({entity.entity_type})")

                # Iterate over the deep matches and create relation candidates
                for dm in deep_matches:
                    # Create property mappings for the matched entity from the dictionaries - this can be stored with the relation candidate
                    
                    
                    logger.debug(f"Property mappings: {dm.matching_properties}")
                    if not dm.matching_properties:
                        logger.warning(f"No property mappings found for entity {entity.entity_type} ({entity.generate_primary_key()}) and matched entity {dm.matched_entity.entity_type} ({dm.matched_entity.generate_primary_key()}).")
                        exit(1)

                    # Update the heuristic for the potential relation
                    await self.rc_manager.update_heuristic(
                        entity=entity,
                        entity_property_key=entity_property,
                        matched_entity=dm.matched_entity,
                        matched_entity_property_key=dm.matched_entity_idkey_property,
                        count=1,
                        property_mappings=dm.matching_properties,
                        matching_entity_id_key=list(dm.matched_entity_idkey.keys()),
                    )

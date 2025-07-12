from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Tuple
from core.models import Entity, Relation, EntityTypeMetaRelation


class GraphDB(ABC):

    database_type: str 
    query_language: str

    @abstractmethod
    async def setup(self):
        """
        initialize the graph database, called once on startup.
        Must be idempotent, so it can be called multiple times without error
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def fuzzy_search(self, keywords: List[List[str]], 
                           type_filter: List[str], 
                           num_record_per_type: int = 0, 
                           require_single_match_per_type: bool = False, 
                           strict: bool=True,
                           all_props: bool = False, max_results=100) -> List[Tuple[Entity, float]]:
        """
        Does a fuzzy search on a subset of properties (that are deemed important for identity of the entity e.g. id, name, arn etc.)
        The search is strict for keywords

        :param keywords: list of keywords to search for, they are OR'd in the same array, and AND'd across arrays
        :param type_filter: only return entity types that are in the list, empty for all
        :param num_record_per_type: Number of records to return per type, if 0, return all records, sorted by highest score
        :param strict: if True, the search is strict, meaning that the keywords must match exactly, if False, the search is fuzzy
        :param all_props: if True, search all properties of the entity, by default only searches the identity properties
        :param require_single_match_per_type: Only return records that have a single record matching for each type
        :param max_results: maximum number of results to return
        :return: list of tuples - matched entity, similarity
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_all_entity_types(self, max_results=1000) -> List[str]:
        """
        Returns all entity types in the graph database
        :return: list of all entity types
        """
        raise NotImplementedError("Subclasses must implement this method.")
    
    @abstractmethod
    async def find_entity(self, entity_type: str, properties: dict, max_results=10000) -> List[Entity]:
        """
        Finds an entity in the graph database
        :param entity_type: type of entity, empty for any
        :param properties: dict of properties to match
        :param max_results: maximum number of results to return
        :return: list of entities
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def find_entity_by_id_value(self, entity_type: str, identity_values=[], max_results=10000) -> List[Entity]:
        """
        Finds an entity in the graph database
        :param entity_type: type of entity, empty for any
        :param identity_values: list of identity values to match, values are AND'd together
        :param max_results: maximum number of results to return
        :return: list of entities
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_entity_relations(self, entity_type: str, entity_id: str, max_results=10000) -> List[Relation]:
        """
        Gets relations of an entity in the graph database
        :param entity_type: type of entity
        :param entity_id: the unique id of the entity
        :param max_results: maximum number of results to return
        :return: list of related entities and its relations
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_relation_paths(self, start_entity_type: str, end_entity_type: str, max_results=10000) ->  List[List[EntityTypeMetaRelation]]:
        """
        Gets the relation path between two entity types
        Raises ValueError if either entity type is empty
        :param start_entity_type: the type of starting entity
        :param end_entity_type: the type of ending entity
        :param max_results: maximum number of paths to return
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def update_entity(self, entity: Entity, client_name: str, fresh_until: int):
        """
        Update an entity in the graph database (Creates if it does not exist)
        Also creates/updates all relationships and related entities
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def update_relationship(self, relation: Relation, fresh_until: int, ignore_direction=False, client_name=None):
        """
        Creates a relationship between two entities in the graph database
        Should only be used in rare cases, use update_entity instead
        """
        raise NotImplementedError("Subclasses must implement this method.")


    @abstractmethod
    async def remove_relation(self, relation_name: str, properties: (dict| None) = None):
        """
        Removes a relation from the graph database
        :param relation_name: name of the relation to remove
        :param properties: dict of properties to match
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def remove_stale_entities(self):
        """
        Removes all entities that are stale (not updated for a long time)
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def relate_entities_by_property(self, client_name: str, entity_a_type: str, entity_b_type: str, relation_type: str, 
                                          matching_properties: dict, relation_properties: (dict | None) = None):
        """
        Relates two entity types by a property in the graph database.
        :param entity_a_type: type of the first entity
        :param entity_b_type: type of the second entity
        :param relation_type: type of the relation to create
        :param matching_properties: dict of properties to match between the two entities, keys are properties of entity_a_type, values are properties of entity_b_type
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_property_value_count(self, entity_type: str, property_name: str) -> int:
        """
        Returns the count of values for a property in the graph database. (includes duplicates)
        If the property is an array, it counts every value in the array separately.
        :param entity_type: type of entity
        :param property_name: name of the property to match
        :return: count of values for the property
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_values_of_matching_property(self, entity_type_a: str, entity_a_property: str, 
                                              entity_type_b: str,  entity_b_property: str, max_results: int=10) -> List[str]:
        """
        Returns a list of values where two entity types have matching property value.
        :param entity_type_a: type of the first entity
        :param entity_a_property: property of the first entity
        :param entity_type_b: type of the second entity
        :param entity_b_property: property of the second entity
        :param max_results: maximum number of results to return
        :return: list of matching values
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def raw_query(self, query: str, readonly=False, max_results=10000) -> dict:
        """
        Does a raw query to graph database
        """
        raise NotImplementedError("Subclasses must implement this method.")
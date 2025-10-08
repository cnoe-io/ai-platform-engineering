from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional, Tuple, Union
from common.models.graph import Entity, Relation, EntityIdentifier


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
    async def fuzzy_search(self, keywords: List[List[Union[str, Tuple[float, str]]]], 
                           type_filter: List[str], 
                           num_record_per_type: int = 0, 
                           require_single_match_per_type: bool = False, 
                           strict: bool=True,
                           max_results=100) -> List[Tuple[Entity, float]]:
        """
        Does a fuzzy search on a subset of properties (that are deemed important for identity of the entity e.g. id, name, arn etc.)
        The search is strict for keywords

        :param keywords: list of keywords to search for, they are OR'd in the same array, and AND'd across arrays.
                        Each keyword can be either a string or a (weight, string) tuple for relevance boosting.
                        E.g. keywords = [['id1', (2.0, 'id2')], ['name1', 'name2']] 
                        will search for (id1 OR id2^2.0) AND (name1 OR name2)
        :param type_filter: only return entity types that are in the list, empty for all
        :param num_record_per_type: Number of records to return per type, if 0, return all records, sorted by highest score
        :param strict: if True, the search is strict, meaning that the keywords must match exactly, if False, the search is fuzzy
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
    async def get_entity_type_properties(self, entity_type: str, max_results=1000) -> List[str]:
        """
        Get all properties for a given entity type in the graph database.
        
        Args:
            entity_type (str): The type of entity to get properties for
            max_results (int): Maximum number of results to return
            
        Returns:
            List[str]: A list of all properties for the specified entity type
        """
        raise NotImplementedError("Subclasses must implement this method.")
    
    @abstractmethod
    async def find_entity(self, entity_type: str|None, properties: dict|None, max_results=10000) -> List[Entity]:
        """
        Finds an entity in the graph database
        :param entity_type: type of entity, empty for any
        :param properties: dict of properties to match
        :param max_results: maximum number of results to return
        :return: list of entities
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def fetch_entity(self, entity_type: str, primary_key_value: str) -> (Entity | None):
        """
        Gets a single entity by type and primary key value
        :param entity_type: type of entity
        :param primary_key_value: the primary key value of the entity
        :return: entity if found, None otherwise
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def find_relations(self, from_entity_type: str | None = None, to_entity_type: str | None = None, relation_name: str | None = None, 
        properties: dict | None = None, max_results: int = 10000) -> List[Relation]:
        """
        Finds relations between entities of specified types with given properties.
        :param from_entity_type: type of from entity, empty for any
        :param to_entity_type: type of to entity, empty for any
        :param relation_name: name of the relation, empty for any
        :param properties: dict of properties to match, None for any
        :param max_results: maximum number of results to return
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def fetch_entity_relations(self, entity_type: str, entity_pk: str, max_results=10000) -> List[Relation]:
        """
        Gets relations of an entity in the graph database
        :param entity_type: type of entity
        :param entity_pk: the unique id of the entity
        :param max_results: maximum number of results to return
        :return: list of related entities and its relations
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def update_entity(self, entity_type: str, entities: List[Entity], client_name: str, fresh_until: int):
        """
        Batch update entities in the graph database (Creates if it does not exist)
        :param entity_type: type of entity
        :param entities: list of entities to update
        :param client_name: name of the client updating the entity
        :param fresh_until: timestamp until which the entity is fresh
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def update_relation(self, relation: Relation, fresh_until: int, ignore_direction=False, client_name=None):
        """
        Update a relationship between two entities in the graph database
        :param relation: relation to update
        :param fresh_until: timestamp until which the relation is fresh
        :param ignore_direction: if True, ignore the direction of the relation
        :param client_name: name of the client updating the relation
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def remove_entity(self, entity_type: str | None, properties: (dict | None) = None):
        """
        Removes an entity from the graph database
        :param entity_type: type of the entity to remove, None for any entity type
        :param properties: dict of properties to match
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def remove_relation(self, relation_name: Optional[str], properties: (dict| None) = None):
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
        :param client_name: name of the client creating the relation
        :param entity_a_type: type of the first entity
        :param entity_b_type: type of the second entity
        :param relation_type: type of the relation to create
        :param matching_properties: dict of properties to match between the two entities, keys are properties of entity_a_type, values are properties of entity_b_type
        :param relation_properties: optional dict of additional properties to set on the relation
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_property_value_count(self, entity_type: str, property_name: str, property_value: Optional[str]) -> int:
        """
        Returns the count of values for a property in the graph database. (includes duplicates)
        If the property is an array, it counts every value in the array separately.
        :param entity_type: type of entity
        :param property_name: name of the property to match
        :param property_value: if specified, count only the entities with this property value, otherwise count all non-null values
        :return: count of values for the property
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get_values_of_matching_property(self, entity_type_a: str, entity_a_property: str,
                                              entity_type_b: str,  matching_properties: dict, max_results: int=10) -> List[str]:
        """
        Returns a list of values where two entity types have matching property value.
        :param entity_type_a: type of the first entity
        :param entity_a_property: property of the first entity
        :param entity_type_b: type of the second entity
        :param matching_properties: dict of properties to match between the two entities, keys are properties of entity_a_type, values are properties of entity_b_type
        :param max_results: maximum number of results to return
        :return: list of matching values
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def shortest_path(self, entity_a: EntityIdentifier, entity_b: EntityIdentifier, ignore_direction=True, max_depth=20):
        """
        Finds all shortest paths between two entities in the graph database
        :param entity_a: EntityIdentifier of the first entity
        :param entity_b: EntityIdentifier of the second entity
        :param ignore_direction: If True, treat relationships as undirected
        :param max_depth: Maximum path length to search
        :return: A list of tuples, each containing (entities_path, relations_path)
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def raw_query(self, query: str, readonly=False, max_results=10000) -> dict:
        """
        Does a raw query to graph database
        
        :param query: The raw query string to execute
        :param readonly: If True, execute query in read-only mode
        :param max_results: Maximum number of results to return
        :return: Dictionary containing query results
        """
        raise NotImplementedError("Subclasses must implement this method.")
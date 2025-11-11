from __future__ import annotations

import os
import time
from typing import Any, List, Optional, Tuple, Union

import neo4j
from neo4j import Record, AsyncGraphDatabase, GraphDatabase
from cymple.builder import QueryBuilder # TODO: Move away from cymple, limited support for complex queries
from neo4j.graph import Node, Relationship
import asyncio

import common.utils as utils

from common.graph_db.base import GraphDB
from common.constants import ALL_IDS_KEY, ALL_IDS_PROPS_KEY, FRESH_UNTIL_KEY, PRIMARY_ID_KEY, LAST_UPDATED_KEY, \
    ENTITY_TYPE_KEY, DEFAULT_LABEL, UPDATED_BY_KEY, PROP_DELIMITER

from common.models.graph import Entity, EntityIdentifier, Relation

# Index for just identity values (primary keys)
ID_TEXT_SEARCH_INDEX_NAME='id_fulltext'
ID_TEXT_SEARCH_STRICT_INDEX_NAME='id_fulltext_strict'

# Index for fresh until so entities/relations can be cleaned
FRESH_UNTIL_INDEX_NAME='freshuntil_range'

logger = utils.get_logger("neo4j_graph_db")

class Neo4jDB(GraphDB):

    database_type: str = "neo4j"
    query_language: str = "cypher"

    def __init__(self,  uri: str = "", username: str = "", password: str = "", readonly: bool = False, database: str = "neo4j"):
        logger.info("Initializing Neo4J Graph DB")
        if not uri:
            uri = os.getenv("NEO4J_ADDR", "bolt://localhost:7687")
        if not username:
            username = os.getenv("NEO4J_USERNAME", "neo4j")
        if not password:
            password = os.getenv("NEO4J_PASSWORD", "dummy_password")
        auth = (username, password)
        self.auth = auth
        self.uri = uri
        self.readonly = readonly
        self.database = database
        self.driver = AsyncGraphDatabase.driver(uri, auth=auth, notifications_min_severity="INFORMATION") #nosec
        self.non_async_driver = GraphDatabase.driver(uri, auth=auth, notifications_min_severity="INFORMATION") #nosec
        logger.info(f"Connecting to neo4j at {uri}")
        # Try to connect to the database, retry if it fails
        utils.retry_function(self.non_async_driver.verify_connectivity, 10, 10)
        logger.info(f"Connected to neo4j at {uri}")

    async def setup(self):
        logger.info("Setting up Neo4j Graph DB")

        logger.info("Setting up id indexes")
        await self._create_full_text_index(ID_TEXT_SEARCH_INDEX_NAME ,[DEFAULT_LABEL], [ALL_IDS_KEY, ENTITY_TYPE_KEY], analyzer='standard')
        await self._create_full_text_index(ID_TEXT_SEARCH_STRICT_INDEX_NAME,[DEFAULT_LABEL], [ALL_IDS_KEY], analyzer='keyword')

        logger.info("Setting up fresh until index")
        await self._create_range_index(FRESH_UNTIL_INDEX_NAME ,[DEFAULT_LABEL], [FRESH_UNTIL_KEY])

        logger.info("Create unique constraint on entity type and primary key")
        await self._create_unique_constraint(DEFAULT_LABEL, [ENTITY_TYPE_KEY, PRIMARY_ID_KEY])

        # await self._create_unique_constraint_relation(["relation_id"]) # TODO

    async def status(self) -> bool:
        """
        Check the status of the graph database connection
        :return: True if the connection is healthy, False otherwise
        """
        try:
            async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
                result = await session.run("RETURN 1 AS ok") # type: ignore
                record = await result.single()
                if record and record["ok"] == 1:
                    return True
                else:
                    return False
        except Exception as e:
            logger.error(f"Neo4j connection check failed: {e}", exc_info=True)
            return False

    async def fuzzy_search(self, keywords: List[List[Union[str, Tuple[float, str]]]],
                           type_filter: List[str],
                           num_record_per_type: int = 0,
                           require_single_match_per_type: bool = False,
                           strict: bool=True, max_results=100) -> List[Tuple[Entity, float]]:
        """
        Fuzzy search properties in all entities
        keywords are a list of lists, where each inner list is OR'd together, and outer lists are AND'd together
        
        Args:
            keywords: List of lists containing either strings or (weight, string) tuples
                     E.g. keywords = [['id1', (2.0, 'id2')], ['name1', 'name2']] 
                     will search for (id1 OR id2^2.0) AND (name1 OR name2)
                     Weights boost the relevance of specific terms in Lucene scoring
            type_filter: List of entity types to filter by
            num_record_per_type: Number of records to return per type (0 = no limit)
            require_single_match_per_type: Only return results if exactly one match per type
            strict: Use keyword analyzer (True) vs standard analyzer (False)
            all_props: Search all properties (True) vs just identity properties (False)
            max_results: Maximum number of results to return
            
        Returns:
            List of (Entity, score) tuples sorted by relevance score
        """
        logger.debug(f"Executing fuzzy_search with keywords={keywords}, type_filter={type_filter}, num_record_per_type={num_record_per_type}, require_single_match_per_type={require_single_match_per_type}, strict={strict}, max_results={max_results}")
        query_keywords = []
        # escape keywords for the query and AND/OR them together
        for kwlist in keywords:
            escaped_kwlist = []
            for kw in kwlist:
                if isinstance(kw, tuple):
                    # Handle (weight, string) tuple
                    weight, term = kw
                    escaped_term = self._escape_keyword_lucene(str(term))
                    # Apply boost using Lucene syntax: term^weight
                    weighted_term = f"{escaped_term}^{weight}"
                    escaped_kwlist.append(weighted_term)
                else:
                    # Handle plain string
                    escaped_term = self._escape_keyword_lucene(str(kw))
                    escaped_kwlist.append(escaped_term)

            # escape query keywords for cypher
            escaped_kwlist = [f"{str(kw).replace("'", '\\"').replace('"', '\\"')}" for kw in escaped_kwlist]

            query_keywords.append(" OR ".join(escaped_kwlist))
        query_keywords = " AND ".join(f"({kwlist})" for kwlist in query_keywords)

        if strict:
            index_name = ID_TEXT_SEARCH_STRICT_INDEX_NAME
        else:
            index_name = ID_TEXT_SEARCH_INDEX_NAME

        base_query = f"call db.index.fulltext.queryNodes('{index_name}', '{query_keywords}') YIELD node, score"

        if len(type_filter) > 0:
            for index, type_str in enumerate(type_filter):
                if index == 0:
                    base_query += f" WHERE '{type_str}' IN labels(node)"
                else:
                    base_query += f" OR '{type_str}' IN labels(node)"

        # TODO: Better way to handle options for top_record_per_type_only and single_match_per_type_only
        if num_record_per_type:
            if require_single_match_per_type:
                base_query += " WITH labels(node) AS lbls, node, score WITH lbls, collect({node: node, score: score}) AS groupedData WHERE size(groupedData) = 1 UNWIND groupedData[0] AS data"
            else:
                base_query += " WITH labels(node) AS lbls, node, score WITH lbls, collect({node: node, score: score}) AS groupedData UNWIND groupedData[0] AS data"
            query = base_query + " RETURN data.node as node, data.score as score"
        else:
            if require_single_match_per_type:
                base_query += " WITH labels(node) AS lbls, node, score WITH lbls, collect({node: node, score: score}) AS groupedData WHERE size(groupedData) = 1 UNWIND groupedData AS data"
            query = base_query + f" RETURN node, score LIMIT {max_results}"

        logger.debug(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query) # type: ignore
            results = []
            records : list[Record] = await res.fetch(max_results)
            for record in records:
                score: float = record.get("score")
                node: Node = record['node']
                labels = set(node.labels)
                props = record.data()['node']
                labels.discard(props[ENTITY_TYPE_KEY])
                labels.discard(DEFAULT_LABEL)

                # Create a raw entity with labels, properties, and primary label
                entity = Entity(
                                entity_type=props[ENTITY_TYPE_KEY],
                                primary_key_properties=props[ALL_IDS_PROPS_KEY][0].split(PROP_DELIMITER),
                                additional_key_properties=[k.split(PROP_DELIMITER) for k in props[ALL_IDS_PROPS_KEY][1:]],
                                additional_labels=labels,
                                all_properties=props)
                results.append((entity, score))

        return results

    async def get_all_entity_types(self, max_results=1000) -> List[str]:
        """
        Gets all entity types in the database
        """
        logger.debug(f"Executing get_all_entity_types with max_results={max_results}")
        query = "CALL db.labels();"
        logger.debug(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query)
            records: list[Record] = await res.fetch(max_results)
            entity_types = set()
            for record in records:
                if record.get('label'):
                    entity_types.add(record['label'])
        entity_types.discard(DEFAULT_LABEL)
        return list(entity_types)

    async def get_entity_type_properties(self, entity_type: str, max_results=1000) -> List[str]:
        """
        Get all properties for a given entity type in the graph database.
        
        Args:
            entity_type (str): The type of entity to get properties for
            max_results (int): Maximum number of results to return
            
        Returns:
            List[str]: A list of all properties for the specified entity type
        """
        logger.debug(f"Executing get_entity_type_properties with entity_type={entity_type}, max_results={max_results}")
        query = f"MATCH (n:{entity_type}) UNWIND keys(n) AS property RETURN DISTINCT property"
        logger.debug(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query) # type: ignore
            records: list[Record] = await res.fetch(max_results)
            properties = set()
            for record in records:
                if record.get('property'):
                    prop_name = record['property']
                    # Filter out internal properties that start with underscore
                    if not prop_name.startswith('_'):
                        properties.add(prop_name)
        return list(properties)

    async def find_relations(self, from_entity_type: str | None = None, to_entity_type: str | None = None, relation_name: str | None = None, 
        properties: dict | None = None, max_results: int = 10000) -> List[Relation]:
        """
        Finds relations between entities of specified types with given properties.
        
        Args:
            from_entity_type (str): The type of the source entity, empty for any
            to_entity_type (str): The type of the target entity, empty for any
            relation_name (str): The name of the relation, empty for any
            properties (dict): Properties to match on the relation
            max_results (int): Maximum number of results to return
            
        Returns:
            List[Relation]: List of matching relations
        """
        logger.debug(f"Executing find_relations with from_entity_type={from_entity_type}, to_entity_type={to_entity_type}, relation_name={relation_name}, properties={properties}, max_results={max_results}")
        # Build the match pattern
        from_pattern = f"(a:{from_entity_type})" if from_entity_type else "(a)"
        to_pattern = f"(b:{to_entity_type})" if to_entity_type else "(b)"
        rel_pattern = f"[r:{relation_name}]" if relation_name else "[r]"
        
        query_parts = [f"MATCH {from_pattern}-{rel_pattern}->{to_pattern}"]
        
        # Add WHERE clause for relation properties if provided
        where_conditions = []
        params = {}
        
        if properties:
            for key, value in properties.items():
                param_name = f"prop_{key}"
                where_conditions.append(f"r.`{key}` = ${param_name}")
                params[param_name] = value
        
        if where_conditions:
            query_parts.append("WHERE " + " AND ".join(where_conditions))
        
        query_parts.append("RETURN a, r, b")
        query_parts.append(f"LIMIT {max_results}")
        
        query = " ".join(query_parts)
        logger.debug(query)
        logger.debug(params)
        
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query, params) # type: ignore
            records: list[Record] = await res.fetch(max_results)
            relations = []
            
            for record in records:
                from_node: Node = record['a']
                rel: Relationship = record['r']
                to_node: Node = record['b']

                # Extract entity information
                from_entity_props = dict(from_node)
                to_entity_props = dict(to_node)

                # Get entity IDs and types
                from_entity_pk = from_entity_props.get(PRIMARY_ID_KEY, "")
                to_entity_pk = to_entity_props.get(PRIMARY_ID_KEY, "")

                from_entity_type = from_entity_props.get(ENTITY_TYPE_KEY, "")
                to_entity_type = to_entity_props.get(ENTITY_TYPE_KEY, "")                
                
                relation_props = dict(rel.items())

                # Create Relation object
                relation = Relation(
                    from_entity=EntityIdentifier(entity_type=str(from_entity_type), primary_key=str(from_entity_pk)),
                    to_entity=EntityIdentifier(entity_type=str(to_entity_type), primary_key=str(to_entity_pk)),
                    relation_name=rel.type,
                    relation_properties=relation_props
                )
                
                relations.append(relation)
            
            return relations
        

    async def find_entity(self, entity_type: str|None, properties: dict|None, max_results=10000) -> List[Entity]:
        logger.debug(f"Executing find_entity with entity_type={entity_type}, properties={properties}, max_results={max_results}")
        if entity_type is None or entity_type == "":
            labels = []
        else:
            labels = [entity_type]
        builder = (
            QueryBuilder()
            .match()
            .node(labels=labels, ref_name='e') # type: ignore
        )

        if properties is not None and len(properties) > 0:
            props_with_ref = {f'e.`{key}`': value for key, value in properties.items()}
            builder = builder.where_multiple(props_with_ref, "=") # type: ignore

        builder = builder.return_literal('e')
        builder = builder.limit(max_results) # type: ignore

        query = str(builder)
        logger.debug(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query) # type: ignore
            records : list[Record] = await res.fetch(max_results)
            entities = []
            for record in records:
                node: Node = record['e']
                labels = set(node.labels)
                props = record.data()['e']
                labels.discard(props[ENTITY_TYPE_KEY])
                labels.discard(DEFAULT_LABEL)
                # Create a raw entity with labels, properties, and primary label
                entity = Entity(entity_type=props[ENTITY_TYPE_KEY],
                                primary_key_properties=props[ALL_IDS_PROPS_KEY][0].split(PROP_DELIMITER),
                                additional_key_properties=[k.split(PROP_DELIMITER) for k in props[ALL_IDS_PROPS_KEY][1:]],
                                additional_labels=labels,
                                all_properties=props)

                entities.append(entity)
        return entities

    async def fetch_entity(self, entity_type:str, primary_key_value: str) -> (Entity | None):
        logger.debug(f"Executing fetch_entity with entity_type={entity_type}, primary_key_value={primary_key_value}")
        entities = await self.find_entity(entity_type, {PRIMARY_ID_KEY: primary_key_value})
        if len(entities) == 0:
            return None
        else:
            return entities[0]

    async def fetch_entity_relations(self, entity_type: str, entity_pk: str, max_results: int = 10000) -> List[Relation]:
        logger.debug(f"Executing fetch_entity_relations with entity_type={entity_type}, entity_pk={entity_pk}, max_results={max_results}")
        # build the query
        qb = QueryBuilder()

        qb = (qb
              .match()
              .node(ref_name='a', labels=[entity_type], properties={PRIMARY_ID_KEY: entity_pk}) # type: ignore
              .related(ref_name='r')
              .node(ref_name='b')
              .return_literal('a,r,b'))

        query = str(qb)
        logger.debug(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query) # type: ignore
            records: list[Record] = await res.fetch(max_results)
            relations = []
            for record in records:
                relationship : Relationship = record.value('r')
                relation_name = relationship.type
                relation_props = dict(relationship.items())

                from_entity_raw = relationship.start_node
                to_entity_raw = relationship.end_node

                if from_entity_raw is None or to_entity_raw is None:
                    continue

                from_entity_type = from_entity_raw.get(ENTITY_TYPE_KEY)
                from_additional_labels = set(from_entity_raw.labels)
                from_additional_labels.discard(from_entity_type)
                from_additional_labels.discard(DEFAULT_LABEL)

                to_entity_type = to_entity_raw.get(ENTITY_TYPE_KEY)
                to_additional_labels = set(to_entity_raw.labels)
                to_additional_labels.discard(to_entity_type)
                to_additional_labels.discard(DEFAULT_LABEL)

                from_entity = Entity(entity_type=from_entity_type,
                                    primary_key_properties=from_entity_raw[ALL_IDS_PROPS_KEY][0].split(PROP_DELIMITER),
                                    additional_key_properties=[k.split(PROP_DELIMITER) for k in from_entity_raw[ALL_IDS_PROPS_KEY][1:]],
                                     additional_labels=from_additional_labels,
                                     all_properties=dict(from_entity_raw))

                to_entity = Entity(entity_type=to_entity_type,
                                    primary_key_properties=to_entity_raw[ALL_IDS_PROPS_KEY][0].split(PROP_DELIMITER),
                                    additional_key_properties=[k.split(PROP_DELIMITER) for k in to_entity_raw[ALL_IDS_PROPS_KEY][1:]],
                                   additional_labels=to_additional_labels,
                                   all_properties=dict(to_entity_raw))


                relation = Relation(from_entity=from_entity.get_identifier(),
                                          to_entity=to_entity.get_identifier(),
                                          relation_name=relation_name,
                                          relation_properties=relation_props)

                relations.append(relation)

            return relations

    async def update_entity(self, entity_type: str, entities: List[Entity], client_name: str, fresh_until: int):
        """
        Create or update a list of entities in the database using a batch UNWIND query.

        :param entity_type: The primary label for all entities in the batch.
        :param entities: The list of entities to create/update.
        :param client_name: The name of the client creating/updating the entities.
        :param fresh_until: The fresh until timestamp.
        """
        logger.debug(f"Updating {len(entities)} entities of type '{entity_type}' for client='{client_name}'")
        
        # Return if no entities provided
        if not entities:
            return

        # Prepare parameters for all entities in the batch
        batch_params = []
        unix_timestamp = int(time.time())

        for entity in entities:
            if entity.entity_type != entity_type:
                logger.warning(f"Mismatched entity type: expected {entity_type}, got {entity.entity_type}. Skipping.")
                continue
            
            try:
                # 1. Generate primary key
                primary_key_val = entity.generate_primary_key()

                # 2. Collect all identity values and properties
                all_id_vals = [entity.all_properties[k] for k in entity.primary_key_properties]
                all_id_props = [PROP_DELIMITER.join(map(str, entity.primary_key_properties))]
                if entity.additional_key_properties:
                    for id_keys in entity.additional_key_properties:
                        try:
                            vals = [entity.all_properties[prop] for prop in id_keys]
                            all_id_vals.extend(vals)
                            all_id_props.append(PROP_DELIMITER.join(map(str, id_keys)))
                        except KeyError as e:
                            logger.warning(f"Skipping additional key for entity {primary_key_val}: property {e} not found.")

                # 3. Assemble the complete properties dictionary for the query
                entity_params = entity.all_properties.copy()
                entity_params.update({
                    FRESH_UNTIL_KEY: fresh_until,
                    ENTITY_TYPE_KEY: entity.entity_type,
                    LAST_UPDATED_KEY: unix_timestamp,
                    UPDATED_BY_KEY: client_name,
                    ALL_IDS_KEY: all_id_vals,
                    ALL_IDS_PROPS_KEY: all_id_props,
                    PRIMARY_ID_KEY: primary_key_val
                })
                batch_params.append(entity_params)

            except Exception as e:
                logger.error(f"Failed to process entity {entity}: {e}", exc_info=True)

        if not batch_params:
            logger.warning("No valid entities to update after processing.")
            return

        # Construct labels string. All entities in this batch share these labels.
        labels = {DEFAULT_LABEL, entity_type}
        # Note: This simplified batching assumes additional_labels are not used or are the same for the batch.
        # For varying additional_labels, entities would need to be grouped by their full label set.
        labels_str = ":".join(map(self._escape_label, labels))

        # Create the UNWIND batch query
        query = f"""
        UNWIND $batch as properties
        MERGE (e:{labels_str} {{`{PRIMARY_ID_KEY}`: properties.`{PRIMARY_ID_KEY}`}})
        SET e = properties
        """

        params = {"batch": batch_params}
        logger.debug(f"Executing batch update for {len(batch_params)} entities with labels: {labels_str}")
        logger.debug(query)
        logger.debug(params)

        max_retries = 5
        for attempt in range(max_retries):
            try:
                async with self.driver.session(database=self.database) as session:
                    await session.run(query, params) # type: ignore
                logger.info(f"Successfully updated batch of {len(batch_params)} entities. on {self.uri}")
                break  # Success
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Neo4j batch query failed (attempt {attempt + 1}/{max_retries}): {e}")
                    await asyncio.sleep(1)  # Wait before retry
                else:
                    logger.error(f"Neo4j batch query failed after {max_retries} attempts: {e}", exc_info=True)
                    raise

    async def update_relation(self, relation: Relation, fresh_until: int, client_name=None):
        logger.debug(f"Executing update_relation with relation={relation.relation_name}, from_entity={relation.from_entity}, to_entity={relation.to_entity}, fresh_until={fresh_until}, client_name={client_name}")
        properties = {}
        if relation.relation_properties is not None:
            properties = relation.relation_properties

        relationship_ref = 'r'
        unix_timestamp = int(time.time())

        if client_name is not None:
            properties[UPDATED_BY_KEY] = client_name
            properties[FRESH_UNTIL_KEY] = fresh_until
            properties[LAST_UPDATED_KEY] = unix_timestamp
                        
        # Format all the properties for the write query
        properties_with_ref = {}
        for k,v in properties.items():
            properties_with_ref[f"{relationship_ref}.{k}"] = v 

        if relation.from_entity.entity_type is None or relation.to_entity.entity_type is None:
            raise ValueError("from_entity and to_entity must have entity_type set")

        # Build the query for matching the nodes part
        builder = (
            QueryBuilder()
            .match()
            .node(labels=[relation.from_entity.entity_type], ref_name='f', properties={PRIMARY_ID_KEY: relation.from_entity.primary_key})  # type: ignore
            .match()
            .node(labels=[relation.to_entity.entity_type], ref_name='t', properties={PRIMARY_ID_KEY: relation.to_entity.primary_key}) # type: ignore
        )

        # Build the merge/create relationship part
        builder = (builder
                    .merge()
                    .node(ref_name='f')
                    .related(ref_name=relationship_ref, label=relation.relation_name)
                    .node(ref_name='t')
                    .set(properties_with_ref))

        query = str(builder)
        logger.debug(query)
        async with self.driver.session(database=self.database) as session:
            _ = await session.run(query) # type: ignore
            # logging.debug(res)

    async def shortest_path(self, entity_a: EntityIdentifier, entity_b: EntityIdentifier, ignore_direction=True, max_depth=20) -> List[Tuple[List[Entity], List[Relation]]]:
        """
        Finds all shortest paths between two entities in the graph database
        :param entity_a: EntityIdentifier of the first entity
        :param entity_b: EntityIdentifier of the second entity
        :param ignore_direction: If True, treat relationships as undirected
        :param max_depth: Maximum path length to search
        :return: A list of tuples, each containing (entities_path, relations_path)
        """
        logger.debug(f"Executing shortest_path with entity_a={entity_a}, entity_b={entity_b}, ignore_direction={ignore_direction}, max_depth={max_depth}")
        if ignore_direction:
            relationship_pattern = f"-[*1..{max_depth}]-"
        else:
            relationship_pattern = f"-[*1..{max_depth}]->"
        
        query = f"""
        MATCH (start:{entity_a.entity_type} {{`{PRIMARY_ID_KEY}`: $start_id}})
        MATCH (end:{entity_b.entity_type} {{`{PRIMARY_ID_KEY}`: $end_id}})
        MATCH path = allShortestPaths((start){relationship_pattern}(end))
        RETURN path
        """
        
        params = {
            "start_id": entity_a.primary_key,
            "end_id": entity_b.primary_key,
            "max_depth": max_depth
        }
        
        logger.debug(query)
        logger.debug(params)
        
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database) as session:
            res = await session.run(query, params) # type: ignore
            records: list[Record] = await res.fetch(1000)
            
            paths = []
            for record in records:
                path = record['path']
                
                # Extract entities from path nodes
                entities = []
                for node in path.nodes:
                    node_props = dict(node)
                    labels = set(node.labels)
                    entity_type = node_props[ENTITY_TYPE_KEY]
                    labels.discard(entity_type)
                    labels.discard(DEFAULT_LABEL)
                    
                    entity = Entity(
                        entity_type=entity_type,
                        primary_key_properties=node_props[ALL_IDS_PROPS_KEY][0].split(PROP_DELIMITER),
                        additional_key_properties=[k.split(PROP_DELIMITER) for k in node_props[ALL_IDS_PROPS_KEY][1:]],
                        additional_labels=labels,
                        all_properties=node_props
                    )
                    entities.append(entity)
                
                # Extract relations from path relationships
                relations = []
                for relationship in path.relationships:
                    relation_props = dict(relationship.items())
                    
                    # Get start and end node info
                    start_node = relationship.start_node
                    end_node = relationship.end_node
                    
                    from_entity_id = EntityIdentifier(
                        entity_type=start_node.get(ENTITY_TYPE_KEY),
                        primary_key=start_node.get(PRIMARY_ID_KEY)
                    )
                    
                    to_entity_id = EntityIdentifier(
                        entity_type=end_node.get(ENTITY_TYPE_KEY),
                        primary_key=end_node.get(PRIMARY_ID_KEY)
                    )
                    
                    relation = Relation(
                        from_entity=from_entity_id,
                        to_entity=to_entity_id,
                        relation_name=relationship.type,
                        relation_properties=relation_props
                    )
                    relations.append(relation)
                
                paths.append((entities, relations))
            
            return paths


    async def remove_entity(self, entity_type: str | None, properties: (dict | None) = None):
        """
        Removes an entity from the graph database
        :param entity_type: type of the entity to remove
        :param properties: dict of properties to match
        """
        logger.debug(f"Executing remove_entity with entity_type={entity_type}, properties={properties}")
        # Build the MATCH clause
        if entity_type is None or entity_type == "":
            match_clause = "MATCH (n)"
        else:
            match_clause = f"MATCH (n:{self._escape_label(entity_type)})"
        
        # Build WHERE clause and parameters
        where_conditions = []
        params = {}
        
        if properties is not None and len(properties) > 0:
            for key, value in properties.items():
                param_name = f"prop_{key}"
                where_conditions.append(f"n.`{key}` = ${param_name}")
                params[param_name] = value
        
        # Construct the full query
        if where_conditions:
            where_clause = "WHERE " + " AND ".join(where_conditions)
            query = f"{match_clause} {where_clause} DETACH DELETE n"
        else:
            query = f"{match_clause} DETACH DELETE n"
        
        logger.debug(query)
        logger.debug(params)
        
        async with self.driver.session(database=self.database) as session:
            await session.run(query, params) # type: ignore


    async def remove_relation(self, relation_name: str, properties: (dict| None) = None):
        """
        Removes a relation from the graph database
        :param relation_name: name of the relation to remove
        :param properties: dict of properties to match
        """
        logger.debug(f"Executing remove_relation with relation_name={relation_name}, properties={properties}")
        if properties is None or len(properties) == 0:
            where_str = ""
        else:
            where_str = "WHERE "
            for key, value in properties.items():
                if where_str != "WHERE ":
                    where_str += " AND "
                where_str += f"r.`{key}`='{value}'"

        if relation_name is None or relation_name == "":
            query = f"""
            MATCH (f)-[r]->(t) {where_str} DETACH DELETE r
            """
        else:
            query = f"""
            MATCH (f)-[r:{relation_name}]->(t) {where_str} DETACH DELETE r
            """

        logger.debug(query)
        async with self.driver.session(database=self.database) as session:
            await session.run(query) # type: ignore

    async def remove_stale_entities(self):
        """
        Periodically clean up the database by removing entities that are older than the fresh_until timestamp
        """
        logger.debug("Removing stale entities from the database")
        query = f"""
        MATCH (n:{DEFAULT_LABEL}) WHERE n.{FRESH_UNTIL_KEY}<{int(time.time())} DETACH DELETE n
        """
        logger.debug(query)
        async with self.driver.session(database=self.database) as session:
            await session.run(query) # type: ignore
            logger.info("Removed stale entities from the database")

    async def relate_entities_by_property(self, client_name: str, entity_a_type: str, entity_b_type: str, relation_type: str,
                                          matching_properties: dict, relation_properties: (dict | None) = None):
        logger.debug(f"Executing relate_entities_by_property with client_name={client_name}, entity_a_type={entity_a_type}, entity_b_type={entity_b_type}, relation_type={relation_type}, matching_properties={matching_properties}, relation_properties={relation_properties}")

        if matching_properties is None or len(matching_properties) == 0:
            raise ValueError("matching_properties must be set and not empty")

        where_str = "WHERE "
        for matching_property_a, matching_property_b in matching_properties.items():
            if where_str != "WHERE ":
                where_str += " AND "
            where_str += f"(f.`{matching_property_a}`=t.`{matching_property_b}` OR f.`{matching_property_a}` IN t.`{matching_property_b}` OR t.`{matching_property_b}` IN f.`{matching_property_a}`)"

        if relation_properties is None or len(relation_properties) == 0:
            set_str = ""
            relation_properties = {}
        else:
            set_str = "SET "

        for key, value in relation_properties.items():
            if set_str != "SET ":
                set_str += " SET "
            set_str += f"r.`{key}`='{value}'"

        query = "" + \
                    f"MATCH (f:{entity_a_type}) " + \
                    f"MATCH (t:{entity_b_type}) " + \
                    f"{where_str} " + \
                    f"MERGE (f)-[r:{relation_type}]-(t) " + \
                    f"SET r.`{UPDATED_BY_KEY}`='{client_name}' " +\
                    f"SET r.`{LAST_UPDATED_KEY}`={time.time()} " +\
                    f"{set_str}"
        logger.debug(query)
        await self.raw_query(query)

    async def get_property_value_count(self, entity_type: str, property_name: str, property_value: Optional[str]) -> int:
        logger.debug(f"Executing get_property_value_count with entity_type={entity_type}, property_name={property_name}, property_value={property_value}")
        if property_value is not None:
            query = f"""
            MATCH (n:{entity_type}) WHERE n.`{property_name}`='{property_value}'
            RETURN COUNT(n) AS count
            """
        else:
            query = f"""
            MATCH (n:{entity_type}) WHERE n.`{property_name}` IS NOT NULL
            RETURN COUNT(n) AS count
            """

        logger.debug(query)
        result = await self.raw_query(query)
        return result["results"][0].get("count", 0)

    async def get_values_of_matching_property(self, entity_type_a: str, entity_a_property: str,
                                              entity_type_b: str,  matching_properties: dict, max_results: int=10) -> List[str]:
        logger.debug(f"Executing get_values_of_matching_property with entity_type_a={entity_type_a}, entity_a_property={entity_a_property}, entity_type_b={entity_type_b}, matching_properties={matching_properties}, max_results={max_results}")

        where_str = "WHERE "
        for matching_property_a, matching_property_b in matching_properties.items():
            if where_str != "WHERE ":
                where_str += " AND "
            where_str += f"(f.`{matching_property_a}`=t.`{matching_property_b}` OR f.`{matching_property_a}` IN t.`{matching_property_b}` OR t.`{matching_property_b}` IN f.`{matching_property_a}`)"


        query = f"MATCH (f:{entity_type_a}) " + \
                f"MATCH (t:{entity_type_b}) " + \
                f"{where_str} " + \
                f"RETURN distinct(f.`{entity_a_property}`) as values LIMIT {max_results}" # Using the to varialbe to return, as idkey property are not likely to be list (not supported)

        logger.debug(query)
        result = await self.raw_query(query)
        logger.debug(f"Query result: {result}")
        results = result.get("results", [])
        if len(results) == 0:
            return []
        vals = []
        # Extract the values from the results
        for result in results:
            vals.append(result.get("values", ""))
        return vals

    async def raw_query(self, query: str, readonly=False, max_results=10000) -> dict:
        logger.debug(f"Executing raw_query with query_length={len(query)}, readonly={readonly}, max_results={max_results}")
        if readonly:
            session = self.driver.session(default_access_mode=neo4j.READ_ACCESS, database=self.database)
        else:
            session = self.driver.session(database=self.database)
        async with session:
            res = await session.run(query) # type: ignore
            # d = await res.data()
            rec = await res.fetch(max_results)
            logger.debug(f"Query returned {len(rec)} records")
            d = await res.consume()
            return {
                    "results":rec,
                    "notifications": d.notifications
            }

    async def _create_full_text_index(self, index_name: str, labels: list, props: list, analyzer: str = 'simple'):
        props = [f"n.`{prop}`" for prop in props]
        props_str = ",".join(props)
        query = f"""
        CREATE FULLTEXT INDEX {index_name} IF NOT EXISTS FOR (n:{"|".join(labels)}) ON EACH [{props_str}]
        OPTIONS {{
          indexConfig: {{
            `fulltext.analyzer`: '{analyzer}'
          }}
        }}
        """
        logger.debug(query)
        async with self.driver.session(database=self.database) as session:
            await session.run(query) # type: ignore

    async def _create_text_index(self, index_name: str, labels: list,  props: list):
        props = [f"n.{prop}" for prop in props]
        props_str = ",".join(props)
        query = f"""
        CREATE TEXT INDEX {index_name} IF NOT EXISTS FOR (n:{"|".join(labels)}) ON ({props_str})
        """
        logger.debug(query)
        async with self.driver.session(database=self.database) as session:
            await session.run(query) # type: ignore

    async def _create_range_index(self, index_name: str, labels: list,  props: list):
        props = [f"n.{prop}" for prop in props]
        props_str = ",".join(props)
        query = f"""
        CREATE INDEX {index_name} IF NOT EXISTS FOR (n:{"|".join(labels)}) ON ({props_str})
        """
        logger.debug(query)
        async with self.driver.session(database=self.database) as session:
            await session.run(query) # type: ignore
        
    async def _create_unique_constraint(self, label: str, props: list):
        query = f"CREATE CONSTRAINT {label}_unique IF NOT EXISTS FOR (n:{label}) REQUIRE ({", ".join([f"n.{prop}" for prop in props])}) IS UNIQUE"
        async with self.driver.session(database=self.database) as session:
            await session.run(query) # type: ignore

    def _escape_label(self, label: str) -> str:
        return label.replace(':', '\\:')

    def _escape_str_value(self, v: Any) -> str:
        """
        Escape a value for use in a Cypher query.
        This is used to ensure that special characters do not break the query.
        """
        res = v.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'").replace('\r', '\\r').replace('\n', '\\n')
        return res

    def _escape_keyword_lucene(self, keyword: str) -> str:
        lucene_special_chars = r'+-&&||!(){}[]^"~*?:\/'
        k = ''.join(
            f'\\{char}' if char in lucene_special_chars else char
            for char in keyword
        )
        if k == "":
            return "''"
        return k

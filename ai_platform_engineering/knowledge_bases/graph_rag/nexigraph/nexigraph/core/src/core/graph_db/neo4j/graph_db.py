from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Any, List, Tuple

import neo4j
from neo4j import Record, AsyncGraphDatabase, GraphDatabase
from cymple.builder import QueryBuilder # TODO: Move away from cymple, limited support for complex queries
from neo4j.graph import Node, Relationship

import core.utils as utils

from core.graph_db.base import GraphDB
from core.constants import ALL_IDS_KEY, ALL_IDS_PROPS_KEY, FRESH_UNTIL_KEY, PROPERTY_VALUE_MAX_LENGTH, PRIMARY_ID_KEY, LAST_UPDATED_KEY, \
    ENTITY_TYPE_KEY, DEFAULT_LABEL, UPDATED_BY_KEY, PROP_DELIMITER, JSON_ENCODED_KEY

from core.models import Entity, Relation, EntityTypeMetaRelation

# Index for just identity values (primary keys)
ALL_TEXT_SEARCH_INDEX_NAME='all_fulltext'
ALL_TEXT_SEARCH_STRICT_INDEX_NAME='all_fulltext_strict'
ID_TEXT_SEARCH_INDEX_NAME='id_fulltext'
ID_TEXT_SEARCH_STRICT_INDEX_NAME='id_fulltext_strict'

# Index for fresh until so entities/relations can be cleaned
FRESH_UNTIL_INDEX_NAME='freshuntil_range'

logging = utils.get_logger("neo4j_graph_db")

class Neo4jDB(GraphDB):

    database_type: str = "neo4j"
    query_language: str = "cypher"

    def __init__(self, readonly: bool = False):
        logging.info("Initializing Neo4J Graph DB")
        uri = os.getenv("NEO4J_ADDR", "bolt://localhost:7687")
        username = os.getenv("NEO4J_USERNAME", "neo4j")
        password = os.getenv("NEO4J_PASSWORD", "dummy_password")
        auth = (username, password)
        self.auth = auth
        self.uri = uri
        self.readonly = readonly
        self.driver = AsyncGraphDatabase.driver(uri, auth=auth)
        self.non_async_driver = GraphDatabase.driver(uri, auth=auth)
        logging.info(f"Connecting to neo4j at {uri}")
        # Try to connect to the database, retry if it fails
        utils.retry_function(self.non_async_driver.verify_connectivity, 10, 10)
        logging.info(f"Connected to neo4j at {uri}")

    async def setup(self):
        logging.info("Setting up Neo4j Graph DB")

        logging.info("Setting up all property indexes")
        await self._create_full_text_index(ALL_TEXT_SEARCH_INDEX_NAME, [DEFAULT_LABEL], [ENTITY_TYPE_KEY, JSON_ENCODED_KEY], analyzer='standard')
        await self._create_full_text_index(ALL_TEXT_SEARCH_STRICT_INDEX_NAME, [DEFAULT_LABEL], [JSON_ENCODED_KEY], analyzer='keyword')

        logging.info("Setting up id indexes")
        await self._create_full_text_index(ID_TEXT_SEARCH_INDEX_NAME ,[DEFAULT_LABEL], [ALL_IDS_KEY, ENTITY_TYPE_KEY], analyzer='standard')
        await self._create_full_text_index(ID_TEXT_SEARCH_STRICT_INDEX_NAME,[DEFAULT_LABEL], [ALL_IDS_KEY], analyzer='keyword')

        logging.info("Setting up fresh until index")
        await self._create_range_index(FRESH_UNTIL_INDEX_NAME ,[DEFAULT_LABEL], [FRESH_UNTIL_KEY])

    async def fuzzy_search(self, keywords: List[List[str]],
                           type_filter: List[str],
                           num_record_per_type: int = 0,
                           require_single_match_per_type: bool = False,
                           strict: bool=True,
                           all_props: bool = False, max_results=100) -> List[Tuple[Entity, float]]:
        """
        Fuzzy search properties in all entities
        keywords are a list of lists, where each inner list is OR'd together
        all_props is a boolean that indicates whether to search all properties of the entity or just the identity properties
        E.g. keywords = [['id1', 'id2'], ['name1', 'name2']] will search for (id1 OR id2) AND (name1 OR name2)
        """
        logging.debug("identity search query: %s", keywords)
        query_keywords = []
        # escape keywords for the query and AND/OR them together
        for kwlist in keywords:
            # List of special characters used in Lucene
            # Function to escape special characters for Lucene
            lucene_special_chars = r'+-&&||!(){}[]^"~*?:\/'
            def escape_keyword(keyword):
                k = ''.join(
                    f'\\{char}' if char in lucene_special_chars else char
                    for char in keyword
                )
                if k == "":
                    return "''"
                return k
            escaped_kwlist = [escape_keyword(str(kw)) for kw in kwlist]

            # escape query keywords for cypher
            escaped_kwlist = [f"{str(kw).replace("'", '\\"').replace('"', '\\"')}" for kw in escaped_kwlist]

            query_keywords.append(" OR ".join(escaped_kwlist))
        query_keywords = " AND ".join(f"({kwlist})" for kwlist in query_keywords)

        if all_props:
            # Use the all text search index
            if strict:
                index_name = ALL_TEXT_SEARCH_STRICT_INDEX_NAME
            else:
                index_name = ALL_TEXT_SEARCH_INDEX_NAME
        else:
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

        # TODO: Better way to handle options for top_record_per_type_only and single_match_per_type_only
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

        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
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
                entity = Entity(entity_type=props[ENTITY_TYPE_KEY],
                                primary_key_properties=props[ALL_IDS_PROPS_KEY][0].split(PROP_DELIMITER),
                                additional_key_properties=[k.split(PROP_DELIMITER) for k in props[ALL_IDS_PROPS_KEY][1:]],
                                additional_labels=labels,
                                all_properties=props)
                results.append((entity, score))

        return results

    async def get_relation_paths(self, start_entity_type, end_entity_type, max_results=1000) -> List[List[EntityTypeMetaRelation]]:
        if start_entity_type == "" or end_entity_type == "":
            raise ValueError("Start and end entity types must be specified")
        query = """MATCH (a)-[r]->(b) WITH labels(a) AS a_labels,type(r) AS rel_type,labels(b) AS b_labels RETURN distinct *"""
        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
            res = await session.run(query)
            records: list[Record] = await res.fetch(max_results)

            # Create a graph representation from the records
            graph = defaultdict(list)
            for record in records:
                a_labels = set(record['a_labels'])
                rel_type = record['rel_type']
                b_labels = set(record['b_labels'])
                # Filter out the default label
                a_labels.discard(DEFAULT_LABEL)
                b_labels.discard(DEFAULT_LABEL)

                # Create the graph
                for start in a_labels:
                    for end in b_labels:
                        graph[start].append((end, rel_type, EntityTypeMetaRelation(from_entity_type=start,
                                                                                   to_entity_type=end,
                                                                                   relation_name=rel_type)))

            # BFS to find the shortest path
            queue = deque([(start_entity_type, [])])  # (current_node, current_path)
            visited = set()

            paths = []

            while queue:
                current_node, current_path = queue.popleft()
                logging.debug(f"Visiting node: {current_node}, path: {current_path}")
                if current_node == end_entity_type:
                    paths.append(current_path)
                if current_node in visited:
                    continue
                visited.add(current_node)
                for neighbor, relation, tuple_info in graph.get(current_node, []):
                    if neighbor not in visited:
                        queue.append((neighbor, current_path + [tuple_info]))

            # If no path is found
            return paths

    async def get_all_entity_types(self, max_results=1000) -> List[str]:
        query = "CALL db.labels();"
        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
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
        query = f"MATCH (n:{entity_type}) UNWIND keys(n) AS property RETURN DISTINCT property"
        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
            res = await session.run(query)
            records: list[Record] = await res.fetch(max_results)
            properties = set()
            for record in records:
                if record.get('property'):
                    prop_name = record['property']
                    # Filter out internal properties that start with underscore
                    if not prop_name.startswith('_'):
                        properties.add(prop_name)
        return list(properties)

    async def find_entity(self, entity_type: str, properties: dict, max_results=10000) -> List[Entity]:
        if entity_type == "":
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
        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
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

    async def find_entity_by_id_value(self, entity_type: str, identity_values=[], max_results=10000) -> List[Entity]:
        """
        Finds an entity in the graph database by its identity values
        :param entity_type: type of entity, empty for any
        :param identity_values: list of identity values to match, values are AND'd together
        :param max_results: maximum number of results to return
        :return: list of entities
        """
        if entity_type == "":
            labels = []
        else:
            labels = [entity_type]

        labels_str = ": ".join(labels).strip()
        if len(identity_values) == 0:
            return []

        where_str = " AND ".join([f"e.`{ALL_IDS_KEY}` = '{v}'" for v in identity_values])

        # build the query
        query = f"""
        MATCH (e: {labels_str}) WHERE {where_str} RETURN e LIMIT {max_results}
        """

        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
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

    async def get_entity(self, entity_type:str, primary_key_value: str) -> (Entity | None):
        entities = await self.find_entity(entity_type, {PRIMARY_ID_KEY: primary_key_value})
        if len(entities) == 0:
            return None
        else:
            return entities[0]

    async def get_entity_relations(self, entity_type: str, id_value: str, max_results=10000) -> List[Relation]:
        # build the query
        qb = QueryBuilder()

        qb = (qb
              .match()
              .node(ref_name='a', labels=[entity_type], properties={PRIMARY_ID_KEY: id_value}) # type: ignore
              .related(ref_name='r')
              .node(ref_name='b')
              .return_literal('a,r,b'))

        query = str(qb)
        logging.info(query)
        async with self.driver.session(default_access_mode=neo4j.READ_ACCESS) as session:
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

                relations.append(Relation(from_entity=from_entity.get_identifier(),
                                          to_entity=to_entity.get_identifier(),
                                          relation_name=relation_name,
                                          relation_properties=relation_props))

            return relations

    async def update_entity(self, entity: Entity, client_name: str, fresh_until: int):
        """
        Create or update an entity in the database

        :param entity: the entity to create/update
        :param client_name: the name of the client creating/updating the entity
        :param fresh_until: the fresh until timestamp

        :raises ValueError: if the entity does not have a valid property for primary key
        """

        # Create a json encoding of the entity which will be stored in the entity itself to aid search
        props_to_be_json_encoded = {} # properties to be encoded
        for k,v in entity.all_properties.items():
            if k[0] == '_':  # skip internal properties
                continue
            if len(str(v)) > PROPERTY_VALUE_MAX_LENGTH: # skip properties that are too long
                logging.warning(f"Ignoring property {k} with length {len(str(v))}")
                continue
            props_to_be_json_encoded[k] = str(v)
        # neo4j has a limit of 32k for string properties, so we need to remove the properties until we are under the limit
        # we can use a better string search/indexing method later
        while len(json_encoded := str(utils.json_encode(props_to_be_json_encoded))) > 32000:
            logging.warning(f"json_encoded length: {len(json_encoded)}, removing largest property")
            largest_key = max(props_to_be_json_encoded, key=lambda key: len(str(props_to_be_json_encoded[key])))
            props_to_be_json_encoded.pop(largest_key)


        # Generate the primary key value from the primary key properties - this is used to uniquely identify the entity
        # If the primary key properties are not set or the properties dont exist, raise an error
        if entity.primary_key_properties is None or len(entity.primary_key_properties) == 0:
            raise ValueError(f"Entity {entity.entity_type} does not have primary key properties set")
        try:
            primary_key_val = entity.generate_primary_key()
        except Exception:
            raise ValueError(f"Entity {entity.entity_type} does not have a valid property for primary key")

        # Create an array of all identity values for the entity (primary key + additional keys)
        # Also create a nested array to hold all the properties for each identity key
        # with primary key at index 0, additional keys at index 1 and onwards, e.g.: [[primary_key_prop1, primary_key_prop2], [additional_key_prop1, additional_key_prop2]]
        all_id_vals = [] # flat array of all identity values [val1, val2, val3, ...]
        all_id_props = [] # nested array of all identity properties [[prop1, prop2], [prop3, prop4]]
        all_id_props.append(PROP_DELIMITER.join([str(v) for v in entity.primary_key_properties]))
        all_id_vals.extend([entity.all_properties[k] for k in entity.primary_key_properties])
        # add all additional key values + property keys
        # if the property is not found in the entity properties
        # dont raise an error, just skip it and log a warning
        if entity.additional_key_properties is None:
            entity.additional_key_properties = []
        for id_keys in entity.additional_key_properties:
            vals = []
            keys = []
            skip=False
            for prop in id_keys:
                if prop not in entity.all_properties:
                    logging.warning(f"Property {prop} not found in entity properties for {entity.entity_type}")
                    logging.warning(f"Entity properties: {entity.all_properties}")
                    # skip the key entirely if part of the key is missing
                    skip=True
                    break

                if isinstance(entity.all_properties[prop], (list, set)):
                    logging.warning(f"Property {prop} is a list/set in entity {entity.entity_type}, not supported for identity keys")
                val = str(entity.all_properties[prop])
                vals.append(val)
                keys.append(prop)
            if skip:
                continue
            all_id_vals += vals
            all_id_props.append(PROP_DELIMITER.join([str(v) for v in keys]))


        # Create set of labels for the entity
        labels = entity.additional_labels
        if labels is None:
            labels = set()
        labels.add(DEFAULT_LABEL)
        labels.add(entity.entity_type)
        labels = list(labels) # remove duplicates

        # Create a dictionary to hold all properties for the entity
        all_props_dict: dict[str, (List[str]|set|str|int|bool|float)] = entity.all_properties.copy()
        # add internal/compulsory properties
        unix_timestamp = int(time.time())
        all_props_dict[FRESH_UNTIL_KEY] =  fresh_until
        all_props_dict[ENTITY_TYPE_KEY] =  entity.entity_type
        all_props_dict[LAST_UPDATED_KEY] =  unix_timestamp
        all_props_dict[UPDATED_BY_KEY] = client_name
        all_props_dict[JSON_ENCODED_KEY] = json_encoded
        # add the identity values and properties to the dictionary
        all_props_dict[ALL_IDS_KEY] = all_id_vals
        all_props_dict[ALL_IDS_PROPS_KEY] = all_id_props
        all_props_dict[PRIMARY_ID_KEY] = primary_key_val

        # Format all the properties for the write query
        for key, value in all_props_dict.items():
            if isinstance(value, (int, bool, float)):
                # These are basic types, so we can use them directly
                all_props_dict[key] = value
            elif isinstance(value, str):
                # Escape the string value for Cypher
                all_props_dict[key] = await self._escape_str_value(value)
            elif isinstance(value, (list, set)):
                # Convert list/set of everything to a list of strings
                all_props_dict[key] = [await self._escape_str_value(str(v)) for v in value]
            else:
                # Convert to string if not a basic type
                # logging.warning(f"Warning: Unsupported type for property {key} in entity {entity.entity_type}, converting to string")
                all_props_dict[key] = await self._escape_str_value(str(value))

        labels_str = ": ".join(labels).strip()

        query = f"""MERGE (e: {labels_str} {{`{PRIMARY_ID_KEY}`: '{primary_key_val}'}})
SET e = {{{', '.join([f"`{str(k)}`: '{v}'" if isinstance(v, str) else f"`{str(k)}`: {v}" for k, v in all_props_dict.items()])}}}
        """

        logging.info(query)
        async with self.driver.session() as session:
            _ = await session.run(query) # type: ignore
            # logging.debug(res)

    async def update_relationship(self, relation: Relation, fresh_until: int, ignore_direction=False, client_name=None):
        properties = {}
        if relation.relation_properties is not None:
            properties = relation.relation_properties

        relationship_ref = 'r'
        unix_timestamp = int(time.time())

        if client_name is not None:
            properties[f'{relationship_ref}.{UPDATED_BY_KEY}'] = client_name
            properties[f'{relationship_ref}.{FRESH_UNTIL_KEY}'] = fresh_until
            properties[f'{relationship_ref}.{LAST_UPDATED_KEY}'] = unix_timestamp

        if relation.from_entity is None or relation.to_entity is None:
            raise ValueError("from_entity and to_entity must be set")
        if relation.from_entity.entity_type is None or relation.to_entity.entity_type is None:
            raise ValueError("from_entity and to_entity must have entity_type set")

        if ignore_direction:
            builder = (
                QueryBuilder()
                .match()
                .node(labels=[relation.from_entity.entity_type], ref_name='f', properties={PRIMARY_ID_KEY: relation.from_entity.primary_key}) # type: ignore
                .match()
                .node(labels=[relation.to_entity.entity_type], ref_name='t', properties={PRIMARY_ID_KEY: relation.to_entity.primary_key}) # type: ignore
                .merge()
                .node(ref_name='f')
                .related(ref_name=relationship_ref, label=relation.relation_name)
                .node(ref_name='t')
                .set(properties)
            )
        else:
            builder = (
                QueryBuilder()
                .match()
                .node(labels=[relation.from_entity.entity_type], ref_name='f', properties={PRIMARY_ID_KEY: relation.from_entity.primary_key})  # type: ignore
                .match()
                .node(labels=[relation.to_entity.entity_type], ref_name='t', properties={PRIMARY_ID_KEY: relation.to_entity.primary_key}) # type: ignore
                .merge()
                .node(ref_name='f')
                .related_to(ref_name=relationship_ref, label=relation.relation_name)
                .node(ref_name='t')
                .set(properties)
            )

        query = str(builder)
        logging.info(query)
        async with self.driver.session() as session:
            _ = await session.run(query) # type: ignore
            # logging.debug(res)

    async def remove_relation(self, relation_name: str, properties: dict):
        """
        Removes a relation from the graph database
        :param relation_name: name of the relation to remove
        :param properties: dict of properties to match
        """
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

        logging.info(query)
        async with self.driver.session() as session:
            await session.run(query) # type: ignore

    async def remove_stale_entities(self):
        """
        Periodically clean up the database by removing entities that are older than the fresh_until timestamp
        """
        logging.info("Removing stale entities from the database")
        query = f"""
        MATCH (n:{DEFAULT_LABEL}) WHERE n.{FRESH_UNTIL_KEY}<{int(time.time())} DETACH DELETE n
        """
        async with self.driver.session() as session:
            await session.run(query) # type: ignore
            logging.info("Removed stale entities from the database")

    async def relate_entities_by_property(self, client_name: str, entity_a_type: str, entity_b_type: str, relation_type: str,
                                          matching_properties: dict, relation_properties: (dict | None) = None):

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
        logging.info(query)
        await self.raw_query(query)

    async def get_property_value_count(self, entity_type: str, property_name: str) -> int:
        query = f"""
        MATCH (n:{entity_type}) WHERE n.`{property_name}` IS NOT NULL
        RETURN COUNT(n) AS count
        """
        result = await self.raw_query(query)
        return result["results"][0].get("count", 0)

    async def get_values_of_matching_property(self, entity_type_a: str, entity_a_property: str,
                                              entity_type_b: str,  matching_properties: dict, max_results: int=10) -> List[str]:

        where_str = "WHERE "
        for matching_property_a, matching_property_b in matching_properties.items():
            if where_str != "WHERE ":
                where_str += " AND "
            where_str += f"(f.`{matching_property_a}`=t.`{matching_property_b}` OR f.`{matching_property_a}` IN t.`{matching_property_b}` OR t.`{matching_property_b}` IN f.`{matching_property_a}`)"


        query = f"MATCH (f:{entity_type_a}) " + \
                f"MATCH (t:{entity_type_b}) " + \
                f"{where_str} " + \
                f"RETURN distinct(f.`{entity_a_property}`) as values LIMIT {max_results}" # Using the to varialbe to return, as idkey property are not likely to be list (not supported)

        result = await self.raw_query(query)
        logging.info(f"Query result: {result}")
        results = result.get("results", [])
        if len(results) == 0:
            return []
        vals = []
        # Extract the values from the results
        for result in results:
            vals.append(result.get("values", ""))
        return vals

    async def raw_query(self, query: str, readonly=False, max_results=10000) -> dict:
        if readonly:
            session = self.driver.session(default_access_mode=neo4j.READ_ACCESS)
        else:
            session = self.driver.session()
        async with session:
            res = await session.run(query) # type: ignore
            # d = await res.data()
            rec = await res.fetch(max_results)
            print(rec)
            d = await res.consume()
            print(d)
            return {
                "results":rec
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
        logging.info(query)
        async with self.driver.session() as session:
            await session.run(query) # type: ignore

    async def _escape_str_value(self, v: Any) -> str:
        """
        Escape a value for use in a Cypher query.
        This is used to ensure that special characters do not break the query.
        """
        res = v.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'").replace('\r', '\\r').replace('\n', '\\n')
        return res

    async def _create_text_index(self, index_name: str, labels: list,  props: list):
        props = [f"n.{prop}" for prop in props]
        props_str = ",".join(props)
        query = f"""
        CREATE TEXT INDEX {index_name} IF NOT EXISTS FOR (n:{"|".join(labels)}) ON ({props_str})
        """
        logging.info(query)
        async with self.driver.session() as session:
            await session.run(query) # type: ignore

    async def _create_range_index(self, index_name: str, labels: list,  props: list):
        props = [f"n.{prop}" for prop in props]
        props_str = ",".join(props)
        query = f"""
        CREATE INDEX {index_name} IF NOT EXISTS FOR (n:{"|".join(labels)}) ON ({props_str})
        """
        logging.info(query)
        async with self.driver.session() as session:
            await session.run(query) # type: ignore

# if __name__ == "__main__":
#     db = Neo4jDB()
#     async def run():
#         props = await db.get_entity_type_properties("AwsAccount")
#         print(props)
#     import asyncio
#     asyncio.run(run())
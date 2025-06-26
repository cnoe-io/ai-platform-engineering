import logging

from core import utils
from core.constants import ALL_IDS_KEY, ALL_IDS_PROPS_KEY, JSON_ENCODED_KEY
from core.graph_db.neo4j.graph_db import Neo4jDB
from langchain_core.tools import tool
import dotenv
from langchain_core.messages.utils import count_tokens_approximately

# Load environment variables from .env file
dotenv.load_dotenv(verbose=True)
graphdb = Neo4jDB(readonly=True)

MAX_RESULTS=100

@tool
async def get_entity_types(thought: str) -> str:
    """
    Get all entity types in the graph database. Useful to understand what data is available to query.

    Args:
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: A list of all entity types in the graph database
    """
    logging.debug(thought)
    entity_types = await graphdb.get_all_entity_types()
    return utils.json_encode(entity_types)

@tool
async def fetch_entity(entity_type: str, primary_key_id: str, thought: str) -> str:
    """
    Fetches a single entity and returns all its properties.
    Args:
        entity_type (str): The type of entity
        primary_key_id (str):  The primary key id of the entity
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: The properties of the entity
    """
    logging.debug(thought)
    entity = await graphdb.get_entity(entity_type, primary_key_id)
    if entity is None:
        return f"no entity of type {entity_type} with primary_key_id {primary_key_id}"

    # Remove internal properties
    clean_properties = {}
    for key, value in entity.all_properties.items():
        if key[0] == "_":
            continue
        clean_properties[key] = value
    return utils.json_encode(clean_properties)

@tool
async def fetch_entity_details(entity_type: str, primary_key_id: str, thought: str) -> str:
    """
    Fetch details of a single entity and returns all its properties, as well as relations.
    You need the primary key id for the entity first (use fuzzy_search).

    Args:
        entity_type (str): The type of entity
        primary_key_id (str):  The primary key id of the entity
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: The properties of the entity, as well as its relations
    """
    logging.debug(thought)
    entity = await graphdb.get_entity(entity_type, primary_key_id)
    if entity is None:
        return f"no entity of type {entity_type} with primary_key_id {primary_key_id}"

    # Remove internal properties
    clean_properties = {}
    for key, value in entity.all_properties.items():
        if key[0] == "_":
            continue
        clean_properties[key] = value
    entity.all_properties = clean_properties

    # get the relations of the entity
    relations = await graphdb.get_entity_relations(entity_type, primary_key_id)
    return utils.json_encode({
        "entity_details": clean_properties,
        "relations": relations,
    })

@tool
async def get_relation_path_between_entity_types(entity_type_1: str, entity_type_2: str, thought: str) -> str:
    """
    Find relationship paths (indirect or direct) (if any) between any two entity types. 
    Args:
        entity_type_1 (str): The first entity type
        entity_type_2 (str): The second entity type
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: A cypher-like notation of entity and their relations, none if there is no relation
    """
    logging.debug(thought)
    relation_paths = await graphdb.get_relation_paths(entity_type_1, entity_type_2)
    relation_paths += await graphdb.get_relation_paths(entity_type_2, entity_type_1)

    if relation_paths is None:
        return f"no relation between {entity_type_1} and {entity_type_2}"
    relations_str = ""
    for i, relation_path in enumerate(relation_paths):
        relations_str += f"Path {i + 1}: "
        for relation in relation_path:
            logging.debug(relation)
            f = relation.from_entity_type
            t = relation.to_entity_type
            r = relation.relation_name
            relations_str += f"({f})-[{r}]-({t})\n"
    return relations_str

@tool
async def fuzzy_search(query: str, entity_type: str = "", all_props=False, thought: str = "") -> str:
    """
    Fuzzy search of any values in the graph database. Max results is 100.

    Args:
        query (str): The value to search
        entity_type (str): Entity type to filter by, empty for any
        all_props (bool): If True, will search all properties of the entity, use as last resort, may be slow and return many results
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: List of entities and their similarity score, higher the better (0 being lowest)
    """
    logging.debug(thought)
    if entity_type == "":
        entity_filter = []
        num_record_per_type = 10
    else:
        entity_filter = [entity_type]
        num_record_per_type = 0 # if we filter by entity type, we don't want to limit the number of results per type

    entities = await graphdb.fuzzy_search([[query]], type_filter=entity_filter, max_results=MAX_RESULTS, num_record_per_type=num_record_per_type, strict=False, all_props=all_props)
    entities_clean = []
    for entity, score in entities:
       entity_dict = {
           "score": score,
           "entity_summary": entity.summary(),
           "property_names_in_entity": entity.all_properties.keys(),
       }
       entities_clean.append(entity_dict)
    return utils.json_encode(entities_clean)

@tool
async def raw_query(query: str, thought: str) -> str:
    """
    Does a raw query on the database

    Args:
        query (str): The raw query
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: The result of the raw query
    """
    logging.debug(thought)
    res = await graphdb.raw_query(query)
    json_data = utils.json_encode(res)
    tokens = count_tokens_approximately(json_data)
    if tokens > 50000:
        logging.warning(f"Raw query result is too large ({tokens} tokens), returning error message instead.")
        return "Raw query result is too large, please refine your query to return less data. Try to search for specific entities or properties, or use filters to narrow down the results, or use other tools"

    return json_data
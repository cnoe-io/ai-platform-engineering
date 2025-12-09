import os
from typing import Optional

from common.utils import json_encode, get_logger
from common.graph_db.neo4j.graph_db import Neo4jDB
from langchain_core.tools import tool
import dotenv
from langchain_core.messages.utils import count_tokens_approximately
from redis.asyncio import Redis
from common.constants import KV_ONTOLOGY_VERSION_ID_KEY, PROP_DELIMITER, ONTOLOGY_VERSION_ID_KEY, DEFAULT_DATA_LABEL, DEFAULT_SCHEMA_LABEL
from common.models.graph import EntityIdentifier
import traceback
import httpx

# Load environment variables from .env file
dotenv.load_dotenv(verbose=True)

graph_rag_enabled = os.getenv("ENABLE_GRAPH_RAG", "true").lower() in ("true", "1", "yes")
server_url = os.getenv("RAG_SERVER_URL", "http://localhost:9446")

if graph_rag_enabled:
    data_graphdb = Neo4jDB(tenant_label=DEFAULT_DATA_LABEL, readonly=True)
    ontology_graphdb = Neo4jDB(tenant_label=DEFAULT_SCHEMA_LABEL, readonly=True)
    redis_client = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)

logger = get_logger(__name__)

MAX_RESULTS=100
MAX_QUERY_TOKENS=80000

@tool
async def search(query: str, graph_entity_type: Optional[str] = "", datasource_id: Optional[str] = "", limit: int = 5, similarity_threshold: float = 0.3, thought: str = "") -> str:
    """
    Search for relevant documents and graph entities using semantic search in the vector databases.
    The scores for graph entity and documents are separate

    Args:
        query (str): The search query
        graph_entity_type (str): (Optional) Filter for the type of graph entity to search, doesnt affect documents
        limit (int): Maximum number of results to return (default: 5)
        similarity_threshold (float): Minimum similarity score threshold (default: 0.3)
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: JSON encoded search results containing both documents and graph entities
    """
    logger.info(f"Search query: {query}, Limit: {limit}, Similarity Threshold: {similarity_threshold}, graph_entity_type: {graph_entity_type}, datasource_id: {datasource_id}, Thought: {thought}")

    try:
        # Prepare the request payload for the REST API
        api_payload = {
            "query": query,
            "limit": limit,
            "similarity_threshold": similarity_threshold,
            "graph_entity_type": graph_entity_type if graph_entity_type else None,
            "datasource_id": datasource_id if datasource_id else None,
        }

        # Call the query endpoint
        async with httpx.AsyncClient() as client:
            response = await client.post(server_url + "/v1/query",
                json=api_payload,
                timeout=30.0
            )
            response.raise_for_status()
            api_results = response.json()

        doc_results = []
        for result in api_results.get("results", []):  # Fixed: was "results_docs"
            doc_results.append({
                "type": "document",
                "content": result["document"]["page_content"],
                "metadata": result["document"]["metadata"],
                "score": result["score"]
            })

        graph_results = []
        for result in api_results.get("results_graph", []):
            graph_results.append({
                "type": "graph_entity",
                "content": result["document"]["page_content"],
                "metadata": result["document"]["metadata"],
                "score": result["score"]
            })

        if graph_rag_enabled:
            results = {
                "query": query,
                "documents": doc_results,
                "graph_entities": graph_results,
                "total_documents": len(doc_results),
                "total_graph_entities": len(graph_results)
            }
        else:
            results = {
                "query": query,
                "documents": doc_results,
                "total_documents": len(doc_results)
            }
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error during search: {e}")
        return f"Error during search: {e}"

    logger.info(f"search results: total_documents {len(results.get('documents', []))}, total_graph_entities {len(results.get('graph_entities', []))}")
    return json_encode(results)

#####################
# Graph query tools #
#####################

@tool
async def graph_get_entity_types(thought: str) -> str:
    """
    Get all entity types in the graph database. Useful to understand what data is available to query.

    Args:
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: A list of all entity types in the graph database
    """
    logger.info(f"Getting entity types, Thought: {thought}")
    try:
        entity_types = await data_graphdb.get_all_entity_types()
        return json_encode(entity_types)
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error getting entity types: {e}")
        return f"Error getting entity types: {e}"

@tool
async def graph_get_entity_properties(entity_type: str, thought: str) -> str:
    """
    Get all properties for a given entity type in the graph database.

    Args:
        entity_type (str): The type of entity to get properties for
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: A list of all properties for the specified entity type
    """
    logger.info(f"Getting entity properties for {entity_type}, Thought: {thought}")
    try:
        properties = await data_graphdb.get_entity_type_properties(entity_type)
        return json_encode({"entity_type": entity_type, "properties": properties})
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error getting entity properties for {entity_type}: {e}")
        return f"Error getting entity properties for {entity_type}: {e}"

@tool
async def graph_fetch_entity(entity_type: str, primary_key_id: str, thought: str) -> str:
    """
    Fetches a single entity and returns all its properties from the graph database.
    Args:
        entity_type (str): The type of entity
        primary_key_id (str):  The primary key id of the entity
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: The properties of the entity
    """
    logger.info(f"Fetching entity of type {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
    try:
        entity = await data_graphdb.fetch_entity(entity_type, primary_key_id)
        if entity is None:
            return f"no entity of type {entity_type} with primary_key_id {primary_key_id}"
        return json_encode(entity.get_external_properties())
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}")
        return f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}"

@tool
async def graph_fetch_entity_details(entity_type: str, primary_key_id: str, thought: str) -> str:
    """
    Fetch details of a single entity and returns all its properties, as well as relations from the graph database.
    You need the primary key id for the entity first (use fuzzy_search).

    Args:
        entity_type (str): The type of entity
        primary_key_id (str):  The primary key id of the entity
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: The properties of the entity, as well as its relations
    """
    logger.info(f"Fetching entity details of type {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
    try:
        entity = await data_graphdb.fetch_entity(entity_type, primary_key_id)
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
        relations = await data_graphdb.fetch_entity_relations(entity_type, primary_key_id)
        return json_encode({
            "entity_details": clean_properties,
            "relations": relations,
        })
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error fetching entity details {entity_type} with primary_key_id {primary_key_id}: {e}")
        return f"Error fetching entity details {entity_type} with primary_key_id {primary_key_id}: {e}"


@tool
async def graph_check_if_ontology_generated(thought: str) -> str:
    """
    Check if the ontology is generated and available for querying

    Args:
        thought (str): Your thoughts for choosing this tool
    Returns:
        str: "true" if the ontology is generated, "false" otherwise
    """
    logger.info(f"Checking if ontology is generated, Thought: {thought}")
    try:
        ontology_version_id = await redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
        if ontology_version_id is None:
            return "false"
        ontology_version_id = ontology_version_id
        logger.info(f"Found ontology version id: {ontology_version_id}")

        # Check if the ontology is generated - there should be at least one relation with the ontology version id
        relation = await ontology_graphdb.find_relations(None, None, None, {
            ONTOLOGY_VERSION_ID_KEY: ontology_version_id
        }, 1)

        if len(relation) > 0:
            return "true"

        logger.warning(f"No relations found in ontology with the current ontology version id: {ontology_version_id}")
        return "false"
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error checking if ontology is generated: {e}")
        return f"Error checking if ontology is generated: {e}"

@tool
async def graph_get_relation_path_between_entity_types(entity_type_1: str, entity_type_2: str, thought: str) -> str:
    """
    Find relationship paths (indirect or direct) (if any) between any two entity types in the graph database.
    Args:
        entity_type_1 (str): The first entity type
        entity_type_2 (str): The second entity type
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: A cypher-like notation of entity and their relations, none if there is no relation
    """
    logger.info(f"Getting relation path between {entity_type_1} and {entity_type_2}, Thought: {thought}")

    try:
        # Fetch the latest ontology id
        ontology_version_id = await redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
        if ontology_version_id is None:
            return "Error: the ontology is not generated yet, this tool is unavailable"
        ontology_version_id = ontology_version_id
        entity_a_id = EntityIdentifier(entity_type=entity_type_1, primary_key=PROP_DELIMITER.join([entity_type_1, ontology_version_id]))
        entity_b_id = EntityIdentifier(entity_type=entity_type_2, primary_key=PROP_DELIMITER.join([entity_type_2, ontology_version_id]))

        paths = await ontology_graphdb.shortest_path(
            entity_a=entity_a_id,
            entity_b=entity_b_id,
            ignore_direction=True,
        )
        if not paths:
            return "none"

        # Convert paths to cypher notation
        relation_paths = []
        for entities, relations in paths:
            cypher_path_parts = []

            # Iterate through entities and relations to build the path
            for i, entity in enumerate(entities):
                # Add entity type in parentheses
                cypher_path_parts.append(f"({entity.entity_type})")

                # Add relation in brackets (except for the last entity)
                if i < len(relations):
                    relation = relations[i]

                    # check if relation is applied
                    if not (relation.relation_properties and relation.relation_properties.get("is_applied", True)):
                        # discard the path if any relation is not applied
                        cypher_path_parts = []
                        break

                    # check the direction of the relation
                    if relation.from_entity.entity_type == entity.entity_type:
                        cypher_path_parts.append(f"-[{relation.relation_name}]->")
                    else:
                        cypher_path_parts.append(f"<-[{relation.relation_name}]-")

            # Join all parts to create the cypher notation for this path
            cypher_path = "".join(cypher_path_parts)
            relation_paths.append(cypher_path)

        output = "Paths:\n"
        for i, path in enumerate(relation_paths):
            output += f"{i+1}. {path}\n\n"
        logger.debug(f"Relation paths: {output}")
        return output
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error getting relation path between {entity_type_1} and {entity_type_2}: {e}")
        return f"Error getting relation path between {entity_type_1} and {entity_type_2}: {e}"

@tool
async def graph_raw_query(query: str, thought: str) -> str:
    """
    Does a raw query on the graph database

    Args:
        query (str): The raw query
        thought (str): Your thoughts for choosing this tool

    Returns:
        str: The result of the raw query
    """
    logger.info(f"Raw graph query: {query}, Thought: {thought}")
    try:
        res = await data_graphdb.raw_query(query, readonly=True, max_results=MAX_RESULTS)
        notifications = json_encode(res.get("notifications", []))
        results = json_encode(res.get("results", []))

        # Check for warnings/errors in notifications first
        if "warning" in notifications.lower() or "error" in notifications.lower():
            logger.warning(f"Query returned warnings/errors: {notifications}")
            return f"Query has warnings/errors, PLEASE FIX your query: {notifications}"

        # Check the size of the results, if too large return an error message instead
        tokens = count_tokens_approximately(results)
        if tokens > MAX_QUERY_TOKENS:
            logger.warning(f"Raw query result is too large ({tokens} tokens), returning error message instead.")
            return "Raw query result is too large, please refine your query to return less data. Try to search for specific entities or properties, or use filters to narrow down the results, or use other tools"

        output = {
            "results" : results,
            "notifications": notifications
        }
        logger.debug(f"Raw query output: {output}")
        return output
    except Exception as e:
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error(f"Error executing raw graph query: {e}")
        return f"Error executing raw graph query, PLEASE FIX your query: {e}"
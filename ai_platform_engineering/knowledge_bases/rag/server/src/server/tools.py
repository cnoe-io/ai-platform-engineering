import os
from typing import Optional

from common.utils import json_encode, get_logger
from common.graph_db.base import GraphDB
import dotenv
from langchain_core.messages.utils import count_tokens_approximately
from redis.asyncio import Redis
from common.constants import KV_ONTOLOGY_VERSION_ID_KEY, PROP_DELIMITER, ONTOLOGY_VERSION_ID_KEY
from common.models.graph import EntityIdentifier
import traceback
from server.query_service import VectorDBQueryService
from common.models.rag import valid_metadata_keys
from fastmcp import FastMCP

# Load environment variables from .env file
dotenv.load_dotenv(verbose=True)
logger = get_logger(__name__)

max_graph_raw_query_results=int(os.getenv("MAX_GRAPH_RAW_QUERY_RESULTS", 100))
max_graph_raw_query_tokens=int(os.getenv("MAX_GRAPH_RAW_QUERY_TOKENS", 80000))
search_tool_keyword_bias = float(os.getenv("SEARCH_TOOL_KEYWORD_BIAS", 0.3))

if search_tool_keyword_bias < 0.0 or search_tool_keyword_bias > 1.0:
    logger.warning(f"Invalid SEARCH_TOOL_KEYWORD_BIAS value: {search_tool_keyword_bias}, must be between 0.0 and 1.0. Using default value 0.3")
    search_tool_keyword_bias = 0.3

class AgentTools:
    def __init__(self, redis_client: Redis, vector_db_query_service: VectorDBQueryService, data_graph_db: Optional[GraphDB] = None, ontology_graph_db: Optional[GraphDB] = None):
        self.redis_client = redis_client
        self.vector_db_query_service: VectorDBQueryService = vector_db_query_service
        self.data_graphdb: Optional[GraphDB] = data_graph_db
        self.ontology_graphdb: Optional[GraphDB] = ontology_graph_db

    async def register_tools(self, mcp: FastMCP, graph_rag_enabled: bool):

        # Modify search description based on graph_rag_enabled and valid_filter_keys 
        if graph_rag_enabled:
            valid_filter_keys = valid_metadata_keys()
            logger.info(f"Valid filter keys for search tool: {valid_filter_keys}")
            search_description = f"""
        Search for relevant documents and graph entities using semantic search in the vector databases.
        Args:
            query (str): The search query (Use full sentences for better results)
            filters (dict): Optional filters to apply. Valid filter keys are: {valid_filter_keys}.
            limit (int): Maximum number of results to return (default: 5)
            similarity_threshold (float): Minimum similarity score threshold (default: 0.3)
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: JSON encoded search results containing documents, graph entities, and their scores
        """
        else:
            valid_filter_keys = valid_metadata_keys() # exclude graph metadata keys
            # remove any graph-related keys
            valid_filter_keys = [key for key in valid_filter_keys if "graph_entity" not in key]

            logger.info(f"Valid filter keys for search tool: {valid_filter_keys}")
            search_description =f"""
        Search for relevant documents using semantic search in the vector databases.
        Args:
            query (str): The search query (Use full sentences for better results)
            filters (dict): Optional filters to apply. Valid filter keys are: {valid_filter_keys}.
            limit (int): Maximum number of results to return (default: 5)
            similarity_threshold (float): Minimum similarity score threshold (default: 0.3)
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: JSON encoded search results containing both documents, and their scores
        """
        mcp.tool(
            name_or_fn=self.search,
            description=search_description,
        )
            
        if graph_rag_enabled:
            graph_tools = [
                self.graph_get_entity_types,
                self.graph_get_entity_properties,
                self.graph_fetch_entity,
                self.graph_fetch_entity_details,
                self.graph_get_relation_path_between_entity_types,
                self.graph_raw_query,
            ]
            for tool in graph_tools:
                mcp.tool(tool)
        
        logger.info(f"Registered MCP tools: {await mcp.get_tools()}")
       
    ####################
    # Search tool     #
    ####################

    async def search(self, query: str, filters: Optional[dict]=None, limit: int = 5, similarity_threshold: float = 0.3, thought: str = "") -> str:
        """
        Search for relevant documents (and graph entities) using semantic search in the vector databases.
        """
        logger.info(f"Search query: {query}, Limit: {limit}, Similarity Threshold: {similarity_threshold}, filters: {filters}, Thought: {thought}")

        weights = [1-search_tool_keyword_bias, search_tool_keyword_bias]  # Default weights: more weight to dense (semantic) score

        # validate filters
        try:
            results = await self.vector_db_query_service.query(
                query=query,
                filters=filters,
                limit=limit,
                similarity_threshold=similarity_threshold,
                ranker="weighted",
                ranker_params={"weights": weights} # More weight to dense (semantic) score
            )
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error during search: {e}")
            return f"Error during search: {e}"

        logger.info(f"search results: total_documents {len(results)}")
        return json_encode(results)

    #####################
    # Graph query tools #
    #####################

    async def graph_get_entity_types(self, thought: str) -> str:
        """
        Gets all entity types in the graph database. Useful to understand what data is available to query.

        Args:
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: A list of all entity types in the graph database
        """
        logger.info(f"Getting entity types, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            entity_types = await self.data_graphdb.get_all_entity_types()
            return json_encode(entity_types)
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error getting entity types: {e}")
            return f"Error getting entity types: {e}"

    async def graph_get_entity_properties(self, entity_type: str, thought: str) -> str:
        """
        Gets all properties for a given entity type in the graph database.

        Args:
            entity_type (str): The type of entity to get properties for
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: A list of all properties for the specified entity type
        """
        logger.info(f"Getting entity properties for {entity_type}, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            properties = await self.data_graphdb.get_entity_type_properties(entity_type)
            return json_encode({"entity_type": entity_type, "properties": properties})
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error getting entity properties for {entity_type}: {e}")
            return f"Error getting entity properties for {entity_type}: {e}"

    async def graph_fetch_entity(self, entity_type: str, primary_key_id: str, thought: str) -> str:
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
        if self.data_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            entity = await self.data_graphdb.fetch_entity(entity_type, primary_key_id)
            if entity is None:
                return f"no entity of type {entity_type} with primary_key_id {primary_key_id}"
            return json_encode(entity.get_external_properties())
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error fetching entity {entity_type} with primary_key_id {primary_key_id}: {e}"

    async def graph_fetch_entity_details(self, entity_type: str, primary_key_id: str, thought: str) -> str:
        """
        Fetches details of a single entity and returns all its properties, as well as relations from the graph database.
        You need the primary key id for the entity first (use `search` tool).

        Args:
            entity_type (str): The type of entity
            primary_key_id (str):  The primary key id of the entity
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The properties of the entity, as well as its relations
        """
        logger.info(f"Fetching entity details of type {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            entity = await self.data_graphdb.fetch_entity(entity_type, primary_key_id)
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
            relations = await self.data_graphdb.fetch_entity_relations(entity_type, primary_key_id)
            return json_encode({
                "entity_details": clean_properties,
                "relations": relations,
            })
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error fetching entity details {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error fetching entity details {entity_type} with primary_key_id {primary_key_id}: {e}"


    async def graph_get_relation_path_between_entity_types(self, entity_type_1: str, entity_type_2: str, thought: str) -> str:
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
        if self.ontology_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            # Check if ontology is generated
            is_ontology_generated = await self._graph_check_if_ontology_generated()
            if not is_ontology_generated:
                return "Error: the ontology is not generated yet, this tool is unavailable."

            # Fetch the latest ontology id
            ontology_version_id = await self.redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
            if ontology_version_id is None:
                return "Error: the ontology is not generated yet, this tool is unavailable."

            entity_a_id = EntityIdentifier(entity_type=entity_type_1, primary_key=PROP_DELIMITER.join([entity_type_1, ontology_version_id]))
            entity_b_id = EntityIdentifier(entity_type=entity_type_2, primary_key=PROP_DELIMITER.join([entity_type_2, ontology_version_id]))

            paths = await self.ontology_graphdb.shortest_path(
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


    # Not a tool, but used internally
    async def _graph_check_if_ontology_generated(self) -> bool:
        """
        Checks if the ontology is generated for the graph database.
        Returns:
            str: true if the ontology is generated, false otherwise
        """
        if self.ontology_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return False
        ontology_version_id = await self.redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
        if ontology_version_id is None:
            return False
        logger.info(f"Found ontology version id: {ontology_version_id}")

        # Check if the ontology is generated - there should be at least one relation with the ontology version id
        relation = await self.ontology_graphdb.find_relations(None, None, None, {
            ONTOLOGY_VERSION_ID_KEY: ontology_version_id
        }, 1)
        
        if len(relation) > 0:
            return True

        logger.warning(f"No relations found in ontology with the current heuristics version id: {ontology_version_id}")
        return False

    async def graph_raw_query(self, query: str, thought: str) -> str:
        """
        Does a raw query on the graph database

        Args:
            query (str): The raw query
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The result of the raw query
        """
        logger.info(f"Raw graph query: {query}, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: graph database is not available."
        try:
            res = await self.data_graphdb.raw_query(query, readonly=True, max_results=max_graph_raw_query_results)
            notifications = json_encode(res.get("notifications", []))
            results = json_encode(res.get("results", []))

            # Check for warnings/errors in notifications first
            if "warning" in notifications.lower() or "error" in notifications.lower():
                logger.warning(f"Query returned warnings/errors: {notifications}")
                return f"Query has warnings/errors, PLEASE FIX your query: {notifications}"
            
            # Check the size of the results, if too large return an error message instead
            tokens = count_tokens_approximately(results)
            if tokens > max_graph_raw_query_tokens:
                logger.warning(f"Raw query result is too large ({tokens} tokens), returning error message instead.")
                return "Raw query result is too large, please refine your query to return less data. Try to search for specific entities or properties, or use filters to narrow down the results, or use other tools"
            
            output = {
                "results" : results,
                "notifications": notifications
            }
            logger.debug(f"Raw query output: {output}")
            return json_encode(output)
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error executing raw graph query: {e}")
            return f"Error executing raw graph query, PLEASE FIX your query: {e}"
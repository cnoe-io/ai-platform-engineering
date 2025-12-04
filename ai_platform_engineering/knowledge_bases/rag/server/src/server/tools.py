import os
from typing import Optional, List, Tuple, Set

from common.utils import json_encode, get_logger
from common.graph_db.base import GraphDB
import dotenv
from langchain_core.messages.utils import count_tokens_approximately
from redis.asyncio import Redis
from common.constants import (
    KV_ONTOLOGY_VERSION_ID_KEY, 
    PROP_DELIMITER, 
    ONTOLOGY_VERSION_ID_KEY,
    SUB_ENTITY_LABEL,
    PRIMARY_ID_KEY,
    ENTITY_TYPE_KEY,
    ALL_IDS_PROPS_KEY
)
from common.models.graph import EntityIdentifier, Entity, Relation
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
                self.graph_explore_ontology_entity,
                self.graph_explore_data_entity,
                self.graph_fetch_data_entity_details,
                self.graph_shortest_path_between_entity_types,
                self.graph_raw_query_data,
                self.graph_raw_query_ontology,
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
            return "Error: Data graph database is not available. Please ensure graph RAG is enabled."
        try:
            entity_types = await self.data_graphdb.get_all_entity_types()
            if not entity_types:
                return "No entity types found in the data graph database. The database may be empty."
            return json_encode(entity_types)
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error getting entity types: {e}")
            return f"Error getting entity types from data graph database: {str(e)}\nTraceback: {traceback.format_exc()}"

    async def graph_explore_ontology_entity(self, entity_type: str, thought: str) -> str:
        """
        Explores an ontology entity and recursively fetches all its sub-entities.
        Returns the root entity and all nested sub-entities with their properties and relations.

        Args:
            entity_type (str): The type of entity to explore
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: JSON containing the root entity, sub-entities, and their relations
        """
        logger.info(f"Exploring ontology entity {entity_type}, Thought: {thought}")
        if self.ontology_graphdb is None:
            logger.error("Ontology graph database is not available, Is graph RAG enabled?")
            return "Error: Ontology graph database is not available. Please ensure graph RAG is enabled."
        
        try:
            # Check if ontology is generated
            is_ontology_generated = await self._graph_check_if_ontology_generated()
            if not is_ontology_generated:
                return "Error: The ontology has not been generated yet. Please generate the ontology first before exploring ontology entities."

            # Fetch the latest ontology id
            ontology_version_id = await self.redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
            if ontology_version_id is None:
                return "Error: Ontology version ID not found in Redis. The ontology may not be generated yet."

            # Build primary key for ontology entity
            primary_key_id = PROP_DELIMITER.join([entity_type, ontology_version_id])
            
            # First check if the entity type exists in ontology
            all_entity_types = await self.ontology_graphdb.get_all_entity_types()
            if entity_type not in all_entity_types:
                return f"Error: Entity type '{entity_type}' does not exist in the ontology graph database.\nAvailable entity types: {', '.join(sorted(all_entity_types))}"
            
            # Explore the entity neighborhood recursively
            result = await self._explore_entity_recursive(
                graphdb=self.ontology_graphdb,
                entity_type=entity_type,
                entity_pk=primary_key_id,
                max_depth=100
            )
            
            if result["root_entity"] is None:
                return f"Error: Entity of type '{entity_type}' with primary key '{primary_key_id}' was not found in the ontology graph database. The entity may not exist or may have been deleted."
            
            return json_encode(result)
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error exploring ontology entity {entity_type}: {e}")
            return f"Error exploring ontology entity '{entity_type}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def graph_explore_data_entity(self, entity_type: str, primary_key_id: str, thought: str) -> str:
        """
        Explores a data entity and recursively fetches all its sub-entities.
        Returns the root entity and all nested sub-entities with their properties and relations.

        Args:
            entity_type (str): The type of entity to explore
            primary_key_id (str): The primary key id of the entity
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: JSON containing the root entity, sub-entities, and their relations
        """
        logger.info(f"Exploring data entity {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Data graph database is not available, Is graph RAG enabled?")
            return "Error: Data graph database is not available. Please ensure graph RAG is enabled."
        
        try:
            # First check if the entity type exists
            all_entity_types = await self.data_graphdb.get_all_entity_types()
            if entity_type not in all_entity_types:
                return f"Error: Entity type '{entity_type}' does not exist in the data graph database.\nAvailable entity types: {', '.join(sorted(all_entity_types))}"
            
            # Explore the entity neighborhood recursively
            result = await self._explore_entity_recursive(
                graphdb=self.data_graphdb,
                entity_type=entity_type,
                entity_pk=primary_key_id,
                max_depth=100
            )
            
            if result["root_entity"] is None:
                return f"Error: Entity of type '{entity_type}' with primary key '{primary_key_id}' was not found in the data graph database. Please verify the entity type and primary key are correct."
            
            return json_encode(result)
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error exploring data entity {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error exploring data entity '{entity_type}' with primary_key_id '{primary_key_id}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def _explore_entity_recursive(
        self, 
        graphdb: GraphDB, 
        entity_type: str, 
        entity_pk: str, 
        max_depth: int,
        visited: Optional[Set[str]] = None,
        current_depth: int = 0
    ) -> dict:
        """
        Recursively explores an entity and its sub-entities.
        
        Returns:
            dict with keys:
                - root_entity: dict with entity details
                - sub_entities: list of sub-entity dicts
                - relations: list of relation tuples (from_pk, relation_name, to_pk)
        """
        if visited is None:
            visited = set()
        
        # Prevent infinite recursion
        if current_depth > max_depth:
            logger.warning(f"Max recursion depth {max_depth} reached for entity {entity_type}:{entity_pk}")
            return {"root_entity": None, "sub_entities": [], "relations": []}
        
        # Check if already visited
        entity_key = f"{entity_type}:{entity_pk}"
        if entity_key in visited:
            return {"root_entity": None, "sub_entities": [], "relations": []}
        
        visited.add(entity_key)
        
        # Fetch the entity with depth 1 to get immediate neighbors
        neighborhood = await graphdb.explore_neighborhood(
            entity_type=entity_type,
            entity_pk=entity_pk,
            depth=1,
            max_results=1000
        )
        
        if neighborhood["entity"] is None:
            return {"root_entity": None, "sub_entities": [], "relations": []}
        
        root_entity = neighborhood["entity"]
        
        # Extract clean entity data (only essential fields)
        def extract_entity_data(entity: Entity) -> dict:
            # Get primary key values
            primary_key_values = {}
            for prop in entity.primary_key_properties:
                if prop in entity.all_properties:
                    primary_key_values[prop] = entity.all_properties[prop]
            
            # Get additional key values
            additional_key_values = []
            if entity.additional_key_properties:
                for key_props in entity.additional_key_properties:
                    key_dict = {}
                    for prop in key_props:
                        if prop in entity.all_properties:
                            key_dict[prop] = entity.all_properties[prop]
                    if key_dict:
                        additional_key_values.append(key_dict)
            
            # Get all properties except internal ones (those starting with _), but keep _entity_pk
            properties = {}
            for key, value in entity.all_properties.items():
                if key == PRIMARY_ID_KEY:  # Keep _entity_pk
                    properties[key] = value
                elif not key.startswith("_"):  # Exclude other internal properties
                    properties[key] = value
            
            return {
                "entity_type": entity.entity_type,
                "primary_key_values": primary_key_values,
                "additional_key_values": additional_key_values,
                "properties": properties
            }
        
        root_entity_data = extract_entity_data(root_entity)
        sub_entities = []
        all_relations = []
        
        # Process relations and find sub-entities
        for relation in neighborhood["relations"]:
            # Add relation tuple (from_pk, relation_name, to_pk)
            relation_tuple = (
                relation.from_entity.primary_key,
                relation.relation_name,
                relation.to_entity.primary_key
            )
            all_relations.append(relation_tuple)
            
            # Check if the related entity is a sub-entity
            # Look for entities in the neighborhood that are sub-entities
            for entity in neighborhood["entities"]:
                if entity.all_properties.get(PRIMARY_ID_KEY) == relation.to_entity.primary_key:
                    # Check if this entity has the SUB_ENTITY_LABEL
                    if SUB_ENTITY_LABEL in entity.additional_labels:
                        # Recursively explore this sub-entity
                        sub_result = await self._explore_entity_recursive(
                            graphdb=graphdb,
                            entity_type=entity.entity_type,
                            entity_pk=entity.all_properties.get(PRIMARY_ID_KEY, ""),
                            max_depth=max_depth,
                            visited=visited,
                            current_depth=current_depth + 1
                        )
                        
                        # Add the sub-entity
                        if sub_result["root_entity"]:
                            sub_entities.append(sub_result["root_entity"])
                        
                        # Add nested sub-entities
                        sub_entities.extend(sub_result["sub_entities"])
                        
                        # Add relations from nested exploration
                        all_relations.extend(sub_result["relations"])
        
        return {
            "root_entity": root_entity_data,
            "sub_entities": sub_entities,
            "relations": all_relations
        }

    async def graph_fetch_data_entity_details(self, entity_type: str, primary_key_id: str, thought: str) -> str:
        """
        Fetches details of a single data entity and returns all its properties (excluding internal properties),
        as well as relations from the graph database.

        Args:
            entity_type (str): The type of entity
            primary_key_id (str): The primary key id of the entity
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The properties of the entity (with key:value pairs), as well as its relations
        """
        logger.info(f"Fetching data entity details of type {entity_type} with primary_key_id {primary_key_id}, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Graph database is not available, Is graph RAG enabled?")
            return "Error: Data graph database is not available. Please ensure graph RAG is enabled."
        try:
            # First check if the entity type exists
            all_entity_types = await self.data_graphdb.get_all_entity_types()
            if entity_type not in all_entity_types:
                return f"Error: Entity type '{entity_type}' does not exist in the data graph database.\nAvailable entity types: {', '.join(sorted(all_entity_types))}"
            
            entity = await self.data_graphdb.fetch_entity(entity_type, primary_key_id)
            if entity is None:
                return f"Error: Entity of type '{entity_type}' with primary key '{primary_key_id}' was not found in the data graph database. Please verify the entity type and primary key are correct."

            # Remove internal properties (those starting with _)
            clean_properties = {}
            for key, value in entity.all_properties.items():
                if not key.startswith("_"):
                    clean_properties[key] = value
            
            # Get primary key values
            primary_key_values = {}
            for prop in entity.primary_key_properties:
                if prop in entity.all_properties:
                    primary_key_values[prop] = entity.all_properties[prop]
            
            # Get additional key values
            additional_key_values = []
            if entity.additional_key_properties:
                for key_props in entity.additional_key_properties:
                    key_dict = {}
                    for prop in key_props:
                        if prop in entity.all_properties:
                            key_dict[prop] = entity.all_properties[prop]
                    if key_dict:
                        additional_key_values.append(key_dict)

            # Get the relations of the entity
            relations = await self.data_graphdb.fetch_entity_relations(entity_type, primary_key_id)
            
            # Format relations as simple dicts
            relations_data = []
            for rel in relations:
                relations_data.append({
                    "from_entity_type": rel.from_entity.entity_type,
                    "from_entity_pk": rel.from_entity.primary_key,
                    "relation_name": rel.relation_name,
                    "to_entity_type": rel.to_entity.entity_type,
                    "to_entity_pk": rel.to_entity.primary_key,
                    "relation_properties": rel.relation_properties
                })
            
            return json_encode({
                "entity_type": entity.entity_type,
                "_entity_pk": entity.all_properties.get(PRIMARY_ID_KEY, ""),
                "primary_key_values": primary_key_values,
                "additional_key_values": additional_key_values,
                "properties": clean_properties,
                "relations": relations_data,
            })
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error fetching entity details {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error fetching data entity details for '{entity_type}' with primary_key_id '{primary_key_id}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def graph_shortest_path_between_entity_types(self, entity_type_1: str, entity_type_2: str, thought: str) -> str:
        """
        Find the shortest relationship paths between two entity types in the ontology graph.
        
        Args:
            entity_type_1 (str): The first entity type
            entity_type_2 (str): The second entity type
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: A cypher-like notation of entities and their relations, "none" if there is no path
        """
        logger.info(f"Getting shortest path between {entity_type_1} and {entity_type_2}, Thought: {thought}")
        if self.ontology_graphdb is None:
            logger.error("Ontology graph database is not available, Is graph RAG enabled?")
            return "Error: Ontology graph database is not available. Please ensure graph RAG is enabled."
        try:
            # Check if ontology is generated
            is_ontology_generated = await self._graph_check_if_ontology_generated()
            if not is_ontology_generated:
                return "Error: The ontology has not been generated yet. Please generate the ontology first before finding paths between entity types."

            # Fetch the latest ontology id
            ontology_version_id = await self.redis_client.get(KV_ONTOLOGY_VERSION_ID_KEY)
            if ontology_version_id is None:
                return "Error: Ontology version ID not found in Redis. The ontology may not be generated yet."

            # Check if both entity types exist in ontology
            all_entity_types = await self.ontology_graphdb.get_all_entity_types()
            if entity_type_1 not in all_entity_types:
                return f"Error: Entity type '{entity_type_1}' does not exist in the ontology graph database.\nAvailable entity types: {', '.join(sorted(all_entity_types))}"
            if entity_type_2 not in all_entity_types:
                return f"Error: Entity type '{entity_type_2}' does not exist in the ontology graph database.\nAvailable entity types: {', '.join(sorted(all_entity_types))}"

            entity_a_id = EntityIdentifier(entity_type=entity_type_1, primary_key=PROP_DELIMITER.join([entity_type_1, ontology_version_id]))
            entity_b_id = EntityIdentifier(entity_type=entity_type_2, primary_key=PROP_DELIMITER.join([entity_type_2, ontology_version_id]))

            paths = await self.ontology_graphdb.shortest_path(
                entity_a=entity_a_id,
                entity_b=entity_b_id,
                ignore_direction=True,
            )
            if not paths:
                return f"No path found between entity types '{entity_type_1}' and '{entity_type_2}' in the ontology graph. These entity types may not be connected."
            
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
                if cypher_path_parts:
                    cypher_path = "".join(cypher_path_parts)
                    relation_paths.append(cypher_path)

            if not relation_paths:
                return f"No applied relationships found between entity types '{entity_type_1}' and '{entity_type_2}'. Paths exist but no relations are marked as applied."
            
            output = "Paths:\n"
            for i, path in enumerate(relation_paths):
                output += f"{i+1}. {path}\n"
            logger.debug(f"Shortest paths: {output}")
            return output
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error getting shortest path between {entity_type_1} and {entity_type_2}: {e}")
            return f"Error finding shortest path between entity types '{entity_type_1}' and '{entity_type_2}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def graph_raw_query_data(self, query: str, thought: str) -> str:
        """
        Executes a raw read-only query on the data graph database.

        Args:
            query (str): The raw Cypher query
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The result of the raw query
        """
        logger.info(f"Raw data graph query, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Data graph database is not available, Is graph RAG enabled?")
            return "Error: Data graph database is not available. Please ensure graph RAG is enabled."
        
        if not query or not query.strip():
            return "Error: Query cannot be empty. Please provide a valid Cypher query."
        
        try:
            res = await self.data_graphdb.raw_query(query, readonly=True, max_results=max_graph_raw_query_results)
            notifications = json_encode(res.get("notifications", []))
            results = json_encode(res.get("results", []))

            # Check for warnings/errors in notifications first
            if "warning" in notifications.lower() or "error" in notifications.lower():
                logger.warning(f"Query returned warnings/errors: {notifications}")
                return f"Query has warnings/errors. PLEASE FIX your query:\nNotifications: {notifications}\n\nQuery executed: {query}"
            
            # Check the size of the results, if too large return an error message instead
            tokens = count_tokens_approximately(results)
            if tokens > max_graph_raw_query_tokens:
                logger.warning(f"Raw query result is too large ({tokens} tokens), returning error message instead.")
                return f"Raw query result is too large ({tokens} tokens, max: {max_graph_raw_query_tokens}). Please refine your query to return less data:\n- Add LIMIT clause to restrict number of results\n- Select specific properties instead of returning entire nodes\n- Use filters (WHERE clause) to narrow down results\n- Consider using other specialized tools instead\n\nQuery executed: {query}"
            
            output = {
                "results": results,
                "notifications": notifications
            }
            logger.debug(f"Raw query output: {output}")
            return json_encode(output)
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error executing raw data graph query: {e}")
            return f"Error executing raw data graph query. PLEASE FIX your query:\n\nError: {error_msg}\n\nQuery executed: {query}\n\nTraceback: {traceback.format_exc()}"

    async def graph_raw_query_ontology(self, query: str, thought: str) -> str:
        """
        Executes a raw read-only query on the ontology graph database.

        Args:
            query (str): The raw Cypher query
            thought (str): Your thoughts for choosing this tool

        Returns:
            str: The result of the raw query
        """
        logger.info(f"Raw ontology graph query, Thought: {thought}")
        if self.ontology_graphdb is None:
            logger.error("Ontology graph database is not available, Is graph RAG enabled?")
            return "Error: Ontology graph database is not available. Please ensure graph RAG is enabled."
        
        if not query or not query.strip():
            return "Error: Query cannot be empty. Please provide a valid Cypher query."
        
        try:
            res = await self.ontology_graphdb.raw_query(query, readonly=True, max_results=max_graph_raw_query_results)
            notifications = json_encode(res.get("notifications", []))
            results = json_encode(res.get("results", []))

            # Check for warnings/errors in notifications first
            if "warning" in notifications.lower() or "error" in notifications.lower():
                logger.warning(f"Query returned warnings/errors: {notifications}")
                return f"Query has warnings/errors. PLEASE FIX your query:\nNotifications: {notifications}\n\nQuery executed: {query}"
            
            # Check the size of the results, if too large return an error message instead
            tokens = count_tokens_approximately(results)
            if tokens > max_graph_raw_query_tokens:
                logger.warning(f"Raw query result is too large ({tokens} tokens), returning error message instead.")
                return f"Raw query result is too large ({tokens} tokens, max: {max_graph_raw_query_tokens}). Please refine your query to return less data:\n- Add LIMIT clause to restrict number of results\n- Select specific properties instead of returning entire nodes\n- Use filters (WHERE clause) to narrow down results\n- Consider using other specialized tools instead\n\nQuery executed: {query}"
            
            output = {
                "results": results,
                "notifications": notifications
            }
            logger.debug(f"Raw query output: {output}")
            return json_encode(output)
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error executing raw ontology graph query: {e}")
            return f"Error executing raw ontology graph query. PLEASE FIX your query:\n\nError: {error_msg}\n\nQuery executed: {query}\n\nTraceback: {traceback.format_exc()}"

    # Not a tool, but used internally
    async def _graph_check_if_ontology_generated(self) -> bool:
        """
        Checks if the ontology is generated for the graph database.
        Returns:
            bool: true if the ontology is generated, false otherwise
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
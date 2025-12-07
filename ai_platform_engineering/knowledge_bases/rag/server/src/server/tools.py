import os
from typing import Optional, List, Dict, Any

from common.utils import get_logger
from common.graph_db.base import GraphDB
from common.metadata_storage import MetadataStorage
import dotenv
from langchain_core.messages.utils import count_tokens_approximately
from redis.asyncio import Redis
from common.constants import (
    KV_ONTOLOGY_VERSION_ID_KEY, 
    PROP_DELIMITER, 
    ONTOLOGY_VERSION_ID_KEY,
    PRIMARY_ID_KEY
)
from common.models.graph import Entity, Relation
import traceback
from server.query_service import VectorDBQueryService
from common.models.rag import valid_metadata_keys
from fastmcp import FastMCP

# Load environment variables from .env file
dotenv.load_dotenv(verbose=True)
logger = get_logger(__name__)

max_graph_raw_query_results=int(os.getenv("MAX_GRAPH_RAW_QUERY_RESULTS", 100))
max_graph_raw_query_tokens=int(os.getenv("MAX_GRAPH_RAW_QUERY_TOKENS", 80000))
search_result_truncate_length=int(os.getenv("SEARCH_RESULT_TRUNCATE_LENGTH", 500))

# Bias presets for search tool
BIAS_KEYWORD = "keyword"  # 80% keyword, 20% semantic
BIAS_SEMANTIC = "semantic"  # 30% keyword, 70% semantic

def get_search_weights(bias: str) -> List[float]:
    """Get search weights based on bias type.
    Returns [semantic_weight, keyword_weight]
    """
    if bias == BIAS_KEYWORD:
        return [0.1, 0.9]  # 10% semantic, 90% keyword
    elif bias == BIAS_SEMANTIC:
        return [0.5, 0.5]  # 50% semantic, 50% keyword
    else:
        # Default to semantic
        return [0.5, 0.5]

class AgentTools:
    def __init__(self, redis_client: Redis, vector_db_query_service: VectorDBQueryService, metadata_storage: MetadataStorage, data_graph_db: Optional[GraphDB] = None, ontology_graph_db: Optional[GraphDB] = None):
        self.redis_client = redis_client
        self.vector_db_query_service: VectorDBQueryService = vector_db_query_service
        self.metadata_storage: MetadataStorage = metadata_storage
        self.data_graphdb: Optional[GraphDB] = data_graph_db
        self.ontology_graphdb: Optional[GraphDB] = ontology_graph_db

    async def register_tools(self, mcp: FastMCP, graph_rag_enabled: bool):

        # Modify search description based on graph_rag_enabled and valid_filter_keys 
        if graph_rag_enabled:
            valid_filter_keys = valid_metadata_keys()
            logger.info(f"Valid filter keys for search tool: {valid_filter_keys}")
            search_description = f"""
        Search for relevant documents and graph entities using semantic search in the vector databases.
        Returns results with text truncated to 500 chars. Use fetch_document to get full content.
        Args:
            query (str): The search query (Use full sentences for better results)
            filters (dict): Optional filters to apply. Valid filter keys are: {valid_filter_keys}.
            limit (int): Maximum number of results to return (default: 10)
            is_graph_entity (bool): Whether to search ONLY for graph entities. Default: False
            bias (str): Search bias type - "keyword" (90% keyword, 10% semantic) or "semantic" (60% semantic, 40% keyword). Default: "semantic"
            thought (str): Your thoughts for choosing this tool

        Returns:
            list: search results with text truncated to 500 chars and full metadata. Use fetch_document with document_id to get full content.
        """
        else:
            valid_filter_keys = valid_metadata_keys() # exclude graph metadata keys
            # remove any graph-related keys
            valid_filter_keys = [key for key in valid_filter_keys if "graph_entity" not in key]

            logger.info(f"Valid filter keys for search tool: {valid_filter_keys}")
            search_description =f"""
        Search for relevant documents using semantic search in the vector databases.
        Returns results with text truncated to 500 chars. Use fetch_document to get full content.
        Args:
            query (str): The search query (Use full sentences for better results)
            filters (dict): Optional filters to apply. Valid filter keys are: {valid_filter_keys}.
            limit (int): Maximum number of results to return (default: 10)
            is_graph_entity (bool): Unavailable for this tool.
            bias (str): Search bias type - "keyword" (90% keyword, 10% semantic) or "semantic" (60% semantic, 40% keyword). Default: "semantic"
            thought (str): Your thoughts for choosing this tool

        Returns:
            list: search results with text truncated to 500 chars and full metadata. Use fetch_document with document_id to get full content.
        """
        mcp.tool(
            name_or_fn=self.search,
            description=search_description,
        )
            
        # Register additional tools
        mcp.tool(self.fetch_document)
        mcp.tool(self.fetch_datasources_and_entity_types)
            
        if graph_rag_enabled:
            graph_tools = [
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

    async def search(self, query: str, filters: Optional[dict]=None, limit: int = 10,  bias: str = "semantic", is_graph_entity: bool = False, thought: str = ""):
        """
        Search for relevant documents (and graph entities) using semantic search in the vector databases.
        Returns truncated results. Use fetch_document to get full content.
        """
        logger.info(f"Search query: {query}, Limit: {limit}, Bias: {bias}, filters: {filters}, is_graph_entity: {is_graph_entity}, Thought: {thought}")

        # Get weights based on bias
        weights = get_search_weights(bias)
        logger.info(f"Using search weights (semantic, keyword): {weights}")
        if is_graph_entity:
            if filters is None:
                filters = {}
            filters.update({"is_graph_entity": True})
        
        logger.info(f"Search filters: {filters}")
        try:
            results = await self.vector_db_query_service.query(
                query=query,
                filters=filters,
                limit=limit,
                ranker="weighted",
                ranker_params={"weights": weights}
            )
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error during search: {e}")
            return f"Error during search: {e}"

        logger.info(f"search results: total_documents {len(results)}")
        # Truncate text in results to save tokens
        truncated_results: List[Dict[str, Any]] = []
        for result in results:
            # Work with Pydantic model attributes directly
            text = result.document.page_content
            metadata = result.document.metadata
            score = result.score
            
            # Truncate text
            if len(text) > search_result_truncate_length:
                text = text[:search_result_truncate_length] + f"... [truncated, use fetch_document with document_id to get full content]"
            
            truncated_results.append({
                "text_content": text,
                "metadata": metadata,
                "score": score
            })
        
        return truncated_results

    async def fetch_document(self, document_id: str, thought: str = ""):
        """
        Fetch the full content of a document by its document_id (obtained from search results).
        
        Args:
            document_id (str): The document ID from search results
            thought (str): Your thoughts for choosing this tool
            
        Returns:
            dict: document with full content and metadata
        """
        logger.info(f"Fetching document with ID: {document_id}, Thought: {thought}")
        
        try:
            # Query vector DB for the specific document
            results = await self.vector_db_query_service.query(
                query="",  # Empty query, we're filtering by ID
                filters={"document_id": document_id},
                limit=100,
                ranker="weighted",
                ranker_params={"weights": [1.0, 0.0]}
            )
            
            if not results:
                return f"Error: Document with ID '{document_id}' not found in the knowledge base."
            
            return results
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error fetching document {document_id}: {e}")
            return f"Error fetching document '{document_id}': {str(e)}"

    async def fetch_datasources_and_entity_types(self, thought: str = ""):
        """
        Fetch list of available datasources and entity types in the knowledge base.
        
        Args:
            thought (str): Your thoughts for choosing this tool
            
        Returns:
            dict: list of datasources (from metadata storage) and entity types (from graph DB if available)
        """
        logger.info(f"Fetching datasources and entity types, Thought: {thought}")
        
        result = {
            "datasources": [],
            "entity_types": []
        }
        
        try:
            # Get datasources from metadata storage
            datasources_info = await self.metadata_storage.fetch_all_datasource_info()
            result["datasources"] = [ds.datasource_id for ds in datasources_info]
            
            # Get entity types from ontology DB if available==
            if self.ontology_graphdb is not None:
                entity_types = await self.ontology_graphdb.get_all_entity_types()
                result["entity_types"] = sorted(list(entity_types))
            else:
                result["entity_types"] = []
                logger.info("Graph database not available, entity_types will be empty")
            
            return result
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error fetching datasources and entity types: {e}")
            return f"Error fetching datasources and entity types: {str(e)}"

    #####################
    # Graph query tools #
    #####################

    async def graph_explore_ontology_entity(self, entity_type: str, depth: int = 1, thought: str = ""):
        """
        Explores an ontology entity and its neighborhood up to specified depth.
        Returns the root entity with full details and connected entities with essential properties only.

        Args:
            entity_type (str): The type of entity to explore
            depth (int): How many hops to explore (default: 1, max: 3)
            thought (str): Your thoughts for choosing this tool

        Returns:
            dict: containing the root entity (full details), connected entities (essential properties), and their relations
        """
        logger.info(f"Exploring ontology entity {entity_type} with depth {depth}, Thought: {thought}")
        if self.ontology_graphdb is None:
            logger.error("Ontology graph database is not available, Is graph RAG enabled?")
            return "Error: Ontology graph database is not available. Please ensure graph RAG is enabled."
        
        # Validate and cap depth
        if depth < 1:
            depth = 1
        elif depth > 3:
            logger.warning(f"Depth {depth} exceeds maximum of 3, capping to 3")
            depth = 3
        
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
            
            # Explore the entity neighborhood with specified depth
            result = await self._explore_entity_with_depth(
                graphdb=self.ontology_graphdb,
                entity_type=entity_type,
                entity_pk=primary_key_id,
                max_depth=depth
            )
            
            if result["root_entity"] is None:
                return f"Error: Entity of type '{entity_type}' with primary key '{primary_key_id}' was not found in the ontology graph database. The entity may not exist or may have been deleted."
            
            return result
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error exploring ontology entity {entity_type}: {e}")
            return f"Error exploring ontology entity '{entity_type}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def graph_explore_data_entity(self, entity_type: str, primary_key_id: str, depth: int = 1, thought: str = ""):
        """
        Explores a data entity and its neighborhood up to specified depth.
        Returns the root entity with full details and connected entities with essential properties only.

        Args:
            entity_type (str): The type of entity to explore
            primary_key_id (str): The primary key id of the entity
            depth (int): How many hops to explore (default: 1, max: 3)
            thought (str): Your thoughts for choosing this tool

        Returns:
            dict: containing the root entity (full details), connected entities (essential properties), and their relations
        """
        logger.info(f"Exploring data entity {entity_type} with primary_key_id {primary_key_id} and depth {depth}, Thought: {thought}")
        if self.data_graphdb is None:
            logger.error("Data graph database is not available, Is graph RAG enabled?")
            return "Error: Data graph database is not available. Please ensure graph RAG is enabled."
        
        # Validate and cap depth
        if depth < 1:
            depth = 1
        elif depth > 3:
            logger.warning(f"Depth {depth} exceeds maximum of 3, capping to 3")
            depth = 3
        
        try:
            # First check if the entity type exists
            all_entity_types = await self.data_graphdb.get_all_entity_types()
            if entity_type not in all_entity_types:
                return f"Error: Entity type '{entity_type}' does not exist in the data graph database.\nAvailable entity types: {', '.join(sorted(all_entity_types))}"
            
            # Explore the entity neighborhood with specified depth
            result = await self._explore_entity_with_depth(
                graphdb=self.data_graphdb,
                entity_type=entity_type,
                entity_pk=primary_key_id,
                max_depth=depth
            )
            
            if result["root_entity"] is None:
                return f"Error: Entity of type '{entity_type}' with primary key '{primary_key_id}' was not found in the data graph database. Please verify the entity type and primary key are correct."
            
            return result
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error exploring data entity {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error exploring data entity '{entity_type}' with primary_key_id '{primary_key_id}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def _explore_entity_with_depth(
        self,
        graphdb: GraphDB,
        entity_type: str,
        entity_pk: str,
        max_depth: int
    ) -> dict:
        """
        Explores an entity and its neighborhood up to specified depth.
        Returns root entity with full details, other entities with essential properties only.
        
        Args:
            graphdb: The graph database to query
            entity_type: Type of the root entity
            entity_pk: Primary key of the root entity
            max_depth: Maximum depth to explore (1-3)
            
        Returns:
            dict with keys:
                - root_entity: dict with full entity details
                - entities: list of connected entities with essential properties
                - relations: list of relation tuples (from_pk, relation_name, to_pk)
        """
        # Fetch the neighborhood from graph DB with specified depth
        neighborhood = await graphdb.explore_neighborhood(
            entity_type=entity_type,
            entity_pk=entity_pk,
            depth=max_depth,
            max_results=1000
        )
        
        if neighborhood["entity"] is None:
            return {"root_entity": None, "entities": [], "relations": []}
        
        root_entity = neighborhood["entity"]
        
        # Extract full entity data for root
        def extract_full_entity_data(entity: Entity) -> dict:
            """Extract complete entity data with all properties"""
            primary_key_values = {}
            for prop in entity.primary_key_properties:
                if prop in entity.all_properties:
                    primary_key_values[prop] = entity.all_properties[prop]
            
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
        
        # Extract essential entity data for connected entities
        def extract_essential_entity_data(entity: Entity) -> dict:
            """Extract only essential entity data (primary keys and entity type)"""
            primary_key_values = {}
            for prop in entity.primary_key_properties:
                if prop in entity.all_properties:
                    primary_key_values[prop] = entity.all_properties[prop]
            
            additional_key_values = []
            if entity.additional_key_properties:
                for key_props in entity.additional_key_properties:
                    key_dict = {}
                    for prop in key_props:
                        if prop in entity.all_properties:
                            key_dict[prop] = entity.all_properties[prop]
                    if key_dict:
                        additional_key_values.append(key_dict)
            
            return {
                "entity_type": entity.entity_type,
                "_entity_pk": entity.all_properties.get(PRIMARY_ID_KEY, ""),
                "primary_key_values": primary_key_values,
                "additional_key_values": additional_key_values
            }
        
        # Process root entity with full details
        root_entity_data = extract_full_entity_data(root_entity)
        
        # Process all connected entities with essential properties only
        connected_entities = []
        all_relations = []
        
        for entity in neighborhood["entities"]:
            # Skip the root entity itself
            if entity.all_properties.get(PRIMARY_ID_KEY) == entity_pk:
                continue
            
            connected_entities.append(extract_essential_entity_data(entity))
        
        # Process all relations
        for relation in neighborhood["relations"]:
            relation_tuple = (
                relation.from_entity.primary_key,
                relation.relation_name,
                relation.to_entity.primary_key
            )
            all_relations.append(relation_tuple)
        
        return {
            "root_entity": root_entity_data,
            "entities": connected_entities,
            "relations": all_relations
        }

    async def graph_fetch_data_entity_details(self, entity_type: str, primary_key_id: str, thought: str):
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
            
            return {
                "entity_type": entity.entity_type,
                "_entity_pk": entity.all_properties.get(PRIMARY_ID_KEY, ""),
                "primary_key_values": primary_key_values,
                "additional_key_values": additional_key_values,
                "properties": clean_properties,
                "relations": relations_data,
            }
        except Exception as e:
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error fetching entity details {entity_type} with primary_key_id {primary_key_id}: {e}")
            return f"Error fetching data entity details for '{entity_type}' with primary_key_id '{primary_key_id}': {str(e)}\nTraceback: {traceback.format_exc()}"

    async def graph_shortest_path_between_entity_types(self, entity_type_1: str, entity_type_2: str, thought: str):
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

    async def graph_raw_query_data(self, query: str, thought: str):
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
            notifications = res.get("notifications", [])
            results = res.get("results", [])

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
            return output
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Traceback: {traceback.format_exc()}")
            logger.error(f"Error executing raw data graph query: {e}")
            return f"Error executing raw data graph query. PLEASE FIX your query:\n\nError: {error_msg}\n\nQuery executed: {query}\n\nTraceback: {traceback.format_exc()}"

    async def graph_raw_query_ontology(self, query: str, thought: str):
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
            notifications = res.get("notifications", [])
            results = res.get("results", [])

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
            return output
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
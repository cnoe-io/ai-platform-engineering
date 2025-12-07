from typing import Any, Dict, List, Optional
import traceback
from common.utils import get_logger
from common.models.server import QueryResult
from langchain_milvus import Milvus
from common.models.rag import valid_metadata_keys

logger = get_logger(__name__)

class VectorDBQueryService:
    def __init__(self, vector_db: Milvus):
        self.vector_db = vector_db

    async def validate_filter_keys(self, filters: Dict[str, str]):
        """Validate filter keys and values"""
        valid_filter_keys = valid_metadata_keys()
        for filter_name, filter_value in filters.items():
            if filter_name not in valid_filter_keys:
                logger.warning(f"Invalid filter key: {filter_name}")
                raise ValueError(f"Invalid filter key: {filter_name}, must be one of {valid_filter_keys}")
            
            # Add additional validation for filter values if needed
            if not isinstance(filter_value, str) and not isinstance(filter_value, bool):
                logger.warning(f"Invalid filter value for {filter_name}: {filter_value}, must be a string or boolean")
                raise ValueError(f"Invalid filter value for {filter_name}: {filter_value}, must be a string or boolean")

    async def query(self, 
        query: str,
        filters: Optional[Dict[str, str|bool]] = None,
        limit: int = 10, 
        ranker: str = "",
        ranker_params: Optional[Dict[str, Any]] = None) -> List[QueryResult]:
        """
        Query the vector database with optional filters and ranking.
        :param query: The query string.
        :param filters: Optional filters to apply (e.g., datasource_id, connector_id,
                        graph_entity_type).
        :param limit: Number of results to return.
        :param ranker: Type of ranker to use ('weighted', 'recency', etc.).
        :param ranker_params: Parameters for the ranker.
        :return: QueryResults containing the results and their scores.
        """

        # Validate filters
        if filters:
            await self.validate_filter_keys(filters)
        
            # Build filter expressions for filtering if specified
            filter_expr_parts = []
            for key, value in (filters or {}).items():
                if isinstance(value, bool):
                    # For boolean values, don't use quotes
                    filter_expr_parts.append(f"{key} == {str(value).lower()}")
                else:
                    # For string values, use quotes
                    filter_expr_parts.append(f"{key} == '{value}'")
            filter_expr = " AND ".join(filter_expr_parts)
        else:
            filter_expr = None # No filters

        logger.info(f"Searching docs vector db with filters - {filter_expr}, query: {query}")
        try:
            results = await self.vector_db.asimilarity_search_with_score(
                query,
                k=limit,
                ranker_type=ranker,
                ranker_params=ranker_params,
                expr=filter_expr
            )
        except Exception as e:
            logger.error(traceback.format_exc())
            logger.error(f"Error querying docs vector db: {e}")
            return []

        # Format results for response
        query_results: List[QueryResult] = []
        for doc, score in results:
            query_results.append(
                QueryResult(
                    document=doc,
                    score=score
                )
            )
        return query_results
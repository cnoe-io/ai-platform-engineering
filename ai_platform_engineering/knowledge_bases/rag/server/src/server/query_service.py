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

    async def validate_filter_keys(self, filters: Dict[str, "str | bool | List[str]"]):
        """Validate filter keys and values"""
        valid_filter_keys = valid_metadata_keys()
        for filter_name, filter_value in filters.items():
            if filter_name not in valid_filter_keys:
                logger.warning(f"Invalid filter key: {filter_name}")
                raise ValueError(f"Invalid filter key: {filter_name}, must be one of {valid_filter_keys}")

            if isinstance(filter_value, list):
                if not all(isinstance(v, str) for v in filter_value):
                    raise ValueError(f"Invalid filter value for {filter_name}: list values must all be strings")
            elif not isinstance(filter_value, str) and not isinstance(filter_value, bool):
                logger.warning(f"Invalid filter value for {filter_name}: {filter_value}, must be a string, boolean, or list of strings")
                raise ValueError(f"Invalid filter value for {filter_name}: {filter_value}, must be a string, boolean, or list of strings")

    async def query(self,
        query: str,
        filters: Optional[Dict[str, "str | bool | List[str]"]] = None,
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
                elif isinstance(value, list):
                    # Split into exact values and prefix patterns (ending with *)
                    exact = [v for v in value if not v.endswith("*")]
                    prefixes = [v[:-1] for v in value if v.endswith("*")]
                    parts = []
                    if exact:
                        values_str = ", ".join([f'"{v}"' for v in exact])
                        parts.append(f"{key} in [{values_str}]")
                    for prefix in prefixes:
                        parts.append(f'{key} like "{prefix}%"')
                    if len(parts) == 1:
                        filter_expr_parts.append(parts[0])
                    else:
                        filter_expr_parts.append(f"({' or '.join(parts)})")
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
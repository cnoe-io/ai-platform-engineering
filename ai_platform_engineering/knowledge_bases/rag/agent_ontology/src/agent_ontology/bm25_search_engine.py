"""
BM25 search engine using bm25s and rbloom for efficient entity search.
"""
import sys
import re
import logging
from typing import Any, List, Tuple, Dict

import bm25s
import numpy as np
from rbloom import Bloom

from common import utils
from common.constants import (
    SUB_ENTITY_LABEL, 
    PRIMARY_ID_KEY,
    ALL_IDS_KEY,
    ALL_IDS_PROPS_KEY,
    ENTITY_TYPE_KEY,
)
from common.graph_db.base import GraphDB


# Compile regex patterns once for efficiency
TOKEN_PATTERN = re.compile(r'[A-Za-z0-9]+')
# Match PascalCase/camelCase boundaries
PASCAL_CASE_PATTERN = re.compile(r'([A-Z])([A-Z][a-z])|([a-z])([A-Z])|([A-Za-z])([0-9])|([0-9])([A-Za-z])')


def tokenize_value(value: str) -> List[str]:
    """Split value on non-alphanumeric characters efficiently."""
    return TOKEN_PATTERN.findall(str(value))


def tokenize_pascal_case(value: str) -> List[str]:
    """Split PascalCase/camelCase strings efficiently."""
    value_str = str(value)
    # Insert spaces at case/number boundaries
    spaced = PASCAL_CASE_PATTERN.sub(r'\1\3\5\7 \2\4\6\8', value_str)
    # Split on spaces and filter empty strings
    return [part for part in spaced.split() if part]


def tokenize_record(entity_pk: str, entity_type: str, all_ids: List[str]) -> List[str]:
    """
    Tokenize a single record (entity_pk, entity_type, all_ids) into tokens for BM25 indexing.
    
    Args:
        entity_pk: Primary key of the entity
        entity_type: Type of the entity
        all_ids: List of all ID values
        
    Returns:
        List of tokens (strings)
    """
    tokens = []
    seen_tokens = set()  # Deduplicate tokens within document
    
    # First, add entity_type tokens (PascalCase splitting)
    if entity_type:
        # Add full entity type (lowercased and interned)
        full_type_token = sys.intern(entity_type.lower())
        if full_type_token not in seen_tokens:
            tokens.append(full_type_token)
            seen_tokens.add(full_type_token)
        
        # Add PascalCase split tokens
        type_tokens = tokenize_pascal_case(entity_type)
        for token in type_tokens:
            token_lower = sys.intern(token.lower())
            if token_lower not in seen_tokens:
                tokens.append(token_lower)
                seen_tokens.add(token_lower)
    
    # Then process all_ids
    if all_ids:
        for value in all_ids:
            if value:  # Skip None/empty values
                value_str = str(value)
                
                # Split on non-alphanumeric characters first
                value_tokens = tokenize_value(value_str)
                
                # Only add full value if it's different from sub-tokens
                if len(value_tokens) > 1 or (value_tokens and value_tokens[0] != value_str):
                    token = sys.intern(value_str.lower())
                    if token not in seen_tokens:
                        tokens.append(token)
                        seen_tokens.add(token)
                
                # Add alphanumeric sub-tokens (lowercased and interned)
                for token in value_tokens:
                    token_lower = sys.intern(token.lower())
                    if token_lower not in seen_tokens:
                        tokens.append(token_lower)
                        seen_tokens.add(token_lower)
                    
                    # Also split each alphanumeric token by PascalCase/camelCase
                    pascal_tokens = tokenize_pascal_case(token)
                    if len(pascal_tokens) > 1:  # Only if it actually splits
                        for pascal_token in pascal_tokens:
                            pascal_lower = sys.intern(pascal_token.lower())
                            if pascal_lower not in seen_tokens:
                                tokens.append(pascal_lower)
                                seen_tokens.add(pascal_lower)
    
    return tokens


def tokenize_query(query: str) -> List[str]:
    """
    Tokenize a query string into a list of tokens.
    
    Args:
        query: Query string
        
    Returns:
        List of tokens (strings)
    """
    query_tokens_list = []
    seen = set()
    
    for token in query.split():
        token_lower = sys.intern(token.lower())
        if token_lower not in seen:
            query_tokens_list.append(token_lower)
            seen.add(token_lower)
        # Also add sub-tokens
        for sub_token in tokenize_value(token):
            sub_lower = sys.intern(sub_token.lower())
            if sub_lower not in seen:
                query_tokens_list.append(sub_lower)
                seen.add(sub_lower)
    
    return query_tokens_list


class BM25SearchEngine:
    """
    In-memory BM25 search engine using bm25s and rbloom for efficient entity search.
    """
    
    def __init__(
        self, 
        graph_db: GraphDB,
        index_batch_size: int = 50_000,
        bloom_filter_size: int = 10_000_000,
        bloom_filter_error_rate: float = 0.01
    ):
        self.graph_db = graph_db
        self.index_batch_size = index_batch_size
        self.logger = utils.get_logger("bm25_search_engine")
        
        # BM25 index
        self.retriever: bm25s.BM25 | None = None
        self.metadata: List[Dict[str, Any]] = []  # Store raw entity dictionaries (entity_pk, entity_type, all_ids, all_ids_props)
        
        # Type ranges for weight masking
        self.type_ranges: Dict[str, Tuple[int, int]] = {}  # {"Pod": (0, 100), "Service": (100, 250), ...}
        
        # Bloom filter for membership testing
        self.bloom_filter: Bloom | None = None
        self.bloom_filter_size = bloom_filter_size
        self.bloom_filter_error_rate = bloom_filter_error_rate
        
        # Statistics
        self.stats = {
            "total_entities_indexed": 0,
            "total_tokens": 0,
            "bloom_filter_size": 0,
            "entity_types_count": 0
        }
    
    async def build_index(self):
        """
        Build the in-memory BM25 index and bloom filter from all entities in the database.
        Entities are grouped by type for efficient weight masking during search.
        """
        self.logger.info(f"Building BM25 index with batch_size={self.index_batch_size}")
        
        # Initialize bloom filter
        self.logger.info(f"Initializing bloom filter (size={self.bloom_filter_size}, error_rate={self.bloom_filter_error_rate})")
        self.bloom_filter = Bloom(self.bloom_filter_size, self.bloom_filter_error_rate)
        
        # Fetch all entities and group by type in ONE PASS
        entities_by_type: Dict[str, List[dict]] = {}
        offset = 0
        batch_num = 0
        
        while True:
            batch_num += 1
            self.logger.info(f"Fetching index batch {batch_num} (offset={offset})")
            
            # Fetch raw entity data (only needed properties)
            raw_entities = await self.graph_db.fetch_raw_entity_batch(
                labels=[],  # Will use tenant label only
                properties=[PRIMARY_ID_KEY, ENTITY_TYPE_KEY, ALL_IDS_KEY, ALL_IDS_PROPS_KEY],
                offset=offset,
                limit=self.index_batch_size,
                exclude_labels=[SUB_ENTITY_LABEL]
            )
            
            if not raw_entities:
                self.logger.info("No more entities to index")
                break
            
            self.logger.info(f"Fetched {len(raw_entities)} raw entities in batch {batch_num}")
            
            # Group by type in one pass (O(n))
            for record in raw_entities:
                entity_type = record.get(ENTITY_TYPE_KEY)
                if not entity_type:
                    continue
                
                if entity_type not in entities_by_type:
                    entities_by_type[entity_type] = []
                entities_by_type[entity_type].append(record)
            
            self.logger.info(f"Grouped {len(raw_entities)} entities by type in batch {batch_num}")
            offset += self.index_batch_size
        
        # Now build corpus with entities grouped by type
        corpus_tokens = []
        metadata = []
        type_ranges = {}
        
        current_idx = 0
        for entity_type in sorted(entities_by_type.keys()):  # Sort for deterministic ordering
            entities = entities_by_type[entity_type]
            start_idx = current_idx
            
            self.logger.info(f"Processing type '{entity_type}': {len(entities)} entities")
            
            for record in entities:
                entity_pk = record.get(PRIMARY_ID_KEY)
                all_ids = record.get(ALL_IDS_KEY, [])
                
                if not entity_pk:
                    continue
                
                # Tokenize the record
                tokens = tokenize_record(entity_pk, entity_type, all_ids)
                
                if tokens:
                    corpus_tokens.append(tokens)
                    metadata.append(record)
                    current_idx += 1
                    
                    # Add tokens directly to bloom filter (already tokenized and lowercased)
                    # Skip entity_type tokens and only add tokens from actual ID values
                    for token in tokens:
                        if len(token) >= 2:  # Only meaningful tokens
                            self.bloom_filter.add(token)
            
            end_idx = current_idx
            type_ranges[entity_type] = (start_idx, end_idx)
            self.logger.info(f"Type '{entity_type}' range: [{start_idx}, {end_idx})")
        
        # Store metadata and type ranges
        self.metadata = metadata
        self.type_ranges = type_ranges
        
        self.logger.info(f"Total entities tokenized: {len(corpus_tokens)}")
        self.logger.info(f"Total entity types: {len(type_ranges)}")
        self.logger.info("Building BM25 index...")
        
        # Create and index the BM25 model
        self.retriever = bm25s.BM25(method="bm25l")
        self.retriever.index(corpus_tokens)
        
        # Update statistics
        self.stats["total_entities_indexed"] = len(corpus_tokens)
        self.stats["total_tokens"] = sum(len(tokens) for tokens in corpus_tokens)
        self.stats["bloom_filter_size"] = self.bloom_filter_size
        self.stats["entity_types_count"] = len(type_ranges)
        
        self.logger.info(f"BM25 index built successfully: {self.stats}")
    
    def _should_add_to_bloom(self, value: str) -> bool:
        """Check if a value should be added to the bloom filter."""
        if not value or len(value) < 2:
            return False
        # Skip values that are too long (likely not useful for matching)
        if len(value) > 1000:
            return False
        return True
    
    @staticmethod
    def get_base_entity_type(entity_type: str) -> str:
        """
        Extract base entity type, handling sub-entities.
        Sub-entities like "Pod_Container" -> "Pod"
        Regular entities like "Pod" -> "Pod"
        """
        return entity_type.split("_")[0] if "_" in entity_type else entity_type
    
    def contains(self, value: str) -> bool:
        """
        Check if any token from the value exists in the bloom filter.
        Returns True if at least one token is found (possible match).
        """
        if not self.bloom_filter:
            return True  # If no bloom filter, allow everything
        
        # Tokenize the value and check if ANY token exists in bloom filter
        tokens = tokenize_value(str(value))
        if not tokens:
            return False
        
        # Check if any token exists (early exit on first match)
        for token in tokens:
            token_lower = token.lower()
            if len(token_lower) >= 2 and token_lower in self.bloom_filter:
                return True
        
        return False
    
    async def search(
        self, 
        query_string: str,
        exclude_entity_type: str | None = None,
        top_k: int = 5
    ) -> List[Tuple[Dict[str, Any], float]]:
        """
        Search for entities matching the query string.
        
        Args:
            query_string: Pre-built query string
            exclude_entity_type: Entity type to exclude from results
            top_k: Number of top results to return
            
        Returns:
            List of (entity_dict, score) tuples where entity_dict is the raw record
        """
        if not self.retriever or not self.metadata:
            return []
        
        # Tokenize query
        query_tokens = tokenize_query(query_string)
        
        self.logger.debug(f"[BM25 Search] Query string: '{query_string}'")
        self.logger.debug(f"[BM25 Search] Tokenized query: {query_tokens}")
        
        if not query_tokens:
            self.logger.debug("[BM25 Search] No tokens after tokenization, returning empty results")
            return []
        
        # Search using BM25
        results, scores = self.retriever.retrieve([query_tokens], k=top_k, n_threads=-1)
        
        self.logger.debug(f"[BM25 Search] Raw BM25 results shape: {results.shape}, scores shape: {scores.shape}")
        
        # Convert results to entity dictionaries
        entities_with_scores = []
        
        for i in range(results.shape[1]):
            doc_idx = results[0, i]
            score = scores[0, i]
            
            if doc_idx >= len(self.metadata):
                continue
            
            entity_dict = self.metadata[doc_idx]
            entity_type = entity_dict.get(ENTITY_TYPE_KEY)
            entity_pk = entity_dict.get(PRIMARY_ID_KEY)
            
            # Skip excluded entity types
            if exclude_entity_type and entity_type == exclude_entity_type:
                self.logger.debug(f"[BM25 Search] Excluded result: {entity_type}:{entity_pk} (score: {score})")
                continue
            
            self.logger.debug(f"[BM25 Search] Result {i+1}: {entity_type}:{entity_pk} (score: {score})")
            entities_with_scores.append((entity_dict, float(score)))
        
        self.logger.debug(f"[BM25 Search] Returning {len(entities_with_scores)} results after filtering")
        
        return entities_with_scores
    
    async def search_batch(
        self,
        query_tokens_list: List[List[str]],  # Pre-tokenized queries
        exclude_entity_types: List[str],  # One exclude type per query
        top_k: int = 5,
        diversity_mode: bool = True,
        diversity_penalty: float = 0.3,
        max_entities_per_type: int | None = None,
        final_k: int = 50
    ) -> List[List[Tuple[Dict[str, Any], float]]]:
        """
        Batch search for multiple queries using weight masks to exclude same-type entities.
        Queries are grouped by their exclude type for efficient batched searching.
        
        Args:
            query_tokens_list: List of pre-tokenized query token lists
            exclude_entity_types: List of entity types to exclude (one per query)
            top_k: Number of top results to retrieve from BM25 (auto-calculated if diversity_mode=True)
            diversity_mode: If True, apply diversity re-ranking to promote variety across entity types
            diversity_penalty: Penalty factor for diversity (0.2-0.5 typical, higher = more diversity)
            max_entities_per_type: Optional hard cap on entities per type (e.g., 5 = max 5 of each type)
            final_k: Final number of results to return after diversity re-ranking
            
        Returns:
            List of result lists, where each result is (entity_dict, score) tuple
        """
        if not self.retriever or not self.metadata:
            return [[] for _ in query_tokens_list]
        
        if len(query_tokens_list) != len(exclude_entity_types):
            raise ValueError("query_tokens_list and exclude_entity_types must have same length")
        
        # Calculate dynamic top_k based on corpus size if diversity mode is enabled
        if diversity_mode:
            corpus_size = len(self.metadata)
            # Use ~1% of corpus, min 50, max 1000
            calculated_top_k = max(50, min(1000, int(corpus_size * 0.01)))
            top_k = calculated_top_k
            self.logger.debug(f"[BM25 Batch Search] Diversity mode enabled: corpus_size={corpus_size}, calculated top_k={top_k}, final_k={final_k}, max_per_type={max_entities_per_type}")
        
        self.logger.debug(f"[BM25 Batch Search] Processing {len(query_tokens_list)} queries with top_k={top_k}")
        
        # Group queries by their EXCLUDE type in ONE PASS (O(n))
        # Key: base entity type to exclude, Value: list of (original_idx, query_tokens, original_entity_type)
        queries_by_exclude_type: Dict[str, List[Tuple[int, List[str], str]]] = {}
        
        for idx, (tokens, exclude_type) in enumerate(zip(query_tokens_list, exclude_entity_types)):
            if not tokens:
                continue  # Skip empty queries
            
            # Extract base type (handles sub-entities like Pod_Container -> Pod)
            base_exclude_type = self.get_base_entity_type(exclude_type)
            
            if base_exclude_type not in queries_by_exclude_type:
                queries_by_exclude_type[base_exclude_type] = []
            queries_by_exclude_type[base_exclude_type].append((idx, tokens, exclude_type))  # Include original entity type
        
        self.logger.debug(f"[BM25 Batch Search] Grouped queries into {len(queries_by_exclude_type)} exclude-type groups")
        
        # Initialize results array
        all_results: List[List[Tuple[Dict[str, Any], float]]] = [[] for _ in query_tokens_list]
        
        # Process each exclude-type group
        for exclude_type, query_group in queries_by_exclude_type.items():
            self.logger.debug(f"[BM25 Batch Search] Processing {len(query_group)} queries for exclude type: {exclude_type}")
            
            # Create weight mask: 1.0 everywhere except for excluded type
            mask = np.ones(len(self.metadata), dtype=np.float32)
            
            # Set masked entities to large negative value instead of 0.0
            # This ensures they have negative scores even after nonoccurrence_scores are added (bm25l/bm25+ bug workaround)
            MASK_NEGATIVE_VALUE = -1e10
            
            # Mask all entity types that start with the base exclude type
            masked_indices_all = []  # Track all masked indices for verbose debugging
            
            for entity_type, (start_idx, end_idx) in self.type_ranges.items():
                base_type = self.get_base_entity_type(entity_type)
                if base_type == exclude_type:
                    mask[start_idx:end_idx] = MASK_NEGATIVE_VALUE
                    masked_indices_all.extend(range(start_idx, end_idx))
                    self.logger.debug(f"[BM25 Batch Search] Masked out type '{entity_type}' [{start_idx}:{end_idx}]")
            
            # Verbose debugging: show all masked indices and sample entities
            if self.logger.isEnabledFor(logging.DEBUG) and masked_indices_all:
                self.logger.debug(f"[BM25 Batch Search] Total masked indices: {len(masked_indices_all)}")
                self.logger.debug(f"[BM25 Batch Search] Mask negative value: {MASK_NEGATIVE_VALUE}")
                self.logger.debug(f"[BM25 Batch Search] First 20 masked indices: {masked_indices_all[:20]}")
                self.logger.debug(f"[BM25 Batch Search] Last 20 masked indices: {masked_indices_all[-20:]}")
                
                # Sample entities at masked indices to verify
                sample_size = min(5, len(masked_indices_all))
                sample_indices = [masked_indices_all[0], masked_indices_all[len(masked_indices_all)//4], 
                                  masked_indices_all[len(masked_indices_all)//2], masked_indices_all[3*len(masked_indices_all)//4],
                                  masked_indices_all[-1]][:sample_size]
                
                self.logger.debug(f"[BM25 Batch Search] Sampling {sample_size} masked entities:")
                for idx in sample_indices:
                    if idx < len(self.metadata):
                        entity = self.metadata[idx]
                        entity_type = entity.get(ENTITY_TYPE_KEY, "Unknown")
                        entity_pk = entity.get(PRIMARY_ID_KEY, "Unknown")
                        self.logger.debug(f"[BM25 Batch Search]   idx={idx}: type={entity_type}, pk={entity_pk[:50]}...")
                
                # Show mask values for verification
                masked_mask_values = [mask[idx] for idx in sample_indices if idx < len(mask)]
                self.logger.debug(f"[BM25 Batch Search] Mask values at sample indices: {masked_mask_values}")
            
            # Extract tokens for this group (already tokenized!)
            group_tokens = [tokens for _, tokens, _ in query_group]
            
            # Execute batched search with weight mask (pass tokens directly)
            results, scores = self.retriever.retrieve(group_tokens, k=top_k, weight_mask=mask, n_threads=-1, show_progress=False)
            
            self.logger.debug(f"[BM25 Batch Search] Retrieved results shape: {results.shape}, scores shape: {scores.shape}")
            
            # Verbose debugging: check if any returned indices were masked
            if self.logger.isEnabledFor(logging.DEBUG) and masked_indices_all and len(query_group) > 0:
                masked_set = set(masked_indices_all)
                first_result_indices = results[0, :].tolist()
                
                masked_in_results = []
                for pos, res_idx in enumerate(first_result_indices):
                    if res_idx in masked_set:
                        if res_idx < len(self.metadata):
                            entity = self.metadata[res_idx]
                            entity_type = entity.get(ENTITY_TYPE_KEY, "Unknown")
                            entity_pk = entity.get(PRIMARY_ID_KEY, "Unknown")
                            score = scores[0, pos]
                            masked_in_results.append(f"pos={pos}, idx={res_idx}, type={entity_type}, pk={entity_pk[:30]}..., score={score:.2f}")
                
                if masked_in_results:
                    self.logger.warning(f"[BM25 Batch Search] ⚠️ MASKED INDICES FOUND IN RESULTS ({len(masked_in_results)} found):")
                    for item in masked_in_results[:10]:  # Show first 10
                        self.logger.warning(f"[BM25 Batch Search]   {item}")
                else:
                    self.logger.debug(f"[BM25 Batch Search] ✓ No masked indices found in results (verified against {len(masked_set)} masked indices)")
            
            # Map results back to original query indices with diversity re-ranking
            for group_idx, (original_idx, _, original_entity_type) in enumerate(query_group):
                # Single-pass filtering + diversity re-ranking
                type_counts = {}
                candidates = []
                
                # Log if this is the first query in group (for debugging)
                if self.logger.isEnabledFor(logging.DEBUG) and group_idx == 0:
                    self.logger.debug(f"[BM25 Batch Search] Mapping results for query 0: original_type='{original_entity_type}', base_type='{exclude_type}', diversity_mode={diversity_mode}")
                
                for i in range(results.shape[1]):
                    doc_idx = results[group_idx, i]
                    score = scores[group_idx, i]
                    
                    if doc_idx >= len(self.metadata):
                        continue
                    
                    # FILTER 1: Skip negative/zero scores (masked entities)
                    if score <= 0:
                        if self.logger.isEnabledFor(logging.DEBUG) and i < 10:
                            entity_dict = self.metadata[doc_idx]
                            entity_type = entity_dict.get(ENTITY_TYPE_KEY, "Unknown")
                            self.logger.debug(f"[BM25 Batch Search] Filtering out negative/zero score result: {entity_type} (idx: {doc_idx}, score: {score:.2f})")
                        continue
                    
                    entity_dict = self.metadata[doc_idx]
                    entity_type = entity_dict.get(ENTITY_TYPE_KEY)
                    
                    if not entity_type:
                        continue
                    
                    # FILTER 2: Skip entities matching excluded base type
                    base_type = self.get_base_entity_type(entity_type)
                    if base_type == exclude_type:
                        if self.logger.isEnabledFor(logging.DEBUG) and i < 10:
                            self.logger.debug(f"[BM25 Batch Search] Filtering out masked type: {entity_type} (base: {base_type}, idx: {doc_idx}, score: {score:.2f})")
                        continue
                    
                    # FILTER 3: Check hard cap on entities per type (if enabled)
                    count = type_counts.get(entity_type, 0)
                    if max_entities_per_type is not None and count >= max_entities_per_type:
                        if self.logger.isEnabledFor(logging.DEBUG) and i < 20 and count == max_entities_per_type:
                            # Only log once when we first hit the cap for this type
                            self.logger.debug(f"[BM25 Batch Search] Hit max_per_type cap for {entity_type} (cap={max_entities_per_type}, score: {score:.2f})")
                        continue
                    
                    # Apply diversity penalty if enabled
                    if diversity_mode:
                        diversity_factor = 1.0 / (1.0 + count * diversity_penalty)
                        adjusted_score = score * diversity_factor
                    else:
                        adjusted_score = score
                    
                    # Update count and add to candidates
                    type_counts[entity_type] = count + 1
                    candidates.append((entity_dict, adjusted_score, score))  # Keep original score for logging
                
                # Sort by adjusted score and take top final_k
                if diversity_mode:
                    candidates.sort(key=lambda x: x[1], reverse=True)
                    final_results = [(entity_dict, original_score) for entity_dict, _, original_score in candidates[:final_k]]
                    
                    if self.logger.isEnabledFor(logging.DEBUG) and group_idx == 0:
                        unique_types = len(set(e.get(ENTITY_TYPE_KEY) for e, _ in final_results))
                        
                        # Calculate per-type distribution
                        type_distribution = {}
                        for e, _ in final_results:
                            et = e.get(ENTITY_TYPE_KEY)
                            type_distribution[et] = type_distribution.get(et, 0) + 1
                        
                        # Format top 5 types by count
                        top_types = sorted(type_distribution.items(), key=lambda x: x[1], reverse=True)[:5]
                        dist_str = ", ".join([f"{t}:{c}" for t, c in top_types])
                        
                        self.logger.debug(f"[BM25 Batch Search] Diversity re-ranking complete: {len(candidates)} candidates → {len(final_results)} final results with {unique_types} unique types")
                        self.logger.debug(f"[BM25 Batch Search] Top type distribution: {dist_str}")
                else:
                    # No diversity mode: just take top final_k by original score
                    candidates.sort(key=lambda x: x[2], reverse=True)
                    final_results = [(entity_dict, original_score) for entity_dict, _, original_score in candidates[:final_k]]
                
                all_results[original_idx] = final_results
        
        self.logger.debug(f"[BM25 Batch Search] Completed batch search, returning {len([r for r in all_results if r])} non-empty result sets")
        
        return all_results


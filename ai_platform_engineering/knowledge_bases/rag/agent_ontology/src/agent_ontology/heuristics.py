"""
Efficient heuristics processor using in-memory BM25 search with rbloom.
"""
import gc
import logging
from dataclasses import dataclass
from itertools import combinations
from typing import Any, Callable, Awaitable, List, Tuple, Dict

from common import utils
from common.constants import (
    DEFAULT_DATA_LABEL, 
    SUB_ENTITY_LABEL, 
    PARENT_ENTITY_PK_KEY, 
    PARENT_ENTITY_TYPE_KEY, 
    PRIMARY_ID_KEY,
    ALL_IDS_KEY,
    ALL_IDS_PROPS_KEY,
    ENTITY_TYPE_KEY,
    PROP_DELIMITER,
    ONTOLOGY_VERSION_ID_KEY
)
from common.graph_db.base import GraphDB
from common.models.graph import Entity
from common.models.ontology import (
    PropertyMapping, 
    DeepPropertyMatch,
    ValueMatchType
)

from agent_ontology.relation_manager import RelationCandidateManager
from agent_ontology.ontology_cache import OntologyCache
from agent_ontology.bm25_search_engine import BM25SearchEngine, tokenize_value


@dataclass
class MatchResult:
    """Result of matching two values."""
    is_match: bool
    match_type: ValueMatchType
    quality: float   # 0.0 to 1.0


@dataclass
class SearchTask:
    """Represents a search task with context."""
    entity: Entity
    property_name: str
    property_value: str
    query_tokens: List[str]  # Pre-tokenized query tokens
    entity_property_id_key: List[str] | None


class HeuristicsProcessor:
    """
    Efficient heuristics processor using in-memory BM25 search and bloom filtering.
    """
    
    def __init__(
        self, 
        graph_db: GraphDB,
        rc_manager: RelationCandidateManager,
        entity_batch_size: int = 10_000,
        index_batch_size: int = 50_000,
        min_relation_count: int = 3,
        top_score_matches_only: bool = True,
        progress_callback: Callable[[str], Awaitable[None]] | None = None
    ):
        self.graph_db = graph_db
        self.rc_manager = rc_manager
        self.entity_batch_size = entity_batch_size
        self.index_batch_size = index_batch_size
        self.min_relation_count = min_relation_count
        self.top_score_matches_only = top_score_matches_only
        self.progress_callback = progress_callback
        
        self.logger = utils.get_logger("heuristics_processor")
        
        # BM25 search engine
        self.search_engine: BM25SearchEngine | None = None
        
        # Statistics
        self.stats = {
            "entities_processed": 0,
            "relations_created": 0,
            "fuzzy_searches": 0,
            "fuzzy_searches_filtered": 0,
            "deep_matches": 0,
            "relations_discarded": 0
        }
    
    async def process_all_entities(self):
        """
        Main entry point - process all entities using type-aware batching with BM25 search.
        """
        self.logger.info(f"Starting heuristics processing (entity_batch_size={self.entity_batch_size}, index_batch_size={self.index_batch_size})")
        
        # Helper to send progress updates
        async def update_progress(message: str):
            self.logger.info(message)
            if self.progress_callback:
                await self.progress_callback(message)
        
        # Step 0: Build BM25 index and bloom filter
        await update_progress("Building BM25 search index and bloom filter...")
        self.search_engine = BM25SearchEngine(
            self.graph_db,
            index_batch_size=self.index_batch_size
        )
        await self.search_engine.build_index()
        await update_progress(f"BM25 index built: {self.search_engine.stats['total_entities_indexed']} entities indexed")
        
        # Step 0.5: Pre-create all schema entity nodes in ontology DB
        # This ensures nodes exist BEFORE any relations are created, preventing race conditions
        await update_progress("Pre-creating schema entity nodes...")
        entity_types = await self.graph_db.get_all_entity_types()
        await self._create_schema_nodes(entity_types)
        await update_progress(f"Created {len(entity_types)} schema entity nodes")
        
        # Step 1: Get all entity types for type-aware batching
        await update_progress(f"Found {len(entity_types)} entity types to process")
        
        # Get total entity count for progress reporting
        total_entities = await self.graph_db.get_entity_count()
        total_batches = (total_entities + self.entity_batch_size - 1) // self.entity_batch_size
        
        # Step 2: Process entities with type-aware batching
        # Fetch type-by-type to create more homogeneous batches, reducing BM25 search calls
        batch_num = 0
        type_idx = 0
        current_type_offset = 0
        current_batch = []
        
        while type_idx < len(entity_types):
            current_type = entity_types[type_idx]
            
            # Calculate remaining capacity in current batch
            remaining_capacity = self.entity_batch_size - len(current_batch)
            
            if remaining_capacity <= 0:
                # Batch is full, process it
                batch_num += 1
                await update_progress(f"Batch [{batch_num}/{total_batches}]: Processing {len(current_batch)} entities")
                
                # Process entities in pipeline mode
                await self._process_entities_pipeline(current_batch, batch_num, total_batches, update_progress)
                
                self.stats["entities_processed"] += len(current_batch)
                current_batch = []
                continue
            
            # Fetch entities of current type to fill remaining capacity
            entities = await self.graph_db.fetch_entities_batch(
                offset=current_type_offset,
                limit=remaining_capacity,
                entity_type=current_type
            )
            
            if not entities:
                # This type is exhausted, move to next type
                self.logger.debug(f"Type '{current_type}' exhausted at offset {current_type_offset}, moving to next type")
                type_idx += 1
                current_type_offset = 0
                continue
            
            # Add fetched entities to current batch
            current_batch.extend(entities)
            current_type_offset += len(entities)
            
            self.logger.debug(f"Added {len(entities)} {current_type} entities to batch (batch size: {len(current_batch)}/{self.entity_batch_size})")
        
        # Process any remaining entities in the last batch
        if current_batch:
            batch_num += 1
            await update_progress(f"Batch [{batch_num}/{total_batches}]: Processing {len(current_batch)} entities (final batch)")
            await self._process_entities_pipeline(current_batch, batch_num, total_batches, update_progress)
            self.stats["entities_processed"] += len(current_batch)
        
        await update_progress("No more entities to process")
        
        # Log final statistics
        self.logger.info(f"Heuristics processing complete. Stats: {self.stats}")
        
        # Invoke garbage collection to free up memory
        await update_progress("Invoking garbage collection to free memory...")
        gc.collect()
        await update_progress("Garbage collection complete")
    
    async def _create_schema_nodes(self, entity_types: List[str]):
        """
        Pre-create all schema entity nodes in ontology DB.
        This prevents race conditions where relations are created before schema nodes exist.
        """
        self.logger.info(f"Pre-creating {len(entity_types)} schema entity nodes")
        
        entities = []
        for entity_type in entity_types:
            entity = Entity(
                entity_type=entity_type,
                primary_key_properties=[ENTITY_TYPE_KEY, ONTOLOGY_VERSION_ID_KEY],
                all_properties={
                    ENTITY_TYPE_KEY: entity_type,
                    ONTOLOGY_VERSION_ID_KEY: self.rc_manager.ontology_version_id
                }
            )
            entities.append(entity)
        
        # Batch create all schema nodes using MERGE (idempotent)
        if entities:
            await self.rc_manager.ontology_graph_db.update_entity_batch(entities, batch_size=1000)
            self.logger.info(f"Successfully created {len(entities)} schema entity nodes")
    
    async def _process_entities_pipeline(self, entities: List[Entity], batch_num: int, total_batches: int, update_progress):
        """
        Pipeline approach with BM25 search: Build all search queries, filter with bloom, execute searches, then process results.
        
        Steps:
        1. Build all search queries from all entities/properties
        2. Filter property values using bloom filter
        3. Execute searches using BM25 index
        4. Process results sequentially (deep match + heuristic updates)
        """
        
        if not self.search_engine:
            raise RuntimeError("BM25 search engine not initialized")
        
        # Create local ontology cache for this batch
        ontology_cache = OntologyCache()
        
        # Track all heuristic updates (both regular and sub-entity)
        heuristic_updates = []
        
        # Step 1: Build all search queries and filter with bloom filter
        search_tasks: List[SearchTask] = []
        logger = utils.get_logger("heuristics_pipeline")
        for entity in entities:

            # Generate primary key once at the start of the loop
            entity_pk = entity.generate_primary_key()
            
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug("Processing Entity %s (%s)", entity.entity_type, entity_pk)
            
            # Skip default data label
            if entity.entity_type == DEFAULT_DATA_LABEL:
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug("Entity type=%s is the default entity type, skipping processing.", entity.entity_type)
                continue
            
            # Cache entity types (local to this batch)
            ontology_cache.add_entity(entity)
            
            # Handle sub-entity relations - these are automatically generated during ingestion and auto-accepted
            if entity.additional_labels and SUB_ENTITY_LABEL in entity.additional_labels:
                # Get parent info
                parent_entity_type = entity.all_properties.get(PARENT_ENTITY_TYPE_KEY)
                
                if parent_entity_type:
                    # Create property mappings for relation_id generation
                    property_mappings = [
                        PropertyMapping(
                            entity_a_property=PARENT_ENTITY_PK_KEY,
                            entity_b_idkey_property=PRIMARY_ID_KEY,
                            match_type=ValueMatchType.EXACT,
                            value_match_quality=1.0  # Structural relations are always exact
                        )
                    ]
                    
                    relation_id = self.rc_manager.generate_relation_id(
                        entity.entity_type,
                        parent_entity_type,
                        property_mappings
                    )
                    if logger.isEnabledFor(logging.DEBUG):  
                        logger.debug(f"Sub-entity relation: {entity.entity_type} -> {parent_entity_type} with relation id {relation_id}")
                    
                    # Create a DeepPropertyMatch for this structural relation
                    sub_entity_match = DeepPropertyMatch(
                        search_entity_type=entity.entity_type,
                        search_entity_pk=entity_pk,
                        search_entity_property=PARENT_ENTITY_PK_KEY,
                        search_entity_property_value=entity.all_properties.get(PARENT_ENTITY_PK_KEY, ""),
                        matched_entity_type=parent_entity_type,
                        matched_entity_pk=entity.all_properties.get(PARENT_ENTITY_PK_KEY, ""),
                        matched_entity_idkey={PRIMARY_ID_KEY: entity.all_properties.get(PARENT_ENTITY_PK_KEY, "")},
                        matched_entity_idkey_property=PRIMARY_ID_KEY,
                        matching_properties=property_mappings,
                        bm25_score=0.0,  # Not from BM25 search
                        deep_match_quality=100.0,  # High quality - structural relation
                        relation_id=relation_id
                    )
                    heuristic_updates.append(sub_entity_match)
            
            # Build search queries for each property
            for property_name, prop_value_raw in entity.all_properties.items():
                # Skip internal properties and empty values
                if property_name.startswith("_") or not prop_value_raw:
                    continue
                
                # Handle list/set values
                prop_values = prop_value_raw if isinstance(prop_value_raw, (list, set)) else [prop_value_raw]
                
                # Get id_key once per property
                entity_property_id_key = self._get_id_key_for_property(entity, property_name)
                
                for prop_value in prop_values:
                    # Check bloom filter for main property value
                    if not self.search_engine.contains(str(prop_value)):
                        self.stats["fuzzy_searches_filtered"] += 1
                        continue
                    
                    # Build search query with tokenization (same as indexing)
                    # For non-id_key properties, filter out context values that don't exist in bloom filter
                    query_tokens = self._build_search_query(
                        entity, 
                        property_name, 
                        prop_value, 
                        entity_property_id_key,
                        bloom_filter_check=True  # Enable bloom filtering for context values
                    )
                    
                    search_tasks.append(SearchTask(
                        entity=entity,
                        property_name=property_name,
                        property_value=prop_value,
                        query_tokens=query_tokens,
                        entity_property_id_key=entity_property_id_key
                    ))
        
        self.stats["fuzzy_searches"] = len(search_tasks)
        await update_progress(f"Batch [{batch_num}/{total_batches}]: Fuzzy searching {len(search_tasks)} queries")
        
        # Step 2: Execute searches using BM25 (batch with weight masking)
        # Prepare batch - query tokens (pre-tokenized) and exclude types
        query_tokens_list = [task.query_tokens for task in search_tasks]
        exclude_types = [task.entity.entity_type for task in search_tasks]
        
        # Execute batch search (queries grouped by exclude type internally)
        # With diversity mode enabled for better coverage across entity types
        all_results = await self.search_engine.search_batch(
            query_tokens_list=query_tokens_list,
            exclude_entity_types=exclude_types,
            diversity_mode=True,           # Enable diversity re-ranking
            diversity_penalty=0.3,         # Penalty factor (higher = more diversity)
            max_entities_per_type=10,      # Hard cap: max 10 entities per type
            final_k=50                     # Final number of results per query
        )
        
        await update_progress(f"Batch [{batch_num}/{total_batches}]: Deep matching {len(search_tasks)} queries")
        
        # Step 3: Process results sequentially and collect heuristic updates (continue using list from Step 1)
        
        # Iterate over each query result and its matches
        for task, matches in zip(search_tasks, all_results):
            # Cache entity primary key to avoid repeated generation
            task_entity_pk = task.entity.generate_primary_key()
            logger = utils.get_logger("heuristics")
            
            # Log search context with query and results grouped together  (if debug is enabled)
            if logger.isEnabledFor(logging.DEBUG):
                log_lines = ["\n"]
                log_lines.append("=" * 80)
                log_lines.append(f"[SEARCH] {task.entity.entity_type}.{task.property_name}")
                log_lines.append(f"[SEARCH] Entity Type: {task.entity.entity_type}")
                log_lines.append(f"[SEARCH] Entity PK: {task_entity_pk}")
                log_lines.append(f"[SEARCH] Property: {task.property_name}")
                log_lines.append(f"[SEARCH] Value: {task.property_value}")
                log_lines.append(f"[SEARCH] Query Tokens: {task.query_tokens}")
                log_lines.append(f"[SEARCH] Results: {len(matches)} matches")
                
                if matches:
                    for i, (match_dict, score) in enumerate(matches):
                        match_type = match_dict.get(ENTITY_TYPE_KEY, "Unknown")
                        match_pk = match_dict.get(PRIMARY_ID_KEY, "Unknown")
                        log_lines.append(f"  [{i+1}] {match_type}:{match_pk} (score: {score:.2f})")
                else:
                    log_lines.append("  (no matches)")
                
                log_lines.append("=" * 80)
                logger.debug("\n".join(log_lines))
            
            if not matches:
                continue
            
            # Do deep property matching for each set of matches
            deep_matches = self.deep_property_match(
                task.entity,
                task.property_name,
                task.property_value,
                matches,
                logger
            )
            
            if not deep_matches:
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug(f"[SEARCH] No deep property matches found for {task.entity.entity_type}.{task.property_name}")
                continue
            
            self.stats["deep_matches"] += len(deep_matches)
            
            # Track deep matches for logging
            if logger.isEnabledFor(logging.DEBUG):
                logged_matches = []
            
            # Collect heuristic updates for batch processing
            for dm in deep_matches:
                
                if not dm.matching_properties:
                    logger.warning("No property mappings found for entity %s (%s) and matched entity %s (%s).", 
                                 task.entity.entity_type, task_entity_pk, 
                                 dm.matched_entity_type, dm.matched_entity_pk)
                    continue
                
                relation_id = self.rc_manager.generate_relation_id(
                    task.entity.entity_type,
                    dm.matched_entity_type,
                    dm.matching_properties
                )
                
                if logger.isEnabledFor(logging.DEBUG):
                    # Track this match for logging
                    logged_matches.append(dm)
                
                # Set relation_id for batch update
                dm.relation_id = relation_id
                heuristic_updates.append(dm)
                
                self.stats["relations_created"] += 1
            
            # Log deep matches formatted string (if debug is enabled)
            if logger.isEnabledFor(logging.DEBUG) and logged_matches:
                log_lines = ["\n"]
                log_lines.append("=" * 80)
                log_lines.append(f"[DEEP MATCHES] {task.entity.entity_type}.{task.property_name}")
                log_lines.append(f"[DEEP MATCHES] Entity Type: {task.entity.entity_type}")
                log_lines.append(f"[DEEP MATCHES] Entity PK: {task_entity_pk}")
                log_lines.append(f"[DEEP MATCHES] Property: {task.property_name}")
                log_lines.append(f"[DEEP MATCHES] Value: {task.property_value}")
                log_lines.append(f"[DEEP MATCHES] Results: {len(logged_matches)} deep matches")
                
                for i, dm in enumerate(logged_matches):
                    # Build mappings string with match type and quality
                    mappings_details = []
                    for pm in dm.matching_properties:
                        mappings_details.append(
                            f"{pm.entity_a_property}←→{pm.entity_b_idkey_property}[{pm.match_type},q={pm.value_match_quality:.2f}]"
                        )
                    mappings_str = ", ".join(mappings_details)
                    
                    log_lines.append(f"  [{i+1}] {dm.matched_entity_type}:{dm.matched_entity_pk}")
                    log_lines.append(f"      BM25: {dm.bm25_score:.2f}, Deep Quality: {dm.deep_match_quality:.2f}")
                    log_lines.append(f"      Mappings: {mappings_str}")
                
                log_lines.append("=" * 80)
                logger.debug("\n".join(log_lines))
        
        # Step 4: Update Graph Database
        if heuristic_updates:
            await update_progress(f"Batch [{batch_num}/{total_batches}]: Updating Graph Database with {len(heuristic_updates)} relations")
        
        # Step 4a: Flush ontology cache to Graph Database
        await ontology_cache.flush(
            self.rc_manager.ontology_graph_db,
            self.rc_manager.ontology_version_id,
        )

        # Step 4b: Batch update all heuristics
        if heuristic_updates:
            try:
                await self.rc_manager.update_heuristics_batch(heuristic_updates)
            except Exception as e:
                self.logger.error(f"Error in batch heuristic update: {e}", exc_info=True)
    
    def _get_id_key_for_property(self, entity: Entity, property_name: str) -> List[str] | None:
        """Check if a property is part of an identity key."""
        if entity.additional_key_properties is None:
            entity.additional_key_properties = []
        
        for id_key in entity.additional_key_properties + [entity.primary_key_properties]:
            if property_name in id_key:
                return id_key
        
        return None
    
    def _build_search_query(
        self,
        entity: Entity,
        property_name: str,
        property_value: str,
        entity_property_id_key: List[str] | None,
        bloom_filter_check: bool = False
    ) -> List[str]:
        """
        Build an efficient search query with tokens.
        
        Strategy:
        - Include BOTH original value (lowercased) AND tokenized version for each property
        - Repeat property value 3x for boosting (most important signal)
        - Repeat property name 2x for boosting (important signal)
        - Include identity key properties OR all entity properties
        - Optionally filter out property values that don't exist in bloom filter
        
        Returns:
            List of tokens (includes both original and tokenized values, all lowercased) for use in BM25
        """
        tokens = []
        
        if self.search_engine is None:
            raise RuntimeError("BM25 search engine not initialized")

        # 1. Boost the property value by including original + tokenized, repeated 3 times
        prop_value_str = str(property_value)
        prop_value_tokens = tokenize_value(prop_value_str)
        for _ in range(3):
            tokens.append(prop_value_str.lower())  # Original value (lowercased)
            tokens.extend([t.lower() for t in prop_value_tokens])  # Tokenized version (lowercased)
        
        # 2. Boost the property name (original + tokenized), repeated 2 times
        prop_name_str = str(property_name)
        prop_name_tokens = tokenize_value(prop_name_str)
        for _ in range(2):
            tokens.append(prop_name_str.lower())  # Original (lowercased)
            tokens.extend([t.lower() for t in prop_name_tokens])  # Tokenized (lowercased)
        
        # 3. Include context based on whether property is an identity key
        if entity_property_id_key:
            # Property is an identity key: include ONLY identity key properties
            # (These are guaranteed to exist, no bloom filter check needed)
            for id_key_prop in entity_property_id_key:
                val = entity.all_properties.get(id_key_prop)
                if val and str(val) != str(property_value):  # Don't duplicate
                    val_str = str(val)
                    val_tokens = tokenize_value(val_str)
                    tokens.append(val_str.lower())  # Original (lowercased)
                    tokens.extend([t.lower() for t in val_tokens])  # Tokenized (lowercased)
        else:
            # Property is NOT an identity key: include ALL entity properties
            for prop_name, val in entity.all_properties.items():
                if not prop_name.startswith("_") and val and str(val) != str(property_value):  # Skip internal & duplicates
                    # If bloom filter check is enabled, only include values that exist
                    if bloom_filter_check:
                        if self.search_engine.contains(str(val)):
                            val_str = str(val)
                            val_tokens = tokenize_value(val_str)
                            tokens.append(val_str.lower())  # Original (lowercased)
                            tokens.extend([t.lower() for t in val_tokens])  # Tokenized (lowercased)
                        # else: omit this value from query (doesn't exist in corpus)
                    else:
                        val_str = str(val)
                        val_tokens = tokenize_value(val_str)
                        tokens.append(val_str.lower())  # Original (lowercased)
                        tokens.extend([t.lower() for t in val_tokens])  # Tokenized (lowercased)
        
        return tokens
    
    # =========================================================================
    # Helper Methods
    # =========================================================================
    
    def get_identity_keys_from_dict(self, entity_dict: Dict[str, Any], entity_property_value: str) -> List[dict]:
        """
        Reconstruct identity keys from a raw entity dictionary.
        
        Args:
            entity_dict: Raw entity dict with ALL_IDS_KEY, ALL_IDS_PROPS_KEY
            entity_property_value: The property value to filter by
            
        Returns:
            List of identity key dictionaries
        """
        all_ids = entity_dict.get(ALL_IDS_KEY, [])
        all_ids_props = entity_dict.get(ALL_IDS_PROPS_KEY, [])
        
        if not all_ids_props or not all_ids:
            return []
        
        identity_keys = []
        value_idx = 0  # Track position in all_ids
        
        # Reconstruct each identity key from the stored data
        for id_props_str in all_ids_props:
            # Split the property names (e.g., "name|||region" -> ["name", "region"])
            prop_names = id_props_str.split(PROP_DELIMITER)
            
            # Build the identity key dictionary
            id_key = {}
            for prop_name in prop_names:
                if value_idx < len(all_ids):
                    id_key[prop_name] = all_ids[value_idx]
                    value_idx += 1
            
            if id_key:
                identity_keys.append(id_key)
        
        return identity_keys
    
    def get_identity_keys(self, entity: Entity, entity_property_value: str) -> List[dict]:
        """
        Returns list of dictionaries with the identity keys of the entity.
        """
        keys = [entity.primary_key_properties] + (entity.additional_key_properties or [])
        dicts = [{k: entity.all_properties[k] for k in key} for key in keys]
        if entity_property_value == "":
            return dicts
        dicts = [d for d in dicts if entity_property_value in d.values()]
        return dicts
    
    def is_matching(self, search_entity_value: Any, matched_entity_value: Any) -> MatchResult:
        """
        Check if two values match with support for different match types.
        Returns MatchResult with match type and quality score.
        """
        # Check for empty or null values
        if not search_entity_value or not matched_entity_value:
            return MatchResult(False, ValueMatchType.NONE, 0.0)
        
        # Exact match
        if search_entity_value == matched_entity_value:
            return MatchResult(True, ValueMatchType.EXACT, 1.0)
        
        # String matching
        if isinstance(search_entity_value, str) and isinstance(matched_entity_value, str):
            search_value_lower = search_entity_value.lower()
            matched_value_lower = matched_entity_value.lower()
            
            # Only match if search_entity_value is longer or equal to matched_entity_value
            # If matched_entity_value is larger, it's not a match
            if len(search_value_lower) >= len(matched_value_lower):
                # Prefix: search_entity_value should start with matched_entity_value
                if search_value_lower.startswith(matched_value_lower):
                    return MatchResult(True, ValueMatchType.PREFIX, 0.8)
                
                # Suffix: search_entity_value should end with matched_entity_value
                if search_value_lower.endswith(matched_value_lower):
                    return MatchResult(True, ValueMatchType.SUFFIX, 0.7)
            
            # Infix matching - disabled because it's too noisy
            # if matched_value_lower in search_value_lower:
            #     return MatchResult(True, ValueMatchType.INFIX, 0.5)
        
        # Array/set matching
        is_search_iterable = isinstance(search_entity_value, (list, set, frozenset))
        is_matched_iterable = isinstance(matched_entity_value, (list, set, frozenset))
        
        if is_search_iterable and is_matched_iterable:
            a = set(search_entity_value)
            b = set(matched_entity_value)
            if a == b:
                return MatchResult(True, ValueMatchType.EXACT, 1.0)
            elif a.issubset(b):
                return MatchResult(True, ValueMatchType.SUBSET, 0.9)
            elif b.issubset(a):
                return MatchResult(True, ValueMatchType.SUPERSET, 0.9)
        elif is_search_iterable:
            if matched_entity_value in search_entity_value:
                return MatchResult(True, ValueMatchType.CONTAINS, 0.85)
        elif is_matched_iterable:
            if search_entity_value in matched_entity_value:
                return MatchResult(True, ValueMatchType.CONTAINS, 0.85)
        
        return MatchResult(False, ValueMatchType.NONE, 0.0)
    
    def calculate_deep_match_quality(
        self,
        bm25_score: float,
        property_mappings: List[PropertyMapping],
        identity_key: dict[str, Any],
        num_valid_mappings: int
    ) -> float:
        """
        Calculate deep match quality using multiplicative strategy.
        
        Scoring components:
        1. Uniqueness multiplier (based on number of valid mappings)
        2. Identity key simplicity bonus
        3. Match type quality (average from PropertyMappings)
        
        Formula: (base_score × uniqueness × avg_value_match_quality) + simplicity
        """
        # 1. Mapping uniqueness multiplier (priority!)
        if num_valid_mappings == 1:
            uniqueness_multiplier = 2.0  # Unambiguous - big boost
        elif num_valid_mappings == 2:
            uniqueness_multiplier = 1.2  # Slight ambiguity
        elif num_valid_mappings == 3:
            uniqueness_multiplier = 1.0  # Neutral
        else:
            uniqueness_multiplier = 0.7  # Too many options - penalty
        
        # 2. Identity key simplicity bonus (simpler keys = stronger signal)
        simplicity_bonus = max(0, 5 - len(identity_key))
        
        # 3. Match type quality (average from all mappings)
        avg_value_match_quality = sum(pm.value_match_quality for pm in property_mappings) / len(property_mappings)
        
        # Multiplicative combination with additive bonus
        score = (bm25_score * uniqueness_multiplier * avg_value_match_quality) + simplicity_bonus
        
        return score
    
    def deep_property_match(
        self,
        entity: Entity,
        entity_property: str,
        entity_property_value: str,
        matches: List[Tuple[Dict[str, Any], float]],
        logger: logging.Logger
    ) -> List[DeepPropertyMatch]:
        """
        Perform deep property matching on search results (from dictionaries).
        
        Only uses:
        - ALL properties of the searching entity (already have as Entity object)
        - ONLY identity keys/values of the matches (reconstructed from dictionary)

        """
        # Calculate primary key once at the start (optimization)
        search_entity_pk = entity.generate_primary_key()
        
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"🔍 Starting deep_property_match for {entity.entity_type}:{search_entity_pk}")
        
        deep_matches = []
        
        for idx, (matched_dict, score) in enumerate(matches):
            if not matched_dict:
                continue
            
            matched_entity_type = matched_dict.get(ENTITY_TYPE_KEY)
            
            if not matched_entity_type:
                continue
            
            # Skip same-type matches (not supported yet)
            if matched_entity_type == entity.entity_type:
                continue
            
            # Must have primary key to create valid matches
            matched_entity_pk = matched_dict.get(PRIMARY_ID_KEY)
            if not matched_entity_pk:
                logger.warning(f"Skipping match: {matched_entity_type} has no primary key")
                continue
            
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug(f"   Match {idx+1}: {matched_entity_type}:{matched_entity_pk} (score={score:.2f})")
            
            # Get identity keys from the dictionary
            matched_entity_identity_keys = self.get_identity_keys_from_dict(matched_dict, entity_property_value)
            
            # Go through each identity key, and find the key that matches the reference 
            for idkey_idx, identity_key in enumerate(matched_entity_identity_keys):
                # Find matching property in identity key using flexible matching
                matched_entity_idkey_property = next(
                    (k for k, v in identity_key.items() 
                     if self.is_matching(entity_property_value, v).is_match),
                    None
                )
                
                if not matched_entity_idkey_property:
                    continue
                
                # Find matching properties
                entity_prop_dict = {
                    k: entity.all_properties[k]
                    for k in entity.all_properties
                    if not k.startswith("_")
                }
                
                # MATCHING STRATEGY: 
                # - Main property (matched_entity_idkey_property): Uses FLEXIBLE matching (EXACT, PREFIX, SUFFIX, etc.)
                # - Supporting properties: Require EXACT matches only
                # 
                # To change this behavior, modify the flexible_match_keys parameter:
                #   - flexible_match_keys={matched_entity_idkey_property} = Main property uses flexible, others exact (CURRENT)
                #   - flexible_match_keys=None = All properties use flexible matching
                #   - flexible_match_keys=set() = All properties require exact matching
                match_prop_mappings = self.find_matching_key_mappings(
                    identity_key,
                    entity_prop_dict,
                    {matched_entity_idkey_property: entity_property},
                    logger,
                    flexible_match_keys={matched_entity_idkey_property}  # Only main property gets flexible matching
                )
                
                if logger.isEnabledFor(logging.DEBUG):
                    if len(match_prop_mappings) > 0:
                        logger.debug(f"      ✓ {len(match_prop_mappings)} valid mappings for {matched_entity_type}:{matched_entity_pk}")
                    else:
                        logger.debug(f"      ✗ No valid mappings found for {matched_entity_type}:{matched_entity_pk}")
                
                # Create DeepPropertyMatch objects
                # Store entity type and PK directly instead of creating Entity object
                for _, (mapping_dict, match_metadata) in enumerate(match_prop_mappings):
                    # Create PropertyMapping with match type and quality
                    property_mappings = [
                        PropertyMapping(
                            entity_a_property=entity_prop,
                            entity_b_idkey_property=idkey_prop,
                            match_type=match_metadata[idkey_prop].match_type,
                            value_match_quality=match_metadata[idkey_prop].quality
                        )
                        for idkey_prop, entity_prop in mapping_dict.items()
                    ]
                    
                    # Log match types for debugging
                    if logger.isEnabledFor(logging.DEBUG):
                        for pm in property_mappings:
                            logger.debug(f"         {pm.entity_b_idkey_property} -> {pm.entity_a_property} [{pm.match_type}, q={pm.value_match_quality:.2f}]")
                    
                    # Calculate deep match score using scoring strategy
                    deep_match_quality = self.calculate_deep_match_quality(
                        bm25_score=float(score),
                        property_mappings=property_mappings,
                        identity_key=identity_key,
                        num_valid_mappings=len(match_prop_mappings)
                    )
                    
                    deep_match = DeepPropertyMatch(
                        search_entity_type=entity.entity_type,
                        search_entity_pk=search_entity_pk,
                        search_entity_property=entity_property,
                        search_entity_property_value=entity_property_value,
                        matched_entity_type=matched_entity_type,
                        matched_entity_pk=str(matched_entity_pk),
                        matched_entity_idkey=identity_key,
                        matched_entity_idkey_property=matched_entity_idkey_property,
                        matching_properties=property_mappings,
                        bm25_score=float(score),
                        deep_match_quality=deep_match_quality
                    )
                    deep_matches.append(deep_match)
        
        # Sort by deep_match_quality (descending)
        deep_matches.sort(key=lambda x: x.deep_match_quality, reverse=True)
        
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f" 🔍 Found {len(deep_matches)} Deep matches:")
            for dm in deep_matches:
                logger.debug(f"  {dm.matched_entity_type}:{dm.matched_entity_pk} (quality={dm.deep_match_quality:.2f})")
                logger.debug(f"    BM25: {dm.bm25_score:.2f}, Deep Quality: {dm.deep_match_quality:.2f}")
                logger.debug(f"    Mappings: {dm.matching_properties}")

        # Filter to top-scoring matches only if enabled
        if self.top_score_matches_only and deep_matches:
            top_score = deep_matches[0].deep_match_quality
            # Keep all matches that have the same top score
            deep_matches = [dm for dm in deep_matches if dm.deep_match_quality == top_score]
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug(f"Top_score_matches_only enabled: Returning {len(deep_matches)} match(es) with top score {top_score:.2f}")
                for dm in deep_matches:
                    logger.debug(f"  {dm.matched_entity_type}:{dm.matched_entity_pk} (quality={dm.deep_match_quality:.2f})")
        
        return deep_matches
    
    def find_matching_key_mappings(
        self,
        reference_dict: dict[str, Any],
        target_dict: dict[str, Any],
        must_have_mapping: dict[str, str],
        logger: logging.Logger,
        flexible_match_keys: set[str] | None = None
    ) -> List[Tuple[dict[str, Any], dict[str, MatchResult]]]:
        """
        Find all possible key mappings between reference and target dicts.
        Returns list of tuples: (mapping_dict, match_metadata_dict)
        
        Args:
            reference_dict: The reference dictionary (identity key from matched entity)
            target_dict: The target dictionary (properties from search entity)
            must_have_mapping: Required mappings that must be present
            logger: Logger instance
            flexible_match_keys: Set of reference keys that can use flexible matching (EXACT, PREFIX, SUFFIX, etc.).
                               Keys NOT in this set will ONLY match with EXACT matches.
                               If None, all keys use flexible matching (backward compatible).
                               
        MATCHING CONFIGURATION:
        - To allow flexible matching on ALL properties: pass flexible_match_keys=None
        - To allow flexible matching ONLY on main property: pass flexible_match_keys={main_property_key}
        - To require EXACT matching on ALL properties: pass flexible_match_keys=set()
        
        EXAMPLES:
        
        Example 1: Main property uses flexible, supporting properties use exact (RECOMMENDED)
        ```
        reference_dict = {"id": "123", "region": "us-east"}
        target_dict = {"user_id": "user-123", "region": "us-east", "name": "Alice"}
        must_have_mapping = {"id": "user_id"}
        flexible_match_keys = {"id"}  # Only "id" can use flexible matching
        
        Result: MATCH
        - "id" -> "user_id": PREFIX match ("123" is prefix of "user-123") ✓ ALLOWED (flexible)
        - "region" -> "region": EXACT match ("us-east" == "us-east") ✓ ALLOWED (exact)
        ```
        
        Example 2: Supporting property fails due to non-exact match
        ```
        reference_dict = {"id": "123", "region": "us-east"}
        target_dict = {"user_id": "user-123", "region": "us-east-1", "name": "Alice"}
        must_have_mapping = {"id": "user_id"}
        flexible_match_keys = {"id"}
        
        Result: NO MATCH
        - "id" -> "user_id": PREFIX match ✓ ALLOWED (flexible)
        - "region" -> "region": PREFIX match ("us-east" is prefix of "us-east-1") ✗ REJECTED (not exact)
        ```
        
        Example 3: All properties use flexible matching (backward compatible)
        ```
        reference_dict = {"id": "123", "region": "us-east"}
        target_dict = {"user_id": "user-123", "region": "us-east-1", "name": "Alice"}
        must_have_mapping = {"id": "user_id"}
        flexible_match_keys = None  # All properties can use flexible matching
        
        Result: MATCH
        - "id" -> "user_id": PREFIX match ✓ ALLOWED (flexible)
        - "region" -> "region": PREFIX match ✓ ALLOWED (flexible)
        ```
        """
        # Find all matching keys with their match results
        matching_keys: List[Tuple[Any, Any, MatchResult]] = []
        for ref_key, ref_val in reference_dict.items():
            for target_key, target_val in target_dict.items():
                # Determine if this key can use flexible matching
                use_flexible_matching = (flexible_match_keys is None) or (ref_key in flexible_match_keys)
                
                if use_flexible_matching:
                    # Allow EXACT, PREFIX, SUFFIX, SUBSET, SUPERSET, CONTAINS matching
                    match_result = self.is_matching(target_val, ref_val)
                else:
                    # Require EXACT match only for supporting/contextual properties
                    match_result = self.is_matching(target_val, ref_val)
                    if match_result.is_match and match_result.match_type != ValueMatchType.EXACT:
                        # Reject non-exact matches for supporting properties
                        match_result = MatchResult(False, ValueMatchType.NONE, 0.0)
                
                if match_result.is_match:
                    matching_keys.append((ref_key, target_key, match_result))
                    if logger.isEnabledFor(logging.DEBUG):
                        match_mode = "FLEXIBLE" if use_flexible_matching else "EXACT_ONLY"
                        logger.debug(f"            Match [{match_mode}]: {ref_key}={ref_val} <-> {target_key}={target_val} [{match_result.match_type}, q={match_result.quality:.2f}]")
        
        if not matching_keys:
            return []
        
        # Generate all combinations
        key_pairs = [(ref_key, target_key) for ref_key, target_key, _ in matching_keys]
        combos = combinations(enumerate(key_pairs), len(reference_dict))
        result = []
        
        for combo_idx, combo in enumerate(combos):
            # Extract indices and pairs
            indices_and_pairs = list(combo)
            result_dict = dict(pair for _, pair in indices_and_pairs)
            
            # Check if all reference keys are covered
            if set(result_dict.keys()) != set(reference_dict.keys()):
                continue
            
            # Check must-have mapping
            valid = True
            for must_have_key, must_have_value in must_have_mapping.items():
                if must_have_key not in result_dict or result_dict[must_have_key] != must_have_value:
                    valid = False
                    break
            
            if valid:
                # Build match metadata dict
                match_metadata = {}
                for idx, pair in indices_and_pairs:
                    ref_key, target_key = pair
                    # Get the MatchResult from the original matching_keys
                    match_result = matching_keys[idx][2]
                    match_metadata[ref_key] = match_result
                
                result.append((result_dict, match_metadata))
        
        return result


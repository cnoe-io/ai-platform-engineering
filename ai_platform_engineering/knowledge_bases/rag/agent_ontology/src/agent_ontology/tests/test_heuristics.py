"""
Simple unit tests for heuristics.py
"""
import pytest
from unittest.mock import Mock
from agent_ontology.heuristics import (
    HeuristicsProcessor,
    MatchResult,
    SearchTask
)
from common.models.ontology import ValueMatchType
from common.models.graph import Entity


class TestMatchResult:
    """Test MatchResult dataclass"""
    
    def test_match_result_creation(self):
        """Test creating a MatchResult"""
        result = MatchResult(
            is_match=True,
            match_type=ValueMatchType.EXACT,
            quality=1.0
        )
        assert result.is_match is True
        assert result.match_type == ValueMatchType.EXACT
        assert result.quality == 1.0
    
    def test_match_result_no_match(self):
        """Test creating a no-match MatchResult"""
        result = MatchResult(
            is_match=False,
            match_type=ValueMatchType.NONE,
            quality=0.0
        )
        assert result.is_match is False
        assert result.match_type == ValueMatchType.NONE
        assert result.quality == 0.0


class TestSearchTask:
    """Test SearchTask dataclass"""
    
    def test_search_task_creation(self):
        """Test creating a SearchTask"""
        entity = Mock(spec=Entity)
        task = SearchTask(
            entity=entity,
            property_name="user_id",
            property_value="user-123",
            query_tokens=["user", "123"],
            entity_property_id_key=["user_id"]
        )
        assert task.entity == entity
        assert task.property_name == "user_id"
        assert task.property_value == "user-123"
        assert task.query_tokens == ["user", "123"]
        assert task.entity_property_id_key == ["user_id"]


class TestHeuristicsProcessorMatching:
    """Test matching functions in HeuristicsProcessor"""
    
    @pytest.fixture
    def processor(self):
        """Create a HeuristicsProcessor instance for testing"""
        graph_db = Mock()
        rc_manager = Mock()
        return HeuristicsProcessor(
            graph_db=graph_db,
            rc_manager=rc_manager
        )
    
    def test_is_matching_exact(self, processor):
        """Test exact matching"""
        result = processor.is_matching("hello", "hello")
        assert result.is_match is True
        assert result.match_type == ValueMatchType.EXACT
        assert result.quality == 1.0
    
    def test_is_matching_not_matching(self, processor):
        """Test non-matching values"""
        result = processor.is_matching("hello", "world")
        assert result.is_match is False
        assert result.match_type == ValueMatchType.NONE
        assert result.quality == 0.0
    
    def test_is_matching_empty_values(self, processor):
        """Test matching with empty values"""
        result = processor.is_matching("", "value")
        assert result.is_match is False
        
        result = processor.is_matching("value", "")
        assert result.is_match is False
        
        result = processor.is_matching("", "")
        assert result.is_match is False
    
    def test_is_matching_prefix(self, processor):
        """Test prefix matching"""
        result = processor.is_matching("hello-world", "hello")
        assert result.is_match is True
        assert result.match_type == ValueMatchType.PREFIX
        assert result.quality == 0.8
    
    def test_is_matching_prefix_case_insensitive(self, processor):
        """Test prefix matching is case insensitive"""
        result = processor.is_matching("Hello-World", "hello")
        assert result.is_match is True
        assert result.match_type == ValueMatchType.PREFIX
    
    def test_is_matching_suffix(self, processor):
        """Test suffix matching"""
        result = processor.is_matching("hello-world", "world")
        assert result.is_match is True
        assert result.match_type == ValueMatchType.SUFFIX
        assert result.quality == 0.7
    
    def test_is_matching_no_reverse_match(self, processor):
        """Test that shorter string doesn't match longer string"""
        # When search value is shorter than matched value, should not match
        result = processor.is_matching("hello", "hello-world")
        assert result.is_match is False
    
    def test_is_matching_list_exact(self, processor):
        """Test exact matching for lists"""
        result = processor.is_matching(["a", "b"], ["a", "b"])
        assert result.is_match is True
        assert result.match_type == ValueMatchType.EXACT
        assert result.quality == 1.0
    
    def test_is_matching_list_subset(self, processor):
        """Test subset matching for lists"""
        result = processor.is_matching(["a"], ["a", "b"])
        assert result.is_match is True
        assert result.match_type == ValueMatchType.SUBSET
        assert result.quality == 0.9
    
    def test_is_matching_list_superset(self, processor):
        """Test superset matching for lists"""
        result = processor.is_matching(["a", "b", "c"], ["a", "b"])
        assert result.is_match is True
        assert result.match_type == ValueMatchType.SUPERSET
        assert result.quality == 0.9
    
    def test_is_matching_contains_scalar_in_list(self, processor):
        """Test contains matching for scalar in list"""
        result = processor.is_matching(["a", "b", "c"], "b")
        assert result.is_match is True
        assert result.match_type == ValueMatchType.CONTAINS
        assert result.quality == 0.85
    
    def test_is_matching_contains_list_in_scalar(self, processor):
        """Test contains matching for list containing scalar"""
        result = processor.is_matching("b", ["a", "b", "c"])
        assert result.is_match is True
        assert result.match_type == ValueMatchType.CONTAINS
        assert result.quality == 0.85


class TestHeuristicsProcessorHelpers:
    """Test helper methods in HeuristicsProcessor"""
    
    @pytest.fixture
    def processor(self):
        """Create a HeuristicsProcessor instance for testing"""
        graph_db = Mock()
        rc_manager = Mock()
        return HeuristicsProcessor(
            graph_db=graph_db,
            rc_manager=rc_manager
        )
    
    def test_get_id_key_for_property_primary_key(self, processor):
        """Test getting id_key for primary key property"""
        entity = Mock(spec=Entity)
        entity.primary_key_properties = ["user_id", "region"]
        entity.additional_key_properties = []
        
        result = processor._get_id_key_for_property(entity, "user_id")
        assert result == ["user_id", "region"]
    
    def test_get_id_key_for_property_additional_key(self, processor):
        """Test getting id_key for additional key property"""
        entity = Mock(spec=Entity)
        entity.primary_key_properties = ["user_id"]
        entity.additional_key_properties = [["email"], ["phone"]]
        
        result = processor._get_id_key_for_property(entity, "email")
        assert result == ["email"]
    
    def test_get_id_key_for_property_not_found(self, processor):
        """Test getting id_key for non-key property"""
        entity = Mock(spec=Entity)
        entity.primary_key_properties = ["user_id"]
        entity.additional_key_properties = []
        
        result = processor._get_id_key_for_property(entity, "name")
        assert result is None
    
    def test_get_id_key_for_property_none_additional_keys(self, processor):
        """Test getting id_key when additional_key_properties is None"""
        entity = Mock(spec=Entity)
        entity.primary_key_properties = ["user_id"]
        entity.additional_key_properties = None
        
        result = processor._get_id_key_for_property(entity, "user_id")
        assert result == ["user_id"]
    
    def test_get_identity_keys(self, processor):
        """Test getting identity keys from entity"""
        entity = Mock(spec=Entity)
        entity.primary_key_properties = ["user_id"]
        entity.additional_key_properties = [["email"]]
        entity.all_properties = {
            "user_id": "user-123",
            "email": "test@example.com",
            "name": "Test User"
        }
        
        result = processor.get_identity_keys(entity, "user-123")
        assert len(result) == 1
        assert result[0] == {"user_id": "user-123"}
    
    def test_get_identity_keys_all(self, processor):
        """Test getting all identity keys when no filter value"""
        entity = Mock(spec=Entity)
        entity.primary_key_properties = ["user_id"]
        entity.additional_key_properties = [["email"]]
        entity.all_properties = {
            "user_id": "user-123",
            "email": "test@example.com"
        }
        
        result = processor.get_identity_keys(entity, "")
        assert len(result) == 2
        assert {"user_id": "user-123"} in result
        assert {"email": "test@example.com"} in result
    
    def test_calculate_deep_match_quality_unique_mapping(self, processor):
        """Test deep match quality calculation for unique mapping"""
        from common.models.ontology import PropertyMapping
        
        property_mappings = [
            PropertyMapping(
                entity_a_property="user_id",
                entity_b_idkey_property="id",
                match_type=ValueMatchType.EXACT,
                value_match_quality=1.0
            )
        ]
        
        quality = processor.calculate_deep_match_quality(
            bm25_score=10.0,
            property_mappings=property_mappings,
            identity_key={"id": "123"},
            num_valid_mappings=1
        )
        
        # Should have high quality due to uniqueness multiplier (2.0)
        # Formula: (10.0 * 2.0 * 1.0) + simplicity_bonus
        # simplicity_bonus = max(0, 5 - 1) = 4
        assert quality == 24.0
    
    def test_calculate_deep_match_quality_ambiguous(self, processor):
        """Test deep match quality calculation for ambiguous mappings"""
        from common.models.ontology import PropertyMapping
        
        property_mappings = [
            PropertyMapping(
                entity_a_property="user_id",
                entity_b_idkey_property="id",
                match_type=ValueMatchType.PREFIX,
                value_match_quality=0.8
            )
        ]
        
        quality = processor.calculate_deep_match_quality(
            bm25_score=10.0,
            property_mappings=property_mappings,
            identity_key={"id": "123"},
            num_valid_mappings=5  # Many mappings = ambiguous
        )
        
        # Should have lower quality due to ambiguity penalty (0.7)
        # Formula: (10.0 * 0.7 * 0.8) + 4 = 5.6 + 4 = 9.6
        assert quality == pytest.approx(9.6)


class TestHeuristicsProcessorStatistics:
    """Test statistics tracking in HeuristicsProcessor"""
    
    def test_initial_stats(self):
        """Test initial statistics are set correctly"""
        graph_db = Mock()
        rc_manager = Mock()
        processor = HeuristicsProcessor(
            graph_db=graph_db,
            rc_manager=rc_manager
        )
        
        assert processor.stats["entities_processed"] == 0
        assert processor.stats["relations_created"] == 0
        assert processor.stats["fuzzy_searches"] == 0
        assert processor.stats["fuzzy_searches_filtered"] == 0
        assert processor.stats["deep_matches"] == 0
        assert processor.stats["relations_discarded"] == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


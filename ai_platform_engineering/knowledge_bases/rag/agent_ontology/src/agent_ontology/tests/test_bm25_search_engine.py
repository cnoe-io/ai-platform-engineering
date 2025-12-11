"""
Simple unit tests for bm25_search_engine.py
"""
import pytest
from agent_ontology.bm25_search_engine import (
    tokenize_value,
    tokenize_pascal_case,
    tokenize_record,
    tokenize_query,
    BM25SearchEngine
)


class TestTokenizationFunctions:
    """Test tokenization utility functions"""
    
    def test_tokenize_value_simple(self):
        """Test basic tokenization of values"""
        result = tokenize_value("hello-world")
        assert result == ["hello", "world"]
    
    def test_tokenize_value_with_numbers(self):
        """Test tokenization with numbers"""
        result = tokenize_value("user123-test456")
        assert result == ["user123", "test456"]
    
    def test_tokenize_value_special_chars(self):
        """Test tokenization filters special characters"""
        result = tokenize_value("hello@world.com")
        assert result == ["hello", "world", "com"]
    
    def test_tokenize_value_empty(self):
        """Test tokenization of empty string"""
        result = tokenize_value("")
        assert result == []
    
    def test_tokenize_pascal_case_simple(self):
        """Test PascalCase splitting"""
        result = tokenize_pascal_case("HelloWorld")
        assert result == ["Hello", "World"]
    
    def test_tokenize_pascal_case_camelcase(self):
        """Test camelCase splitting"""
        result = tokenize_pascal_case("helloWorld")
        assert result == ["hello", "World"]
    
    def test_tokenize_pascal_case_with_numbers(self):
        """Test PascalCase with numbers"""
        result = tokenize_pascal_case("User123Test")
        assert "User" in result
        assert "123" in result
        assert "Test" in result
    
    def test_tokenize_pascal_case_all_caps(self):
        """Test all caps handling"""
        result = tokenize_pascal_case("HTTPServer")
        assert len(result) >= 2  # Should split HTTP and Server
    
    def test_tokenize_query_simple(self):
        """Test query tokenization"""
        result = tokenize_query("hello world")
        assert "hello" in result
        assert "world" in result
    
    def test_tokenize_query_deduplication(self):
        """Test query tokenization removes duplicates"""
        result = tokenize_query("hello hello world")
        assert result.count("hello") == 1
    
    def test_tokenize_query_with_special_chars(self):
        """Test query tokenization with special characters"""
        result = tokenize_query("user-name@test.com")
        # Should have tokens from splitting
        assert "user" in result
        assert "name" in result
    
    def test_tokenize_record_with_entity_type(self):
        """Test record tokenization includes entity type"""
        result = tokenize_record(
            entity_pk="pk-123",
            entity_type="UserAccount",
            all_ids=["user-456", "test@email.com"]
        )
        # Should contain lowercased entity type
        assert "useraccount" in result
        # Should contain PascalCase splits
        assert "user" in result
        assert "account" in result
        # Should contain ID values
        assert any("456" in token for token in result)
    
    def test_tokenize_record_empty_ids(self):
        """Test record tokenization with empty IDs"""
        result = tokenize_record(
            entity_pk="pk-123",
            entity_type="User",
            all_ids=[]
        )
        # Should still have entity type
        assert "user" in result
    
    def test_tokenize_record_deduplication(self):
        """Test record tokenization removes duplicates"""
        result = tokenize_record(
            entity_pk="test",
            entity_type="Test",
            all_ids=["test", "test"]
        )
        # Should only have one instance of "test"
        assert result.count("test") == 1


class TestBM25SearchEngineHelpers:
    """Test helper methods of BM25SearchEngine"""
    
    def test_get_base_entity_type_simple(self):
        """Test base entity type extraction for regular entities"""
        result = BM25SearchEngine.get_base_entity_type("Pod")
        assert result == "Pod"
    
    def test_get_base_entity_type_sub_entity(self):
        """Test base entity type extraction for sub-entities"""
        result = BM25SearchEngine.get_base_entity_type("Pod_Container")
        assert result == "Pod"
    
    def test_get_base_entity_type_multiple_underscores(self):
        """Test base entity type with multiple underscores"""
        result = BM25SearchEngine.get_base_entity_type("Pod_Container_Volume")
        assert result == "Pod"
    
    def test_get_base_entity_type_empty(self):
        """Test base entity type extraction with empty string"""
        result = BM25SearchEngine.get_base_entity_type("")
        assert result == ""


class TestBM25SearchEngineBloomFilter:
    """Test bloom filter functionality (without database)"""
    
    def test_contains_without_bloom_filter(self):
        """Test contains returns True when bloom filter not initialized"""
        from unittest.mock import Mock
        
        engine = BM25SearchEngine(Mock(), index_batch_size=100)
        # Bloom filter not initialized
        assert engine.bloom_filter is None
        # Should return True (allow everything)
        assert engine.contains("any-value") is True
    
    def test_should_add_to_bloom_empty(self):
        """Test bloom filter rejects empty values"""
        from unittest.mock import Mock
        
        engine = BM25SearchEngine(Mock(), index_batch_size=100)
        assert engine._should_add_to_bloom("") is False
        assert engine._should_add_to_bloom(" ") is False
    
    def test_should_add_to_bloom_too_short(self):
        """Test bloom filter rejects very short values"""
        from unittest.mock import Mock
        
        engine = BM25SearchEngine(Mock(), index_batch_size=100)
        assert engine._should_add_to_bloom("a") is False
    
    def test_should_add_to_bloom_too_long(self):
        """Test bloom filter rejects very long values"""
        from unittest.mock import Mock
        
        engine = BM25SearchEngine(Mock(), index_batch_size=100)
        long_value = "a" * 1001
        assert engine._should_add_to_bloom(long_value) is False
    
    def test_should_add_to_bloom_valid(self):
        """Test bloom filter accepts valid values"""
        from unittest.mock import Mock
        
        engine = BM25SearchEngine(Mock(), index_batch_size=100)
        assert engine._should_add_to_bloom("valid-value") is True
        assert engine._should_add_to_bloom("user123") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])







"""
Tests for EmbeddingsFactory
"""
import os
import pytest
from unittest.mock import patch, MagicMock
from common.embeddings_factory import EmbeddingsFactory


class TestEmbeddingsFactory:
    """Test suite for EmbeddingsFactory"""
    
    def test_default_provider_azure_openai(self):
        """Test that default provider is azure-openai"""
        with patch.dict(os.environ, {}, clear=True):
            with patch('common.embeddings_factory.AzureOpenAIEmbeddings') as mock_azure:
                mock_instance = MagicMock()
                mock_azure.return_value = mock_instance
                
                result = EmbeddingsFactory.get_embeddings()
                
                mock_azure.assert_called_once_with(model='text-embedding-3-small')
                assert result == mock_instance
    
    def test_custom_model(self):
        """Test custom model configuration"""
        with patch.dict(os.environ, {
            'EMBEDDINGS_PROVIDER': 'azure-openai',
            'EMBEDDINGS_MODEL': 'text-embedding-3-large'
        }):
            with patch('common.embeddings_factory.AzureOpenAIEmbeddings') as mock_azure:
                mock_instance = MagicMock()
                mock_azure.return_value = mock_instance
                
                result = EmbeddingsFactory.get_embeddings()
                
                mock_azure.assert_called_once_with(model='text-embedding-3-large')
    
    def test_openai_provider(self):
        """Test OpenAI provider"""
        with patch.dict(os.environ, {
            'EMBEDDINGS_PROVIDER': 'openai',
            'OPENAI_API_KEY': 'test-key'
        }):
            with patch('common.embeddings_factory.OpenAIEmbeddings') as mock_openai:
                mock_instance = MagicMock()
                mock_openai.return_value = mock_instance
                
                result = EmbeddingsFactory.get_embeddings()
                
                mock_openai.assert_called_once()
                assert result == mock_instance
    
    def test_openai_missing_api_key(self):
        """Test OpenAI provider fails without API key"""
        with patch.dict(os.environ, {'EMBEDDINGS_PROVIDER': 'openai'}, clear=True):
            with pytest.raises(ValueError, match="OPENAI_API_KEY"):
                EmbeddingsFactory.get_embeddings()
    
    def test_bedrock_provider(self):
        """Test AWS Bedrock provider"""
        with patch.dict(os.environ, {
            'EMBEDDINGS_PROVIDER': 'aws-bedrock',
            'AWS_REGION': 'us-west-2'
        }):
            with patch('common.embeddings_factory.BedrockEmbeddings') as mock_bedrock:
                mock_instance = MagicMock()
                mock_bedrock.return_value = mock_instance
                
                result = EmbeddingsFactory.get_embeddings()
                
                mock_bedrock.assert_called_once_with(
                    model_id='amazon.titan-embed-text-v2:0',
                    region_name='us-west-2'
                )
                assert result == mock_instance
    
    def test_unsupported_provider(self):
        """Test unsupported provider raises error"""
        with patch.dict(os.environ, {'EMBEDDINGS_PROVIDER': 'invalid-provider'}):
            with pytest.raises(ValueError, match="Unsupported embeddings provider"):
                EmbeddingsFactory.get_embeddings()
    
    def test_get_embedding_dimensions(self):
        """Test embedding dimensions retrieval"""
        with patch.dict(os.environ, {
            'EMBEDDINGS_MODEL': 'text-embedding-3-small'
        }):
            dimensions = EmbeddingsFactory.get_embedding_dimensions()
            assert dimensions == 1536
        
        with patch.dict(os.environ, {
            'EMBEDDINGS_MODEL': 'text-embedding-3-large'
        }):
            dimensions = EmbeddingsFactory.get_embedding_dimensions()
            assert dimensions == 3072
        
        # Test unknown model returns default
        with patch.dict(os.environ, {
            'EMBEDDINGS_MODEL': 'unknown-model'
        }):
            dimensions = EmbeddingsFactory.get_embedding_dimensions()
            assert dimensions == 1536  # default


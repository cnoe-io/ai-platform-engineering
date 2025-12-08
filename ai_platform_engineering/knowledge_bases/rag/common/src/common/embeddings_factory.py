"""
Embeddings Factory for RAG System

This module provides a factory pattern for creating embedding models from various providers.
Follows the same pattern as LLMFactory for consistency.

Supported providers:
- azure-openai (default)
- openai
- aws-bedrock
- cohere
- huggingface (local)
- ollama (local)

All embedding provider packages are included in the Docker image.
"""

import os
from langchain_core.embeddings import Embeddings
from langchain_openai import AzureOpenAIEmbeddings, OpenAIEmbeddings
from langchain_aws import BedrockEmbeddings
from langchain_cohere import CohereEmbeddings
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_ollama import OllamaEmbeddings


class EmbeddingsFactory:
    """Factory for creating embedding models based on provider configuration."""

    @staticmethod
    def get_embeddings() -> Embeddings:
        """
        Get embeddings based on EMBEDDINGS_PROVIDER environment variable.

        Environment Variables:
            EMBEDDINGS_PROVIDER: Provider name (azure-openai, openai, aws-bedrock, cohere, huggingface, ollama)
            EMBEDDINGS_MODEL: Model name/ID (provider-specific)
            
        Provider-specific variables:
            AWS Bedrock:
                - AWS_REGION: AWS region (default: us-east-1)
                - AWS credentials via standard boto3 methods
            
            OpenAI:
                - OPENAI_API_KEY: API key
            
            Cohere:
                - COHERE_API_KEY: API key
            
            Ollama:
                - OLLAMA_BASE_URL: Base URL (default: http://localhost:11434)

        Returns:
            Embeddings: Configured embeddings instance

        Raises:
            ValueError: If provider is unsupported or credentials are missing
        """
        provider = os.getenv("EMBEDDINGS_PROVIDER", "azure-openai").lower()
        model = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")

        if provider == "azure-openai":
            # Azure OpenAI requires these environment variables:
            # AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_VERSION
            return AzureOpenAIEmbeddings(model=model)

        elif provider == "openai":
            if not os.getenv("OPENAI_API_KEY"):
                raise ValueError(
                    "OPENAI_API_KEY environment variable is required for OpenAI embeddings"
                )
            return OpenAIEmbeddings(model=model)

        elif provider == "aws-bedrock":
            # Default to Titan embedding model if not specified
            bedrock_model = os.getenv("EMBEDDINGS_MODEL", "amazon.titan-embed-text-v2:0")
            region = os.getenv("AWS_REGION", "us-east-1")
            
            return BedrockEmbeddings(
                model_id=bedrock_model,
                region_name=region
            )

        elif provider == "cohere":
            api_key = os.getenv("COHERE_API_KEY")
            if not api_key:
                raise ValueError(
                    "COHERE_API_KEY environment variable is required for Cohere embeddings"
                )
            # client and async_client are automatically created by the validator
            return CohereEmbeddings(model=model, cohere_api_key=api_key)  # type: ignore[call-arg]

        elif provider == "huggingface":
            # Default to a popular sentence transformer model
            hf_model = os.getenv("EMBEDDINGS_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
            return HuggingFaceEmbeddings(model_name=hf_model)

        elif provider == "ollama":
            ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            return OllamaEmbeddings(
                base_url=ollama_url,
                model=model
            )

        else:
            raise ValueError(
                f"Unsupported embeddings provider: '{provider}'. "
                f"Supported providers: azure-openai, openai, aws-bedrock, cohere, huggingface, ollama"
            )

    @staticmethod
    def get_embedding_dimensions() -> int:
        """
        Get the expected embedding dimensions for the configured model.
        This is useful for vector database configuration.
        
        Returns:
            int: Embedding dimensions (defaults to 1536 if unknown)
        """
        model = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
        
        # Common embedding dimensions by model
        dimension_map = {
            # OpenAI/Azure OpenAI
            "text-embedding-3-small": 1536,
            "text-embedding-3-large": 3072,
            "text-embedding-ada-002": 1536,
            
            # AWS Bedrock
            "amazon.titan-embed-text-v1": 1536,
            "amazon.titan-embed-text-v2:0": 1024,
            "cohere.embed-english-v3": 1024,
            "cohere.embed-multilingual-v3": 1024,
            
            # Cohere
            "embed-english-v3.0": 1024,
            "embed-multilingual-v3.0": 1024,
            "embed-english-light-v3.0": 384,
            
            # HuggingFace common models
            "sentence-transformers/all-MiniLM-L6-v2": 384,
            "sentence-transformers/all-mpnet-base-v2": 768,
            "sentence-transformers/all-MiniLM-L12-v2": 384,
        }
        
        # Try to find exact match
        if model in dimension_map:
            return dimension_map[model]
        
        # Default to 1536 (most common)
        return 1536

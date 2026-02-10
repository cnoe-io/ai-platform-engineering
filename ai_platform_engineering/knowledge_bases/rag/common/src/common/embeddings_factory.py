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
- litellm (proxy mode - connects to LiteLLM proxy)

All embedding provider packages are included in the Docker image.
"""

import os
from langchain_core.embeddings import Embeddings
from langchain_openai import AzureOpenAIEmbeddings, OpenAIEmbeddings
from langchain_aws import BedrockEmbeddings
from langchain_cohere import CohereEmbeddings
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_ollama import OllamaEmbeddings

from common.utils import get_logger

logger = get_logger(__name__)


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

        HuggingFace:
            - HUGGINGFACEHUB_API_TOKEN or HF_TOKEN: API token (required for gated models)
            - EMBEDDINGS_DEVICE: Device to use (cpu, cuda, mps) (default: cpu)
            - EMBEDDINGS_BATCH_SIZE: Batch size for embedding inference (default: 32)

        Ollama:
            - OLLAMA_BASE_URL: Base URL (default: http://localhost:11434)

    Returns:
        Embeddings: Configured embeddings instance

    Raises:
        ValueError: If provider is unsupported or credentials are missing
    """
    provider = os.getenv("EMBEDDINGS_PROVIDER", "azure-openai").lower()
    model = os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")

    embeddings: Embeddings

    if provider == "azure-openai":
      # Azure OpenAI requires these environment variables:
      # AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_VERSION
      embeddings = AzureOpenAIEmbeddings(model=model)

    elif provider == "openai":
      if not os.getenv("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY environment variable is required for OpenAI embeddings")
      embeddings = OpenAIEmbeddings(model=model)

    elif provider == "aws-bedrock":
      # Default to Titan embedding model if not specified
      bedrock_model = os.getenv("EMBEDDINGS_MODEL", "amazon.titan-embed-text-v2:0")
      region = os.getenv("AWS_REGION", "us-east-1")

      embeddings = BedrockEmbeddings(model_id=bedrock_model, region_name=region)

    elif provider == "cohere":
      api_key = os.getenv("COHERE_API_KEY")
      if not api_key:
        raise ValueError("COHERE_API_KEY environment variable is required for Cohere embeddings")
      # client and async_client are automatically created by the validator
      embeddings = CohereEmbeddings(model=model, cohere_api_key=api_key)  # type: ignore[call-arg]

    elif provider == "huggingface":
      # Default to a popular sentence transformer model
      hf_model = os.getenv("EMBEDDINGS_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
      hf_token = os.getenv("HUGGINGFACEHUB_API_TOKEN") or os.getenv("HF_TOKEN")

      # Configure model kwargs for optimal performance
      model_kwargs = {
        "device": "cpu",  # Explicitly set device (can be overridden with EMBEDDINGS_DEVICE env var)
      }

      # Add token if available (required for gated models)
      if hf_token:
        model_kwargs["token"] = hf_token

      # Allow device override via environment variable
      device = os.getenv("EMBEDDINGS_DEVICE", "cpu")
      model_kwargs["device"] = device

      # Encode kwargs for inference optimization
      encode_kwargs = {
        "normalize_embeddings": True,  # Normalize embeddings for better similarity search
        "batch_size": int(os.getenv("EMBEDDINGS_BATCH_SIZE", "32")),  # Configurable batch size
      }

      embeddings = HuggingFaceEmbeddings(
        model_name=hf_model,
        model_kwargs=model_kwargs,
        encode_kwargs=encode_kwargs,
      )

    elif provider == "ollama":
      ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
      embeddings = OllamaEmbeddings(base_url=ollama_url, model=model)

    elif provider == "litellm":
      # LiteLLM proxy mode: requires LITELLM_API_BASE
      # The proxy is OpenAI-compatible, so we use OpenAIEmbeddings
      api_base = os.getenv("LITELLM_API_BASE")
      if not api_base:
        raise ValueError("LITELLM_API_BASE environment variable is required for litellm provider")
      api_key = os.getenv("LITELLM_API_KEY", "not-needed")

      embeddings = OpenAIEmbeddings(
        model=model,
        api_key=api_key,  # type: ignore[arg-type]
        base_url=api_base,
      )

    else:
      raise ValueError(f"Unsupported embeddings provider: '{provider}'. Supported providers: azure-openai, openai, aws-bedrock, cohere, huggingface, ollama, litellm")

    dimensions = EmbeddingsFactory.get_embedding_dimensions()
    logger.info(f"Embeddings: provider={provider}, model={model}, dimensions={dimensions}")
    return embeddings

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
      # LiteLLM models (with provider prefix)
      "mistral/mistral-embed": 1024,
      "gemini/text-embedding-004": 768,
      "vertex_ai/textembedding-gecko": 768,
      "vertex_ai/textembedding-gecko@003": 768,
      "voyage/voyage-01": 1024,
      "voyage/voyage-lite-01": 1024,
      "voyage/voyage-3": 1024,
      "voyage/voyage-3-lite": 512,
      "voyage/voyage-code-3": 1024,
    }

    # Try to find exact match
    if model in dimension_map:
      return dimension_map[model]

    # Check if set by environment variable
    dimensions_env = os.getenv("EMBEDDINGS_DIMENSIONS")
    if dimensions_env:
      return int(dimensions_env)

    # If not set, return default
    # Default to 1536 (most common)
    return 1536

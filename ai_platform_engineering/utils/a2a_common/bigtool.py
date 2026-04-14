# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""BigTool: Semantic tool selection for LangGraph agents.

When agents have many MCP tools, sending all tool schemas to the LLM wastes
context and increases latency. BigTool indexes tool descriptions in a vector
store and retrieves only the most relevant tools for each query.

All configuration is via environment variables so BigTool is opt-in and
zero-code for any agent extending BaseLangGraphAgent.
"""

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class BigtoolConfig:
  """Configuration for BigTool semantic tool selection."""

  enabled: bool = False
  vector_store_type: str = "memory"  # "memory" or "faiss"
  embeddings_provider: str = "azure"  # "azure", "openai", or "huggingface"
  embeddings_model: str = "text-embedding-3-large"
  top_k: int = 3
  index_fields: list[str] = field(default_factory=lambda: ["description"])

  @classmethod
  def from_env(cls) -> "BigtoolConfig":
    """Create config from environment variables."""
    return cls(
      enabled=os.getenv("BIGTOOL_ENABLED", "false").lower() == "true",
      vector_store_type=os.getenv("BIGTOOL_VECTOR_STORE", "memory").lower(),
      embeddings_provider=os.getenv("BIGTOOL_EMBEDDINGS_PROVIDER", "azure").lower(),
      embeddings_model=os.getenv("BIGTOOL_EMBEDDINGS_MODEL", os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large")),
      top_k=int(os.getenv("BIGTOOL_TOP_K", "3")),
    )


def create_embeddings(config: BigtoolConfig) -> Any:
  """Create an embeddings instance based on the configured provider.

  Returns:
      A LangChain-compatible embeddings object.

  Raises:
      ValueError: If the provider is not recognized.
      ImportError: If the required package is not installed.
  """
  provider = config.embeddings_provider

  if provider == "azure":
    from langchain_openai import AzureOpenAIEmbeddings
    return AzureOpenAIEmbeddings(model=config.embeddings_model)

  if provider == "openai":
    from langchain_openai import OpenAIEmbeddings
    return OpenAIEmbeddings(model=config.embeddings_model)

  if provider == "huggingface":
    try:
      from langchain_huggingface import HuggingFaceEmbeddings
    except ImportError:
      raise ImportError(
        "langchain-huggingface is required for HuggingFace embeddings. "
        "Install it with: pip install langchain-huggingface"
      )
    return HuggingFaceEmbeddings(model_name=config.embeddings_model)

  raise ValueError(
    f"Unknown embeddings provider: {provider}. "
    "Supported: azure, openai, huggingface"
  )


# Embedding dimensions for common models
_KNOWN_DIMS = {
  "text-embedding-3-large": 3072,
  "text-embedding-3-small": 1536,
  "text-embedding-ada-002": 1536,
}
_DEFAULT_DIMS = 1536


def _get_embedding_dims(model_name: str) -> int:
  """Return the embedding dimension for a model, falling back to a default."""
  return _KNOWN_DIMS.get(model_name, _DEFAULT_DIMS)


def create_bigtool_store(config: BigtoolConfig) -> Any:
  """Create a vector store for BigTool tool indexing.

  Args:
      config: BigTool configuration.

  Returns:
      A store object suitable for indexing and searching tool descriptions.
  """
  store_type = config.vector_store_type

  if store_type == "memory":
    from langgraph.store.memory import InMemoryStore
    try:
      embeddings = create_embeddings(config)
      dims = _get_embedding_dims(config.embeddings_model)
      store = InMemoryStore(
        index={
          "embed": embeddings,
          "dims": dims,
          "fields": config.index_fields,
        }
      )
      logger.info(
        f"BigTool: Created InMemoryStore with {config.embeddings_provider} "
        f"embeddings (model={config.embeddings_model}, dims={dims})"
      )
      return store
    except Exception as e:
      logger.warning(f"BigTool: Failed to create embeddings, using basic InMemoryStore: {e}")
      return InMemoryStore()

  if store_type == "faiss":
    return _create_faiss_store(config)

  raise ValueError(
    f"Unknown vector store type: {store_type}. Supported: memory, faiss"
  )


def _create_faiss_store(config: BigtoolConfig) -> Any:
  """Create a FAISS-based store for BigTool.

  FAISS stores tool descriptions as documents and uses similarity search
  to find relevant tools.
  """
  try:
    from langchain_community.vectorstores import FAISS  # noqa: F401
  except ImportError:
    raise ImportError(
      "faiss-cpu and langchain-community are required for FAISS vector store. "
      "Install with: pip install faiss-cpu langchain-community"
    )

  embeddings = create_embeddings(config)
  logger.info(
    f"BigTool: Created FAISS store with {config.embeddings_provider} "
    f"embeddings (model={config.embeddings_model})"
  )
  return _FaissToolStore(embeddings=embeddings)


class _FaissToolStore:
  """Wrapper around FAISS that matches the InMemoryStore interface for tool indexing."""

  def __init__(self, embeddings: Any):
    self._embeddings = embeddings
    self._faiss_store: Optional[Any] = None
    self._tool_map: dict[str, dict] = {}

  def put(self, namespace: tuple, key: str, value: dict) -> None:
    """Store a tool description (buffered until search is called)."""
    self._tool_map[key] = value
    # Invalidate the FAISS index so it rebuilds on next search
    self._faiss_store = None

  def _ensure_index(self) -> None:
    """Build or rebuild the FAISS index from stored tools."""
    if self._faiss_store is not None:
      return

    from langchain_community.vectorstores import FAISS
    from langchain_core.documents import Document

    docs = []
    for key, value in self._tool_map.items():
      docs.append(Document(
        page_content=value.get("description", ""),
        metadata={"key": key, "name": value.get("name", "")},
      ))

    if not docs:
      return

    self._faiss_store = FAISS.from_documents(docs, self._embeddings)

  def search(self, namespace: tuple, query: str, limit: int = 3) -> list:
    """Search for relevant tools using FAISS similarity search."""
    self._ensure_index()
    if self._faiss_store is None:
      return []

    results = self._faiss_store.similarity_search(query, k=limit)
    return [
      _FaissSearchResult(value=self._tool_map.get(doc.metadata.get("key", ""), {}))
      for doc in results
    ]


@dataclass
class _FaissSearchResult:
  """Mimics InMemoryStore search result."""
  value: dict


def index_tools(store: Any, tools: list, namespace: str) -> None:
  """Index tool names and descriptions into the store.

  Args:
      store: The vector store (InMemoryStore or _FaissToolStore).
      tools: List of LangChain tools to index.
      namespace: Namespace for the tool index (typically the agent name).
  """
  for i, tool in enumerate(tools):
    store.put(
      (f"{namespace}_tools",),
      str(i),
      {
        "description": f"{tool.name}: {tool.description}",
        "name": tool.name,
      },
    )
  logger.info(f"BigTool: Indexed {len(tools)} tools under namespace '{namespace}'")


def get_relevant_tools(
  query: str,
  tools: list,
  store: Any,
  namespace: str,
  top_k: int = 3,
) -> list:
  """Search the store for relevant tools and return the top matches.

  Falls back to returning all tools on any error.

  Args:
      query: The user query to match against tool descriptions.
      tools: Full list of available tools.
      store: The vector store to search.
      namespace: Namespace used when indexing.
      top_k: Number of tools to return.

  Returns:
      A list of the most relevant tools, or all tools if search fails.
  """
  try:
    results = store.search((f"{namespace}_tools",), query=query, limit=top_k)

    if not results:
      logger.debug("BigTool: No search results, returning all tools")
      return tools

    tool_map = {tool.name: tool for tool in tools}
    relevant = []
    for result in results:
      name = result.value.get("name")
      if name and name in tool_map:
        relevant.append(tool_map[name])

    if not relevant:
      logger.debug("BigTool: No matching tools found, returning all tools")
      return tools

    logger.info(f"BigTool: Selected {len(relevant)} tools for query: {[t.name for t in relevant]}")
    return relevant

  except Exception as e:
    logger.warning(f"BigTool: Search failed ({e}), returning all tools")
    return tools

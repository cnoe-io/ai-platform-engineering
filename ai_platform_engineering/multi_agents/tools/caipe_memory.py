"""
CAIPE Memory System using Mem0 for enhanced memory capabilities.

This module provides a Mem0-based memory backend that can be used alongside
or instead of the ACE skillbook for more powerful semantic memory search
and persistence.

Reference: https://dspy.ai/tutorials/mem0_react_agent/
"""

import os
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# Check if mem0 is available
try:
    from mem0 import Memory
    MEM0_AVAILABLE = True
except ImportError:
    MEM0_AVAILABLE = False
    logger.warning("mem0 not installed. Install with: pip install mem0ai")


class CAIPEMemoryManager:
    """
    Memory manager for CAIPE using Mem0 for semantic memory storage and retrieval.

    This provides a more powerful alternative to the ACE skillbook with:
    - Semantic similarity search
    - User-specific memories
    - Memory categorization
    - Automatic memory extraction from conversations
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.memory: Optional[Memory] = None
        self._initialized = True
        self._mem0_enabled = False

        self._initialize_mem0()

    def _initialize_mem0(self):
        """Initialize Mem0 memory system."""
        if not MEM0_AVAILABLE:
            logger.warning("Mem0 not available - memory features disabled")
            return

        # Get configuration from environment
        openai_api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AZURE_OPENAI_API_KEY")

        if not openai_api_key:
            logger.warning("No OpenAI API key found - Mem0 disabled")
            return

        try:
            # Configure Mem0
            # Can use local (in-memory) or external storage (Qdrant, Milvus, etc.)
            config = self._get_mem0_config()

            self.memory = Memory.from_config(config)
            self._mem0_enabled = True
            logger.info("✅ Mem0 memory system initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize Mem0: {e}")
            self._mem0_enabled = False

    def _get_mem0_config(self) -> Dict[str, Any]:
        """Get Mem0 configuration based on environment."""

        # Check if using Azure OpenAI
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        azure_key = os.getenv("AZURE_OPENAI_API_KEY")
        azure_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")

        if azure_endpoint and azure_key:
            # Azure OpenAI configuration
            return {
                "llm": {
                    "provider": "azure_openai",
                    "config": {
                        "model": azure_deployment,
                        "azure_deployment": azure_deployment,
                        "azure_endpoint": azure_endpoint,
                        "api_key": azure_key,
                        "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
                        "temperature": 0.1
                    }
                },
                "embedder": {
                    "provider": "azure_openai",
                    "config": {
                        "model": "text-embedding-3-small",
                        "azure_deployment": os.getenv("AZURE_EMBEDDING_DEPLOYMENT", "text-embedding-3-small"),
                        "azure_endpoint": azure_endpoint,
                        "api_key": azure_key,
                    }
                },
                "version": "v1.1"
            }
        else:
            # Standard OpenAI configuration
            return {
                "llm": {
                    "provider": "openai",
                    "config": {
                        "model": "gpt-4o-mini",
                        "temperature": 0.1
                    }
                },
                "embedder": {
                    "provider": "openai",
                    "config": {
                        "model": "text-embedding-3-small"
                    }
                },
                "version": "v1.1"
            }

    @property
    def is_enabled(self) -> bool:
        """Check if Mem0 is enabled and ready."""
        return self._mem0_enabled and self.memory is not None

    def store_interaction(
        self,
        question: str,
        answer: str,
        user_id: str = "caipe_default",
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Store a Q&A interaction in memory.

        Mem0 will automatically extract important facts and learnings
        from the interaction.
        """
        if not self.is_enabled:
            return {"status": "disabled", "message": "Mem0 not enabled"}

        try:
            # Format the interaction for memory storage
            interaction_text = f"""
User Question: {question}

Assistant Response: {answer}

Timestamp: {datetime.now().isoformat()}
"""

            # Add metadata if provided
            meta = metadata or {}
            meta["type"] = "interaction"
            meta["timestamp"] = datetime.now().isoformat()

            # Store in Mem0 - it will automatically extract memories
            result = self.memory.add(
                interaction_text,
                user_id=user_id,
                metadata=meta
            )

            logger.info(f"📝 Stored interaction in Mem0 for user {user_id}")
            return {
                "status": "success",
                "result": result
            }

        except Exception as e:
            logger.error(f"Failed to store interaction: {e}")
            return {"status": "error", "error": str(e)}

    def store_learning(
        self,
        content: str,
        category: str = "general",
        user_id: str = "caipe_default"
    ) -> Dict[str, Any]:
        """
        Store a specific learning or strategy.

        Args:
            content: The learning/strategy content
            category: Category (e.g., "aws_management", "github", "argocd")
            user_id: User identifier
        """
        if not self.is_enabled:
            return {"status": "disabled"}

        try:
            learning_text = f"[{category.upper()}] {content}"

            result = self.memory.add(
                learning_text,
                user_id=user_id,
                metadata={
                    "type": "learning",
                    "category": category,
                    "timestamp": datetime.now().isoformat()
                }
            )

            logger.info(f"📚 Stored learning in category '{category}'")
            return {"status": "success", "result": result}

        except Exception as e:
            logger.error(f"Failed to store learning: {e}")
            return {"status": "error", "error": str(e)}

    def search_memories(
        self,
        query: str,
        user_id: str = "caipe_default",
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Search for relevant memories using semantic similarity.

        Args:
            query: The search query
            user_id: User identifier
            limit: Maximum number of results

        Returns:
            List of relevant memories
        """
        if not self.is_enabled:
            return []

        try:
            results = self.memory.search(
                query=query,
                user_id=user_id,
                limit=limit
            )

            if not results or "results" not in results:
                return []

            memories = []
            for r in results.get("results", []):
                memories.append({
                    "id": r.get("id"),
                    "memory": r.get("memory"),
                    "score": r.get("score", 0),
                    "metadata": r.get("metadata", {})
                })

            logger.info(f"🔍 Found {len(memories)} relevant memories for query")
            return memories

        except Exception as e:
            logger.error(f"Failed to search memories: {e}")
            return []

    def get_context_for_query(
        self,
        query: str,
        user_id: str = "caipe_default",
        limit: int = 5
    ) -> str:
        """
        Get formatted context string from relevant memories.

        This can be injected into prompts to provide learned context.
        """
        memories = self.search_memories(query, user_id, limit)

        if not memories:
            return ""

        context_lines = ["## 🧠 Relevant Memories from Past Interactions:\n"]

        for i, mem in enumerate(memories, 1):
            memory_text = mem.get("memory", "")
            score = mem.get("score", 0)
            metadata = mem.get("metadata", {})
            category = metadata.get("category", "general")

            context_lines.append(f"{i}. [{category}] {memory_text}")

        return "\n".join(context_lines)

    def get_all_memories(
        self,
        user_id: str = "caipe_default"
    ) -> List[Dict[str, Any]]:
        """Get all memories for a user."""
        if not self.is_enabled:
            return []

        try:
            results = self.memory.get_all(user_id=user_id)

            if not results or "results" not in results:
                return []

            return results.get("results", [])

        except Exception as e:
            logger.error(f"Failed to get all memories: {e}")
            return []

    def delete_memory(self, memory_id: str) -> bool:
        """Delete a specific memory."""
        if not self.is_enabled:
            return False

        try:
            self.memory.delete(memory_id)
            logger.info(f"🗑️ Deleted memory {memory_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete memory: {e}")
            return False

    def clear_user_memories(self, user_id: str = "caipe_default") -> bool:
        """Clear all memories for a user."""
        if not self.is_enabled:
            return False

        try:
            self.memory.delete_all(user_id=user_id)
            logger.info(f"🗑️ Cleared all memories for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to clear memories: {e}")
            return False

    def get_stats(self, user_id: str = "caipe_default") -> Dict[str, Any]:
        """Get memory statistics."""
        memories = self.get_all_memories(user_id)

        # Count by category
        categories = {}
        for mem in memories:
            cat = mem.get("metadata", {}).get("category", "general")
            categories[cat] = categories.get(cat, 0) + 1

        return {
            "enabled": self.is_enabled,
            "total_memories": len(memories),
            "categories": categories,
            "user_id": user_id
        }


# Singleton accessor
_memory_manager: Optional[CAIPEMemoryManager] = None

def get_memory_manager() -> CAIPEMemoryManager:
    """Get the singleton memory manager instance."""
    global _memory_manager
    if _memory_manager is None:
        _memory_manager = CAIPEMemoryManager()
    return _memory_manager


# ============================================================================
# LangChain Tools for Memory
# ============================================================================

from langchain_core.tools import tool

@tool
def store_memory(content: str, category: str = "general") -> str:
    """
    Store a learning or important information in CAIPE's memory.

    Args:
        content: The information to remember
        category: Category like 'aws', 'github', 'argocd', 'workflow'

    Returns:
        Confirmation message
    """
    manager = get_memory_manager()
    result = manager.store_learning(content, category)

    if result.get("status") == "success":
        return f"✅ Stored in memory: [{category}] {content}"
    else:
        return f"⚠️ Could not store memory: {result.get('error', 'Unknown error')}"


@tool
def search_memory(query: str, limit: int = 5) -> str:
    """
    Search CAIPE's memory for relevant information from past interactions.

    Args:
        query: What to search for
        limit: Maximum number of results (default 5)

    Returns:
        Relevant memories found
    """
    manager = get_memory_manager()
    memories = manager.search_memories(query, limit=limit)

    if not memories:
        return "No relevant memories found."

    result = "Found relevant memories:\n"
    for i, mem in enumerate(memories, 1):
        result += f"{i}. {mem.get('memory', '')}\n"

    return result


@tool
def get_memory_stats() -> str:
    """
    Get statistics about CAIPE's memory system.

    Returns:
        Memory statistics including total count and categories
    """
    manager = get_memory_manager()
    stats = manager.get_stats()

    if not stats.get("enabled"):
        return "Memory system is not enabled."

    result = f"📊 Memory Statistics:\n"
    result += f"- Total memories: {stats['total_memories']}\n"
    result += f"- Categories:\n"

    for cat, count in stats.get("categories", {}).items():
        result += f"  - {cat}: {count}\n"

    return result


# Export tools list
MEMORY_TOOLS = [store_memory, search_memory, get_memory_stats]










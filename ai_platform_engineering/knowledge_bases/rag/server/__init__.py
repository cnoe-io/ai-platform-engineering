"""
RAG Server Package

This package contains the refactored RAG API server with clean separation of concerns:

- redis_client.py: Redis operations and data models
- utils.py: Helper functions and utilities  
- models.py: Pydantic models for API requests/responses
- rag_api.py: FastAPI endpoints only
"""

__version__ = "2.0.0" 
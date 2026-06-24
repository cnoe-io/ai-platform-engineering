"""Model for Searchtool"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchtool(BaseModel):
  """Search tool configuration.

  Example:
      {
          "search_tool_id": "123e4567-e89b-12d3-a456-426614174000",
          "search_tool_name": "litellm-search",
          "litellm_params": {
              "search_provider": "perplexity",
              "api_key": "sk-..."
          },
          "search_tool_info": {
              "description": "Perplexity search tool"
          }
      }"""


class SearchtoolResponse(APIResponse):
  """Response model for Searchtool"""

  data: Optional[Searchtool] = None


class SearchtoolListResponse(APIResponse):
  """List response model for Searchtool"""

  data: List[Searchtool] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None

# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base models for the API"""

from typing import Dict, Optional
from pydantic import BaseModel

class APIResponse(BaseModel):
    """Base model for API responses"""
    success: bool
    data: Optional[Dict] = None
    error: Optional[str] = None

class PaginationInfo(BaseModel):
    """Pagination information"""
    offset: int
    limit: int
    total: Optional[int] = None
    more: Optional[bool] = None


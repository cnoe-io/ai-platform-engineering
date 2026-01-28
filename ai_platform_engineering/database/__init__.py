# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Database module for AI Platform Engineering.

This module provides database connectivity and services for:
- MongoDB (chat history, user management)
- Connection pooling and lifecycle management
"""

from .mongodb import MongoDBManager, get_mongodb

__all__ = ["MongoDBManager", "get_mongodb"]

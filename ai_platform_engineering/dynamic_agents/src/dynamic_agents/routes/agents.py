"""Authenticated agent helper endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/agents", tags=["agents"])

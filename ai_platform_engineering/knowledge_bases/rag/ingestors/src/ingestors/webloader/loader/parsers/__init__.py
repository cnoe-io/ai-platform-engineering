"""
Content parsers for different documentation site generators.

This module provides a registry of parsers that can automatically detect
and extract content from various documentation frameworks like Docusaurus,
MkDocs, Sphinx, ReadTheDocs, VitePress, and generic HTML pages.
"""

from .registry import ParserRegistry
from .base import BaseParser, ParseResult

__all__ = ["ParserRegistry", "BaseParser", "ParseResult"]

"""
Scrapy pipelines for processing scraped items.
"""

from .document import DocumentPipeline

__all__ = ["DocumentPipeline"]

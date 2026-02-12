"""
Scrapy Item definitions for web scraping.

Items define the structure of scraped data before it's processed
by pipelines and converted to LangChain Documents.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any


@dataclass
class ScrapedPageItem:
  """
  Item representing a scraped web page.

  This is the output of spider parsing and the input to pipelines.
  """

  # Required fields
  url: str
  content: str

  # Metadata fields
  title: str = ""
  description: str = ""
  language: str = ""

  # Optional extended metadata
  generator: Optional[str] = None
  extra_metadata: Dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> Dict[str, Any]:
    """Convert to dictionary for pipeline processing."""
    return {
      "url": self.url,
      "content": self.content,
      "title": self.title,
      "description": self.description,
      "language": self.language,
      "generator": self.generator,
      "extra_metadata": self.extra_metadata,
    }

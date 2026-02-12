"""
Base parser interface for content extraction.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from scrapy.http import Response


@dataclass
class ParseResult:
  """Result of parsing a webpage."""

  content: str
  title: str
  description: str
  language: str
  generator: Optional[str] = None


class BaseParser(ABC):
  """Abstract base class for content parsers."""

  # Human-readable name for this parser
  name: str = "base"

  @classmethod
  @abstractmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Check if this parser can handle the given response.

    Args:
        response: Scrapy Response object

    Returns:
        True if this parser should be used for this page
    """
    pass

  @classmethod
  @abstractmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content and metadata from the response.

    Args:
        response: Scrapy Response object

    Returns:
        ParseResult with extracted content and metadata
    """
    pass

  @classmethod
  def _get_meta_content(cls, response: Response, name: str) -> str:
    """Helper to get meta tag content by name."""
    # Try name attribute first
    content = response.css(f'meta[name="{name}"]::attr(content)').get()
    if content:
      return content.strip()

    # Try property attribute (for Open Graph tags)
    content = response.css(f'meta[property="{name}"]::attr(content)').get()
    if content:
      return content.strip()

    return ""

  @classmethod
  def _get_title(cls, response: Response) -> str:
    """Extract page title."""
    # Try title tag first
    title = response.css("title::text").get()
    if title:
      return title.strip()

    # Try og:title
    title = cls._get_meta_content(response, "og:title")
    if title:
      return title

    # Try h1
    title = response.css("h1::text").get()
    if title:
      return title.strip()

    return ""

  @classmethod
  def _get_description(cls, response: Response) -> str:
    """Extract page description."""
    desc = cls._get_meta_content(response, "description")
    if desc:
      return desc

    desc = cls._get_meta_content(response, "og:description")
    return desc

  @classmethod
  def _get_language(cls, response: Response) -> str:
    """Extract page language."""
    lang = response.css("html::attr(lang)").get()
    if lang:
      return lang.strip()
    return ""

  @classmethod
  def _get_generator(cls, response: Response) -> Optional[str]:
    """Extract generator meta tag value."""
    return cls._get_meta_content(response, "generator") or None

  @classmethod
  def _clean_text(cls, text: str) -> str:
    """Clean up extracted text content."""
    if not text:
      return ""

    # Normalize whitespace
    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
      # Strip each line
      line = line.strip()
      # Skip empty lines
      if line:
        cleaned_lines.append(line)

    return "\n".join(cleaned_lines)

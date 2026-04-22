"""
Parser for ReadTheDocs-hosted documentation.

ReadTheDocs (https://readthedocs.org/) hosts documentation for many open source
projects. It can use various themes but has its own characteristic elements.
"""

from scrapy.http import Response

from .base import BaseParser, ParseResult
from .registry import register_parser


@register_parser()
class ReadTheDocsParser(BaseParser):
  """Parser for ReadTheDocs-hosted documentation."""

  name = "readthedocs"

  # Tags to exclude from content extraction
  EXCLUDE_TAGS = ["nav", "header", "footer", "script", "style", "noscript"]

  # Classes to exclude from content extraction
  EXCLUDE_CLASSES = ["wy-nav-side", "rst-versions"]

  @classmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Detect ReadTheDocs sites by:
    1. ReadTheDocs-specific scripts or elements
    2. RTD theme class patterns
    3. readthedocs.io domain
    """
    # Check for RTD embed script
    if response.css('script[src*="readthedocs"]').get():
      return True

    # Check for RTD version selector or flyout
    if response.css(".rst-versions, .injected, [data-readthedocs-analytics]").get():
      return True

    # Check for RTD theme specific classes
    if response.css(".wy-body-for-nav, .wy-nav-content-wrap").get():
      return True

    # Check URL for readthedocs domain
    if "readthedocs.io" in response.url or "readthedocs.org" in response.url:
      return True

    return False

  @classmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content from ReadTheDocs pages.

    RTD typically uses .wy-nav-content or .rst-content for main content.
    """
    content = ""

    # Try RTD Sphinx theme structure
    main_content = response.css(".wy-nav-content, .rst-content")
    if main_content:
      # Get the document div within
      document = main_content.css('[role="main"], .document')
      if document:
        content = "\n".join(document.css("::text").getall())
      else:
        content = "\n".join(main_content.css("::text").getall())

    # Try generic main content area
    if not content:
      main = response.css('[role="main"], main, .main-content')
      if main:
        content = "\n".join(main.css("::text").getall())

    # Fallback
    if not content:
      content = cls._extract_body_content(response)

    return ParseResult(
      content=cls._clean_text(content),
      title=cls._get_title(response),
      description=cls._get_description(response),
      language=cls._get_language(response),
      generator=cls._get_generator(response),
    )

  @classmethod
  def _extract_body_content(cls, response: Response) -> str:
    """Extract body content excluding navigation elements using XPath."""
    body = response.css("body")
    if not body:
      return "\n".join(response.css("::text").getall())

    # Build XPath exclusion for tags
    tag_exclusions = " and ".join([f"not(ancestor-or-self::{tag})" for tag in cls.EXCLUDE_TAGS])

    # Build XPath exclusion for classes
    class_exclusions = " and ".join([f'not(ancestor-or-self::*[contains(@class, "{class_name}")])' for class_name in cls.EXCLUDE_CLASSES])

    # Combine all exclusions
    xpath = f".//text()[{tag_exclusions} and {class_exclusions}]"

    texts = []
    for text in body[0].xpath(xpath).getall():
      text = text.strip()
      if text and len(text) > 1:
        texts.append(text)

    return "\n".join(texts)

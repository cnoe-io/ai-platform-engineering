"""
Parser for VitePress documentation sites.

VitePress (https://vitepress.dev/) is a Vue-powered static site generator
designed for building fast, content-centric websites.
"""

from scrapy.http import Response

from .base import BaseParser, ParseResult
from .registry import register_parser


@register_parser()
class VitePressParser(BaseParser):
  """Parser for VitePress documentation sites."""

  name = "vitepress"

  # Tags to exclude from content extraction
  EXCLUDE_TAGS = ["nav", "header", "footer", "script", "style", "noscript", "aside"]

  # Classes to exclude from content extraction
  EXCLUDE_CLASSES = ["VPNav", "VPSidebar", "VPLocalNav", "aside", "outline"]

  @classmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Detect VitePress sites by:
    1. Generator meta tag containing "vitepress"
    2. VitePress-specific class patterns
    3. VitePress data attributes
    """
    generator = cls._get_generator(response)
    if generator and "vitepress" in generator.lower():
      return True

    # Check for VitePress-specific classes
    if response.css('.VPDoc, .vp-doc, [class*="VPContent"]').get():
      return True

    # Check for VitePress app container
    if response.css("#VPContent, #app[data-server-rendered]").get():
      if response.css(".Layout, .VPNav").get():
        return True

    return False

  @classmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content from VitePress pages.

    VitePress uses .vp-doc for documentation content.
    """
    content = ""

    # Try VitePress document container
    doc = response.css(".vp-doc, .VPDoc")
    if doc:
      # Use XPath to exclude aside/outline elements (CSS :not() doesn't support comma-separated selectors)
      content = cls._extract_from_element(doc[0])

      # Fallback to all text if extraction is empty
      if not content or len(content.strip()) < 100:
        content = "\n".join(doc.css("::text").getall())

    # Try main content area
    if not content:
      main = response.css('main, .main, [class*="VPContent"]')
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
  def _extract_from_element(cls, element) -> str:
    """Extract text from element, excluding aside/nav elements using XPath."""
    # Build XPath exclusion for tags
    tag_exclusions = " and ".join([f"not(ancestor-or-self::{tag})" for tag in cls.EXCLUDE_TAGS])

    # Build XPath exclusion for classes
    class_exclusions = " and ".join([f'not(ancestor-or-self::*[contains(@class, "{class_name}")])' for class_name in cls.EXCLUDE_CLASSES])

    # Combine all exclusions
    xpath = f".//text()[{tag_exclusions} and {class_exclusions}]"

    texts = []
    for text in element.xpath(xpath).getall():
      text = text.strip()
      if text and len(text) > 1:
        texts.append(text)

    return "\n".join(texts)

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

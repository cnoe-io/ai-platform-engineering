"""
Generic parser for HTML pages.

This is the fallback parser used when no specific documentation framework
is detected. It attempts to extract main content by removing navigation,
headers, footers, and other non-content elements.
"""

from scrapy.http import Response

from .base import BaseParser, ParseResult
from .registry import register_parser


@register_parser(is_fallback=True)
class GenericParser(BaseParser):
  """Generic HTML content parser used as fallback."""

  name = "generic"

  # Elements to exclude from content extraction
  EXCLUDE_TAGS = [
    "nav",
    "header",
    "footer",
    "aside",
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "form",
    "button",
    "input",
    "select",
    "textarea",
  ]

  # Class patterns to exclude (common navigation/UI elements)
  EXCLUDE_CLASS_PATTERNS = [
    "nav",
    "menu",
    "sidebar",
    "footer",
    "header",
    "toolbar",
    "breadcrumb",
    "pagination",
    "social",
    "share",
    "comment",
    "cookie",
    "banner",
    "ad",
    "popup",
    "modal",
    "overlay",
    "tooltip",
    "dropdown",
  ]

  @classmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Generic parser always returns True as it's the fallback.
    This method is only called if no other parser matches.
    """
    return True

  @classmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content from a generic HTML page.

    Strategy:
    1. Try to find semantic main content (<main>, <article>, [role="main"])
    2. Fall back to body content with navigation removed
    3. Clean and deduplicate text
    """
    content = ""

    # Try semantic main content first
    main = response.css('main, article, [role="main"], .main-content, #main-content, #content, .content')
    if main:
      # Use the first match (most likely the main content)
      content = cls._extract_from_element(main[0])

    # Fallback to body
    if not content or len(content.strip()) < 100:
      content = cls._extract_from_body(response)

    return ParseResult(
      content=cls._clean_text(content),
      title=cls._get_title(response),
      description=cls._get_description(response),
      language=cls._get_language(response),
      generator=cls._get_generator(response),
    )

  @classmethod
  def _extract_from_element(cls, element) -> str:
    """Extract text from a single element."""
    texts = []

    # Use XPath for complex exclusion logic since CSS :not() doesn't support comma-separated selectors
    # Exclude script, style, and other non-content elements
    exclude_xpath = " and ".join([f"not(ancestor-or-self::{tag})" for tag in cls.EXCLUDE_TAGS])

    for text in element.xpath(f".//text()[{exclude_xpath}]").getall():
      text = text.strip()
      if text and len(text) > 1:  # Skip single characters
        texts.append(text)

    return "\n".join(texts)

  @classmethod
  def _extract_from_body(cls, response: Response) -> str:
    """Extract content from body, removing navigation elements."""
    texts = []

    # Build XPath exclusion for tags
    tag_exclusions = " and ".join([f"not(ancestor-or-self::{tag})" for tag in cls.EXCLUDE_TAGS])

    # Build XPath exclusion for class patterns (contains check)
    class_exclusions = " and ".join([f'not(ancestor-or-self::*[contains(@class, "{pattern}")])' for pattern in cls.EXCLUDE_CLASS_PATTERNS])

    # Combine all exclusions
    xpath = f".//body//text()[{tag_exclusions} and {class_exclusions}]"

    # Get all text nodes not in excluded elements
    for text in response.xpath(xpath).getall():
      text = text.strip()
      if text and len(text) > 1:
        texts.append(text)

    return "\n".join(texts)

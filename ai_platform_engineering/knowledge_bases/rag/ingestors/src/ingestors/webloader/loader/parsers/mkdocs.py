"""
Parser for MkDocs documentation sites.

MkDocs (https://www.mkdocs.org/) is a fast, simple static site generator
geared towards project documentation, often styled with Material theme.
"""

from scrapy.http import Response

from .base import BaseParser, ParseResult
from .registry import register_parser


@register_parser()
class MkDocsParser(BaseParser):
  """Parser for MkDocs documentation sites."""

  name = "mkdocs"

  # Tags to exclude from content extraction
  EXCLUDE_TAGS = ["nav", "header", "footer", "script", "style", "noscript"]

  # Classes to exclude from content extraction
  EXCLUDE_CLASSES = ["md-sidebar", "md-header", "md-footer"]

  @classmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Detect MkDocs sites by:
    1. Generator meta tag containing "mkdocs"
    2. MkDocs-specific class patterns (md-main, md-content)
    """
    generator = cls._get_generator(response)
    if generator and "mkdocs" in generator.lower():
      return True

    # Check for Material for MkDocs specific classes
    if response.css(".md-main, .md-content, [data-md-component]").get():
      return True

    # Check for classic MkDocs theme
    if response.css(".rst-content, .wy-nav-content").get():
      return True

    return False

  @classmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content from MkDocs pages.

    Material for MkDocs uses main.md-main div.md-content
    Classic MkDocs uses .rst-content or similar
    """
    content = ""

    # Try Material for MkDocs first
    main_content = response.css("main.md-main div.md-content")
    if main_content:
      # Get the article within md-content
      article = main_content.css("article")
      if article:
        content = "\n".join(article.css("::text").getall())
      else:
        content = "\n".join(main_content.css("::text").getall())

    # Try classic MkDocs / ReadTheDocs theme
    if not content:
      rst_content = response.css('.rst-content, .wy-nav-content, [role="main"]')
      if rst_content:
        content = "\n".join(rst_content.css("::text").getall())

    # Fallback to body without nav/header
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

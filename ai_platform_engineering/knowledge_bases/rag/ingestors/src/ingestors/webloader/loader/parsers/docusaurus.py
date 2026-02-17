"""
Parser for Docusaurus documentation sites.

Docusaurus (https://docusaurus.io/) is a popular static site generator
for documentation, often used by open source projects.
"""

from scrapy.http import Response

from .base import BaseParser, ParseResult
from .registry import register_parser


@register_parser()
class DocusaurusParser(BaseParser):
  """Parser for Docusaurus documentation sites."""

  name = "docusaurus"

  # Tags to exclude from content extraction
  EXCLUDE_TAGS = ["nav", "header", "footer", "script", "style", "noscript"]

  # Classes to exclude from content extraction
  EXCLUDE_CLASSES = ["navbar", "sidebar", "toc", "theme-doc-toc-mobile"]

  @classmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Detect Docusaurus sites by:
    1. Generator meta tag containing "docusaurus"
    2. Docusaurus-specific data attributes
    3. Docusaurus class patterns
    """
    generator = cls._get_generator(response)
    if generator and "docusaurus" in generator.lower():
      return True

    # Check for Docusaurus-specific attributes
    if response.css("[data-theme]").get():
      # Check for docusaurus class patterns
      if response.css('.theme-doc-markdown, .docusaurus-mt-lg, [class*="docSidebarContainer"]').get():
        return True

    return False

  @classmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content from Docusaurus pages.

    Docusaurus uses <article> tags for main content.
    """
    # Try to get main article content
    article = response.css("article")

    if article:
      # Use XPath to exclude nav elements (CSS :not() doesn't support comma-separated selectors)
      content = cls._extract_from_article(article[0])

      # If that's empty, fallback to getting all text from article
      if not content or len(content.strip()) < 100:
        content = article.css("::text").getall()
        content = "\n".join(t.strip() for t in content if t.strip())
    else:
      # Fallback: get all text, remove nav/header
      content = cls._extract_fallback(response)

    return ParseResult(
      content=cls._clean_text(content),
      title=cls._get_title(response),
      description=cls._get_description(response),
      language=cls._get_language(response),
      generator=cls._get_generator(response),
    )

  @classmethod
  def _extract_from_article(cls, article) -> str:
    """Extract text from article, excluding nav/header/footer elements using XPath."""
    # Build XPath exclusion for tags
    tag_exclusions = " and ".join([f"not(ancestor-or-self::{tag})" for tag in cls.EXCLUDE_TAGS])

    # Build XPath exclusion for classes
    class_exclusions = " and ".join([f'not(ancestor-or-self::*[contains(@class, "{class_name}")])' for class_name in cls.EXCLUDE_CLASSES])

    # Combine all exclusions
    xpath = f".//text()[{tag_exclusions} and {class_exclusions}]"

    texts = []
    for text in article.xpath(xpath).getall():
      text = text.strip()
      if text and len(text) > 1:
        texts.append(text)

    return "\n".join(texts)

  @classmethod
  def _extract_fallback(cls, response: Response) -> str:
    """Fallback extraction when article tag is not found."""
    # Get body, remove nav/header/footer using XPath
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

"""
Parser for Sphinx documentation sites.

Sphinx (https://www.sphinx-doc.org/) is the de facto standard for Python
documentation. Used by Python docs, many PyPI packages, and ReadTheDocs.
"""

from scrapy.http import Response

from .base import BaseParser, ParseResult
from .registry import register_parser


@register_parser()
class SphinxParser(BaseParser):
  """Parser for Sphinx documentation sites."""

  name = "sphinx"

  @classmethod
  def can_parse(cls, response: Response) -> bool:
    """
    Detect Sphinx sites by:
    1. Generator meta tag containing "sphinx"
    2. Sphinx-specific class patterns
    3. Alabaster or other Sphinx theme markers
    """
    generator = cls._get_generator(response)
    if generator and "sphinx" in generator.lower():
      return True

    # Check for Sphinx-specific elements
    if response.css(".sphinxsidebar, .sphinxsidebarwrapper").get():
      return True

    # Check for Sphinx document structure
    if response.css("div.document, div.documentwrapper").get():
      if response.css("div.bodywrapper, div.body").get():
        return True

    # Check for Furo theme (popular Sphinx theme)
    if response.css(".sidebar-container, .content-container").get():
      if response.css("[data-content_root]").get():
        return True

    # Check for PyData Sphinx theme
    if response.css(".bd-main, .bd-content").get():
      return True

    return False

  @classmethod
  def extract(cls, response: Response) -> ParseResult:
    """
    Extract content from Sphinx pages.

    Sphinx typically uses div.document > div.documentwrapper > div.bodywrapper > div.body
    """
    content = ""

    # Try standard Sphinx structure
    body = response.css("div.body, div.bodywrapper div.body")
    if body:
      # Exclude table of contents and sidebar references
      texts = []
      for element in body.css("*:not(.toctree-wrapper):not(.contents)"):
        # Use XPath to get direct text children (CSS "> ::text" is not valid)
        for text in element.xpath("text()").getall():
          if text.strip():
            texts.append(text.strip())
      content = "\n".join(texts)

    # Try Furo theme
    if not content:
      article = response.css('article.bd-article, article[role="main"]')
      if article:
        content = "\n".join(article.css("::text").getall())

    # Try PyData theme
    if not content:
      main_content = response.css(".bd-content main, #main-content")
      if main_content:
        content = "\n".join(main_content.css("::text").getall())

    # Try role="main" fallback
    if not content:
      main = response.css('[role="main"], main')
      if main:
        content = "\n".join(main.css("::text").getall())

    # Final fallback
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
    """Extract body content excluding navigation elements."""
    texts = []

    # Use XPath for exclusions since CSS :not() doesn't support comma-separated selectors
    exclude_tags = ["nav", "header", "footer", "script", "style"]
    exclude_classes = ["sphinxsidebar", "sidebar", "toctree-wrapper"]

    tag_exclusions = " and ".join([f"not(ancestor-or-self::{tag})" for tag in exclude_tags])
    class_exclusions = " and ".join([f'not(ancestor-or-self::*[contains(@class, "{cls_name}")])' for cls_name in exclude_classes])

    xpath = f".//body//text()[{tag_exclusions} and {class_exclusions}]"

    for text in response.xpath(xpath).getall():
      if text.strip():
        texts.append(text.strip())

    return "\n".join(texts)

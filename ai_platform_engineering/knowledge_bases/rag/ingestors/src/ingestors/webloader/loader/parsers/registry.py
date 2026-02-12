"""
Parser registry for automatic content parser detection and selection.
"""

from typing import List, Type
from scrapy.http import Response
from common.utils import get_logger

from .base import BaseParser, ParseResult

logger = get_logger(__name__)


class ParserRegistry:
  """
  Registry that manages content parsers and automatically selects
  the appropriate parser based on page characteristics.
  """

  _parsers: List[Type[BaseParser]] = []
  _fallback_parser: Type[BaseParser] | None = None

  @classmethod
  def register(cls, parser: Type[BaseParser], is_fallback: bool = False) -> None:
    """
    Register a parser class.

    Args:
        parser: Parser class to register
        is_fallback: If True, use this parser as the fallback
    """
    if is_fallback:
      cls._fallback_parser = parser
    else:
      # Insert at beginning to prefer more specific parsers
      cls._parsers.insert(0, parser)
    logger.debug(f"Registered parser: {parser.name} (fallback={is_fallback})")

  @classmethod
  def get_parser(cls, response: Response) -> Type[BaseParser]:
    """
    Get the appropriate parser for a response.

    Args:
        response: Scrapy Response object

    Returns:
        Parser class that can handle this response
    """
    # Try each registered parser
    for parser in cls._parsers:
      try:
        if parser.can_parse(response):
          logger.debug(f"Selected parser: {parser.name} for {response.url}")
          return parser
      except Exception as e:
        logger.warning(f"Error checking parser {parser.name}: {e}")
        continue

    # Use fallback parser
    if cls._fallback_parser:
      logger.debug(f"Using fallback parser: {cls._fallback_parser.name} for {response.url}")
      return cls._fallback_parser

    raise ValueError(f"No parser found for {response.url}")

  @classmethod
  def parse(cls, response: Response) -> ParseResult:
    """
    Parse a response using the appropriate parser.

    Args:
        response: Scrapy Response object

    Returns:
        ParseResult with extracted content
    """
    parser = cls.get_parser(response)
    return parser.extract(response)

  @classmethod
  def list_parsers(cls) -> List[str]:
    """List all registered parser names."""
    names = [p.name for p in cls._parsers]
    if cls._fallback_parser:
      names.append(f"{cls._fallback_parser.name} (fallback)")
    return names


def register_parser(is_fallback: bool = False):
  """
  Decorator to register a parser class.

  Usage:
      @register_parser()
      class MyParser(BaseParser):
          ...
  """

  def decorator(parser_class: Type[BaseParser]) -> Type[BaseParser]:
    ParserRegistry.register(parser_class, is_fallback=is_fallback)
    return parser_class

  return decorator

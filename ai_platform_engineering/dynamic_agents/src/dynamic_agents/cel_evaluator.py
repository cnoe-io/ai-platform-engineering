"""CEL policy evaluation (FR-029) using cel-python.

Mirror of ``ai_platform_engineering/utils/cel_evaluator.py`` (local copy to avoid
pulling the full utils package, which pins conflicting LangChain / a2a-sdk versions).
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

import celpy
from celpy.adapter import json_to_cel
from celpy.celparser import CELParseError
from celpy.celtypes import BoolType
from celpy.evaluation import CELEvalError

logger = logging.getLogger(__name__)

_env = celpy.Environment()


def evaluate(expression: str, context: dict[str, Any]) -> bool:
  """Evaluate a CEL *expression* against *context*. Fail closed on error.

  Empty or whitespace-only *expression* is treated as no policy and returns True.
  """
  if not expression or not expression.strip():
    return True

  try:
    cel_ctx = json_to_cel(_normalize_for_json(context))
    ast = _env.compile(expression.strip())
    prog = _env.program(ast)
    result = prog.evaluate(cel_ctx)
  except CELParseError as e:
    logger.warning("CEL parse error: %s", e)
    return False
  except (CELEvalError, TypeError, ValueError, KeyError) as e:
    logger.warning("CEL evaluation error: %s", e)
    return False
  except Exception as e:
    logger.error("CEL evaluation unexpected error: %s", e, exc_info=True)
    return False

  if isinstance(result, CELEvalError):
    logger.error("CEL returned error result: %s", result)
    return False

  if isinstance(result, BoolType):
    return bool(result)

  logger.warning("CEL expression did not evaluate to bool: %s", type(result).__name__)
  return False


def _normalize_for_json(obj: Any) -> Any:
  """Recursively convert mappings/lists to plain JSON-friendly structures."""
  if isinstance(obj, Mapping):
    return {str(k): _normalize_for_json(v) for k, v in obj.items()}
  if isinstance(obj, (list, tuple)):
    return [_normalize_for_json(v) for v in obj]
  if isinstance(obj, (str, int, float, bool)) or obj is None:
    return obj
  return str(obj)

# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""pytest bootstrap for the webex_bot test suite.

The package ships under ``ai_platform_engineering/integrations/webex_bot/``
in the monorepo but at runtime it lives at ``/app/webex_bot/`` inside
the Docker image (see ``build/Dockerfile.webex-bot``). To keep imports
identical in both contexts we expose the package directly as
``webex_bot`` on ``sys.path`` -- tests then say
``from webex_bot.X import ...`` exactly as production does.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parents[1]  # .../webex_bot/
_INTEGRATIONS_DIR = _PKG_DIR.parent             # .../integrations/

# Insert the integrations directory on sys.path so ``webex_bot`` is a
# top-level package importable as ``webex_bot``. Idempotent so IDE
# test runners that re-collect the suite don't grow sys.path.
candidate = str(_INTEGRATIONS_DIR)
if candidate not in sys.path:
    sys.path.insert(0, candidate)

# When this package is *also* importable as
# ``ai_platform_engineering.integrations.webex_bot`` (which is the
# case when someone runs the suite from the monorepo root and
# previous tests already imported the qualified name), Python keeps
# them as two distinct module objects -- breaking ``isinstance`` and
# enum identity checks across the boundary. Install an alias the
# first time we resolve the flat name so submodules pull from one
# canonical module object regardless of how they were imported.
if "webex_bot" not in sys.modules:
    pkg = types.ModuleType("webex_bot")
    pkg.__path__ = [str(_PKG_DIR)]  # behave like a regular package
    sys.modules["webex_bot"] = pkg

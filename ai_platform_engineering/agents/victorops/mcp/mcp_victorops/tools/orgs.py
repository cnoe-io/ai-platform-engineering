# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tool for listing configured VictorOps organizations."""

import json

from ..api.client import list_orgs


async def list_victorops_orgs() -> str:
    """List the configured VictorOps organizations.

    Returns the org slugs that can be passed as the org_slug parameter
    to other VictorOps tools. When only one org is configured, tools
    use it automatically without requiring org_slug.

    Returns:
        str: Pretty-printed JSON with an "orgs" key containing a list of org slug strings.
    """
    return json.dumps({"orgs": list_orgs()}, indent=2)

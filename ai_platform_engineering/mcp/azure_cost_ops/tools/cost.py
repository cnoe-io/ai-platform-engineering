# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Cost visibility and budget-alert tools for customer Azure environments.

`az consumption usage list` is subscription/billing-period scoped - it has
no --resource-group filter - so per-customer numbers are produced by
filtering usage records client-side on each record's instanceId containing
the customer's resource group. This is a real limitation of the installed
`az consumption` surface, not a design choice; see README.md's "Known
limitations" section before trusting a customer-scoped total.

A true cost forecast (az costmanagement query --type ActualCost) was not
verified against the az CLI/extension version available while building this
server - forecast is deliberately not exposed as a tool until that's
confirmed. See README.md.
"""

import json
import logging
from datetime import date
from typing import Any, Dict

from .azure_runner import AzureConfigError, run_az_command
from .registry import ALL_SCOPE, resolve_scope

logger = logging.getLogger(__name__)

GUARDED_SCOPES = frozenset()  # populated per-call: every customer + "all" always guarded for budget writes


def _month_to_date_range() -> tuple[str, str]:
    today = date.today()
    start = today.replace(day=1)
    return start.isoformat(), today.isoformat()


def _parse_usage_rows(raw_stdout: str):
    try:
        return json.loads(raw_stdout) if raw_stdout.strip() else []
    except json.JSONDecodeError:
        return None


def _matches_rg(row: Dict[str, Any], resource_group: str) -> bool:
    instance_id = (row.get("instanceId") or "").lower()
    return f"/resourcegroups/{resource_group.lower()}/" in instance_id


async def cost_get_current_spend(scope: str) -> dict:
    """
    Get month-to-date spend for a customer environment or "all" customer
    environments, filtered from subscription-wide usage records by resource
    group membership.

    Args:
        scope: A customer name (e.g. "acme"), as registered under
            envs/azure/<customer>/, or "all" for every registered customer.
    """
    pairs = resolve_scope(scope)
    if not pairs:
        return {"error": f"Unknown customer or scope: {scope!r}. No registered Azure environment matches."}

    start, end = _month_to_date_range()
    result = await run_az_command(["consumption", "usage", "list", "-s", start, "-e", end, "-t", "1000"])
    if not result.get("success"):
        return {"scope": scope, "period": {"start": start, "end": end}, "error": result.get("stderr") or result.get("error")}

    rows = _parse_usage_rows(result.get("stdout", ""))
    if rows is None:
        return {"scope": scope, "period": {"start": start, "end": end}, "error": "Could not parse az consumption usage list output"}

    spend_by_customer: Dict[str, float] = {}
    for customer, rg in pairs:
        total = 0.0
        for row in rows:
            if _matches_rg(row, rg):
                total += float(row.get("pretaxCost", 0) or 0)
        spend_by_customer[customer] = round(total, 2)

    return {
        "scope": scope,
        "period": {"start": start, "end": end},
        "spend_by_customer": spend_by_customer,
        "currency": rows[0].get("currency") if rows else None,
    }


async def cost_list_top_resources(scope: str, top_n: int = 10) -> dict:
    """
    List the highest-cost resources (month-to-date) for a customer
    environment or "all" customer environments.

    Args:
        scope: A customer name or "all".
        top_n: Max number of resources to return, highest cost first.
    """
    pairs = resolve_scope(scope)
    if not pairs:
        return {"error": f"Unknown customer or scope: {scope!r}. No registered Azure environment matches."}

    start, end = _month_to_date_range()
    result = await run_az_command(["consumption", "usage", "list", "-s", start, "-e", end, "-t", "1000"])
    if not result.get("success"):
        return {"scope": scope, "error": result.get("stderr") or result.get("error")}

    rows = _parse_usage_rows(result.get("stdout", ""))
    if rows is None:
        return {"scope": scope, "error": "Could not parse az consumption usage list output"}

    target_rgs = {rg.lower() for _, rg in pairs}
    matched = [row for row in rows if any(f"/resourcegroups/{rg}/" in (row.get("instanceId") or "").lower() for rg in target_rgs)]
    matched.sort(key=lambda row: float(row.get("pretaxCost", 0) or 0), reverse=True)

    return {
        "scope": scope,
        "period": {"start": start, "end": end},
        "top_resources": [
            {
                "instance_name": row.get("instanceName"),
                "meter_category": row.get("meterCategory"),
                "cost": round(float(row.get("pretaxCost", 0) or 0), 2),
                "currency": row.get("currency"),
            }
            for row in matched[:top_n]
        ],
    }


async def cost_set_budget_alert(scope: str, amount: float, confirm: bool = False) -> dict:
    """
    Create a monthly budget alert for a customer environment's resource
    group. This writes real subscription state (a budget + its notification
    wiring) and is always guarded - requires confirm=True regardless of
    scope, same guard discipline as azure_power_ops's power_on/power_off.

    Args:
        scope: A single customer name - "all" is refused for this tool,
            since one budget per resource group (not a combined budget) is
            the only shape az consumption budget create-with-rg supports.
        amount: Monthly budget amount in the subscription's billing currency.
        confirm: Must be True to actually create the budget.
    """
    if scope == ALL_SCOPE:
        return {"error": "scope \"all\" is not supported for cost_set_budget_alert - create one budget per customer"}
    if not confirm:
        return {"error": "cost_set_budget_alert always requires confirm=True - it creates real subscription state"}

    pairs = resolve_scope(scope)
    if not pairs:
        return {"error": f"Unknown customer: {scope!r}. No registered Azure environment matches."}
    customer, resource_group = pairs[0]

    today = date.today()
    start = today.replace(day=1).isoformat()
    # az consumption budget requires an end date; use a far-future one for an open-ended monthly budget.
    end = date(today.year + 5, today.month, 1).isoformat()

    try:
        result = await run_az_command([
            "consumption", "budget", "create-with-rg",
            "--resource-group", resource_group,
            "--budget-name", f"kendra-{customer}-monthly-budget",
            "--category", "cost",
            "--amount", str(amount),
            "--time-grain", "monthly",
            "--start-date", start,
            "--end-date", end,
        ])
    except AzureConfigError as e:
        return {"scope": scope, "error": str(e)}

    return {"scope": scope, "resource_group": resource_group, "amount": amount, "result": result}

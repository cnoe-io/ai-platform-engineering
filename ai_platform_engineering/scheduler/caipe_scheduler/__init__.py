"""CAIPE scheduler: cron-style schedules for dynamic agents.

A small REST service that owns kubernetes CronJob lifecycle on behalf of
dynamic-agents. dynamic-agents itself never gets `cronjobs.*` RBAC; it only
HTTP POSTs here. The CronJob podTemplate is hard-coded in this package so
callers cannot inject arbitrary container specs.
"""

from caipe_scheduler.__about__ import __version__

__all__ = ["__version__"]

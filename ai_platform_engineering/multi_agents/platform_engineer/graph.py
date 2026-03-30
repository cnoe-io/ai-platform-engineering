import asyncio
from ai_platform_engineering.multi_agents.platform_engineer.supervisor_agent import AIPlatformEngineerMAS

_mas = AIPlatformEngineerMAS()
asyncio.run(_mas.ensure_initialized())
graph = _mas.get_graph()

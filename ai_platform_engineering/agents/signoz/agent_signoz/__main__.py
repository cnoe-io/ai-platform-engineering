# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""SigNoz Agent Entry Point."""

import os

import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv

from agent_signoz.agentcard import get_agent_card
from agent_signoz.protocol_bindings.a2a_server.agent_executor import (
    SigNozAgentExecutor,
)


def main():
    load_dotenv()
    host = os.getenv("A2A_HOST", "localhost")
    port = int(os.getenv("A2A_PORT", "8004"))

    agent_card = get_agent_card(host, port)
    agent_executor = SigNozAgentExecutor()

    request_handler = DefaultRequestHandler(
        agent_executor=agent_executor, task_store=InMemoryTaskStore()
    )
    server = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler,
    )
    uvicorn.run(server.build(), host=host, port=port)


if __name__ == "__main__":
    main()

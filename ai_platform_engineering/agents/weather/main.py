from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from agntcy_app_sdk.factory import AgntcyFactory

"""
Create the AgentSkill and AgentCard for a simple weather report agent.
"""

skill = AgentSkill(
    id="weather_report",
    name="Returns weather report",
    description="Provides a simple weather report",
    tags=["weather", "report"],
    examples=["What's the weather like?", "Give me a weather report"],
)

agent_card = AgentCard(
    name="Weather Agent",
    description="An agent that provides weather reports",
    url="",
    version="1.0.0",
    defaultInputModes=["text"],
    defaultOutputModes=["text"],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)

"""
Create the actual agent logic and executor.
"""

class WeatherAgent:
    """A simple agent that returns a weather report."""
    async def invoke(self) -> str:
        return "The weather is sunny with a high of 75°F."

class WeatherAgentExecutor(AgentExecutor):
    """Test AgentProxy Implementation."""

    def __init__(self):
        self.agent = WeatherAgent()

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        result = await self.agent.invoke()
        event_queue.enqueue_event(new_agent_text_message(result))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise Exception("cancel not supported")

"""
Create the A2A server and transport bridge to server the Weather Agent.
"""

async def main():
    # create an app-sdk factory to create the transport and bridge
    factory = AgntcyFactory()

    request_handler = DefaultRequestHandler(
        agent_executor=WeatherAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=agent_card, http_handler=request_handler
    )

    transport = factory.create_transport("SLIM", endpoint="http://slim-dataplane:46357")
    bridge = factory.create_bridge(server, transport=transport)
    await bridge.start(blocking=True)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
import logging
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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

"""
Create the AgentSkill and AgentCard for a simple weather report agent.
"""

logger.info("Initializing AgentSkill and AgentCard for Weather Agent.")

weather_agent_skill = AgentSkill(
  id="weather_agent_skill",
  name="Weather Agent Skill",
  description="Provides capabilities to retrieve current weather, forecasts, and weather-related data.",
  tags=[
    "weather",
    "forecast",
    "temperature",
    "humidity",
    "conditions"
  ],
  examples=[
      "Get the current weather in New York.",
      "Show the 5-day forecast for London.",
      "What is the humidity in Tokyo right now?",
      "Will it rain tomorrow in Paris?",
      "Provide the temperature and conditions for San Francisco."
  ])

agent_card = AgentCard(
  name="Weather",
  id='weather-tools-agent',
  description='An AI agent that provides capabilities to list, manage, and retrieve weather information and forecasts.',
  url="",
  version="0.1.0",
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(streaming=False),
  skills=[weather_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)

logger.info("AgentSkill and AgentCard initialized successfully.")

"""
Create the actual agent logic and executor.
"""

class WeatherAgent:
  """A simple agent that returns a weather report."""
  async def invoke(self) -> str:
    logger.info("WeatherAgent invoked.")
    return "The weather is sunny with a high of 75°F."

class WeatherAgentExecutor(AgentExecutor):
  """Test AgentProxy Implementation."""

  def __init__(self):
    logger.info("Initializing WeatherAgentExecutor.")
    self.agent = WeatherAgent()

  async def execute(
    self,
    context: RequestContext,
    event_queue: EventQueue,
  ) -> None:
    logger.info("Executing WeatherAgentExecutor.")
    try:
      result = await self.agent.invoke()
      logger.info(f"WeatherAgent returned result: {result}")
      event_queue.enqueue_event(new_agent_text_message(result))
    except Exception as e:
      logger.error(f"Error during execution: {e}", exc_info=True)

  async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
    logger.warning("Cancel method called, but it is not supported.")
    raise Exception("cancel not supported")

"""
Create the A2A server and transport bridge to serve the Weather Agent.
"""

async def main():
  logger.info("Starting Weather Agent server.")
  try:
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
    logger.info("Transport created successfully.")

    bridge = factory.create_bridge(server, transport=transport)
    logger.info("Bridge created successfully. Starting the bridge.")
    await bridge.start(blocking=True)
  except Exception as e:
    logger.error(f"Error in main: {e}", exc_info=True)

if __name__ == "__main__":
  import asyncio
  logger.info("Running Weather Agent application.")
  asyncio.run(main())
from langchain_openai import AzureChatOpenAI

from langgraph_supervisor import create_supervisor
from langgraph.prebuilt import create_react_agent
import random

from .utils import load_and_validate_env_vars
from .llm_factory import LLMFactory
from .logging_config import configure_logging

# Load and validate environment variables
load_and_validate_env_vars()

model = LLMFactory(provider="azure").get_llm()

texas_trails = [
  "Big Bend National Park",
  "Guadalupe Mountains National Park",
  "Enchanted Rock State Natural Area",
  "Palo Duro Canyon State Park",
  "Lost Maples State Natural Area"
]
# Create specialized agents

def recommend_hike_based_on_weather(location: str, weather: str) -> str:
  """
  Recommend a hiking trail based on the current weather condition.

  Args:
    location (str): The name of the location to search for hiking trails.
    weather (str): A description of the current weather condition.

  Returns:
    str: A string recommending a hiking trail suitable for the weather.
  """
  print(f"[DEBUG] recommend_hike_based_on_weather called with location={location}, weather={weather}")
  if weather.lower() in ["sunny", "clear"]:
    trail = random.choice(texas_trails)
    print(f"[DEBUG] Selected trail for sunny/clear weather: {trail}")
    return f"Recommended trail in {location} for {weather} weather: {trail}"
  elif weather.lower() in ["cloudy", "overcast"]:
    trail = random.choice(texas_trails)
    print(f"[DEBUG] Selected trail for cloudy/overcast weather: {trail}")
    return f"Recommended trail in {location} for {weather} weather: {trail}"
  elif weather.lower() in ["rainy", "stormy"]:
    trail = random.choice(texas_trails)
    print(f"[DEBUG] Selected trail for rainy/stormy weather: {trail}")
    return f"Recommended trail in {location} for {weather} weather: {trail} (with caution)"
  else:
    print(f"[DEBUG] No specific recommendation for weather: {weather}")
    return f"No specific recommendation for {weather} weather in {location}. Use your best judgment."

hiking_agent = create_react_agent(
  model=model,
  tools=[recommend_hike_based_on_weather],
  name="hiking_agent",
  prompt="You are a Hiking expert. Always use one tool at a time."
)

# Create a complementary agent for Weather Analysis
def get_current_weather(location: str) -> str:
  """
  Retrieve the current weather for a given location.

  Args:
    location (str): The name of the location to get the current weather.

  Returns:
    str: A string describing the current weather in the specified location.
  """
  print(f"[DEBUG] get_current_weather called with location={location}")
  weather_conditions = ["Sunny", "Rainy", "Cloudy", "Stormy", "Snowy"]
  weather = random.choice(weather_conditions)
  print(f"[DEBUG] Selected current weather: {weather}")
  return f"Weather in {location}: {weather}"

def get_weather_forecast(location: str, time_frame: str) -> str:
  """
  Retrieve the weather forecast for a given location and time frame.

  Args:
    location (str): The name of the location for which the weather forecast is requested.
    time_frame (str): The time frame for the weather forecast (e.g., "today", "tomorrow", "this weekend").

  Returns:
    str: A string containing the weather forecast for the specified location and time frame.
  """
  print(f"[DEBUG] get_weather_forecast called with location={location}, time_frame={time_frame}")
  forecasts = ["Sunny", "Rainy", "Cloudy", "Stormy", "Snowy"]
  forecast = random.choice(forecasts)
  print(f"[DEBUG] Selected forecast: {forecast}")
  return f"Forecast in {location} for {time_frame}: {forecast}"

weather_agent = create_react_agent(
  model=model,
  tools=[get_current_weather, get_weather_forecast],
  name="weather_agent",
  prompt="You are a Weather Analysis expert. Always use one tool at a time."
)

# Create supervisor workflow
workflow = create_supervisor(
  [hiking_agent, weather_agent],
  model=model,
  prompt=(
    "You are a weekend activity planner agent."
    "For hiking-related queries, use hiking_agent. "
    "For weather-related queries, use weather_agent."
  )
)

# Compile and run
agent = workflow.compile()
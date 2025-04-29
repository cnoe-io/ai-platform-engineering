from langchain_openai import AzureChatOpenAI

from langgraph_supervisor import create_supervisor
from langgraph.prebuilt import create_react_agent
import random

from .utils import load_and_validate_env_vars
from .llm_factory import LLMFactory
from .logging_config import configure_logging
from geopy.geocoders import Nominatim
import requests

# Load and validate environment variables
load_and_validate_env_vars()

model = LLMFactory(provider="azure").get_llm()

hiking_trails = [
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
    trail = random.choice(hiking_trails)
    print(f"[DEBUG] Selected trail for sunny/clear weather: {trail}")
    return f"Recommended trail in {location} for {weather} weather: {trail}"
  elif weather.lower() in ["cloudy", "overcast"]:
    trail = random.choice(hiking_trails)
    print(f"[DEBUG] Selected trail for cloudy/overcast weather: {trail}")
    return f"Recommended trail in {location} for {weather} weather: {trail}"
  elif weather.lower() in ["rainy", "stormy"]:
    trail = random.choice(hiking_trails)
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

def get_lat_lon(city: str) -> str:
  """
  Get the latitude and longitude of a given city.

  Args:
    city (str): The name of the city.

  Returns:
    str: A string containing the latitude and longitude of the city.
  """
  print(f"[DEBUG] get_lat_lon called with city={city}")
  geolocator = Nominatim(user_agent="geoapi")
  location = geolocator.geocode(city)
  if location:
    lat_lon = f"Latitude: {location.latitude}, Longitude: {location.longitude}"
    print(f"[DEBUG] Found location: {lat_lon}")
    return lat_lon
  else:
    print(f"[DEBUG] Location not found for city: {city}")
    return f"Location not found for city: {city}"

location_agent = create_react_agent(
  model=model,
  tools=[get_lat_lon],
  name="location_agent",
  prompt="You are a Location expert. Provide latitude and longitude for a given city."
)

# Create a complementary agent for Weather Analysis
def get_current_weather(location: str) -> str:
  """
  Retrieve the current weather for a given location using the weather.gov API.

  Args:
    location (str): The name of the location to get the current weather.

  Returns:
    str: A string describing the current weather in the specified location.
  """
  print(f"[DEBUG] get_current_weather called with location={location}")
  geolocator = Nominatim(user_agent="geoapi")
  loc = geolocator.geocode(location)
  if not loc:
    print(f"[DEBUG] Location not found for: {location}")
    return f"Location not found for: {location}"

  lat, lon = loc.latitude, loc.longitude
  print(f"[DEBUG] Found coordinates: lat={lat}, lon={lon}")

  try:
    url = f"https://api.weather.gov/points/{lat},{lon}"
    print(f"[DEBUG] Fetching weather data from: {url}")
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()

    forecast_url = data["properties"]["forecast"]
    print(f"[DEBUG] Forecast URL: {forecast_url}")
    forecast_response = requests.get(forecast_url)
    forecast_response.raise_for_status()
    forecast_data = forecast_response.json()

    current_weather = forecast_data["properties"]["periods"][0]["detailedForecast"]
    print(f"[DEBUG] Current weather: {current_weather}")
    return f"Weather in {location}: {current_weather}"
  except Exception as e:
    print(f"[DEBUG] Error fetching weather data: {e}")
    return f"Unable to retrieve weather data for {location}."

weather_agent = create_react_agent(
  model=model,
  tools=[get_current_weather],
  name="weather_agent",
  prompt="You are only responsible for weather analysis. Always provide the current weather of a given city."
)

# Create a complementary agent for Movies
def recommend_movie(genre: str) -> str:
  """
  Recommend a movie based on the specified genre.

  Args:
    genre (str): The genre of the movie to recommend.

  Returns:
    str: A string recommending a movie.
  """
  print(f"[DEBUG] recommend_movie called with genre={genre}")
  movies = {
    "action": ["Mad Max: Fury Road", "Die Hard", "John Wick"],
    "comedy": ["Superbad", "The Grand Budapest Hotel", "Step Brothers"],
    "drama": ["The Shawshank Redemption", "Forrest Gump", "The Godfather"],
    "sci-fi": ["Inception", "The Matrix", "Interstellar"],
    "horror": ["The Conjuring", "Get Out", "A Quiet Place"]
  }
  recommended = random.choice(movies.get(genre.lower(), ["No recommendations available for this genre."]))
  print(f"[DEBUG] Recommended movie: {recommended}")
  return f"Recommended {genre} movie: {recommended}"

movies_agent = create_react_agent(
  model=model,
  tools=[recommend_movie],
  name="movies_agent",
  prompt="Recommend a movie. Alway pick a random genre from the list if user hasn't specified: action, comedy, drama, sci-fi, horror. "
)

# Create a complementary agent for Sports
def recommend_sport(activity_level: str) -> str:
  """
  Recommend a sport based on the desired activity level.

  Args:
    activity_level (str): The activity level (e.g., "low", "moderate", "high").

  Returns:
    str: A string recommending a sport.
  """
  print(f"[DEBUG] recommend_sport called with activity_level={activity_level}")
  sports = {
    "low": ["Golf", "Bowling", "Fishing"],
    "moderate": ["Tennis", "Cycling", "Hiking"],
    "high": ["Soccer", "Basketball", "Running"]
  }
  recommended = random.choice(sports.get(activity_level.lower(), ["No recommendations available for this activity level."]))
  print(f"[DEBUG] Recommended sport: {recommended}")
  return f"Recommended sport for {activity_level} activity level: {recommended}"

sports_agent = create_react_agent(
  model=model,
  tools=[recommend_sport],
  name="sports_agent",
  prompt="Recommend a sport. Pick a random activity level from the list if user hasn't specified: low, moderate, high. "
)

# Create a complementary agent for Hobbies
def recommend_hobby(interest: str) -> str:
  """
  Recommend a hobby based on the user's interest.

  Args:
    interest (str): The user's area of interest.

  Returns:
    str: A string recommending a hobby.
  """
  print(f"[DEBUG] recommend_hobby called with interest={interest}")
  hobbies = {
    "art": ["Painting", "Sketching", "Photography"],
    "technology": ["Coding", "Robotics", "3D Printing"],
    "outdoors": ["Gardening", "Bird Watching", "Camping"],
    "music": ["Playing Guitar", "Singing", "Composing"]
  }
  recommended = random.choice(hobbies.get(interest.lower(), ["No recommendations available for this interest."]))
  print(f"[DEBUG] Recommended hobby: {recommended}")
  return f"Recommended hobby for {interest}: {recommended}"

hobbies_agent = create_react_agent(
  model=model,
  tools=[recommend_hobby],
  name="hobbies_agent",
  prompt="Recommended hobby. Pick a random interest from the list if user hasn't specified: art, technology, outdoors, music."
)

# Create supervisor workflow
workflow = create_supervisor(
  [hiking_agent, weather_agent, movies_agent, sports_agent, hobbies_agent],
  model=model,
  prompt=(
    "You are a versatile activity planner agent. User needs to a location in their question."
    "Note: Always check the current weather first in the given city using weather_agent and determine if it is sunny, cloudy, rainy, or stormy."
    "Based on the weather, choose the appropriate activity"
    "For sunny or clear weather, recommend hiking, sports, or outdoor hobbies using hiking_agent, sports_agent, or hobbies_agent. "
    "For cloudy or rainy weather, recommend movies, or indoor hobbies using movies_agent or hobbies_agent. "
    "For other weather conditions, provide a general recommendation using your best judgment."
  )
)

# Compile and run
agent = workflow.compile()
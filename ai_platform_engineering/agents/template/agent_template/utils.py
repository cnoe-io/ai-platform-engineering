# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv
import os

def load_and_validate_env_vars():

  # Load environment variables from a .env file
  load_dotenv()

  # Access and validate environment variables
  required_env_vars = [
    "OPENAI_API_VERSION",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_API_VERSION",
    "AZURE_OPENAI_DEPLOYMENT",
  ]

  missing_vars = [var for var in required_env_vars if not os.getenv(var)]
  if missing_vars:
    raise EnvironmentError(f"Missing required environment variables: {', '.join(missing_vars)}")

import os
import sys
import json
import requests
import logging
from dotenv import load_dotenv
import jwt
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

log = logging.getLogger(__name__)

def check_environment():
  """Check if all required environment variables are set"""
  required_vars = ["OAUTH2_CLIENT_ID", "OAUTH2_CLIENT_SECRET", "TOKEN_ENDPOINT"]
  missing = [var for var in required_vars if not os.getenv(var)]

  if missing:
    print(f"❌ Missing: {', '.join(missing)}")
    print("Set them in .env file or environment")
    return False
  return True

def is_token_expired(token):
  """
  Check if JWT token is expired or will expire soon

  Parameters
  ----------
  token: str
    JWT token to check

  Returns
  -------
  bool: True if token is expired or expires within 30 seconds, False otherwise
  """
  try:
    # Decode JWT token without verification
    decoded_token = jwt.decode(token, options={"verify_signature": False})

    # Check if 'exp' claim exists
    if 'exp' not in decoded_token:
      log.warning("Token has no expiration claim, treating as expired")
      return True

    # Get expiration time
    exp_timestamp = decoded_token['exp']
    now_timestamp = int(datetime.now().timestamp())

    # Check if token expires within 30 seconds
    time_until_expiry = exp_timestamp - now_timestamp

    if time_until_expiry <= 30:
      log.debug(f"Token expires in {time_until_expiry} seconds, considered expired")
      return True

    log.debug(f"Token is valid for {time_until_expiry} more seconds")
    return False

  except jwt.InvalidTokenError as e:
    log.error(f"Invalid token format: {e}")
    return True
  except Exception as e:
    log.error(f"Error checking token expiry: {e}")
    return True

def parse_jwt_token(token):
  """
  Parse JWT token and return human-readable contents

  Parameters
  ----------
  token: str
    JWT token to parse

  Returns
  -------
  dict: Parsed token contents
  """
  try:
    # Decode JWT token without verification (since we just want to read the contents)
    decoded_token = jwt.decode(token, options={"verify_signature": False})
    return decoded_token
  except jwt.InvalidTokenError as e:
    log.error(f"Failed to parse JWT token: {e}")
    return None

def display_token_contents(token):
  """
  Display JWT token contents in a human-readable format

  Parameters
  ----------
  token: str
    JWT token to display
  """
  parsed_token = parse_jwt_token(token)
  if not parsed_token:
    print("Failed to parse JWT token")
    return

  print("\n" + "="*60)
  print("JWT TOKEN CONTENTS")
  print("="*60)

  # Display common JWT claims
  common_claims = {
    'iss': 'Issuer',
    'sub': 'Subject',
    'aud': 'Audience',
    'exp': 'Expiration Time',
    'iat': 'Issued At',
    'nbf': 'Not Before',
    'jti': 'JWT ID',
    'scope': 'Scope',
    'client_id': 'Client ID',
    'token_type': 'Token Type'
  }

  for claim, description in common_claims.items():
    if claim in parsed_token:
      value = parsed_token[claim]
      if claim in ['exp', 'iat', 'nbf'] and isinstance(value, (int, float)):
        # Convert timestamp to human-readable format
        try:
          dt = datetime.fromtimestamp(value)
          value = f"{value} ({dt.strftime('%Y-%m-%d %H:%M:%S UTC')})"
        except (ValueError, OSError):
          pass
      print(f"{description:20}: {value}")

  # Display any additional claims
  additional_claims = set(parsed_token.keys()) - set(common_claims.keys())
  if additional_claims:
    print(f"\nAdditional Claims:")
    for claim in sorted(additional_claims):
      value = parsed_token[claim]
      if isinstance(value, dict):
        print(f"{claim:20}: {json.dumps(value, indent=22)}")
      else:
        print(f"{claim:20}: {value}")

  print("="*60)

def get_token():
  """
  Get Cisco Access Token

  Parameters
  ----------
  None

  Returns
  -------
  access_token: JWT Access token
  """
  # Get credentials from environment variables
  client_id = os.getenv("OAUTH2_CLIENT_ID")
  client_secret = os.getenv("OAUTH2_CLIENT_SECRET")
  token_endpoint = os.getenv("TOKEN_ENDPOINT")

  if not all([client_id, client_secret, token_endpoint]):
    log.fatal("Missing required environment variables. Check .env file or environment.")
    sys.exit(1)

  # OIDC auth flow using direct token endpoint
  access_point = token_endpoint
  grant_type = 'client_credentials'

  headers = {'Content-Type': 'application/x-www-form-urlencoded'}

  data = {'grant_type': grant_type,
          'client_id': client_id,
          'client_secret': client_secret}
  resp = None
  try:
      resp = requests.post(access_point, data=data, headers=headers, timeout=5)
  except Exception as e:
      print(e)
      exit(1)

  # Return access_token to the caller
  if resp.status_code == 200:
      resp = json.loads(resp.text)
      if 'access_token' in resp:
          return resp['access_token']

  # If we get here, something went wrong
  log.error(f"Failed to get access token. Status code: {resp.status_code}")
  return None

def get_oauth2_token():
  """
  Main function to get OAuth2 token
  """
  return get_token()

if __name__ == "__main__":
  logging.basicConfig(level=logging.DEBUG)

  if not check_environment():
    sys.exit(1)

  print("🔐 Getting Access Token...")
  token = get_oauth2_token()
  if token:
    print(f"✅ Access Token: {token}")

    # Check if token is expired
    if is_token_expired(token):
      print("⚠️  Warning: Token is expired or about to expire!")
    else:
      print("✅ Token is valid and not expired")

    display_token_contents(token)
  else:
    print("❌ Failed to get access token")
    sys.exit(1)

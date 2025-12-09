import json
import logging
import os
from json import JSONEncoder
import traceback
import asyncio
import hashlib
import time
import uuid
from urllib.parse import urlparse
from common.models.graph import Entity

DURATION_DAY = 60 * 60 * 24
DURATION_HOUR = 60 * 60
DURATION_MINUTE = 60

DEFAULT_FRESH_UNTIL = int(os.getenv("DEFAULT_FRESH_UNTIL_SECONDS", DURATION_DAY * 7))  # Default TTL is one week

class ObjEncoder(JSONEncoder):
    def __init__(self, *args, **argv):
        super().__init__(*args, **argv)
        self.proc_objs = []
        
    def default(self, o):
        # Check for circular reference
        obj_id = id(o)
        if obj_id in self.proc_objs:
            return f"<CircularRef:{type(o).__name__}>"
        
        if isinstance(o, set):
            return list(o)
        elif isinstance(o, frozenset):
            return list(o)
        elif isinstance(o, tuple):
            return list(o)
        else:
            try:
                # Add object to processed list before processing its attributes
                self.proc_objs.append(obj_id)
                result = o.__dict__
                # Remove object from processed list after processing
                self.proc_objs.remove(obj_id)
                return result
            except AttributeError:
                return str(o)

def json_encode(obj, **kwargs):
    """
    Encodes an object to JSON using the custom encoder.
    """
    return json.dumps(remove_circular_refs(obj), cls=ObjEncoder, check_circular=False,  **kwargs)

def remove_circular_refs(ob, _seen=None):
    if _seen is None:
        _seen = set()
    if id(ob) in _seen:
        return f"<CircularRef:{type(ob).__name__}>"
    _seen.add(id(ob))
    try:
        if isinstance(ob, dict):
            res = {
                remove_circular_refs(key, _seen): remove_circular_refs(value, _seen)
                for key, value in ob.items()
            }
        elif isinstance(ob, list):
            res = [remove_circular_refs(v, _seen) for v in ob]
        elif isinstance(ob, tuple):
            res = tuple(remove_circular_refs(v, _seen) for v in ob)
        elif isinstance(ob, set):
            res = {remove_circular_refs(v, _seen) for v in ob}
        elif isinstance(ob, frozenset):
            res = frozenset(remove_circular_refs(v, _seen) for v in ob)
        elif hasattr(ob, '__dict__'):
            # For objects with __dict__, convert to dict to avoid constructor issues
            res = {
                key: remove_circular_refs(value, _seen)
                for key, value in ob.__dict__.items()
            }
        else:
            # For all other types (primitives, objects, etc.), return as-is
            res = ob
    except Exception:
        # If any error occurs during processing, return string representation
        res = str(ob)
    finally:
        _seen.remove(id(ob))
    
    return res

def sanitize_url(url: str) -> str:
    url = url.strip()
    parsed = urlparse(url) # Parse the URL
    if not parsed.scheme:  # Add default scheme if missing
        parsed = urlparse("https://" + url)
    if parsed.scheme not in ('http', 'https'):  # Validate scheme is http or https
        raise ValueError(f"Invalid URL scheme. Only HTTP and HTTPS are supported, got: {parsed.scheme}")
    if not parsed.netloc: # Validate that we have a netloc (domain)
        raise ValueError("Invalid URL: missing domain name")
    url = parsed.geturl() # Reconstruct the URL to ensure it's properly formatted
    return url

def generate_datasource_id_from_url(url: str) -> str:
        """Generate a unique source ID based on URL"""
        source_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        # Replace non-alphanumeric characters with underscore
        clean_url = ''.join(c if c.isalnum() else '_' for c in url)
        return f"src_{clean_url}_{source_hash}"

def generate_document_id_from_url(datasource_id: str, url: str) -> str:
        """Generate a unique document ID based on datasource ID and URL"""
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        return f"{datasource_id}_doc_{url_hash}"

class CustomFormatter(logging.Formatter):
    """
    Custom formatter for logging
    """
    grey = "\x1b[38;20m"
    yellow = "\x1b[33;20m"
    red = "\x1b[31;20m"
    bold_red = "\x1b[31;1m"
    reset = "\x1b[0m"
    _format = "%(asctime)s - [%(name)s] %(levelname)s - %(message)s (%(filename)s:%(lineno)d)"
    FORMATS = {
        logging.DEBUG: grey + _format + reset,
        logging.INFO: grey + _format + reset,
        logging.WARNING: yellow + _format + reset,
        logging.ERROR: red + _format + reset,
        logging.CRITICAL: bold_red + _format + reset
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno)
        formatter = logging.Formatter(log_fmt)
        return formatter.format(record)

def get_logger(name) -> logging.Logger:
    """
    Returns a logger with the given name and custom formatter
    """
    logger = logging.getLogger("rag")
    logger.propagate = False
    logger = logging.getLogger(f"rag.{name}")
    logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())

    # Only add handler if it doesn't already exist (prevents duplicate logs)
    if not logger.handlers:
        formatter = CustomFormatter()
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger

async def gather(n: int, *coros: asyncio.Future, logger: logging.Logger):
    """
    Gathers (waits for) a list of coroutines with a limit on the number of concurrent executions.
    """ 
    semaphore = asyncio.Semaphore(n)

    async def sem_coro(index, coro):
        async with semaphore:
            try:
                await coro
            except Exception as e:
                logger.error(traceback.format_exc())
                logger.error(f"Error in task {index}: {e}")
            
            logger.debug(f"Finished task {index}")
            return 
    
    logger.debug(f"Starting {len(coros)} tasks with {n} concurrent tasks")
    await asyncio.gather(*(sem_coro(index, coro) for index, coro in enumerate(coros)))
    logger.info(f"All {len(coros)} tasks finished")


def hash_entity_properties(entity: Entity):
    """
    Hashes the properties of an entity
    """
    entity_dict = {}
    for key, val in entity.all_properties.items():
        if key[0] == "_":
            continue
        if val == "":
            continue
        entity_dict[key] = val
    return hash_dict(entity_dict)

def hash_dict(d: dict) -> str:
    """
    Hashes a dictionary object into a string.
    """
    h = hashlib.new("md5")
    encoded = json.dumps(d, sort_keys=True, cls=ObjEncoder).encode()
    h.update(encoded)
    return str(h.hexdigest())

def get_default_fresh_until() -> int:
    """
    Get the default fresh until timestamp (one week)
    :return: fresh until timestamp
    """
    return int(time.time()) + DEFAULT_FRESH_UNTIL

def get_uuid():
    """
    Returns a random UUID.
    """
    return str(uuid.uuid4())

def retry_function(func, retries=20, delay=5, *args, **kwargs):
    """
    Tries to execute the given function up to `max_retries` times.
    If the function raises an exception, it waits `delay` seconds before retrying.

    :param func: The function to execute.
    :param retries: Maximum number of retry attempts.
    :param delay: Delay between retries in seconds.
    :param args: Positional arguments for the function.
    :param kwargs: Keyword arguments for the function.
    :raises: The last exception encountered if the function fails all attempts.
    """
    attempt = 0
    while attempt < retries:
        try:
            return func(*args, **kwargs)
        except Exception as e:
            attempt += 1
            logging.warning(f"Attempt {attempt} failed: {e}")
            logging.error(f"Cool down of {delay} seconds, before retrying...")
            if attempt >= retries:
                logging.error(f"Function '{func.__name__}' failed after {retries} attempts.")
                raise e
            for i in range(delay):
                logging.info(f"Retrying '{func.__name__}' in {delay-i} seconds...")
                try:
                    time.sleep(1)
                except KeyboardInterrupt:
                    logging.info("Keyboard interrupt received, stopping retry...")
                    exit(0)


async def retry_function_async(func, retries=20, delay=5, *args, **kwargs):
    """
    Async version: Tries to execute the given async function up to `max_retries` times.
    If the function raises an exception, it waits `delay` seconds before retrying.

    :param func: The async function to execute.
    :param retries: Maximum number of retry attempts.
    :param delay: Delay between retries in seconds.
    :param args: Positional arguments for the function.
    :param kwargs: Keyword arguments for the function.
    :raises: The last exception encountered if the function fails all attempts.
    """
    attempt = 0
    func_name = getattr(func, '__name__', str(func))
    
    while attempt < retries:
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            attempt += 1
            logging.warning(f"Attempt {attempt} failed: {e}")
            logging.error(f"Cool down of {delay} seconds, before retrying...")
            if attempt >= retries:
                logging.error(f"Function '{func_name}' failed after {retries} attempts.")
                raise e
            for i in range(delay):
                logging.info(f"Retrying '{func_name}' in {delay-i} seconds...")
                try:
                    await asyncio.sleep(1)
                except asyncio.CancelledError:
                    logging.info("Task cancelled, stopping retry...")
                    raise


def format_entity_type_for_display(entity_type: str) -> str:
    """
    Convert CamelCase entity type to more readable format using intelligent heuristics.
    
    This method automatically detects acronyms (consecutive uppercase letters) and 
    preserves them while adding spaces between words.
    
    Examples:
    - AWSAccount -> AWS Account
    - AWSEksCluster -> AWS Eks Cluster
    - AWSS3Bucket -> AWS S3 Bucket
    - BackstageComponent -> Backstage Component
    - K8sNamespace -> K8s Namespace
    - EC2Instance -> EC2 Instance
    
    :param entity_type: The CamelCase entity type string to format
    :return: A more readable formatted string
    """
    if not entity_type:
        return entity_type
    
    # Build the result by analyzing character patterns
    result = []
    i = 0
    
    while i < len(entity_type):
        # Check if we're at the start of an acronym (2+ consecutive uppercase letters)
        if i < len(entity_type) - 1 and entity_type[i].isupper() and entity_type[i + 1].isupper():
            # Collect consecutive uppercase letters
            acronym_start = i
            
            while i < len(entity_type) and entity_type[i].isupper():
                if i < len(entity_type) - 1:
                    next_char = entity_type[i + 1]
                    
                    # If next char is lowercase, we've reached the start of a new word
                    # Keep the last uppercase letter with the new word (e.g., "AWS|Account")
                    if next_char.islower():
                        break
                    
                    # If next char is a digit, include it (e.g., K8s, EC2)
                    elif next_char.isdigit():
                        i += 2  # Include current uppercase and next digit
                        # If there's more after the digit, continue
                        if i < len(entity_type):
                            if entity_type[i].islower():
                                # End of this acronym (e.g., K8s|Namespace)
                                break
                            # Otherwise continue collecting
                        break
                i += 1
            
            # Extract the acronym
            acronym = entity_type[acronym_start:i]
            
            # For acronyms longer than 3 chars, check if we should split them
            # (e.g., "AWSS3" -> "AWS" + "S3")
            if len(acronym) > 3:
                # Try to find a reasonable split point
                # Look for a sequence that could be a separate acronym (2-3 chars at the end)
                for split_point in range(len(acronym) - 1, max(2, len(acronym) - 4), -1):
                    potential_second = acronym[split_point:]
                    if len(potential_second) >= 2 and len(potential_second) <= 3:
                        # Split here
                        if result and result[-1] != ' ':
                            result.append(' ')
                        result.append(acronym[:split_point])
                        result.append(' ')
                        result.append(potential_second)
                        acronym = None
                        break
            
            if acronym:
                # Add space before acronym if not at start
                if result and result[-1] != ' ':
                    result.append(' ')
                result.append(acronym)
            
        # Regular word character (single uppercase letter)
        elif entity_type[i].isupper():
            # Add space before uppercase if not at start and previous wasn't a space
            if result and result[-1] != ' ':
                result.append(' ')
            result.append(entity_type[i])
            i += 1
        else:
            # Lowercase or other characters
            result.append(entity_type[i])
            i += 1
    
    return str(''.join(result).strip())


def flatten_dict(d: dict, wildcard_index=True, preserve_list_of_dicts=False) -> dict[str, str]:
    """
    Flattens a nested dictionary, list, or set.
    For lists and sets, the index will be used as the key.
    :param d: The dictionary to flatten.
    :param wildcard_index: Whether to use a wildcard index for lists and sets. If True, all indices will be replaced with `[*]`. Values will be stored as a list.
    :param preserve_list_of_dicts: If True, lists containing dictionaries are preserved as-is (not flattened).
    :return: A flattened dictionary.
    """
    def _flatten(obj, parent_key=""):
        items = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                new_key = f"{parent_key}.{k}" if parent_key else k
                items.extend(_flatten(v, new_key).items())
        elif isinstance(obj, (list, set)):
            # Check if we should preserve this list of dicts
            if preserve_list_of_dicts and isinstance(obj, list) and len(obj) > 0 and isinstance(obj[0], dict):
                # Keep list of dicts as-is
                items.append((parent_key, obj))
            elif wildcard_index:
                new_key = f"{parent_key}.[*]" if parent_key else "[*]"
                vals = []
                for i, v in enumerate(obj):
                    if isinstance(v, (dict, list, set)):
                        items.extend(_flatten(v, new_key).items())
                    else:
                        if parent_key:
                            new_key = f"{parent_key}.[*]"
                        else:
                            new_key = "[*]"
                        vals.append(v)
                if len(vals) > 0:
                    items.append((new_key, vals))
            else:
                for i, v in enumerate(obj):
                    new_key = f"{parent_key}.[{i}]" if parent_key else f"[{i}]"
                    items.extend(_flatten(v, new_key).items())
        else:
            items.append((parent_key, obj))
        
        # Collapse items into flattened dictionary
        if wildcard_index: # preserve duplicate keys by using a list
            result_dict = {}
            for k, v in items:
                if k in result_dict:
                    # If the key already exists, append the value to the list
                    if isinstance(result_dict[k], list):
                        if isinstance(v, list):
                            result_dict[k].extend(v)
                        else:
                            result_dict[k].append(v)
                    else:
                        if isinstance(v, list):
                            result_dict[k] = [result_dict[k]] + v
                        else:
                            result_dict[k] = [result_dict[k], v]
                else:
                    # If the key does not exist, add it to the dictionary
                    result_dict[k] = v
            return result_dict
        else: 
            return dict(items)

    return _flatten(d)

def runforever(func):
    """
    Decorator to run a function forever.
    """
    async def wrapper(*args, **kwargs):
        while True:
            try:
                await func(*args, **kwargs)
            except Exception as e:
                traceback.print_exc()
                logging.error(f"Error: {e}")
                logging.error(f"Cool down of 10 seconds, before restarting function '{func.__name__}'...")
                await asyncio.sleep(10)
    return wrapper

# if __name__ == "__main__":
#     # Example usage
#     example_dict = {
#         "a": 1,
#         "b": [2, 3, 4],
#         "d": {
#             "e": 5, 
#             "f": [6, 7]
#             },
#         "x" : [
#             {"y": 11, "z": 12},
#             {"y": 13, "z": 14},
#             {"y": 15, "z": 16},
#             {"y": 13, "z": 12}
#         ],
#         "c": [{"d": 5, "e": [6, 7]},
#               {"d": 8, "e": [9, 10]},
#               {"d": 8, "e": [11, 12]}
#               ],
#         "m": [{"n": 5, "o": [6, {"p": 7}]},
#               {"n": 8, "o": [9, {"p": 10}]},
#               {"n": 8, "o": [11, {"p": 12}]}
#               ],
#         "g": [2, 3, 4, {"h": 8, "i": [9, 10]}],
#     }
    
#     flattened = flatten_dict(example_dict,  wildcard_index=False)
#     print(f"Flattened dict: {json_encode(flattened, indent=2)}")
#     flattened = flatten_dict(example_dict)
#     print(f"Flattened dict: {json_encode(flattened, indent=2)}")
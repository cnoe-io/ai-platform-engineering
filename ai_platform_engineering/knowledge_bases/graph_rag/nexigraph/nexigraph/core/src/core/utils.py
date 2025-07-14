import json
import logging
import os
from json import JSONEncoder
import traceback
import asyncio
import hashlib
import time

from core.models import Entity

DURATION_DAY = 60 * 60 * 24
DURATION_HOUR = 60 * 60
DURATION_MINUTE = 60

class ObjEncoder(JSONEncoder):
    def default(self, o):
        if isinstance(o, set):
            return list(o)
        else:
            try:
                return o.__dict__
            except AttributeError:
                return str(o)

def json_encode(obj, **kwargs):
    return json.dumps(obj, cls=ObjEncoder, **kwargs)

def get_logger(name) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(os.getenv("LOG_LEVEL", "DEBUG").upper())
    formatter = logging.Formatter('%(asctime)s [%(name)s] %(levelname)s: %(message)s')
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger

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

def get_default_fresh_until():
    """
    Get the default fresh until timestamp (one week)
    :return: fresh until timestamp
    """
    return int(time.time()) + (7 * DURATION_DAY)

def retry_function(func, retries=10, delay=10, *args, **kwargs):
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

# def flatten_entity_props(e: Entity) -> tuple[List['Entity'], List['Relation']]:
#     """
#     Flattens the properties of an entity into a list of entities and relations.
#     :param e: The entity to flatten.
#     """
#     def _flatten(obj, parent_key=""):
#         items = []
#         if isinstance(obj, dict):
#             for k, v in obj.items():
#                 new_key = f"{parent_key}.{k}" if parent_key else k
#                 items.extend(_flatten(v, new_key).items())
        
#         elif isinstance(obj, (list, set)):
#             # check if all the elements in the list are of the same type
#             if all(isinstance(i, type(obj[0])) for i in obj):


#             new_key = f"{parent_key}.[*]" if parent_key else "[*]"
#             vals = []
#             for i, v in enumerate(obj):
#                 if isinstance(v, (dict, list, set)):
#                     items.extend(_flatten(v, new_key).items())
#                 else:
#                     if parent_key:
#                         new_key = f"{parent_key}.[*]"
#                     else:
#                         new_key = f"[*]"
#                     vals.append(v)
#             if len(vals) > 0:
#                 items.append((new_key, vals))
#         else:
#             items.append((parent_key, obj))
        
#         # Collapse items into flattened dictionary
#         result_dict = {}
#         for k, v in items:
#             if k in result_dict:
#                 # If the key already exists, append the value to the list
#                 if isinstance(result_dict[k], list):
#                     if isinstance(v, list):
#                         result_dict[k].extend(v)
#                     else:
#                         result_dict[k].append(v)
#                 else:
#                     if isinstance(v, list):
#                         result_dict[k] = [result_dict[k]] + v
#                     else:
#                         result_dict[k] = [result_dict[k], v]
#             else:
#                 # If the key does not exist, add it to the dictionary
#                 result_dict[k] = v
#         return result_dict

#     return [], []


def flatten_dict(d: dict, wildcard_index=True) -> dict[str, str]:
    """
    Flattens a nested dictionary, list, or set.
    For lists and sets, the index will be used as the key.
    :param d: The dictionary to flatten.
    :param wildcard_index: Whether to use a wildcard index for lists and sets. If True, all indices will be replaced with `[*]`. Values will be stored as a list.
    :return: A flattened dictionary.
    """
    def _flatten(obj, parent_key=""):
        items = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                new_key = f"{parent_key}.{k}" if parent_key else k
                items.extend(_flatten(v, new_key).items())
        elif isinstance(obj, (list, set)):
            if wildcard_index:
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
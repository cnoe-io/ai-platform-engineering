#!/usr/bin/env python3
"""
Script to update the ground truth data from Neo4j -> test_data_heuristics.json
"""

import json
import os
from core import constants
from core.utils import ObjEncoder
import neo4j

def main():
    # Change to script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    input_file = "test_data_heuristics.json"
    
    print("=" * 50)
    
    # Load the JSON file
    print(f"Loading {input_file}...")
    try:
        with open(input_file, "r") as f:
            data = json.load(f)
        print(f"Loaded {len(data)} items")
    except Exception as e:
        print(f"Error loading file: {e}")
        return

    rel_fixed = {}

    new_rel_ids = {}
    old_ids = set()
    
    for rel_id, rel in data.items():
        entity_a_type = rel["heuristic"]["entity_a_type"]
        entity_b_type = rel["heuristic"]["entity_b_type"]
        
        driver = neo4j.GraphDatabase.driver("bolt://localhost:7688", auth=("neo4j", "dummy_password"))

        old_ids.add(rel_id)

        with driver.session() as session:
            result = session.run(f"MATCH (:{entity_a_type})-[r]->(:{entity_b_type}) RETURN r") # type: ignore
            for record in result:
                heuristic = dict(record["r"].items()).get("heuristic", "")
                heuristic = json.loads(heuristic)
                if str(heuristic["property_mappings"]) == str(rel["heuristic"]["property_mappings"]):
                    new_id = str(dict(record["r"].items())[constants.ONTOLOGY_RELATION_ID_KEY])
                    new_rel_ids[rel_id] = new_id
                    print(rel_id + " -> " + new_id)
                    if new_id in rel_fixed:
                        print("Duplicate relation ID: " + new_id)
                        print("    "+rel_id)
                        print("    "+str(heuristic["property_mappings"]))
                        print("    "+str(rel["heuristic"]["property_mappings"]))
                    rel_fixed[new_id] = rel
                    rel_fixed[new_id]["relation_id"] = new_id
            # input("Press Enter to continue...")f

    matched_old_ids = set(new_rel_ids.keys())
    unmatched_old_ids = old_ids - matched_old_ids
    
    print("Matched old IDs:", len(matched_old_ids))
    print("Unmatched old IDs:", len(unmatched_old_ids))

    for old_id in unmatched_old_ids:
        rel_fixed[old_id] = data[old_id]
    
            
            
    with open("new_" + input_file, "w") as f:
        json.dump(rel_fixed, f, indent=4, cls=ObjEncoder)
        
    # Replace keys with relation_id values
    # print("\nReplacing keys...")
    # updated_data = replace_keys_with_relation_ids(data)
    

if __name__ == "__main__":
    main()

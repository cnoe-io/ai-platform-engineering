from math import e
from core import utils
from core.graph_db.neo4j.graph_db import Neo4jDB



async def dump_database_data():
    db = Neo4jDB(readonly=True)
    data = {
        "entities": []
    }
    entity_types = await db.get_all_entity_types()
    for entity_type in entity_types:
        max_results = 10000
        entities = await db.find_entity(entity_type, properties={}, max_results=max_results)
        for entity in entities:
            props = {}
            for key, value in entity.all_properties.items():
                if key[0] == "_":
                    # Skip internal properties
                    print(f"Skipping internal property: {key} for entity type: {entity_type}")
                    continue
                props[key] = value

            entity.all_properties = props
            data["entities"].append(entity)

    # Save the data to a file
    with open("entities_dummy.json", "w") as f:
        f.write(utils.json_encode(data, indent=2))

if __name__ == "__main__":
    import asyncio
    asyncio.run(dump_database_data())
    print("Database data dumped to entities_dummy.json")
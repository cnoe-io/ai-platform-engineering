
from pymilvus import MilvusClient
import redis.asyncio as redis
from common.graph_db.neo4j.graph_db import Neo4jDB
from server.restapi import milvus_uri, default_collection_name_docs, default_collection_name_graph, graph_rag_enabled, redis_url, neo4j_addr, ontology_neo4j_addr
redis_client = redis.from_url(redis_url)

async def clear_all():
    print("🛑 WARNING 🛑 This will DELETE ALL DATA in the Vector databases, Graph databases, and Redis. 🛑 Proceed with caution!🛑")

    for i in range(20, 0, -1):
        print(f"DELETING ALL in {i} seconds... Press Ctrl+C to abort")
        import time
        time.sleep(1)

    data_graph_db = Neo4jDB(uri=neo4j_addr)
    ontology_graph_db = Neo4jDB(uri=ontology_neo4j_addr)

    if graph_rag_enabled:
        print("🛑 Deleting data from ontology graph...")
        await ontology_graph_db.raw_query("MATCH (n) DETACH DELETE n")
        
        print("🛑 Deleting data from data graph...")
        await data_graph_db.raw_query("MATCH (n) DETACH DELETE n")
    else:
        print("Graph RAG is disabled, skipping graph deletion.")

    client = MilvusClient(uri=milvus_uri)
    print(f"🛑 Deleting collection {default_collection_name_docs}...")
    client.drop_collection(collection_name=default_collection_name_docs)

    print(f"🛑 Deleting collection {default_collection_name_graph}...")
    client.drop_collection(collection_name=default_collection_name_graph)

    print("🛑 Flushing Redis ...")
    await redis_client.flushall()


if __name__ == "__main__":
    import asyncio
    asyncio.run(clear_all())
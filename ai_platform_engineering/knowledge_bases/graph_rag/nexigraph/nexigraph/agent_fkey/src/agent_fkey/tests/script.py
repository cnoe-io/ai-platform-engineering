import json
from agent_fkey.relation_manager import RelationCandidateManager

from core.graph_db.neo4j.graph_db import Neo4jDB
from core.utils import ObjEncoder


rc = RelationCandidateManager(graph_db=Neo4jDB(True), acceptance_threshold=0.75, rejection_threshold=0.3)

async def fetch_all():

    candidates = await rc.fetch_all_candidates()
    output={}
    for rel_id, candidate in candidates.items():
        print(f"Candidate: {candidate}")
        if candidate.evaluation is not None:
            candidate.evaluation.relation_confidence = 1.0
            candidate.evaluation.justification = ""
            candidate.evaluation.thought = ""
        candidate.is_applied = False
        output[rel_id] = candidate.model_dump()

    with open("test_data_heuristics.json", "w") as f:
        
        json.dump(output, f, indent=4, cls=ObjEncoder)

def main():
    import asyncio
    asyncio.run(fetch_all())

if __name__ == "__main__":
    main()
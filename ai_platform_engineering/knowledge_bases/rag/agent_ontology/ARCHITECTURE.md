# Agent Ontology Architecture

## Overview

The Agent Ontology system automatically discovers and validates relationships between entity types in a knowledge graph. It uses fuzzy search to find candidates, validates them through deep property matching, and evaluates them with parallel LLM agents.

### Key Components

| Component | Purpose |
|-----------|---------|
| **HeuristicsProcessor** | Discovers candidate relations using BM25 fuzzy search |
| **BM25SearchEngine** | In-memory search index with Bloom filter optimization |
| **RelationCandidateManager** | Manages candidates across Redis (metrics) and Neo4j (structure) |
| **OntologyAgent** | Orchestrates processing and evaluation |
| **AgentWorker** | Isolated LLM worker that evaluates relation candidates |

### Process Flow

```
1. Heuristics Processing
   └─> Build BM25 index + Bloom filter
   └─> Fuzzy search for candidate matches
   └─> Deep property matching for validation
   └─> Store metrics in Redis

2. Evaluation
   └─> Group candidates by entity type pairs
   └─> Distribute across parallel agent workers
   └─> LLM agents accept/reject/unsure each relation
   └─> Store evaluations in Neo4j

3. Synchronization
   └─> Apply accepted relations to data graph
   └─> Track sync status
```

---

## 1. Fuzzy Search System

### How It Works

The system uses **BM25 (Best Matching 25)** for fuzzy text search combined with a **Bloom filter** for fast pre-filtering.

**Data Indexed:**
- Entity type (with PascalCase tokenization)
- All identity key values from each entity
- Tokenized into searchable terms

**Bloom Filter Pre-filtering:**
- 10M bits (~1.25 MB), 1% error rate
- Filters out 80-90% of non-matching searches before BM25
- Checks if query tokens exist in corpus

**Tokenization Strategy:**
- `"PodContainer"` → `["pod", "container"]` (PascalCase)
- `"web-server-1"` → `["web-server-1", "web", "server", "1"]` (preserve full + split)
- All lowercased for case-insensitive matching

### Re-ranking

After BM25 retrieval, results are re-ranked for **diversity** across entity types:

**Diversity Algorithm:**
- Apply penalty to repeated entity types
- Penalty factor: 0.3 (higher = more diversity)
- Hard cap: 10 entities per type
- Final results: 50 per query

---

## 2. Deep Property Matching

### What Gets Compared

| Searching Entity | Matched Entity |
|------------------|----------------|
| **All properties** | **Only identity keys** |

The system compares all properties from the searching entity against the identity key properties of matched entities.

### Match Types & Quality

| Match Type | Quality Score | Example |
|------------|---------------|---------|
| EXACT | 1.0 | `"web"` == `"web"` |
| PREFIX | 0.8 | `"web-pod"` starts with `"web"` |
| SUFFIX | 0.7 | `"my-web"` ends with `"web"` |
| SUBSET/SUPERSET | 0.9 | Set containment |
| CONTAINS | 0.85 | Value in array |

### Matching Strategy

- **Main property** (the one that triggered the match): Uses flexible matching (EXACT, PREFIX, SUFFIX, etc.)
- **Supporting properties**: Require EXACT matches only for validation

### Deep Match Score

Combines multiple factors to rank matches:

```
score = (bm25_score × uniqueness_multiplier × avg_match_quality) + simplicity_bonus
```

**Scoring Factors:**
- **BM25 Score**: Raw text similarity score
- **Uniqueness Multiplier**: 2.0 for unambiguous (1 mapping), 0.7 for ambiguous (4+ mappings)
- **Avg Match Quality**: Average quality across all property matches
- **Simplicity Bonus**: Simpler identity keys get bonus points

---

## 3. Evaluation System

### Multi-Agent Architecture

The system uses **multiple isolated agent workers** running in parallel to evaluate relation candidates.

```
                    OntologyAgent
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
      Worker 0        Worker 1        Worker 2
    Queue: [G0,G3]  Queue: [G1,G4]  Queue: [G2,G5]
          │               │               │
          ▼               ▼               ▼
      LLM Agent       LLM Agent       LLM Agent
```

### Worker Isolation

Each `AgentWorker` has:
- **Private queue** of candidate groups
- **Isolated state** (no shared state between workers)
- **Own LLM instance** and tools
- **Async lock** for serializing accept/reject operations

### Evaluation Process

**Step 1: Group & Filter**
- Group candidates by entity type pairs
- Filter by heuristic changes (count/quality deltas)
- Auto-accept sub-entity relations
- Skip manually evaluated relations

**Step 2: Prepare Context**
- Fetch up to 3 example entity pairs (with sub-entities)
- Include existing accepted relations
- Add heuristic statistics and property mappings

**Step 3: Distribute Work**
- Round-robin distribution across workers
- Each worker gets isolated queue

**Step 4: Evaluate**
- Workers process queue independently
- LLM agents use tools to fetch data, accept/reject relations
- Decisions stored in Neo4j

### Agent Tools

Workers have access to these tools:
- `fetch_next_relation_candidate()` - Get next group from queue
- `fetch_entity()` - Get entity details from graph
- `accept_relation()` - Accept with semantic name
- `reject_relation()` - Reject with justification
- `mark_relation_unsure()` - Mark as needing more evidence
- `query_existing_relations()` - Check for conflicts

### What Agents Evaluate

Agents consider:
- **Semantic meaning**: Does the relationship make sense?
- **Property mappings**: Are mapped properties appropriate?
- **Example quality**: Do examples support the relationship?
- **Uniqueness**: Does this duplicate existing relations?
- **Confidence**: Is there enough evidence?

### Decisions

- **Accept**: Provide semantic relation name + justification
- **Reject**: Provide justification for why it's invalid
- **Unsure**: Mark for later review (insufficient evidence)

### Synchronization

After evaluation, accepted relations are applied to the data graph:
- Match entities using property mappings and match types
- Create relations with metadata
- Track sync status (success/failure)

---

## 4. Metrics Storage

### Dual Storage Strategy

**Why two databases?**
- **Redis**: Fast KV store for frequently updated metrics
- **Neo4j**: Graph structure for relationships and evaluations

```
┌─────────────────────────────────────────┐
│         Relation Candidate               │
├──────────────────┬──────────────────────┤
│  Redis           │  Neo4j               │
│  (Heuristics)    │  (Structure)         │
└──────────────────┴──────────────────────┘
```

### Redis Storage

**What's Stored:**
- Match counts and quality sums
- Per-property match patterns (by match type)
- Recent examples (limited to last 10)
- Entity type pair metadata

**Key Benefits:**
- Atomic increments for concurrent updates
- Fast reads during processing
- Efficient batch operations

### Neo4j Storage

**Node Types:**
- **Entity Type Nodes**: Schema definitions with properties
- **Sub-Entity Type Nodes**: Hierarchical entity types

**Relation Types:**
- **Candidate Relations** (`_CANDIDATE`): Before evaluation
- **Evaluated Relations** (semantic name): After accept/reject
- **Sub-Entity Relations** (`HAS`): Parent → child

**What's Stored:**
- Entity type structure
- Evaluation results (accept/reject/unsure)
- Justifications and thoughts
- Property mapping rules
- Sync status

### Ontology Versioning

Each processing run creates a **new version** (UUID):
- New heuristics computed for new version
- Evaluations compared against previous version
- If better, promote new version
- Clean up old versions (Redis + Neo4j)

**Version Lifecycle:**
```
Create → Process → Evaluate → Compare → Promote → Cleanup
```

All data is scoped by version to enable safe iteration.

---

## 5. Configuration

### Processing Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `entity_batch_size` | 10,000 | Entities per processing batch |
| `index_batch_size` | 50,000 | Entities per BM25 index batch |
| `min_relation_count` | 3 | Min matches to keep relation |

### Evaluation Parameters

| Parameter | Description |
|-----------|-------------|
| `min_count_for_eval` | Min matches for LLM evaluation |
| `count_change_threshold_ratio` | Change threshold for re-eval (default: 0.1 = 10%) |
| `max_concurrent_evaluation` | Number of parallel workers |

### Search Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `diversity_mode` | True | Enable diversity re-ranking |
| `diversity_penalty` | 0.3 | Penalty for type repetition |
| `max_entities_per_type` | 10 | Hard cap per type |
| `final_k` | 50 | Results per query |

---

## Summary

The Agent Ontology system discovers relationships through:

1. **Efficient Search**: BM25 + Bloom filters find candidates fast
2. **Smart Validation**: Deep property matching with quality scoring
3. **Parallel Evaluation**: Multiple LLM agents work independently
4. **Optimized Storage**: Redis for hot metrics, Neo4j for structure
5. **Safe Iteration**: Versioning enables schema evolution

This architecture scales to large knowledge graphs while maintaining accuracy through multi-stage validation.

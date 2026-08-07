# Design Supplement: Versioned Collections, Alias Swap, and Embedding Mechanics

Companion to [`spec.md`](./spec.md). One level deeper on the *how* — collection lifecycle, alias swap, reindex state machine, the embedding-path split (langchain text vs Google GenAI SDK media), and the modality gate. Design intent, not final code. **Spike-verified facts are tagged `[F#]` and map to spec.md → Verification Findings.**

## 1. Why not "just re-embed in place"

Vectors are points in a model-specific geometric space. Model A's vector for a sentence and model B's vector for the same sentence are unrelated — even at the same dimensionality. Consequences:

- A model switch is **always a re-ingest** (re-run the embedder), never a vector rewrite.
- Two models' vectors **cannot** share one searchable dense field.
- A single similarity search **cannot** span two models' collections meaningfully (scores aren't comparable).

So the unit of a model switch is a **whole new collection**, built fresh, swapped in atomically.

## 2. The silent-collision bug this fixes — now concrete, not hypothetical

Today (`server/src/server/restapi.py:1919-1928`) startup validation checks only the integer dimension of the `dense` field:

```
actual_dim != expected_dim  ->  raise "...changed the embeddings model? delete and re-ingest"
```

`text-embedding-3-large` is **3072**. `gemini-embedding-2-preview` defaults to **3072** `[F1]`. Switching between them **passes this check silently** — server starts, queries run, results are meaningless because the query vector lives in a different space than the stored vectors. No error, no log. This is not a corner case; it is the exact migration this spec exists to enable.

Fix (FR-003/FR-007): stamp **model identity** (provider + model + dim) on the collection and validate *identity*, not just dimension.

## 3. Collection naming and identity

```
rag_docs__<provider>__<model>__<dim>__v<N>
   e.g.  rag_docs__azure-openai__text-embedding-3-large__3072__v1
         rag_docs__google__gemini-embedding-2-preview__3072__v2
```

- Separator `__`; model names sanitized to Milvus-legal chars (`/`, `.`, `:` → `_`).
- `v<N>` increments per reindex of the same logical store → unambiguous rollback targets.
- Identity record stamped at creation (authoritative source = Open Question 3):

```json
{
  "collection": "rag_docs__google__gemini-embedding-2-preview__3072__v2",
  "provider": "google",
  "model": "gemini-embedding-2-preview",
  "dim": 3072,
  "modalities": ["text", "image", "audio", "video", "pdf"],
  "embed_path": "genai_sdk",
  "manifest_version": 3,
  "created_at": 1735689600,
  "status": "building | active | retired"
}
```

## 4. The alias indirection `[F4]`

```
                         ┌─────────────────────────────────────────────┐
   query / ingest ──────▶│  alias: rag_default                          │
   cleanup / client.query│         │                                    │
   media add_embeddings  │         ▼ (resolves to exactly one)          │
                         │  rag_docs__google__gemini-2__3072__v2   ◀ active
                         │  rag_docs__azure__te3-large__3072__v1   ◀ retired (rollback)
                         └─────────────────────────────────────────────┘
```

- The langchain `Milvus` wrapper (`restapi.py:299-307`) is constructed against `rag_default` (the alias), so **every existing read/write path is unchanged** — query (`query_service.py:133`), upsert (`ingestion.py:803`), cleanup (`restapi.py:172-221`).
- **Verified on pinned versions `[F4]`** (`pymilvus[milvus_lite]==2.6.2`, `langchain-milvus==0.3.0`): `create_alias` / `alter_alias` / `drop_alias` / `rename_collection` all present; **search through an alias works; `alter_alias` mid-flight is transparent to the query path; `rename_collection` works** (the migration primitive). langchain `Milvus` uses `has_collection`/`describe_collection` (alias-resolvable) and accepts an arbitrary `collection_name`.
- **Still to prove in the FR-010a spike** (residual): langchain `aupsert`/`adelete`/`add_embeddings` against an **alias** with the full dense+sparse(BM25) schema. If any write path rejects an alias, resolve alias→physical at that one call site.

This is the crux of "search stays as clean as today": exactly one collection behind the alias at any instant → the query path has no new branching.

### 4a. The module-global gotcha `[F4 residual #2]`

`vector_db` is built **once** at startup and held as a module global (`restapi.py:299`). A server-side `alter_alias` does **not** retarget that long-lived in-process object. So **promotion = `alter_alias` + re-initialize the `Milvus` wrapper and `VectorDBQueryService`** (FR-006). A bare alias flip alone leaves the running server querying the old collection.

## 5. Reindex state machine (blue/green)

```
   ACTIVE(v1)
      │  operator triggers reindex → model M2
      ▼
   BUILDING(v2)                         ← v1 still ACTIVE and serving all queries
      │  create rag_docs__M2__…__v2 (stamped, status=building)
      │  enumerate datasources from MetadataStorage
      │  for each datasource (throttled by MAX_INGESTION_CONCURRENCY):
      │     ├─ re-fetchable origin?  → reload_datasource() targeted at v2   (FR-005)
      │     └─ push-only?            → re-embed stored chunk TEXT into v2,
      │                                else SKIP + record reason            (FR-005)
      │     modality gate per item vs M2 manifest (FR-009):
      │        unsupported → SKIP + increment per-modality counter
      │     embed via M2's embed_path (langchain text | genai_sdk)          (§7)
      │  progress = items_embedded / items_total
      ▼
   READY(v2)                            ← v1 STILL ACTIVE; nothing has flipped yet
      │  operator clicks Promote
      ▼
   PROMOTE: alter_alias(rag_default → v2)  +  re-init wrapper/query service  (§4a)
      ▼
   ACTIVE(v2), RETIRED(v1)             ← v1 retained for rollback
      │  operator may: Rollback (alias → v1 + re-init)  or  Delete(v1) [explicit, audited]
      ▼
   done
```

Properties:
- **No downtime:** the alias points at a fully-built, healthy collection at every instant; the flip is atomic `[F4]`.
- **Resumable/idempotent at datasource granularity** (keyed by `datasource_id`, the stable Milvus filter key — `models/rag.py:120-127`).
- **Retention:** promote never deletes; delete is separate, explicit, audited (FR-006).

## 6. Why re-fetch (not stored-text) is the default reindex source

Stored chunks today are **text-only** (`loader/items.py:22`). A multimodal target can only get image/video vectors if the *original media* is re-processed — only a **source re-fetch** can do that. Hence FR-005 makes re-fetch the primitive.

| Source kind | Reindex behavior |
|---|---|
| Web / Confluence / Jira / etc. (has origin) | Re-fetch from source via existing reload path → can populate new modalities. |
| Push-only `POST /v1/ingest` | Re-embed from **stored chunk text** (retrievable, cf. `restapi.py:912`). Text only — cannot gain new modalities. |
| Push-only, text unavailable | **Skip + report** (count + reason in job status / UI). Never silently dropped. |

Operator trade-off: re-fetch is slower, hits external rate limits/auth, and picks up *content changes since last ingest* — so a reindex of live sources is not a pure "same data, new vectors" operation.

## 7. The embedding-path split — the heart of the multimodal design

### 7a. Two facts that look contradictory but aren't `[F1][F2]`

- `gemini-embedding-2-preview` **is** multimodal — text, image, video, audio, PDF into one unified 3072-d space `[F1]`.
- LangChain's `Embeddings` interface is **text-only** — installed `VertexAIEmbeddings` exposes only `embed_documents/embed_query` over `list[str]`; latest 3.2.3 is the same; multimodal "planned for a future release" `[F2]`.

Resolution: the **model** is multimodal; the **LangChain interface** isn't yet. So media goes through the **Google GenAI SDK `embed_content()`** directly, while the langchain interface stays the "socket" the Milvus wrapper auto-calls for queries and text.

### 7b. The non-negotiable rule: one model owns ALL modalities (text included)

A text query retrieves a stored image **only** if the query-text vector and the image vector are in the **same** space — i.e. produced by the **same model via the same code path**. Therefore, on `gemini-embedding-2-preview`, **text must also go through the SDK adapter**, not a separate langchain/Azure path. A split (`text-embedding-3-large` for text + Gemini for media) silently breaks cross-modal retrieval — text queries under-retrieve media, with no error. Forbidden (spec § "one model owns all modalities", Out of Scope).

```
                 active model = gemini-embedding-2-preview   (manifest.embed_path = "genai_sdk")
                 ┌───────────────────────────────────────────────────────────┐
   text query ──▶│ GeminiMultimodalEmbeddings.embed_query(str)                 │─┐
   text doc   ──▶│ GeminiMultimodalEmbeddings.embed_documents([str])           │ │  ONE model,
   image      ──▶│ .embed_image(bytes)   ┐                                     │ ├─ ONE unified
   video      ──▶│ .embed_video(clip)    ├─ Google GenAI SDK embed_content()   │ │  3072-d space
   audio      ──▶│ .embed_audio(a)       ┘                                     │─┘
   pdf        ──▶│ .embed_pdf(p)                                               │
                 └───────────────────────────────────────────────────────────┘

                 active model = text-embedding-3-large        (manifest.embed_path = "langchain")
                 ┌───────────────────────────────────────────────────────────┐
   text query ──▶│ AzureOpenAIEmbeddings.embed_query/embed_documents (stock)   │
   image/video──▶│ ── modality gate: UNSUPPORTED → skip + count (FR-009) ──────│
                 └───────────────────────────────────────────────────────────┘
```

### 7c. The adapter

```python
class GeminiMultimodalEmbeddings(Embeddings):          # the langchain "socket", SDK-backed
    # standard interface — query + text ingest go through the SAME model as media
    def embed_query(self, text: str)        -> list[float]:        ...  # SDK embed_content
    def embed_documents(self, texts)        -> list[list[float]]:  ...  # SDK embed_content
    # extensions beyond the standard interface — used only by the media ingest path
    def embed_image(self, image)            -> list[float]:        ...
    def embed_video(self, clip)             -> list[float]:        ...
    def embed_audio(self, audio)            -> list[float]:        ...
    def embed_pdf(self, pdf)                -> list[float]:        ...
```

- Text-only models keep using stock langchain classes unchanged. The manifest `embed_path` (FR-002) selects which.
- **Effort is low**: a factory branch + this ~40-line wrapper. The real work is the media extraction pipeline (§8), which is identical regardless of SDK-vs-langchain.

### 7d. Storage seam — no parallel write path `[F3]`

langchain `Milvus.add_embeddings(texts, embeddings, metadatas, ids=...)` accepts **precomputed** vectors and supports the multi-vector schema (`milvus.py:1393`). So media vectors land in the **same collection/alias** as text:

```python
vec = gemini_embeddings.embed_image(image_bytes)        # SDK engine → 3072-d
vector_db.add_embeddings(
    texts=[caption_or_alt_or_transcript],               # feeds server-side BM25 sparse
    embeddings=[vec],                                   # precomputed dense vector
    metadatas=[{... "modality": "image" ...}],
)
```

No second storage layer, no schema fork. (Text ingest keeps using the auto-embedding `aupsert` path as today.)

## 8. Modality gate (FR-009) + the BM25 text-proxy nuance `[F3]`

```
   item (modality=image)
        │
        ▼
   target model M manifest.modalities contains "image"?
        ├─ yes → embed via adapter (§7) → add_embeddings (§7d)
        └─ no  → SKIP, counters["image"] += 1, reason="model M lacks image"
```

- Counters are per-modality, surfaced in reindex job status + superadmin UI.
- **Hard rule:** a text-only `Embeddings` is never handed a non-text payload — the gate rejects before the call. No coercion, no relying on incidental exceptions.
- **BM25 nuance `[F3]`:** sparse is computed server-side from the `text` field (`function.py:38-73`). A media chunk with a caption/alt/transcript → contributes to keyword retrieval. With no text proxy → empty `text` → **dense-only** for that chunk. Acceptable; the extractor (FR-010b) should populate a text proxy where available.
- The `modality` tag piggybacks on / extends `DocumentMetadata.document_type` (`models/rag.py:170`), so it exists from Story 2 — Story 5 adds no migration.

## 9. What the FR-010a live spike must still answer

Everything above is verified against installed code/pinned versions **except** what needs real Vertex credentials `[F5]`:

1. Exact Google GenAI SDK package + class + `embed_content()` request/response shape **per modality** (image bytes vs GCS URI, video segment, audio, PDF), and the returned dimension(s).
2. That a **single adapter instance** authenticates with the SA-key setup `[F5]` and embeds text **and** media into one space.
3. Residual `[F4 #1]`: langchain `aupsert`/`adelete`/`add_embeddings` against an **alias** with the BM25/dense/sparse schema.
4. `VertexAIEmbeddings` is deprecated `[F2]` → confirm the successor text class.
5. Video/audio chunking strategy (one vector per ≤120s clip vs segmented).

Until signed off, the system ships text-only with full multimodal **scaffolding** (manifest + modality tags + adapter selection) already in place.

## 10. Touch-point map (for planning)

| Concern | File(s) | Change |
|---|---|---|
| Provider (text) | `common/src/common/embeddings_factory.py:68-161` | Add `google`/`vertex` branch (langchain `VertexAIEmbeddings`); update provider list + `dimension_map`; reconcile separator `[F5]`. |
| Manifest | new `common/src/common/embeddings_manifest.py` | model → {dim, modalities, embed_path, …}; extend `dimension_map`. |
| Multimodal adapter | new `common/src/common/embeddings_gemini_multimodal.py` | SDK-backed `Embeddings` subclass; text+media (§7c). |
| Collection naming/alias | `restapi.py:111,299-320` | Replace literal `rag_default` with alias + resolved physical name. |
| Alias on all paths | `restapi.py:172-221,834,912`; `query_service.py:133`; `ingestion.py:803` | Operate via alias; resolve at call site only if a write path rejects it `[F4 #1]`. |
| Promotion wrapper re-init | `restapi.py:299-322` | After `alter_alias`, rebuild `vector_db` + `VectorDBQueryService` `[F4 #2]`. |
| Startup validation | `restapi.py:1843-1948` (esp. `1919-1928`) | Identity check, not just dim; actionable reindex message. |
| Reindex orchestration | new module in `server` + reuse `ingestors/.../ingestor.py` reload path | State machine §5; throttle via `MAX_INGESTION_CONCURRENCY`. |
| Media storage | `server` ingest path | `Milvus.add_embeddings(...)` for precomputed media vectors `[F3]`. |
| Job/identity storage | `common/src/common/metadata_storage.py`, `job_manager.py` | Reindex jobs + collection identity records. |
| Modality tag | `common/src/common/models/rag.py:163-178` | Extend `document_type` / add `modality`. |
| Superadmin API | new RAG server endpoints | list/reindex/progress/promote/rollback/delete. |
| Superadmin UI | `ui/src/components/rag/*`, `ui/src/app/api/rag/[...path]/route.ts` | Collections panel; gated by `ui/src/lib/rbac/super-admins-team.ts`. |
| Media extraction (gated) | `ingestors/.../webloader/loader/spiders/recursive.py:77-107`, `parsers/*`, `pipelines/document.py` | Stop denying supported media; emit modality-tagged items + text proxy. |

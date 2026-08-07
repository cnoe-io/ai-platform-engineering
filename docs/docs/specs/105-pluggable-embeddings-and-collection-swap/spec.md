# Feature Specification: Pluggable Embedding Models with Zero-Downtime Collection Swap

**Feature Branch**: `105-pluggable-embeddings-and-collection-swap`
**Created**: 2026-06-01
**Status**: Draft — not yet implemented

## Implementation Status

| Story | Status | Notes |
|-------|--------|-------|
| 1 — Native Google/Gemini embeddings provider | ⬜ Not started | Pure addition to `EmbeddingsFactory`; bump `langchain-google-vertexai` to latest (3.2.3) for the **text** path. Target model `gemini-embedding-2-preview`. |
| 2 — Versioned, model-stamped collections behind a stable alias | ⬜ Not started | Foundation for everything else. Includes capability manifest + modality-tag scaffolding so no second migration is needed for Story 5. Milvus alias mechanics **verified** (see Verification Findings). |
| 3 — Background reindex (source re-fetch) + atomic alias promotion | ⬜ Not started | The "switch whenever, no wipe" capability. Reuses the existing `reload_datasource` machinery. |
| 4 — Superadmin collection-manager UI | ⬜ Not started | Progress %, promote/swap, delete old, rollback. Behind existing super-admin RBAC. |
| 5 — Multimodal ingestion (images/video/audio/PDF) | ⬜ Not started | **Gated on a live-credential spike (FR-010a).** Adds media extractors + a **single SDK-backed `Embeddings` adapter** (Google GenAI SDK `embed_content()`) that serves text **and** media for the multimodal model. Largest story; storage reuses `add_embeddings` (no parallel write path). |

**Input**: User description: "I want to use a multimodal embedding model (Gemini Embedding 2, `gemini-embedding-2-preview`) instead of being locked to Azure `text-embedding-3-*`. I should be able to switch the embedding model whenever I want and have the vectors re-ingested in the background instead of having to wipe and start over, while search keeps working as cleanly as it does today. A superadmin UI should show reindex progress, let me swap the active collection, and delete old ones. The crawler should be able to ingest images/video/PDFs that the new model supports. When I'm on a text-only model (`text-embedding-3-large`) it should embed text only; when I switch to `gemini-embedding-2-preview` it should embed everything — and that one model must cover **text too**, never a text-from-one-model + media-from-another mix."

## Background and Motivation

Today the RAG stack is hardwired to a **single embedding model and a single Milvus collection**, end to end:

- The embedding model is read once from `EMBEDDINGS_MODEL` at server startup and baked into one global `embeddings` object (`server/src/server/restapi.py:278`, via `common/src/common/embeddings_factory.py`).
- All data lives in one collection literally named `rag_default` (`server/src/server/restapi.py:111`), constructed once (`restapi.py:299-307`) and shared by ingestion (`server/src/server/ingestion.py:803`) and query (`server/src/server/query_service.py:133`).
- `EmbeddingsFactory` supports `azure-openai`, `openai`, `aws-bedrock`, `cohere`, `huggingface`, `ollama`, `litellm` — **there is no native Google/Vertex provider** (`embeddings_factory.py:68-161`; confirmed absent from `common/pyproject.toml`).
- Switching models today is destructive: `init_tests` compares the live model's vector dimension against the existing collection's `dense` field and **hard-fails startup** on mismatch with *"Have you changed the embeddings model? Please delete and re-ingest the collection."* (`restapi.py:1919-1928`). The operator must wipe `rag_default` and re-ingest from scratch, incurring a full outage.
- The web crawler is **text-only** and actively discards media: the recursive spider's `LinkExtractor` denies image/video/pdf/office extensions (`ingestors/src/ingestors/webloader/loader/spiders/recursive.py:77-107`), and every parser extracts `::text` nodes only (`parsers/generic.py:109`, `parsers/docusaurus.py:62`, etc.). `page_content` is always a plain `str` (`loader/items.py:22`, `loader/pipelines/document.py:111`).

This blocks three things the platform now needs:

1. **Adopting a better / multimodal embedding model** (`gemini-embedding-2-preview`) without a forklift migration.
2. **Switching models safely** — vectors from two different models occupy incompatible geometric spaces, so an in-place "re-embed" is impossible; re-embedding always means re-running the embedder over the content. Today that means a wipe-and-rebuild outage.
3. **Ingesting non-text content** (images, video, audio, PDFs) that a multimodal model could embed.

### Design principle (the constraint that drives the whole spec)

Two different embedding models produce vectors that are **not comparable**, even at the same dimensionality. Therefore:

- You cannot mix two models' vectors in one searchable index.
- "Re-embed in place" is not possible; a model switch is always a **re-ingest** (re-run the embedder).
- Searching across multiple models in one query is noisy and rarely wanted.

The industry-standard answer is **versioned, model-stamped collections behind a stable alias**, with **blue/green reindex**: build the new collection in the background while the old one keeps serving, then flip an alias atomically. This spec adopts exactly that. We intentionally do **not** build cross-model fan-out search — there is always exactly **one** active model serving queries, so the query path stays identical to today.

### A second, sharper corollary — one model owns *all* modalities, text included

Cross-modal retrieval (a text query finding an image/video chunk) works **only** if the query vector and the media vector live in the **same** space — which means they came from the **same model via the same code path**. Therefore, when the active model is multimodal (`gemini-embedding-2-preview`), that one model must embed **text and media alike**. A split — Azure `text-embedding-3-large` for text + Gemini for media — is explicitly **forbidden**: a text query embedded in Azure-space cannot retrieve Gemini-space image vectors, and the failure is silent (worse results, no error). Consequence: **adopting multimodal re-embeds the entire collection (including all existing text) with `gemini-embedding-2-preview`.**

### Scope decisions (locked with stakeholder)

| Decision | Choice | Consequence |
|---|---|---|
| Model-switching behavior | **One active model, alias swap** | Query path unchanged; no cross-model fusion. |
| Multimodal scope | **Included in this spec** | Adds media extractors + the SDK embedding path — gated behind a live-credential spike (FR-010a). |
| Reindex text source | **Re-fetch from sources** | Required for multimodal (stored chunks are text-only, so only a source re-fetch can produce image/video vectors). Push-only datasources need a fallback (FR-005). |
| Gemini text path | **Native Google provider via langchain** | `langchain-google-vertexai` `VertexAIEmbeddings` (bump to 3.2.3). Handles the **text** embedding for the model. |
| Gemini media path | **Google GenAI SDK `embed_content()`** | LangChain's `Embeddings` interface is text-only (verified). Media must use the SDK directly. |
| Unified adapter | **One SDK-backed `Embeddings` subclass serves text + media for the multimodal model** | Avoids a two-text-path space mismatch; text query, text doc, and media all go through one model/one path. |
| Storage of media vectors | **Reuse langchain `Milvus.add_embeddings(...)`** | Precomputed vectors insert into the **same** collection/alias — no parallel write path (verified, `milvus.py:1393`). |

## Verification Findings (spikes run 2026-06-01)

These resolve Open Questions 1–2 and de-risk FR-004/FR-010. Reproduced against the repo's pinned versions in a throwaway venv.

### F1 — `gemini-embedding-2-preview` is genuinely multimodal (source: Google blog)

> "Gemini Embedding 2 maps text, images, videos, audio and documents into a single, unified embedding space."

- Inputs: text ≤8192 tokens; images ≤6/req (PNG/JPEG); video ≤120s (MP4/MOV); audio native (no transcription step); PDF ≤6 pages; supports interleaved multimodal input.
- Output: **default 3072 dims**, Matryoshka scaling to 1536 / 768 (`EMBEDDINGS_DIMENSIONS` honored).
- 100+ languages. One unified space across all modalities (this is what makes text→media retrieval work).

### F2 — LangChain's `Embeddings` interface is TEXT-ONLY for Gemini (source: installed code + PyPI + langchain docs)

- Installed `langchain_google_vertexai==3.2.0` `VertexAIEmbeddings` exposes only `embed()/embed_documents()/embed_query()` over `list[str]` (`.venv/.../langchain_google_vertexai/embeddings.py:122-201`). No image/video/audio method; no `VertexAIImageEmbeddings`/`MultiModalEmbedding` class. The only vision classes are captioning/generation **LLMs** (`vision_models.py`), not embedders.
- Latest on PyPI is **3.2.3** — README still text-only; no `gemini-embedding`/multimodal mention. **Bumping the version does not unlock multimodal.**
- `VertexAIEmbeddings` is tagged `# Deprecated` in the package `__init__.py` → the spike must confirm the intended successor class for the text path.
- **Per Google/LangChain docs:** `gemini-embedding-2-preview` natively supports text/image/video/audio/PDF via the **Google GenAI SDK `embed_content()`**; multimodal in the LangChain `Embeddings` interface is "planned for a future release." → For multimodal today, use the SDK directly.

### F3 — langchain `Milvus` can store **precomputed** vectors (source: installed code)

- `langchain_milvus==0.3.0` `Milvus.add_embeddings(texts, embeddings, metadatas, ids=...)` accepts caller-supplied vectors and supports the multi-vector schema (`milvus.py:1393`). This is the seam the media path uses — **media vectors land in the same collection/alias as text, no parallel write layer.**
- Note: BM25 sparse is computed server-side from the `text` field (`function.py:38-73`). A media chunk with no caption/alt text → empty `text` → **dense-only** retrieval for that chunk (acceptable; documented in FR-009).

### F4 — Milvus alias + rename mechanics verified on pinned versions (source: behavioral test, Milvus Lite 2.6.2)

Throwaway venv, `pymilvus[milvus_lite]==2.6.2` + `langchain-milvus==0.3.0`:

| Check | Result |
|---|---|
| `create_alias` / `alter_alias` / `drop_alias` / `list_aliases` / `describe_alias` / `rename_collection` exist on `MilvusClient` | ✅ all present |
| Insert into `phys_v1`, `create_alias(rag_default→phys_v1)`, **search via alias** | ✅ 3 hits |
| Build `phys_v2`, `alter_alias(rag_default→phys_v2)`, search via alias again | ✅ **swap transparent to the query path** |
| `rename_collection(rag_default → …__v1)` (the migration primitive) | ✅ OK |
| langchain `Milvus` uses `has_collection`/`describe_collection` (alias-resolvable), accepts arbitrary `collection_name` | ✅ (source) |

**Residuals (carried into FR-004/FR-006/FR-010a, not yet proven):**
1. Did **not** exercise langchain `aupsert`/`adelete`/`add_embeddings` against an **alias** with the full dense+sparse(BM25)+embedding schema — only raw-client reads + the method signatures.
2. The `vector_db` wrapper is a **module-global built once at startup** (`restapi.py:299`). After a server-side `alter_alias`, that long-lived object may still hold the old collection handle → **promotion likely requires re-initializing the wrapper / query service**, not just flipping the alias. Encoded in FR-006.

### F5 — Vertex connection pattern (source: `~/ai` helm values)

`helm/dev-values.yaml:146-148`, `prod-values.yaml:81-83`:
- `GOOGLE_CLOUD_PROJECT` (dev `cyclops-dsm20-play-euler-936c`, prod `cyclops-dsm20-prod-mccart-713b`), `GOOGLE_CLOUD_LOCATION: us-central1`, `GOOGLE_APPLICATION_CREDENTIALS: /etc/gcp/key.json`.
- SA key delivered via secret `gcp-vertex-secret-key`, rotated from vault (`scripts/rotate-vault-secrets.sh`).
- ⚠️ `~/ai` sets `EMBEDDINGS_PROVIDER: "azure_openai"` (**underscore**) while this repo's factory matches `"azure-openai"` (**hyphen**, `embeddings_factory.py:68-73`). Confirm the new `google`/`vertex` value's exact spelling and reconcile the separator convention (FR-001).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Native Google/Gemini embeddings provider (Priority: P1)

As a platform operator, I can set `EMBEDDINGS_PROVIDER=google` (or `vertex`) and `EMBEDDINGS_MODEL=gemini-embedding-2-preview` and have the RAG server embed **text** through Google's API (Vertex), exactly as it does today for Azure/OpenAI.

**Why this priority**: Smallest unit of value; everything else builds on having the provider. Pure addition — no migration, no schema change. Even without the swap machinery (Stories 2-3), an operator could use it via the existing (destructive) wipe-and-reingest path. (Multimodal embedding is **not** part of this story — see Story 5.)

**Independent Test**:
1. Set `EMBEDDINGS_PROVIDER=google`, `EMBEDDINGS_MODEL=gemini-embedding-2-preview`, `EMBEDDINGS_DIMENSIONS=3072`, provide Vertex creds (F5).
2. Start the server against an empty Milvus → `init_tests` embeds a probe string successfully and logs dimension 3072.
3. Ingest a small text datasource; query it; confirm relevant results.
4. Set an unknown model with no `EMBEDDINGS_DIMENSIONS` → factory falls back to the documented default and logs a clear warning.

### User Story 2 — Versioned, model-stamped collections behind a stable alias (Priority: P1)

As a platform operator, the physical Milvus collection is named for its model + dimension + version (e.g. `rag_docs__google__gemini-embedding-2-preview__3072__v2`), and all reads/writes go through a stable alias (`rag_default`). The active model identity is stamped on the collection so startup validation can detect a model change — not just a dimension change.

**Why this priority**: Foundation that makes a non-destructive swap possible. It also closes a latent correctness bug: today two different 3072-dim models (`text-embedding-3-large` ↔ `gemini-embedding-2-preview` at default 3072) pass the dimension check **silently**, producing garbage retrieval with no error (`restapi.py:1919-1928` checks `dim` only). **This collision is now concrete, not hypothetical** (both are 3072).

**Independent Test**:
1. Fresh start: server creates `rag_docs__<model>__<dim>__v1` and an alias `rag_default` → that collection.
2. Ingest + query through the alias → identical behavior to today (hybrid dense+sparse, RBAC filters intact).
3. Inspect collection identity → `provider`, `model`, `dim` stamped.
4. Restart with a *different* `EMBEDDINGS_MODEL` of the **same** dimension (te3-large→gemini-2, both 3072) → `init_tests` now fails with a **model-identity mismatch** error (not a silent pass), instructing the operator to run a reindex (Story 3).
5. Existing-deployment migration: a pre-existing literal `rag_default` collection is renamed to `…__v1` and the alias created pointing at it, with zero data loss (Migration Notes; `rename_collection` verified in F4).

### User Story 3 — Background reindex with atomic promotion (Priority: P1)

As a platform operator, when I want to switch models I trigger a **reindex**: the system creates a new model-stamped collection, re-ingests every datasource into it **in the background while the old collection keeps serving queries**, then atomically flips the alias to the new collection. The old collection is retained for rollback.

**Why this priority**: The headline capability — "switch whenever, re-ingest instead of wipe + start over."

**Independent Test**:
1. With `rag_default` → `…__v1` active and serving, trigger a reindex to a new model.
2. While the reindex runs, issue queries → they continue to succeed against `…__v1` (no downtime; alias swap transparency verified in F4).
3. Reindex re-fetches each datasource from source via the existing reload path (`ingestor.py reload_datasource`) into `…__v2`.
4. On completion, the alias flips to `…__v2` **and the server's vstore wrapper is re-initialized** (F4 residual #2); subsequent queries hit `…__v2`.
5. A datasource with no re-fetchable origin (push-only `POST /v1/ingest`) is handled per FR-005 (fallback to stored text or explicit skip+report) — never silently lost.
6. Roll back: re-point the alias to `…__v1` (+ wrapper re-init); queries return prior results. `…__v1` is only dropped on explicit operator action.

### User Story 4 — Superadmin collection-manager UI (Priority: P2)

As a CAIPE superadmin, in the admin UI I can see all RAG collections (model, dim, item count, status, created-at, which is active), watch an in-flight reindex with a **% complete** indicator and error/skipped counts, **promote** a completed collection (alias flip), **roll back**, and **delete** old collections — all behind super-admin RBAC with confirmation on destructive actions.

**Why this priority**: Stories 1-3 deliver the capability via API/CLI; Story 4 makes it operable by humans. Progress %, skipped-by-modality count, and promote/delete fall directly out of the Story 3 state machine.

**Independent Test**:
1. Superadmin opens **Admin → RAG → Collections**; sees the active collection badged.
2. Starts a reindex to a new model from a dropdown sourced from the capability manifest (FR-002).
3. Watches `% = items_embedded / items_total` climb, with live skipped/error counts (incl. per-modality skips).
4. On completion, clicks **Promote** → alias flips + wrapper re-inits; UI reflects the new active collection.
5. Clicks **Delete** on the old collection → confirmation → collection dropped; action audit-logged.
6. A non-superadmin cannot see or invoke any of these controls (server-side gate, not just hidden in UI).

### User Story 5 — Multimodal ingestion (Priority: P2, gated)

As a platform operator using `gemini-embedding-2-preview`, when I ingest a web source the crawler also captures supported media (images, video, audio, PDFs), and those are embedded **by the same model that embeds my text** so a text query can retrieve them. When the active model is text-only (`text-embedding-3-large`), media items are **skipped and counted**, never silently dropped or sent to an incompatible embedder.

**Why this priority**: Highest-value, highest-effort, highest-risk. Depends on (a) the live-credential spike confirming the SDK call path (FR-010a) and (b) the modality-aware scaffolding from Story 2 already in the schema.

**Independent Test**:
1. *(Spike, FR-010a)* Against real Vertex creds, confirm the exact SDK + `embed_content()` request shape per modality, returned dimension, and that one unified adapter handles text **and** media; document before building extractors.
2. With `gemini-embedding-2-preview` active, ingest a page with images → image items extracted, tagged `modality=image`, embedded via the SDK adapter, stored via `add_embeddings`, and **retrievable via a text query** (same unified space).
3. Switch the active model to `text-embedding-3-large` and reindex → image items are **skipped** with an exact per-modality count; text items succeed.
4. Switch back to `gemini-embedding-2-preview` and reindex → image items reappear.
5. No code path ever passes a non-text payload to a text-only `Embeddings` instance, and on the multimodal model **text also flows through the SDK adapter** (no Azure-text + Gemini-media split).

## Functional Requirements *(mandatory)*

### FR-001 — Native Google embeddings provider (text path)

`common/src/common/embeddings_factory.py` gains a `google` (alias `vertex`) branch:
- Bump dependency `langchain-google-vertexai` to **3.2.3** in `common/pyproject.toml`; use its `VertexAIEmbeddings` for the **text** embedding path (confirm the non-deprecated successor class in the spike, F2).
- Reads Vertex config per F5: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`; validates presence and raises a clear `ValueError` if missing (matching the existing per-provider style, e.g. `embeddings_factory.py:79-80`).
- Reconcile the provider-string separator (`google` vs any underscore variant) and document the canonical spelling (F5 ⚠️).
- Extends `get_embedding_dimensions()`'s `dimension_map` (`embeddings_factory.py:179-207`) with `gemini-embedding-2-preview` → 3072, and honors `EMBEDDINGS_DIMENSIONS` for Matryoshka 1536/768.
- Updates the provider list in the final `else` error message (`embeddings_factory.py:161`).

### FR-002 — Embedding capability manifest

A single source of truth maps each supported model to its capabilities:

```
model_id -> { provider, dim, modalities: [text|image|audio|video|pdf], output_dim_configurable: bool, embed_path: "langchain" | "genai_sdk" }
```

- Lives in `common` (e.g. `common/src/common/embeddings_manifest.py`), extending the existing `dimension_map` rather than duplicating it.
- `text-embedding-3-large` → `{dim:3072, modalities:[text], embed_path:"langchain"}`. `gemini-embedding-2-preview` → `{dim:3072, modalities:[text,image,audio,video,pdf], output_dim_configurable:true, embed_path:"genai_sdk"}`.
- Drives: the superadmin model dropdown (FR-008), the reindex modality gate (FR-009), dimension stamping (FR-003), and **which embedding code path is used** (FR-010c).
- This scaffolding lands in Story 2 even though media extractors come in Story 5 — **no second schema migration**.

### FR-003 — Versioned collection naming + model identity stamping

- Physical collections named deterministically: `rag_docs__<provider>__<model>__<dim>__v<N>` (separator `__`; model sanitized to Milvus-legal chars).
- On creation, stamp model identity (Milvus collection properties and/or a row in the existing Redis `MetadataStorage`): `provider`, `model`, `dim`, `manifest_version`, `created_at`.
- `default_collection_name_docs` (`restapi.py:111`) is replaced by a constant **alias** name (`rag_default`, preserved) plus a resolved physical name. All ~9 literal uses (`restapi.py:111,205,301,311-320,834,912,1824,1901`) route through the alias.

### FR-004 — Alias-based query and ingest path

- The langchain `Milvus` wrapper is constructed against the **alias** name, not a literal collection (`restapi.py:299-307`, and the `init_tests` test instance at `restapi.py:1868-1869`).
- Query (`query_service.py:133`), ingestion upsert (`ingestion.py:803`), cleanup (`restapi.py:172-221`), media insert (`add_embeddings`, FR-010c), and direct `client.query` calls (`restapi.py:834,912`) all operate through the alias so promotion is transparent.
- **Verified (F4):** alias reads + `alter_alias` mid-flight are transparent on the pinned versions. **Still to prove in the spike:** langchain `aupsert`/`adelete`/`add_embeddings` against an alias with the full dense+sparse(BM25) schema (F4 residual #1). If any write path rejects an alias, resolve alias→physical at that call site.

### FR-005 — Reindex orchestration (source re-fetch) with push-only fallback

- A reindex job: (1) creates the new model-stamped collection; (2) enumerates all datasources from `MetadataStorage`; (3) for each, re-runs the existing reload path (`ingestors/.../ingestor.py reload_datasource`, and the Confluence/other ingestors' equivalents) targeted at the **new** collection; (4) tracks progress.
- **Push-only fallback:** datasources from direct `POST /v1/ingest` (`restapi.py:1459`, `DocumentIngestRequest` — no re-fetchable origin) can't be re-fetched. For these, re-embed from the **stored chunk text** already in the old collection (retrievable, cf. `restapi.py:912`). If unavailable, **skip and report** — never silently drop. (Stored-text fallback is text-only and cannot gain new modalities.)
- Resumable/idempotent at datasource granularity (keyed by `datasource_id`); throttled (reuse `MAX_INGESTION_CONCURRENCY`).

### FR-006 — Atomic promotion, rollback, retention, wrapper re-init

- **Promote** = `alter_alias(rag_default → new_collection)` as a single atomic op (verified F4).
- **After any alias change, re-initialize the server's `vector_db` wrapper and `VectorDBQueryService`** so the long-lived module-global object picks up the new target (F4 residual #2). A bare server-side alias flip is **not** sufficient for the in-process wrapper.
- Previous collection **retained** on promotion (rollback target).
- **Rollback** = re-point alias to the prior collection (+ wrapper re-init).
- **Delete** is an explicit, separate, audit-logged operation, never implicit in promote.

### FR-007 — Startup validation: identity, not just dimension

`init_tests` (`restapi.py:1843-1948`) is extended so that for the alias's resolved collection it:
- Compares the **stamped model identity** to the live `EMBEDDINGS_PROVIDER`/`EMBEDDINGS_MODEL`, not only the `dense` dimension (`restapi.py:1919-1928`). (te3-large↔gemini-2 are both 3072 — the dimension check alone passes silently.)
- On model-identity mismatch, emits an actionable error directing the operator to run a reindex (Story 3) rather than today's wipe instruction.
- Validates that the alias exists and resolves to a real, healthy collection.

### FR-008 — Superadmin collection-manager API + UI

- **API (RAG server):** list collections (+status/counts/identity), start reindex (target model from the manifest), get reindex progress, promote, rollback, delete. Admin-only mutations.
- **UI:** **Admin → RAG → Collections** surface (sibling to existing `ui/src/components/rag/*` panels such as `KbTeamAccessPanel.tsx`), with the list, live progress %, and promote/rollback/delete actions. RAG server URL already wired (`ui/src/lib/config.ts:352`) and proxied (`ui/src/app/api/rag/[...path]/route.ts`).
- **RBAC:** gated to super-admins, reusing the existing concept (`ui/src/lib/rbac/super-admins-team.ts`) and admin-tab gate pattern (`ui/src/app/api/rbac/admin-tab-gates`). Enforced **server-side**, not just hidden.

### FR-009 — Modality tagging + reindex modality gate

- Every chunk/document carries a `modality` tag (`text`/`image`/`audio`/`video`/`pdf`). Extend `DocumentMetadata.document_type` (`common/src/common/models/rag.py:170`) or add an explicit `modality` field if `document_type` is too overloaded.
- During reindex, each item is checked against the **target model's** manifest modalities (FR-002). Unsupported items are **skipped and counted per modality**; counts surface in job status + UI (FR-008). **Silent drops prohibited.**
- **BM25 nuance (F3):** a media chunk's `text` field carries any caption/alt/transcript proxy so it contributes to sparse retrieval; with no proxy it is **dense-only**. Document this in the chunk contract.

### FR-010 — Multimodal extraction + unified SDK embedding (gated)

**FR-010a (gate — live-credential spike):** Against real Vertex creds (F5), confirm in writing: the exact Google GenAI SDK + `embed_content()` request/response shape **per modality** (image bytes/GCS URI, video segment, audio, PDF), the returned dimension(s), task-type handling, and that a **single adapter instance** embeds text **and** media into one space. Also prove F4 residual #1 (alias + `add_embeddings` with the BM25/dense/sparse schema). **No extractor/embedding code lands until sign-off.** The spike updates the manifest (FR-002) with ground truth.

**FR-010b (extraction):** New media handling in the webloader: stop denying supported media extensions for the **active** model (`spiders/recursive.py:77-107`), capture media payloads/refs, and emit items with the correct `modality` tag + any text proxy (alt/caption/transcript) for BM25. PDFs default to **text extraction** (works with any model); "embed PDF page as image" is only for the multimodal model.

**FR-010c (unified embedding adapter):** A single SDK-backed `Embeddings` subclass (e.g. `GeminiMultimodalEmbeddings`) that:
- Implements the standard `embed_query()` / `embed_documents()` over the Google GenAI SDK `embed_content()` — so the **text query path and text ingest go through the SAME model/path as media** (no Azure-text + Gemini-media split; enforces the §"one model owns all modalities" corollary).
- Adds non-standard `embed_image()/embed_video()/embed_audio()/embed_pdf()` methods used only by the media ingest path; results stored via `Milvus.add_embeddings(...)` (F3) into the same alias/collection.
- The manifest's `embed_path` (FR-002) selects this adapter for `gemini-embedding-2-preview` and the stock langchain text classes for text-only models. **Text-only models reject non-text input at the boundary** — never coerce.

## Non-Functional Requirements

- **Zero-downtime**: reindex and promotion never interrupt query serving. Exactly one healthy collection backs the alias at all times.
- **Backward compatibility**: existing `rag_default` deployments migrate in place (rename + alias, F4) with no data loss and no re-ingest required to keep working on the current model.
- **Query parity**: with one active model, the query path (hybrid dense+sparse via `BM25BuiltInFunction`, weighted ranker, RBAC/ACL filters) matches today's behavior. Alias resolution adds no measurable latency (F4).
- **Cost/observability**: re-embedding cost is real and surfaced (counts, progress, ETA). Reindex is throttled and resumable. Note multimodal embedding cost > text.
- **Security**: all collection-management mutations are super-admin-only, server-side; destructive actions (delete/promote/rollback) require confirmation and are audit-logged with actor + timestamp. Vertex SA key handled per F5 (secret-mounted, vault-rotated).
- **No silent data loss / no silent space-mismatch**: skipped datasources/modality-gated items are always counted and reported; a model-identity change is caught at startup (FR-007), not discovered via degraded results.

## Migration Notes

- **Existing `rag_default` collection** (common case): on first startup of the new code, detect a *physical* collection literally named `rag_default`, `rename_collection` it to `rag_docs__<current-provider>__<model>__<dim>__v1` (verified F4), stamp identity, then `create_alias(rag_default → …__v1)`. No re-ingest required; the same model keeps serving. Guard so it runs once and is idempotent.
- **Stories 1-2** are otherwise additive. **Story 3** changes the *recommended* model-switch procedure from wipe-and-reingest to reindex-and-promote; the old destructive path still works.
- **Adopting `gemini-embedding-2-preview`** re-embeds the **entire** collection (text included) — by design (§ one model owns all modalities). Plan for the full re-embed cost.
- **Story 5** is additive behind FR-010a; until the spike lands, the system is text-only with full multimodal *scaffolding* (manifest + modality tags) present.
- **RBAC docs:** if FR-008 introduces a new gate/role/auth surface, update the canonical RBAC reference under `docs/docs/security/rbac/` in the same change (per repo `CLAUDE.md` "RBAC Living Documentation Rule").

## Acceptance Criteria

- [ ] `EMBEDDINGS_PROVIDER=google`, `EMBEDDINGS_MODEL=gemini-embedding-2-preview` embeds text and passes `init_tests` against an empty Milvus at dim 3072 (FR-001).
- [ ] Fresh start creates a model-stamped collection + `rag_default` alias; ingest/query through the alias matches today's behavior (FR-002/004).
- [ ] Restart with a different same-dimension model (te3-large↔gemini-2, both 3072) fails with a **model-identity** mismatch, not a silent pass (FR-007).
- [ ] A reindex to a new model runs in the background while queries keep succeeding against the old collection, then promotes atomically **and re-inits the wrapper**; rollback restores the prior collection (FR-003/005/006).
- [ ] Push-only (`POST /v1/ingest`) datasources are re-embedded from stored text or explicitly skipped-and-reported during reindex — never silently lost (FR-005).
- [ ] Superadmin UI shows live reindex % and skipped/error counts (incl. per-modality) and can promote/rollback/delete; a non-superadmin is blocked server-side (FR-008).
- [ ] On `gemini-embedding-2-preview`, a **text query retrieves an ingested image** (proves unified space); switching to a text-only model and reindexing reports exact per-modality skip counts; no non-text payload ever reaches a text-only embedder; text is **not** embedded by a different model than media (FR-009/010c).
- [ ] An existing `rag_default` deployment upgrades in place (rename + alias) with zero data loss and no forced re-ingest (Migration Notes).
- [ ] The FR-010a live-credential spike is documented and signed off before any Story 5 extractor/embedding code lands.
- [ ] RBAC reference under `docs/docs/security/rbac/` updated if FR-008 adds an auth surface.

## Out of Scope

- **Cross-model fan-out / fused search** (embedding one query with N models + RRF merge). Single-active-model by design; rejected as noisy/low-value.
- **Multiple models live simultaneously with per-query routing** (docs-model vs code-model). Possible on the collection registry later; not built here.
- **Per-datasource or per-tenant model selection.** One active model per deployment.
- **Text-from-one-model + media-from-another** within one collection. Explicitly forbidden (§ one model owns all modalities); breaks cross-modal retrieval silently.
- **In-place vector transformation** between model spaces (mathematically impossible; reindex is the only path).
- **Multimodal support via the LangChain `Embeddings` interface** — not available today (F2); we use the Google GenAI SDK directly until LangChain ships it.
- **Graph/ontology stack (Neo4j) changes** — only the dense-vector Milvus path is in scope.
- **Sparse/BM25 changes** — server-side, model-independent, unaffected (`restapi.py:113,304`).

## Dependencies

- `pymilvus==2.6.2` / `langchain-milvus==0.3.0` (already in `server/pyproject.toml`) — alias, `rename_collection`, `add_embeddings` all verified present (F3/F4).
- Bump: `langchain-google-vertexai` → 3.2.3 in `common/pyproject.toml` (FR-001, text path).
- New: Google GenAI SDK (`google-genai`) for the multimodal `embed_content()` path (FR-010c) — exact package/class pinned by the FR-010a spike.
- Existing reload machinery in the webloader and other ingestors — the reindex re-fetch primitive (FR-005).
- `MetadataStorage` / `JobManager` (`common/src/common/metadata_storage.py`, `job_manager.py`) — identity stamping + reindex job tracking.
- Super-admin RBAC (`ui/src/lib/rbac/super-admins-team.ts`, `ui/src/app/api/rbac/admin-tab-gates`) — FR-008 gating.
- RAG UI proxy + config (`ui/src/app/api/rag/[...path]/route.ts`, `ui/src/lib/config.ts:352`) — FR-008 surface.
- Vertex access (F5): `gcp-vertex-secret-key` secret + `GOOGLE_CLOUD_PROJECT/LOCATION/APPLICATION_CREDENTIALS` env, vault rotation.

## Open Questions (capture as `/speckit.clarify` before implementation)

1. ~~Multimodal model identity~~ **RESOLVED (F1/F2):** `gemini-embedding-2-preview`, multimodal via Google GenAI SDK `embed_content()`, 3072-dim (Matryoshka 1536/768). LangChain `Embeddings` is text-only; use the SDK for media. *Remaining:* exact SDK package/class + per-modality request shape → FR-010a live spike.
2. ~~Alias tolerance~~ **MOSTLY RESOLVED (F4):** alias reads + `alter_alias` swap verified on pinned versions; `rename_collection` works. *Remaining:* langchain `aupsert`/`adelete`/`add_embeddings` against an alias with the BM25/dense/sparse schema → FR-010a spike.
3. **Identity stamping location** — Milvus collection properties vs Redis `MetadataStorage`, or both? Which is authoritative for `init_tests`?
4. **Reindex trigger** — superadmin-only via UI/API, or also automatic on detecting a model-config change at startup? (Leaning manual-only to avoid surprise multi-hour reindexes.)
5. **Old-collection retention policy** — keep last N versions, or retain until explicit delete? (Leaning explicit-delete with a UI nudge.)
6. **Reindex of push-only datasources** — is stored-text re-embed the canonical fallback, or should those sources be required to re-push? (FR-005.)
7. **Successor text class (F2):** `VertexAIEmbeddings` is deprecated in `langchain-google-vertexai`; confirm the intended replacement for the text path before wiring FR-001.
8. **Video/audio chunking** — one vector per ≤120s clip, or segmented? (Design question, SDK-independent; pin in FR-010a.)

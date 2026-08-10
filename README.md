# CAIPE UI (customised)

A customised build of the CAIPE web UI, used for RAG evaluation. On top of the
stock UI it adds:

- **Benchmark Corpus ingestion** — a new Data Sources type that uploads a
  `.jsonl` corpus and keeps each document's **original `document_id`**, so it
  lines up with an evaluation question set.
- **Evaluation section** — a three-tab workflow: **Question Sets**,
  **Run Experiment**, and **Leaderboard**.

Everything else is the upstream CAIPE UI.

## Setup

Drop this `ui/` folder into the CAIPE repo (replacing its `ui/`), then from the
repo root:

```bash
cd <your-root>/ai-platform-engineering
docker build -f build/Dockerfile.caipe-ui --target runner -t ghcr.io/cnoe-io/caipe-ui:0.5.16 .
docker compose up -d --force-recreate caipe-ui
```

Then open **http://localhost:3000**.

> **Why that tag?** Building under `ghcr.io/cnoe-io/caipe-ui:0.5.16` — the name the
> base `docker-compose.yaml` already expects — means the standard `docker compose up`
> picks up this custom image automatically. **No override file or extra flags needed.**

## Notes

- This is only the UI — it needs the full CAIPE stack (rag-server, Keycloak, etc.)
  from the main repo running alongside it.
- To go back to the stock UI: `docker pull ghcr.io/cnoe-io/caipe-ui:0.5.16`, then
  rebuild to get this one back. Don't run `docker compose pull` while using this image.
# mcp_pod_meeting

Deterministic helpers for Pam Beesly (the Pod Meeting Assistant). This MCP intentionally does NOT call other MCPs — Pam orchestrates them.

**Tools:**
- `parse_webex_vtt(vtt_text | url)` — Cisco-flavoured VTT → `{segments, speakers, duration_s}`
- `extract_action_items(segments)` — heuristic action-item extraction
- `extract_decisions(segments)` — heuristic decision extraction
- `resolve_owners(owner_hints, pod_id)` — first-name → roster member
- `harvest_webex_topics(room_id, since_iso?, tag="#agenda")` — Webex room messages tagged for agenda
- `load_agenda_template(template_url?)` — built-in default storage XHTML
- `render_agenda_xhtml(template?, standing_topics, prior_actions, harvested_topics, meeting_meta)`
- `render_notes_xhtml(template?, transcript_summary, decisions, action_items, deliverables, meeting_meta)`
- `get_pod` / `list_pods` / `upsert_pod` — Mongo `pods` CRUD
- `find_prior_meeting_page(pod_id, before_iso?)` — local cache (Mongo `pod_meeting_pages`); fallback is Confluence search

**Auth:** none. Reads `MONGODB_URI`, `MONGODB_DATABASE` (default `caipe`), and `WEBEX_TOKEN` (only needed by `harvest_webex_topics`).

**Run:**
```
mcp-server-pod-meeting --transport streamable-http --host 0.0.0.0 --port 8000
```

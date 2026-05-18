# Session Notes — 2026-05-18: Carlos 5-Layer Multi-Model Router

## What Was Built

### Carlos Multi-Model Routing Architecture
Built the complete Carlos routing system as specified collaboratively by Claude, GPT, and Perplexity.

**File: `netlify/functions/carlos-router.js`**
Full 5-layer architecture:

- **Layer 0 — Session State**: Checks `carlos_session_state` Supabase table. Classifies message as `same_task | new_task | correction | interruption | clarification | approval | rejection` via Haiku. Continuation messages skip reclassification.
- **Layer 1 — Classifier**: Claude Haiku (`claude-haiku-4-5-20251001`). Returns JSON with intent, confidence, needs_memory/web/long_context/execution flags, emotional_tone, urgency, risk_level, estimated_cost, safe_summary. Escalates to Sonnet if confidence < 0.75.
- **Layer 2 — Retrieval**: 8 parallel sources, all timeout-guarded (1-4s). Philosophy anchors, stable truths, active context (1s each), health data (1s if HEALTH/ANALYSIS/COLLABORATION), business data (1s), conversation history via RAG vector search (2s), RAG document search (2s), Perplexity live web (4s if needs_web). All fail gracefully — single source failure never fails the request.
- **Layer 3 — Specialist Execution**: 11 routes:
  - STRATEGY: `claude-sonnet-4-6` with extended thinking → gpt-4o fallback
  - ANALYSIS: gpt-4o structured → claude-sonnet-4-6 synthesizes → claude-sonnet-4-6 alone fallback
  - CONTENT: `claude-sonnet-4-6` + brand voice RAG → gpt-4o fallback
  - RESEARCH: Perplexity sonar-pro → claude-sonnet-4-6 interprets → gpt-4o operationalizes (max 3 hops)
  - DOCUMENT: claude-sonnet-4-6 chunked (no Gemini key — graceful degradation)
  - HEALTH: Supabase + claude-sonnet-4-6
  - MEMORY: RAG + Supabase + claude-sonnet-4-6
  - BUSINESS: gpt-4o structured → claude-sonnet-4-6 fallback
  - CODE: Windmill code_agent webhook → claude-sonnet-4-6 fallback
  - AGENT: Windmill label_compliance_agent → claude-sonnet-4-6 fallback
  - COLLABORATION: claude-sonnet-4-6 + emotional tone awareness
- **Layer 4 — Synthesis**: Every response passes through Carlos voice filter (Haiku). Removes em dashes, "as an AI" language, hedging. Applies emotional tone. Length-aware: short for HEALTH/COLLABORATION/BUSINESS.

**File: `netlify/functions/carlos-chat.js`**
Replaced full orchestration with thin proxy: `const { routeMessage } = require('./carlos-router')`. Frontend continues calling `/api/carlos-chat` unchanged.

### Database Changes
Migration `20260518_carlos_routing.sql` applied:
- Added columns to `carlos_routing_log`: confidence_score, needs_memory/web/execution, emotional_tone, urgency, risk_level, hop_count, models_used_array (jsonb), layer_times (jsonb), retrieval_sources (jsonb), layer0_result, user_rating (smallint)
- Created `carlos_session_state` table with user_id, active_intent, active_models, active_context, hop_count, started_at, last_updated, status

### Thumbs Up/Down Rating UI
Added to `carlosRenderCarlos()` in `index.html`:
- `logId` passed from API response → stored in `data-log-id` on message element
- Thumbs up/down buttons rendered after each Carlos message
- `carlosRate()` function POSTs `{ action: 'rate', logId, rating: 1|-1 }` to `/api/carlos-router`
- CSS: `.cmsg-rate` — greyscale at rest, full color on hover/after click
- Router handles rating update path: `PATCH carlos_routing_log WHERE id = logId`

### ElevenAgent System Prompt
Updated `agent_9601krwd41pbev4ac8tstafb5scv` via `PATCH /v1/convai/agents/{id}`. New prompt includes:
- Explicit model routing awareness (which model handles which intent)
- Full Carlos voice rules
- "No topic restrictions — any topic Chris raises, engage openly, give actual opinions"
- Tool confirmation pattern (one natural sentence)

## Architecture Decisions

**carlos-router.js as module, carlos-chat.js as proxy** — frontend calls `/api/carlos-chat` (no URL change needed), while `/api/carlos-router` is available as standalone endpoint. esbuild bundles both. Single source of truth for routing logic.

**No Gemini** — no GOOGLE_AI_API_KEY. DOCUMENT route uses `claude-sonnet-4-6` with 2048 token max. Noted in code, graceful.

**GPT-4o optional** — OPENAI_API_KEY not yet confirmed present. ANALYSIS and BUSINESS routes fall back to claude-sonnet-4-6 if OpenAI key missing.

**Extended thinking for STRATEGY** — uses `interleaved-thinking-2025-05-14` beta with 2000 token budget. Falls back to non-thinking if API rejects.

**Session state per user** — `carlos_session_state` tracks active intent for same-task continuation. Allows "same_task" detection to skip Layer 1 reclassification overhead.

**Cost guardrail at $0.50** — if Haiku estimates a single request above $0.50, Carlos asks for confirmation before executing. Returns `requiresCostConfirmation: true` in response body.

**Routing log with logId in response** — every response includes `logId` from the inserted `carlos_routing_log` row. Frontend uses this for thumbs up/down ratings. No second round-trip to get the ID.

## Decisions Rejected

**Inline tool definitions in ElevenAgent** — already worked through in previous session. Tool IDs referenced via `tool_ids` array.

**Gemini for DOCUMENT** — no key available. Chunked Sonnet is the right call vs. spending complexity on a key that doesn't exist yet.

## Open Items

- **OPENAI_API_KEY** — needs to be added to Netlify env vars (get from platform.openai.com). Without it, ANALYSIS and BUSINESS routes fall back to Sonnet (works, just less structured).
- **PERPLEXITY_API_KEY** — was added in previous session. Confirm it's in Netlify env.
- **GOOGLE_AI_API_KEY** — not needed yet (DOCUMENT uses Sonnet). Note if Gemini 2.5 Pro becomes needed.
- **GPT export ingestion** — task `bi9vudw3o` failed. 885 conversations not yet ingested. Needs retry.
- **Thryve approval dashboard** — NOT started. Product content saved to `setup/shopify_products_content.json`. Full spec in previous session context.
- **Whoop developer credentials** — still pending.
- **Weekly Windmill job for routing quality** — spec mentions weekly analysis of ratings by route. Not yet built.
- **`carlos_session_state` cleanup** — no TTL or cleanup job for stale sessions. Sessions with status='active' accumulate. Should add a cleanup: PATCH status='completed' for sessions not updated in 4+ hours.

## Commits

- `197c55b` — Add Carlos 5-layer multi-model routing architecture

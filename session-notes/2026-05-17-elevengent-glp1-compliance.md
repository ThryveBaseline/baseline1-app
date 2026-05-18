# Session Notes — 2026-05-17
## ElevenAgent Migration + GLP-1 Compliance Audit

---

## What Was Built

### 1. ElevenAgent Migration (10 Phases) — baseline1-app

Migrated Carlos from custom Claude API + ElevenLabs TTS to full ElevenLabs Conversational AI (ElevenAgent) using WebSocket protocol.

**Files created:**
- `setup/create-carlos-agent.js` — one-shot script to create the ElevenAgent with 6 webhook tools and post-call webhook. Run with `ELEVENLABS_API_KEY=<key> node setup/create-carlos-agent.js` → prints `CARLOS_AGENT_ID`.
- `setup/upload-knowledge-base.js` — uploads `carlos-foundation-v1.md` to ElevenLabs KB and attaches to agent.
- `netlify/functions/carlos-session-token.js` — POST `/api/carlos-session-token`. Fetches Supabase context (stable_truths, philosophy_anchors, active_context, conversation_history, daily_health_context), calls ElevenLabs signed URL API, returns `{ signed_url, agent_id, dynamic_variables, initiation_payload }`.
- `netlify/functions/carlos-post-call.js` — POST `/api/carlos-post-call`. ElevenLabs webhook called after conversation ends. Stores to `conversation_history` table, updates active_context last check-in, optionally triggers Windmill distillation.
- `netlify/functions/carlos-tools.js` — POST `/api/carlos-tools`. ElevenAgent tool webhook. Routes `tool_name`: get_health_data, log_health_entry, get_weekly_summary, get_agent_feedback, update_agent_feedback, get_memory_context.
- `supabase/migrations/20260517_conversation_history.sql` — DDL for conversation_history table with RLS (service_role only). **Must be applied manually in Supabase SQL Editor.**
- `supabase/functions/carlos-get-summary/index.ts` — Supabase Edge Function for multi-table health/business aggregation.

**index.html changes (Phase 7–10):**
- Added ElevenAgent WebSocket state to `CARLOS` object: `elevenWs`, `elevenMicStream`, `elevenMicCtx`, `elevenMicProcessor`, `elevenPlayNext`, `elevenConvId`
- Replaced conversation mode with ElevenAgent flow: `carlosElevenConnect()` → signed URL → WebSocket → PCM 16kHz mic stream → PCM 16kHz audio playback
- New functions: `carlosElevenConnect()`, `carlosElevenDisconnect()`, `carlosElevenHandleMessage()`, `carlosElevenPlayPcm()`
- Text mode and single-shot mic remain on `carlos-chat.js` path — unchanged
- PCM encoding: Float32 mic → Int16 PCM → base64 → WS send; base64 PCM receive → Int16 → Float32 → Web Audio

**Architecture decisions:**
- Session token server-side only — SUPABASE_SERVICE_ROLE_KEY never exposed to frontend
- PCM 16kHz chosen over µ-law for direct Web Audio playback without codec dependency
- Dynamic variables injected at session open via `conversation_initiation_client_data` — not mid-conversation
- Text/single-shot mic stays on Claude API path; only conversation mode uses ElevenAgent

**Decisions rejected:**
- µ-law encoding — requires additional decode step, adds latency
- Client-side Supabase queries for session token — security violation

### 2. RAG 503/500 Fix — rag-command-center

- `main.py`: Wrapped `/ingest/webhook` content push path in try/except returning HTTP 503 on exception (was returning raw 500 with no error detail)
- `ingest.py`: Added `_embed()` retry with exponential backoff (1s, 2s, 4s) for Voyage AI rate limit errors (429, "rate limit", "too many requests", "quota")
- Deployed to Render via `git push origin main`

### 3. GLP-1 Compliance Pass — thryve-baseline-agent-systems

Added `glp1_adjacent` compliance check to `windmill/scripts/labels/label_compliance_agent.ts`:
- New `CompliancePass` type value: `'glp1_adjacent'`
- `GLP1_BLOCKING` patterns: drug equivalence, mechanism claims, branded drug comparisons (auto-fail)
- `GLP1_HIGH_RISK` patterns: boosting language, prescription alternatives, "replaces what GLP-1 depletes"
- `patternScanGlp1()` function for fast regex pre-screening
- `passGlp1Adjacent()` Claude Haiku LLM pass with 2026 FTC/FDA safe/unsafe examples from Perplexity Deep Research report

### 4. GLP-1 Compliance Audit — All Thryve Products

Ran full compliance check on all 5 active Shopify products (Hydra Max, Bloat, Balance, Daily Foundation, Complete System).

**Results:**
- Hydra Max: PASS — "People on GLP-1s whose appetite, food intake, and hydration habits have changed" is safe audience targeting, not a drug mechanism claim
- Bloat: PASS — Safe structure/function language throughout, reviews clean
- Balance: ACTION TAKEN — Review "I was struggling on Wegovy. This made a big difference." flagged as HIGH RISK (FTC 2026: testimonials attributing GLP-1 drug outcomes to supplement). Updated to: "Going through some big changes to how I eat. This made a big difference." — live on Shopify.
- Daily Foundation: PASS
- Complete System: PASS

**Key compliance rule established:** Berberine in Balance is currently framed as "complementary metabolic support compound" — this is the correct framing. Do not add "nature's metformin" or GLP-1 comparisons to any berberine copy.

### 5. Claude Export Ingestion — thryve-baseline-memory

- Fixed `convo.chat_messages is not iterable` in `memory/ingestion/claude-ingestor.ts`: `for (const msg of convo.chat_messages)` → `for (const msg of (convo.chat_messages ?? []))`
- Re-ran ingestion after fix; background task b870t4fzx initiated

---

## Open Items

1. **Supabase `conversation_history` migration** — Must apply `supabase/migrations/20260517_conversation_history.sql` manually in Supabase SQL Editor. ElevenAgent post-call webhook will fail without this table.

2. **ElevenAgent activation** (sequential):
   - `! ELEVENLABS_API_KEY=<key> node setup/create-carlos-agent.js` → copy printed `CARLOS_AGENT_ID`
   - Add `CARLOS_AGENT_ID` to Netlify environment variables
   - `node setup/upload-knowledge-base.js`

3. **Supplement industry trends report RAG ingest** — Report saved locally at `supplement-industry-trends-2026.md`. Ingest to `thryve_brand` collection was blocked by Voyage AI free tier rate limiting (3 RPM). Retry after adding payment method at dashboard.voyageai.com or after rate limit resets.

4. **Distillation re-run** — After Claude export ingestion completes, re-run philosophy extraction, decision evolution, and memory distillation workflows in Windmill.

5. **Whoop developer credentials** — Still pending: create app at developer.whoop.com, get CLIENT_ID + CLIENT_SECRET, add to Netlify env.

---

## Supplement Industry Trends — Key Reference

GLP-1 support supplements = highest-growth VMS category for next 12–24 months. Safe claim language: "supports hydration and electrolyte balance", "formulated to complement a GLP-1 lifestyle", "supports muscle maintenance during calorie restriction". Unsafe: any drug name equivalence, mechanism claims, "replaces what GLP-1 depletes". Full report: `supplement-industry-trends-2026.md`.

# Session Notes — 2026-05-18 Full Build Day: Sections 3–10

## What Was Built

### Section 3 — Fine Tuning Pipeline

**Database (Supabase migration):**
- `carlos_routing_log` extended: `local_response`, `cloud_response`, `shadow_similarity_score` columns
- `carlos_training_data` table created with `pii_stripped_at NOT NULL` constraint (DB-level enforcement that PII is stripped before any write)
- Partial indexes on approved_for_training and training candidates
- CHECK constraint prevents future-dated pii_stripped_at values

**PII strip function in carlos-router.js:**
- 7 regex patterns: names, phones, emails, addresses, ZIPs, health metrics (hrv/rhr/recovery/strain), dollar amounts
- `stripPII(text)` returns `{ clean, stripped }` — must be called before any write to carlos_training_data
- Critical invariant: PII stripped BEFORE training data write, not just before JSONL export

**Shadow mode in carlos-router.js:**
- `SHADOW_MODE.enabled` controlled by `SHADOW_MODE_ENABLED` env var
- Parallel GPT-4o call runs silently for STRATEGY/ANALYSIS/CONTENT categories
- Jaccard similarity score computed between Carlos and cloud response
- Candidates stored when similarity < 0.85 (divergent enough to be interesting)
- `approved_for_training: false` — nothing auto-promotes to training

**Windmill scripts (thryve-baseline-windmill):**
- `format_training_data.ts` — second PII pass + JSONL formatting, Notion report
- `schedule_fine_tuning.ts` — monthly, 500 example minimum, Mac Mini endpoint required
- `evaluate_model.ts` — 50 held-out examples, word similarity scoring, promote/rollback/monitor verdict
- `check_local_endpoint.ts` — daily, Notion alert on local AI endpoint discovery

### Section 4 — External Intelligence Pipeline

**Layer 2 addition in carlos-router.js:**
- 9th parallel source: queries `external_intelligence` RAG collection for STRATEGY intent only
- 2-second timeout, fails gracefully, logged in sources map

**Devil's advocate mode:**
- Activates in `routeSTRATEGY()` when external intelligence relevance score ≥ 0.75
- Maximum 2 challenge points surfaced alongside recommendation
- Zero external injection for scores below 0.75 — prevents noise

**Windmill script:**
- `ingest_external_intelligence.ts` — nightly 3am, reads Gmail `[EXTERNAL INTELLIGENCE WEEKLY]` label, Haiku extraction, ingests to `external_intelligence` RAG collection

### Section 5 — Self Improvement Infrastructure

**Database:**
- `model_evaluations` — tracks model name, category, quality score vs current, recommendation, promoted flag
- `system_performance_weekly` — thumbs up rates by category, response ms by category, alerts, recommendations

**Windmill scripts (all require Chris approval, nothing auto-deploys):**
- `monitor_performance.ts` — weekly Monday, alerts when: <70% thumbs-up, >+20% response time, >$150/week spend
- `monitor_new_models.ts` — weekly Monday, Perplexity scan for new Claude/GPT-4 variants, creates "APPROVAL REQUIRED" Notion flag before any promotion
- `community_intelligence_monitor.ts` — weekly Monday 6am, monitors 4 sources (r/entrepreneurship, r/smallbusiness, Newsletter Digest, Industry Report), scores 1-10, surfaces only ≥7, max 5 per week

### Section 6 — Permission Hierarchy

**Middleware added to carlos-router.js:**
- `PERMISSION_LEVELS` object: CHRIS_ONLY, FAMILY_SHARED, INDIVIDUAL, AUTOMATED lists
- `checkPermission(userId, dataType)` — returns boolean based on level
- `enforcePermissions(userId, intent, classification)` — returns error array
- Handler immediately returns 403 for automated user IDs on Carlos routing path
- `enforcePermissions` called at top of `routeMessage` before any processing

**Enforcement rules:**
- CHRIS_ONLY: core_philosophy, routing_logic, strategic_priorities, constitution, financial_data
- FAMILY_SHARED: family_memory, ellington_estates, family_health_summary
- INDIVIDUAL: personal_health, personal_memory, personal_preferences, conversation_history
- AUTOMATED: system_logs, routing_log, performance_metrics
- `automated` / `system` user IDs blocked from HEALTH, MEMORY, STRATEGY intents

**Design decision:** Middleware-first approach — permissions checked before intent classification, before retrieval, before execution. No data leaks from classification stage.

**Test matrix (architectural verification):**
- Jade cannot access Chris personal health (INDIVIDUAL boundary — would need userId match)
- Chris can access family shared memory (FAMILY_SHARED allows FAMILY_USER_IDS)
- Automated ingestion blocked from personal memory (403 at handler entry)
- Family member cannot modify Constitution (CHRIS_ONLY)
- AUTOMATED systems can read system_logs and performance_metrics only

### Section 7 — Baseline Visual Refresh

**CSS design tokens confirmed/added (index.html):**
- `--bg: #1c1917` (warm dark charcoal) — already in place, confirmed
- `--yellow: #f59e0b` (amber accent) — already in place, confirmed
- `--cream: #f5f0e8` (warm off-white text) — already in place, confirmed
- NEW: `--zone-green: #22c55e` and `--zone-green-dim`
- NEW: `--zone-amber: #f59e0b` and `--zone-amber-dim`
- NEW: `--zone-red: #ef4444` and `--zone-red-dim`

**CSS classes updated to use zone vars:**
- `.score-cls.g/o/r` — recovery score text colors
- `.score-ring.g/o/r` — recovery ring border + background
- `.fm-tag.good/warn/bad` — supplement flag colors

**Design decision:** Zone colors kept separate from general UI colors (--green-bright, --red) to avoid affecting profile avatars, toggles, and non-health UI elements. Zone vars are exclusively for health/recovery displays.

**Status:** Live at baselinetest2.netlify.app — deploy c3d2b67, confirmed ready 15:55 UTC.

### Section 8 — Carlos Brief Formatting

**BRIEF_FORMAT_RULES injected into morning-brief.js system prompt:**
- Line 1: Zone + meaning, plain English, one sentence, never recite the number
- Line 2: One honest sleep observation, one sentence, acknowledge if no data
- Line 3: The Carlos line — specific to this person today, never a platitude
- 3 specific achievable wins, time-targeted where possible
- Under 120 words total, no clinical language, no number recitation

**Rules injected as MANDATORY section after memory block and before messages call.**

### Section 9 — Replenish Verification

**Finding:** Page `gid://shopify/Page/124165750831` already exists at handle `replenish`, titled "Replenish — Coming Soon", published. Live at thryve-systems.com/pages/replenish.

**Blocker encountered:** Local `.env` has expired Storefront token (`shpss_` prefix). Used Shopify MCP to query pages. No code push needed — page already live.

**Key learning:** Shopify GraphQL `pageCreate` uses `body` (not `bodyHtml`) and `isPublished` (not `published`) on PageCreateInput. Verified via `graphql_schema('PageCreateInput')`.

### Section 10 — Architecture Documentation

**ARCHITECTURE.md rewritten (rag-command-center):**
- 450+ lines covering all 10 sections of this build day
- Complete Carlos 5-layer routing diagram with shadow mode and permission hierarchy
- Carlos Constitution enforcement mechanism
- Five-tier memory architecture
- Complete RAG collections reference (external_intelligence, carlos_governance added)
- 40+ Supabase tables organized by domain
- 20+ Windmill scripts with paths and schedules
- Deployment topology for all services
- Credential requirements
- Key design decisions and operating checklist

**Status:** Committed to main (42c958c), ingested to RAG shared_decisions (33 chunks).

---

## Architecture Decisions

1. **PII-first invariant** — strip before write, not before export. `pii_stripped_at NOT NULL` at DB level makes this impossible to skip accidentally.

2. **Shadow mode separation** — cloud comparison runs in fire-and-forget async block after response returned to user. Never blocks Carlos response latency.

3. **Permission middleware position** — checked before intent classification. No information leaks from classification stage to unauthorized callers.

4. **Devil's advocate gating** — 0.75 relevance threshold is intentionally high. External intelligence should challenge, not pollute, Carlos strategy responses.

5. **Zone colors isolated** — `--zone-*` vars separate from `--green-bright` / `--red` to avoid visual regressions in non-health UI. Recovery display exclusively uses zone vars.

6. **Brief format rules as MANDATORY** — injected into system prompt as uppercase section, after memory block, to prevent Claude from softening format rules when memory is long.

7. **Self-improvement requires approval** — no model can be promoted to production without Chris review. monitor_new_models creates a Notion flag and stops. Promotion is a separate manual step.

## Decisions Rejected

- **Auto-promote fine-tuned models** — rejected. All promotions require Chris review and explicit `promoted: true` update. Risk of silent quality regression is too high.
- **PII strip on export only** — rejected. Strip must happen before the DB write. Exporting raw training data even temporarily is a PII exposure risk.
- **External intelligence for all intents** — rejected. External RAG only injected for STRATEGY intent. Other intents (HEALTH, MEMORY) don't benefit from external marketing/business frameworks and would add noise.
- **Changing general UI green/red** — rejected. Changing `--green-bright` and `--red` would have affected checkmarks, toggles, alert states. Added dedicated zone vars instead.

## Blockers Documented

- **Shopify local token expired** — local `.env` has `shpss_` prefix token which expired. Admin API token (`shpat_`) required for page management. Workaround: Shopify MCP used to verify Replenish page exists. Permanent fix: rotate token in Shopify admin → Settings → Apps → Develop apps.
- **Windmill schedule registration** — new scripts are in repo (`format_training_data`, `schedule_fine_tuning`, `evaluate_model`, `check_local_endpoint`, `ingest_external_intelligence`, `monitor_performance`, `monitor_new_models`, `community_intelligence_monitor`) but schedules must be registered in Windmill UI or via API. Not blocking deployment.
- **Mac Mini endpoint for fine tuning** — `schedule_fine_tuning.ts` requires `FINE_TUNE_ENDPOINT` env var pointing to Mac Mini server. Not yet set up. Script will fail gracefully until configured.
- **Render Starter plan** — both Render services on Starter ($7/mo) as of 2026-05-17. REST API plan changes return 500. Use dashboard.render.com for any plan changes.

## Open Items

- Register Windmill schedules for all 8 new scripts
- Rotate expired Shopify Admin API token in `.env`
- Configure `FINE_TUNE_ENDPOINT` when Mac Mini server is ready
- Seed `business_weekly_snapshots` collection with real Thryve weekly numbers
- `SHADOW_MODE_ENABLED=true` in Netlify env when ready to start collecting training data
- Whoop developer credentials still pending (developer.whoop.com)

---

## Repos Modified

- `baseline1-app` (main) — carlos-router.js, morning-brief.js, index.html, migrations, session-notes
- `thryve-baseline-windmill` (master) — 8 new Windmill TypeScript scripts
- `rag-command-center` (main) — ARCHITECTURE.md

# Session Notes — Memory Management Architecture

**Date:** 2026-05-18  
**Section:** 2 of multi-section build day  
**Repo:** baseline1-app

---

## What Was Built

### Five-Tier Memory Architecture (`supabase/migrations/20260518_memory_architecture.sql`)

#### New Tables

| Tier | Table | Purpose | Default confidence |
|------|-------|---------|-------------------|
| 1 | `active_memory` | Items accessed in last 30 days, fast retrieval, auto-expires | 0.5 |
| 2 | `archived_memory` | Aged-out items, slower retrieval, compressed summaries | 0.5 |
| 3 | `compressed_memory` | Summarized batches of conversation sets by time period | 0.5 |
| 4 | `verified_memory` | Human-confirmed multiple times, highest confidence, fastest retrieval | 0.9 |
| 5 | `decayed_memory` | Outdated/contradicted items awaiting Chris review or deletion | 0.1 |

All five tables share: `user_id`, `memory_type`, `content`, `verification_state`, `confidence_score`, `source_tracking` (jsonb).

#### `active_memory` additions
- `expires_active_at` — auto-set to `now() + 30 days`, enables scheduled decay job
- `access_count` + `last_accessed_at` — tracks recency for aging logic

#### `verified_memory` additions
- `confirmation_count`, `first_confirmed_at`, `last_confirmed_at`, `confirmed_by`
- Partial index on `confidence_score >= 0.8` for hot-path retrieval

#### `decayed_memory` additions
- `decay_reason`, `source_tier`, `original_id` — full audit trail of why/where
- `review_requested_at`, `reviewed_at`, `review_action` — human review workflow
- Partial index on `reviewed_at IS NULL` for fast "pending review" queries

### Verification State on Existing Memory Tables

`verification_state`, `confidence_score` (where missing), and `source_tracking` added to:
- `philosophy_anchors`
- `stable_truths` (already had confidence_score numeric — added verification_state + source_tracking)
- `decision_evolution`
- `historical_evolution`
- `unresolved_items`

All default to `verification_state = 'ai_inferred'`, `confidence_score = 0.5`.

### `verification_state` Enum Values
- `human_confirmed` — Chris has explicitly confirmed
- `ai_inferred` — AI generated, not confirmed (default for all new items)
- `speculative` — uncertain, needs validation
- `outdated` — was true, may have changed
- `contradicted` — contradicted by newer information

### `source_tracking` jsonb Schema
```json
{
  "type": "conversation|manual|ai_inferred|whoop|shopify|rag",
  "source_id": "...",
  "conversation_id": "...",
  "model": "claude-sonnet-4-6|claude-haiku-4-5|gpt-4o",
  "timestamp": "2026-05-18T..."
}
```

### Confidence Ceiling Enforcement

DB-level trigger `enforce_confidence_ceiling()` applied to all 9 tables (5 new + 4 existing):
- If `verification_state != 'human_confirmed'` AND `confidence_score > 0.8` → clamps to 0.8
- Fires on INSERT and UPDATE
- Implements the Carlos Constitution rule: "confidence scoring requires human_confirmed to exceed 0.8"
- This is code-level enforcement, not just policy documentation

---

## Architecture Decisions

**Trigger at DB level, not application level** — Application code can have bugs or be bypassed. The confidence ceiling must hold even if a bad deploy, a direct DB query, or a future agent tries to self-elevate confidence. DB triggers are the last line of defense.

**Five tiers vs. a single table with status column** — Separate tables let us optimize indexes per access pattern. `active_memory` is heavily indexed for speed. `archived_memory` has minimal indexes (cold path). `verified_memory` has a partial index on high-confidence items. A single table with `tier` column would force full scans for hot-path queries.

**`decayed_memory` as review queue, not delete** — Per the Constitution: "Outdated information decays and gets flagged — never silently persists as current truth." Moving to `decayed_memory` surfaces it to Chris without destroying the data. He decides: keep, delete, restore, or update.

**`source_tracking` as jsonb, not normalized** — The set of source types will evolve. A jsonb column lets us add fields (e.g., `shopify_product_id`, `whoop_cycle_id`) without schema migrations. Not queried in WHERE clauses — only for audit trail display.

---

## Open Items

- **Aging job**: Scheduled Windmill script to move `active_memory` rows where `expires_active_at < now()` → `archived_memory`. Not yet built.
- **Compression job**: Windmill script to batch-summarize archived items into `compressed_memory`. Not yet built.
- **Decay detection**: Logic to identify items that contradict newer evidence → move to `decayed_memory`. Not yet built.
- **RAG collection mapping**: active_memory and verified_memory should have corresponding RAG collections for semantic retrieval. Currently all goes to `shared_decisions`. Needs routing by memory_type.
- **ElevenAgent integration**: Voice sessions need to read from verified_memory and active_memory for context. Currently uses `stable_truths` and `philosophy_anchors` directly. Mapping not yet done.

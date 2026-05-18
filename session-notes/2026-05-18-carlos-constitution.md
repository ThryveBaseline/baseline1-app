# Session Notes — Carlos Constitution v1.0

**Date:** 2026-05-18  
**Section:** 1 of multi-section build day  
**Repo:** baseline1-app

---

## What Was Built

### Carlos Constitution (`carlos-constitution.md`)
Full governance document for the Carlos AI system. Sections:
- CORE IDENTITY — Carlos amplifies Chris, never replaces. Not final decision-maker.
- MEMORY RULES — Separate types, verification states, no automatic permanent changes, recursive contamination prevention
- AUTONOMOUS ACTION LIMITS — Drafting/suggesting autonomous; posting/deleting/ordering requires human approval
- ANTI YES-MACHINE RULES — Devil's advocate mode (min 0.75 relevance score), honest disagreement required
- TRUTH VERIFICATION — AI-inferred facts labeled until human-confirmed, conflicts surface to Chris
- PRIVACY AND SECURITY — Data separation by domain (personal/Thryve/Ellington Estates), nothing crosses boundaries
- PERMISSION HIERARCHY — Core philosophy and routing architecture Chris-only
- COMPLEXITY GUARDRAILS — Every subsystem needs manual override, disable toggle, rollback
- HUMAN RELATIONSHIP PROTECTION — Supports family relationships, never replaces them
- HUMANITY PRESERVATION — Not all inefficiency is bad. Goal: remove destructive friction, not mechanize existence
- SYSTEM HEALTH CHECKS — Weekly/monthly/quarterly/annual cadence
- OFF SWITCH REQUIREMENT — Every subsystem: manual override, disable, rollback, audit log, human escalation

### Supabase Migration (`supabase/migrations/20260518_carlos_constitution.sql`)
Two tables applied via Management API:
- `carlos_constitution` — stores active constitution with content_hash, is_active (unique partial index enforces single active record)
- `carlos_constitution_version` — logs every session load: version, hash, result (ok/missing/corrupted/fallback)

Constitution v1.0 seeded as active record.

### RAG Ingestion
Constitution ingested to `carlos_governance` collection: 7 chunks, doc_id `c45dea3f68be0b974ad024ac3fbaf78d`

### Enforcement in `carlos-router.js`
- Module-level cache: `_constitutionCache` + `_constitutionCacheTime` with 1-hour TTL
- `loadConstitution(sessionId)` — fetches active record, logs to `carlos_constitution_version`, caches result
- Called at start of every `routeMessage()` call
- If missing/inactive: throws `{ constitutionMissing: true }` error → handler returns HTTP 503
- Constitution content prepended to every context block passed to all 11 specialist route functions
- Rating path in handler bypasses constitution check (non-message path)

---

## Architecture Decisions

**Enforcement at runtime, not startup** — Netlify functions are stateless; no "startup" to hook. Check runs per-request with TTL cache. Cache means ~1 DB call per hour per warm instance, not per message.

**503 not 500** — Constitution missing is a governance/infrastructure failure, not an application error. 503 signals "service temporarily unavailable" to the frontend, which should surface a clear message rather than a generic error.

**Full content injection, not just metadata** — The constitution is ~2000 tokens but governs every response. Prepending it to the context block (not just the system prompt constant) means it travels with the retrieved context into every specialist route, maintaining priority even when other context is long.

**Hash stored but not verified on load** — The content_hash is recorded for audit trail purposes. Active tamper detection (comparing hash at load time) is left for a future iteration when a canonical hash source exists outside the DB.

---

## Open Items
- Content hash tamper detection: compare loaded content_hash against a canonical value (hardcoded in code or env var) to catch DB-level tampering
- ElevenAgent (voice mode) does not yet load constitution — needs `carlos-session-token.js` to inject constitution into dynamic variables at session start
- Quarterly constitution review process not yet automated (manually scheduled for ~August 2026)

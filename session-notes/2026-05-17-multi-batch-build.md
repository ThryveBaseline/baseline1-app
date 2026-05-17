# Session Notes: 2026-05-17 — Multi-Batch Build (Batches 2–9)

## What Was Built

All remaining batches from the parallel build request. Continued from the UI batch session (2026-05-17-baseline-ui-batch.md).

---

### BATCH 2: Gmail Inbox Monitor

**File:** `thryve-baseline-windmill/windmill/scripts/gmail_inbox_monitor.ts`
**Schedule:** Every 15 minutes (`0 */15 * * * *`)

Classifies unread Gmail messages into 9 categories by subject-line pattern:
- `shopify_order`, `customer_complaint`, `wholesale_inquiry`, `press_media`
- `influencer_collab`, `supplement_review`, `compliance_legal`, `vendor_supplier`, `general_inquiry`

Routing: `compliance_legal` and `customer_complaint` → Notion AI Updates DB (Impact=High, Alert Status=Alert Sent).
All categories → Supabase `agent_outputs`. Marks processed emails as read.
Resource types: `GmailResource`, `SupabaseResource`, `NotionResource`.

---

### BATCH 3: Perplexity Intelligence Monitoring (5 scripts)

All in `thryve-baseline-windmill/windmill/scripts/`. Write to Notion AI Updates DB + Supabase agent_outputs.

| Script | Schedule | Topic |
|---|---|---|
| `competitive_monitor.ts` | Daily 7am ET | LMNT/LiquidIV/AG1 moves |
| `supplement_research.ts` | Mon 6am ET | Electrolyte/taurine studies |
| `estates_market_monitor.ts` | Fri 7am ET | Luxury/STR market trends |
| `ai_stack_monitor.ts` | Mon 8am ET | Claude/ElevenLabs/Supabase/Windmill updates |
| `content_ideas_generator.ts` | Sun 9am ET | Weekly Thryve content brief |

All use Windmill resource injection (not env vars). Model: `sonar`. `dryRun: boolean = false` parameter.

---

### BATCH 4: Claude Skills (completed in previous compaction window)

- `~/.claude/skills/thryve-brand-voice/SKILL.md` — complete Thryve brand voice, compliance, product specs
- `~/.claude/skills/baseline-health-protocol/SKILL.md` — Carlos principles, health schema, brief format

---

### BATCH 5: Replenish Coming Soon Page

**File:** `thryve-baseline-agent-systems/session-notes/replenish-page-content.md`

Standalone HTML page body for Shopify /pages/replenish. Recovery-focused electrolyte positioning:
- Two recovery windows: post-workout + overnight sleep
- 200mg magnesium glycinate + GABA mechanism
- HRV/Whoop angle
- GLP-1 protocol compatibility
- "Notify me" email capture CTA
- FDA disclaimer
- Zero em dashes

**To deploy:** Copy HTML content into Shopify Admin → Pages → Create page, handle = "replenish".

---

### BATCH 6: Shopify-Klaviyo Audit (completed in previous session)

Grep confirmed: zero custom Klaviyo/webhook code in any repo. All three repos clean.
Recommendation: use native Shopify Flow + Klaviyo connector, no custom code needed.

---

### BATCH 7: Today Screen — Notion Data, Tap-to-Detail, Mark Done

**Files changed:**
- `baseline1-app/netlify/functions/today-data.js` — Notion primary source
- `baseline1-app/netlify/functions/today-mark-done.js` — NEW: archives Notion pages
- `baseline1-app/index.html` — detail modal, mark-done

**today-data.js changes:**
- Queries Notion first for each section (Social Response Queue, Reddit Opps, AI Updates, Label Compliance)
- Falls back to Supabase `agent_outputs` if Notion env vars not set
- Returns `notionPageId` on every item (null for Supabase-sourced items)
- AI Updates split by `Name.startsWith('FAILURE:')` → failures vs intel sections

**today-mark-done.js:**
- POST `{ pageId }` → PATCH Notion `/pages/{id}` with `{ archived: true }`
- Graceful no-op if `NOTION_API_KEY` not set

**index.html changes:**
- `_todayItems[]` global array stores items for onclick lookup
- Items rendered with `data-today-idx` + `onclick="todayOpenDetail(idx)"`
- Bottom-sheet detail modal: title, meta, full detail text, URL link, Mark done button
- `todayMarkDone()` → POST to today-mark-done → removes item from DOM, updates counts

**Netlify env vars to add:** `NOTION_API_KEY`, `NOTION_SOCIAL_RESPONSE_QUEUE_DB_ID`, `NOTION_REDDIT_OPPS_DB_ID`, `NOTION_AI_UPDATES_DB_ID`, `NOTION_LABEL_COMPLIANCE_DB_ID`

---

### Approval Dashboard

**Files:**
- `thryve-baseline-agent-systems/approval-dashboard/index.html` — standalone dashboard
- `thryve-baseline-windmill/windmill/scripts/notion_to_shopify_publisher.ts` — publisher script

**Dashboard:** Vanilla JS, dark theme matching baseline1-app. Four tabs: Social Comments, Reddit Opportunities, Label Reviews, AI Intelligence. Connects to Notion via `?key=NOTION_KEY` URL param. Approve/dismiss updates Notion properties. Includes:
- Taurine lock notice on Label Reviews tab (Hydra Max V1, 500mg locked)
- Bloat live-page verification reminder

**Publisher script:** Queries Notion Social Content Queue for `Status=Approved` + `Platform=Shopify Blog|Product Description`. Publishes to Shopify Admin API (articles for blog, product update for descriptions). Marks Notion page `Published` on success. `dryRun: true` default.

---

### BATCH 8: ElevenAgents Architecture Plan

**File:** `baseline1-app/session-notes/elevenlabs-conversational-ai-migration-plan.md`

Architecture decision doc comparing:
- Option A: full replacement of carlos-chat.js + elevenlabs-tts.js with ElevenLabs Conversational AI
- Option B: parallel deployment with feature flag (recommended)

Key risks: persona fidelity without Carlos system prompt, memory injection complexity, LLM lock-in (ElevenLabs uses their own model), cost comparison unclear.

Recommendation: Option B first — validate persona/latency in parallel before cutting over.

---

## Architecture Decisions

### Notion as primary Today screen source
Windmill agents write to Notion. Supabase `agent_outputs` was the original placeholder. Notion is authoritative for approval-queue items. Supabase fallback ensures Today screen works even before Notion env vars are configured.

### Approval dashboard as static HTML
No backend server needed — dashboard talks directly to Notion API from the browser. Notion key passed as URL query param (not committed). Suitable for private internal use.

### Publisher script default dryRun: true
Shopify writes are irreversible. Every operator MUST explicitly pass `dryRun: false` to publish. This matches the approval_policy.json no-auto-publish rule.

### Perplexity scripts use Windmill resource injection
Not `process.env` — uses Windmill-injected resource objects. Consistent with other Windmill scripts in the repo. Perplexity API key stored as Windmill variable `g/all/perplexity_api_key`.

## Open Items

- Shopify page for Replenish: copy `replenish-page-content.md` HTML into Shopify Admin manually
- Netlify env vars: add NOTION_* vars in Netlify dashboard for Today screen to use live Notion data
- Gmail OAuth: `GmailResource.accessToken` must be a Gmail OAuth token — set up in Windmill resources
- Approval dashboard URL: serve from a subdomain or Netlify page; add Notion key to URL when accessing
- Perplexity API key: add to Windmill as variable `g/all/perplexity_api_key`
- ElevenLabs Conversational AI migration: no action until open questions in the plan doc are answered

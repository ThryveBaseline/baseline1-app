# Session Notes: 2026-05-17 — Baseline UI Batch (10 items)

## What Was Built

All 10 UI/UX changes applied to baseline1-app and deployed to Netlify (commit `c8d648f`).

### 1. Carlos Brief Text Rewrite
- **Old format**: JSON with `reality`, `truth`, `wins`, `use_what_works`, `grocery_list`
- **New format**: JSON with `zone_sentence`, `sleep_note`, `carlos_line`, `wins`
- `zone_sentence`: names the zone and what it means — no raw numbers that are already on the dashboard
- `sleep_note`: one honest sentence on sleep quality and implication (null if no data)
- `carlos_line`: one direct specific line from Carlos — an observation, not a platitude
- Wins remain: 3 specific timed targets
- renderBrief() and renderBriefFromHistory() updated with backward compat (falls back to old `reality`/`truth` fields)
- saveBriefToHistory() updated to save both new fields and legacy aliases

### 2. Font + Color Refresh
- Fraunces → Syne (all ~30+ usages via replace_all)
- `--yellow: #d4f000` → `#e8a430` (warm amber)
- All `rgba(212,240,0,...)` → `rgba(232,164,48,...)` (replace_all)
- Apple touch icon color updated to match
- Google Fonts import updated (Syne:wght@400;500;600;700;800)

### 3. Image Inputs — Camera/Upload Choice
- Removed `capture="environment"` from `#foodImg` input
- No JS changes needed — browser shows native camera/library picker when capture is absent

### 4. Morning Catch-Up — Retrospective Rewrite
- `cup-lbl`: "Missed last night" → "Yesterday"
- `cup-text`: "No check-in from last night. Want to fill it in quickly?" → "No check-in logged. How did yesterday go?"

### 5. B2 Food — Remove Manual Form, Rename Describe
- Removed `openFood('manual')` button from food methods grid
- Removed `manualSection` HTML block (name + amount + caffeine fields)
- Renamed `openFood('describe')` button to "Manual Entry" with "Describe what you ate, AI logs it"
- Removed `method === 'manual'` branches from `openFood()`, `foodAction()`, `closeFoodPanel()`
- Barcode fallback changed from `openFood('manual')` to `openFood('describe')`
- Dead functions (autoEstimateCaff, toggleCaffOverride, estimateCaffeine) left in place — no errors, no churn

### 6. B6 Carlos — Honest Gap Acknowledgment
- Updated `general_chat` intent guidance in carlos-chat.js:
  - "If yesterday had no check-in, acknowledge that gap honestly without assuming what happened"
  - "Never state yesterday's state as fact if you don't have the data"

### 7. Carlos Data in Conversation
- Updated `general_chat` intent guidance:
  - "Let the data inform your tone and framing — do NOT recite raw metrics unless the user specifically asks for numbers"

### 8. Carlos Foundation Profile — RAG Ingest
- Ingested `carlos-foundation-v1.md` to RAG collection `baseline_persona`
- 9 chunks ingested, doc_id `644040a878ab0899a9ab76bec75216ee`
- fetchPersonaFull() in carlos-chat.js already queries this collection — no code changes needed

### 9. Today Screen
- New screen `s-today` added to HTML before bottom nav
- 5 sections: Social Comments, Reddit Opportunities, AI Intelligence, Automation Failures, Label Reviews
- All sections conditionally shown/hidden based on data
- New `today-data.js` Netlify function: fetches `agent_outputs` table by output_type, plus `label_reviews` table
- New `refreshToday()` JS function calls `/.netlify/functions/today-data`
- Nav bottom: replaced Analyze tab with Today tab (Analyze still accessible via Home quick actions)
- CSS classes: `.today-section`, `.today-sec-lbl`, `.today-item`, `.today-item-urgent`, `.today-item-warn`

### 10. Morning Brief — Memory Tables
- Created `netlify/functions/morning-brief.js`:
  - Fetches `stable_truths`, `active_context`, `philosophy_anchors` from Supabase
  - 1-week module-level cache (memory changes weekly)
  - Injects as context block into Claude system prompt
  - Acts as a transparent proxy for `/api/claude` requests from generateBrief()
- Updated generateBrief() to call `/api/morning-brief` instead of `/api/claude`
- New function route handled by existing wildcard `[[redirects]]` in netlify.toml

## Architecture Decisions

### Brief JSON schema change
Old fields removed from output: `use_what_works`, `grocery_list`. New fields added: `zone_sentence`, `sleep_note`, `carlos_line`. Legacy fields `reality` and `truth` kept as aliases in saveBriefToHistory for backward compat with old saved briefs.

### Why Syne over Fraunces
Fraunces is a transitional serif — elegant but cold. Syne is a geometric sans — modern, slightly quirky, warm when paired with a warm amber accent. Stays out of the way for UI text.

### Why amber #e8a430
`#d4f000` neon yellow reads as clinical/tech. Warm amber reads as grounded and human. Still visible on dark backgrounds. Distinct from the green health accent (`--green-bright: #6db87f`).

### Today screen tab replaced Analyze
Bottom nav had 5 tabs but Analyze is rarely a primary daily action. Moved Analyze to the Home quick actions grid (already existed). Today screen is the high-priority daily action surface.

### today-data.js design
Fetches by `output_type` field on `agent_outputs` table. Types expected: `social_comment`, `reddit_opportunity`, `intelligence_flag`, `automation_failure`. Label reviews from `label_reviews` table with `status=pending`. If tables don't exist or return 0 rows, sections are hidden — no errors.

## Open Items
- `agent_outputs` table needs correct `output_type` values populated by automation agents for Today screen to show real data
- `label_reviews` table may not exist yet — today-data.js handles gracefully (returns empty array)
- Whoop nav integration removed — was in old Analyze slot, now accessible from Home → Profile

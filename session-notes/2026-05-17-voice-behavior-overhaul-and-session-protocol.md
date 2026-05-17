# Session Notes — 2026-05-17 — Voice Behavior Overhaul + Session Protocol

## What Was Built

### 1. ElevenLabs Voice — End-to-End Fix
- Diagnosed `ELEVENLABS_API_KEY` not being saved to Netlify (silent failure with `envVarIsSecret: true`)
- Re-set with `envVarIsSecret: false`, `newVarScopes: ["all"]` — key now confirmed present
- Triggered redeployment; confirmed function returns HTTP 200 with valid base64 MP3 audio

### 2. Voice Behavior Overhaul (Carlos Chat)
**Rule: input method determines response method.**
- Text input → text response only. No automatic audio.
- Voice input → voice response.
- Conversation mode → continuous voice loop.

**Two voice modes split from the old `conversationMode` boolean:**
- **Single shot** (`carlosSingleShotMic`): tap mic → listen → auto-send → Carlos responds in audio → stops. Tapping mic while listening cancels.
- **Conversation mode** (`carlosToggleConversation`): separate chat-bubble button, green when active, continuous loop until toggled off.

**CARLOS state change:** `conversationMode: false` → `voiceMode: null | 'single' | 'conversation'`

**`carlosSendRaw` signature:** Added `fromVoice = false` parameter. Audio only plays if `fromVoice === true`. Removed `spokenPreview` background auto-play entirely.

**`carlosStartMic` rec.onend:** Calls `carlosSend(true)` (fromVoice=true) when mic produces a transcript. All voice sends auto-submit.

### 3. Morning Brief Audio Options
- **"Read to me" button**: always visible when brief content is shown. One tap plays the brief aloud regardless of settings.
- **Brief delivery preference** in Profile → Carlos Voice:
  - Text only (default) — no audio
  - Audio on demand — "Read to me" button available
  - Auto audio — plays automatically when brief opens
- Tapping "Read to me" from text-only setting auto-upgrades preference to "on demand" and persists it.
- Auto audio: `unlockAudio()` called during the "Get Today's Brief" user gesture so async playback works after fetch completes.
- Silent mode: OS handles it natively — no JS detection needed.

### 4. Session Notes Protocol — All Five Repos
Added to CLAUDE.md in all five repos:
- `baseline1-app`
- `rag-command-center` (also created CLAUDE.md from scratch, merged with existing remote version)
- `thryve-automation-worker`
- `thryve-baseline-windmill` (branch is `master` not `main`)
- `thryve-baseline-agent-systems` (branch is `master` not `main`)

Created `session-notes/` directory with `.gitkeep` in all five repos.

**Protocol added:**
- End of every session: write session notes, commit, ingest to RAG `shared_decisions`
- Before significant builds: search RAG, check existing tools, Perplexity audit, architecture doc first

## Decisions Made

- **`fromVoice` parameter pattern** over `CARLOS.lastInputWasVoice` flag — cleaner, avoids shared mutable state race conditions in async flow
- **`capturedVoiceMode`** captured at top of `carlosSendRaw` before any awaits — prevents mode changes mid-flight from affecting which finally block runs
- **Removed preview gate from text mode entirely** — was causing confusion (spokenPreview always set → audio always fired)
- **AudioContext unlock during generateBrief gesture** rather than at playback time — required because browsers won't allow AudioContext resume after async latency
- **No JS silent mode detection** — OS/browser handles it natively; over-engineering would require test audio buffers

## Decisions Rejected

- **`CARLOS.lastInputWasVoice` flag** approach — rejected because it's shared mutable state that could be overwritten between the mic onend callback and the send handler
- **Separate "Audio" tab in profile** for brief settings — rejected in favor of adding to existing Carlos Voice section (less navigation complexity)
- **speechSynthesis fallback** — removed entirely in a prior session; not restored here (known Chrome deadlock bug with `onend` never firing)

## Architecture Choices

- Voice mode state machine: `null → 'single' → null` for single shot; `null → 'conversation' → null` for loops
- Single shot terminates in `carlosSendRaw`'s `finally` block: `if (capturedVoiceMode === 'single') CARLOS.voiceMode = null`
- Conversation loops from `finally`: `if (capturedVoiceMode === 'conversation') carlosStartMic()`
- Brief read aloud reads reality + truth + win items as one concatenated string via DOM queries

## Open Items

- **`business_weekly_snapshots` table is empty** — `business_query` intent returns no data until seeded with real Thryve weekly numbers
- **Whoop developer credentials** — user needs to create app at developer.whoop.com and add WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET
- **Render upgrade** — rag-command-center + thryve-automation-worker to Starter ($7/mo each); blocked on payment method at dashboard.render.com/billing
- **thryve-baseline-windmill and thryve-baseline-agent-systems use `master` branch** — not `main`; note this in future push commands

## Files Changed

- `C:\Users\Chris\baseline1-app\index.html` — voice behavior, morning brief UI
- `C:\Users\Chris\baseline1-app\CLAUDE.md` — session protocol added
- `C:\Users\Chris\rag-command-center\CLAUDE.md` — created + merged with existing remote
- `C:\Users\Chris\thryve-automation-worker\CLAUDE.md` — session protocol added
- `C:\Users\Chris\thryve-baseline-windmill\CLAUDE.md` — session protocol added
- `C:\Users\Chris\thryve-baseline-agent-systems\CLAUDE.md` — session protocol added
- `session-notes/.gitkeep` — created in all five repos

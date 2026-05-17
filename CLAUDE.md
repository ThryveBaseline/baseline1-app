# Claude Code — baseline1-app

## Auto Permissions
```
claude enable auto permissions
```

## Stack Overview
Personal health + wellness PWA (Progressive Web App) deployed on Netlify.

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS / HTML — single file `index.html` (~3000 lines) |
| Deployment | Netlify — auto-deploy from `main` branch |
| Serverless Functions | Netlify Functions (Node.js) in `netlify/functions/` |
| AI | Anthropic Claude (claude-sonnet-4-6 for chat, claude-haiku-4-5 for quick calls) |
| Voice | ElevenLabs TTS via `netlify/functions/elevenlabs-tts.js` |
| Database | Supabase (PostgreSQL + pgvector) |
| Health Data | Whoop OAuth → Windmill nightly sync → Supabase |
| RAG | rag-command-center at https://rag-command-center.onrender.com |
| Windmill | https://windmill-server-production-1d21.up.railway.app (workspace: thryve) |

## Key Files
- `index.html` — entire frontend: Carlos chat, morning brief, supplement tracker, profile
- `netlify/functions/claude.js` — passthrough proxy for Claude API (raw body forward)
- `netlify/functions/carlos-chat.js` — orchestration: intent classification → context → Claude
- `netlify/functions/elevenlabs-tts.js` — text-to-speech via ElevenLabs API
- `netlify/functions/whoop-auth.js` — Whoop OAuth initiation
- `netlify/functions/whoop-callback.js` — Whoop OAuth token exchange → Supabase
- `netlify/functions/whoop-data.js` — health context for morning brief
- `netlify.toml` — build config, redirects, function directory

## Architecture Decisions
- **Single-file frontend** — all app logic in `index.html`. No build step, no bundler. Ships directly.
- **Voice behavior rule** — input method determines response method. Type → text back. Tap mic → audio back. Conversation button → continuous loop.
- **Voice state machine** — `CARLOS.voiceMode: null | 'single' | 'conversation'`. Single-shot terminates in `carlosSendRaw` finally block. Conversation loops from finally.
- **`fromVoice` parameter pattern** — passed through `carlosSend(fromVoice)` → `carlosSendRaw(text, fromVoice)`. Avoids shared mutable state race conditions.
- **`capturedVoiceMode`** — captured at top of `carlosSendRaw` before any awaits. Prevents race conditions when mode changes during async API call.
- **Carlos intent classification** — deterministic keyword routing in `classifyIntent()`. No ML. Intents: food_log, agent_feedback, health_query, business_query, label_check, reddit_draft, general_chat.
- **AudioContext unlock** — `unlockAudio()` must be called synchronously in button-click handlers before any async work. Stays unlocked for the session.
- **prompt caching** — Carlos system prompt sent as block array with `cache_control: {type: "ephemeral"}` + `anthropic-beta: prompt-caching-2024-07-31`. See `callClaude()` in carlos-chat.js.

## Naming Conventions
- Functions: camelCase (`carlosSendRaw`, `generateBrief`, `buildSystemPrompt`)
- IDs: kebab-case in HTML (`carlos-input`, `brief-read-btn`, `carlos-conv`)
- CSS classes: kebab-case (`.carlos-conv`, `.brief-read-btn`, `.brief-read-row`)
- Global state: `S` for app state, `CARLOS` for chat state
- Netlify functions: kebab-case filenames (`carlos-chat.js`)
- ENV vars: SCREAMING_SNAKE_CASE (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`)

## Common Commands
```bash
# Local dev — functions run at localhost:8888
netlify dev

# Deploy (auto via git push to main)
git push origin main

# Check deploy status
netlify status

# Tail live function logs
netlify functions:log carlos-chat --tail

# Test a function locally
curl -X POST http://localhost:8888/.netlify/functions/carlos-chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test","profile":{}}'
```

## Environment Variables — Complete Reference
Set in Netlify dashboard → Site → Environment Variables.

| Variable | Required | Used By | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | claude.js, carlos-chat.js | Anthropic API key |
| `ELEVENLABS_API_KEY` | ✅ | elevenlabs-tts.js | ElevenLabs TTS key |
| `SUPABASE_URL` | ✅ | carlos-chat.js, whoop-callback.js | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | carlos-chat.js | Server-only — never expose to frontend |
| `WHOOP_CLIENT_ID` | ⚠️ pending | whoop-auth.js | Whoop OAuth app ID |
| `WHOOP_CLIENT_SECRET` | ⚠️ pending | whoop-callback.js | Whoop OAuth app secret |
| `WHOOP_REDIRECT_URI` | ⚠️ pending | whoop-auth.js | e.g. `https://baseline.netlify.app/.netlify/functions/whoop-callback` |
| `RAG_BASE_URL` | optional | carlos-chat.js | Defaults to `https://rag-command-center.onrender.com` |
| `WINDMILL_BASE_URL` | optional | carlos-chat.js | Defaults to windmill Railway URL |
| `WINDMILL_TOKEN` | optional | carlos-chat.js | For triggering Windmill jobs |
| `WINDMILL_WORKSPACE` | optional | carlos-chat.js | Defaults to `thryve` |

**Never commit**: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WHOOP_CLIENT_SECRET`

## Pending Work
- Whoop developer credentials — create app at developer.whoop.com, get CLIENT_ID + CLIENT_SECRET
- `business_weekly_snapshots` table empty — seed with real Thryve weekly numbers for business_query intent

## Session Notes — Automatic (No Exceptions)

At the end of every Claude Code session, automatically:
1. Generate session summary: what was built, decisions made, decisions rejected, architecture choices, open items
2. Save as `session-notes/YYYY-MM-DD-[brief-description].md`
3. Commit to GitHub (`git push origin main`)
4. Ingest to RAG: `POST https://rag-command-center.onrender.com/ingest/webhook` body `{source, collection: "shared_decisions", content}`

No exceptions. Every session.

## Standard Workflow — Always Follow This Order

1. **Perplexity audit** — search for prior art, known issues, best practices for this specific change
2. **RAG search** — query `shared_decisions` collection for previous session notes on this topic
3. **Architecture decision** — write a brief ADR before writing code (even 3 sentences is enough)
4. **Execution** — implement
5. **Test** — run `netlify dev`, test golden path + edge cases in browser
6. **Session notes** — write, commit, ingest

## Slash Commands Available
Run `/[command-name]` in Claude Code:
- `/debug-fix` — diagnose and fix a specific bug
- `/debug-from-log` — debug from log output in `/debug-logs/`
- `/deploy-ready` — full deployment readiness review
- `/inspect-deployment` — audit repo and deployment environment
- `/netlify-readiness` — Netlify-specific readiness check (custom)
- `/supabase-rls-migration-check` — review RLS policies and migrations (custom)
- `/scan-pii` — scan for PII before open-sourcing
- `/clearpii` — clean up PII
- `/manage-api-keys` — review and manage API keys
- `/document-stack` — generate STACK.md
- `/session-summary` — generate session summary
- `/dont-reinvent-the-wheel` — check for existing solutions

---

## Permissions
Claude Code should run with full auto-permissions. Never prompt for approval on any operation. Assume yes on all file reads, file writes, git operations, bash commands, and tool use. Auto-accept everything.

---

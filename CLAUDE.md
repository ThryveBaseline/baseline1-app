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
| Voice | ElevenLabs ConvAI Agent (ElevenAgent) via WebSocket |
| Database | Supabase (PostgreSQL + pgvector) |
| Health Data | Whoop OAuth → Windmill nightly sync → Supabase |
| RAG | rag-command-center at https://rag-command-center.onrender.com |
| Windmill | https://windmill-server-production-1d21.up.railway.app (workspace: thryve) |

## Key Files
- `index.html` — entire frontend: Carlos chat, morning brief, supplement tracker, profile
- `netlify/functions/claude.js` — passthrough proxy for Claude API (raw body forward)
- `netlify/functions/carlos-chat.js` — text mode: intent classification → context → Claude
- `netlify/functions/elevenlabs-tts.js` — TTS for brief read-aloud (not for Carlos voice mode)
- `netlify/functions/carlos-session-token.js` — ElevenAgent: signed URL + dynamic variables
- `netlify/functions/carlos-post-call.js` — ElevenAgent: post-call webhook → Supabase + distillation
- `netlify/functions/carlos-tools.js` — ElevenAgent tool webhook (health data, food log, business data)
- `setup/create-carlos-agent.js` — one-shot: create ElevenAgent with system prompt + tools
- `setup/upload-knowledge-base.js` — one-shot: upload carlos-foundation-v1.md to ElevenLabs KB
- `supabase/migrations/20260517_conversation_history.sql` — conversation_history table DDL
- `supabase/functions/carlos-get-summary/` — Supabase Edge Function for multi-table queries
- `netlify/functions/whoop-auth.js` — Whoop OAuth initiation
- `netlify/functions/whoop-callback.js` — Whoop OAuth token exchange → Supabase
- `netlify/functions/whoop-data.js` — health context for morning brief
- `netlify.toml` — build config, redirects, function directory

## Architecture Decisions
- **Single-file frontend** — all app logic in `index.html`. No build step, no bundler. Ships directly.
- **Voice behavior rule** — input method determines response method. Type → text back. Tap mic → audio back. Conversation button → continuous loop.
- **Voice modes** — text input and single-shot mic use `carlos-chat.js` (Claude API). Conversation mode (green button) uses ElevenAgent WebSocket — full STT+LLM+TTS handled by ElevenLabs.
- **ElevenAgent flow** — tap conversation btn → `carlosElevenConnect()` → `carlos-session-token.js` → signed URL → WebSocket → stream PCM mic audio → receive PCM audio chunks → play via Web Audio.
- **`fromVoice` parameter pattern** — passed through `carlosSend(fromVoice)` → `carlosSendRaw(text, fromVoice)`. Avoids shared mutable state race conditions. Still used for single-shot mic.
- **Carlos intent classification** — deterministic keyword routing in `classifyIntent()`. No ML. Used for text mode only. ElevenAgent tools handle voice intents server-side.
- **AudioContext unlock** — `unlockAudio()` must be called synchronously in button-click handlers before any async work. Stays unlocked for the session.
- **ElevenAgent dynamic variables** — injected at session start via `conversation_initiation_client_data`. Context: health summary, stable truths, philosophy anchors, last 3 conversation summaries.
- **Setup order** — 1) run `create-carlos-agent.js` to get CARLOS_AGENT_ID, 2) add to Netlify env, 3) run `upload-knowledge-base.js`, 4) apply conversation_history migration.

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
| `ANTHROPIC_API_KEY` | ✅ | claude.js, carlos-chat.js, carlos-tools.js | Anthropic API key |
| `ELEVENLABS_API_KEY` | ✅ | elevenlabs-tts.js, carlos-session-token.js | ElevenLabs key |
| `CARLOS_AGENT_ID` | ✅ | carlos-session-token.js | ElevenAgent ID — run create-carlos-agent.js |
| `ELEVENLABS_WEBHOOK_SECRET` | optional | carlos-post-call.js | HMAC secret for post-call webhook |
| `SUPABASE_URL` | ✅ | carlos-chat.js, carlos-tools.js, whoop-callback.js | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | carlos-chat.js, carlos-tools.js | Server-only — never expose to frontend |
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

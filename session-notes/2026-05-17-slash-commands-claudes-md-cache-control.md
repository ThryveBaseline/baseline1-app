# Session Notes — 2026-05-17 — Slash Commands, CLAUDE.md Overhaul, Cache Control

## What Was Built

### 1. Slash Commands — baseline1-app
Installed 12 slash commands in `.claude/commands/`:

**From danielrosehill/Claude-Slash-Commands:**
- `scan-pii` — scan repo for PII before open-sourcing
- `clearpii` — clean up PII in folder
- `manage-api-keys` — review and manage API keys in env
- `inspect-deployment` — audit repo and deployment environment
- `deploy-ready` — full deployment readiness review
- `debug-fix` — diagnose, fix, and validate a specific bug
- `debug-from-log` — debug from `/debug-logs/` directory output
- `document-stack` — analyze and document technology stack
- `session-summary` — generate session progress report
- `dont-reinvent-the-wheel` — check for existing solutions before building

**Custom commands (written this session):**
- `netlify-readiness` — Netlify-specific readiness check: netlify.toml, env vars, functions CORS, redirects, deploy previews
- `supabase-rls-migration-check` — review migrations, RLS policies, service-role usage, column-level security

### 2. CLAUDE.md Rewrite — baseline1-app
Replaced the short placeholder with a comprehensive reference including:
- Full stack table (frontend, functions, AI, voice, DB, Windmill)
- Architecture decisions (voiceMode state machine, fromVoice pattern, capturedVoiceMode, AudioContext unlock)
- Naming conventions (camelCase functions, kebab-case IDs/CSS, SCREAMING_SNAKE_CASE env vars)
- Complete env var reference table with required/pending status for all 11 vars
- Slash command index
- Permissions block: full auto-permissions, never prompt for approval
- Standard workflow: Perplexity audit → RAG search → ADR → execute → test → session notes

### 3. Prompt Caching — carlos-chat.js
Added `cache_control: { type: "ephemeral" }` to the Carlos system prompt in `callClaude()`.

**Before:**
```javascript
body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 512, system: systemPrompt, messages })
```

**After:**
```javascript
const system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
// + header: 'anthropic-beta': 'prompt-caching-2024-07-31'
```

The Carlos system prompt is ~3KB of static rules. With caching enabled, the first call writes the cache and subsequent calls in the same conversation hit the cache — approximately 90% reduction in input token cost for multi-turn conversations.

## Decisions Made

- **Prompt caching in the function, not the proxy** — `carlos-chat.js` constructs the system prompt server-side, making it the right place to add cache_control. The `claude.js` proxy is a passthrough and would require frontend changes to inject caching.
- **`cache_control: ephemeral`** — the 5-minute TTL is appropriate for conversation-length caching. The Carlos system prompt doesn't change between turns.
- **Custom commands over existing** — `netlify-readiness` and `supabase-rls-migration-check` don't exist in the public command libraries. Written from scratch targeting this specific stack.

## Decisions Rejected

- **Pinning requirements.txt in rag-command-center** — attempted in the previous task; broke the Render build. Windows venv versions ≠ Linux build environment. Reverted.

## Open Items

- **Whoop developer credentials** — create app at developer.whoop.com, get CLIENT_ID + CLIENT_SECRET
- **`business_weekly_snapshots` table** — empty, needs seeding
- **Netlify AI Gateway** — enable in dashboard, then update `carlos-chat.js` base URL
- **Supabase Branching** — requires Pro plan upgrade first

## Files Changed

- `CLAUDE.md` — comprehensive rewrite
- `.claude/commands/` — 12 new slash command files
- `netlify/functions/carlos-chat.js` — prompt caching added to `callClaude()`

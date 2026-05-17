# Claude Code — baseline1-app

## Auto Permissions
This project runs with auto permissions. Enable at session start:
```
claude enable auto permissions
```

## Project
Baseline — personal health + wellness PWA deployed on Netlify.
Whoop OAuth integration, Claude morning brief, supplement stack tracker.
Stack: Vanilla JS/HTML · Netlify Functions · Supabase · Anthropic Claude.

## Deployment
- Netlify auto-deploys from `main` branch
- `netlify.toml` controls build and redirect rules
- Functions in `netlify/functions/` deploy automatically

## Key Files
- `index.html` — full single-file app (2900+ lines)
- `netlify/functions/claude.js` — proxies Claude API calls
- `netlify/functions/whoop-auth.js` — initiates Whoop OAuth flow
- `netlify/functions/whoop-callback.js` — OAuth token exchange → Supabase
- `netlify/functions/whoop-data.js` — serves health context to frontend

## Netlify Environment Variables Required
See `netlify/functions/.env.example` for the full list.
Critical for Whoop: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

## Whoop Integration Status
- OAuth flow: complete (whoop-auth → whoop-callback)
- Nightly sync: Windmill agent `f/health/whoop_nightly_sync_agent` runs 5:30am ET
- Supabase tables: `health_connections`, `daily_health_context`
- Morning brief: Whoop health_summary injected into Claude context automatically

## Pending
- Whoop developer credentials (from developer.whoop.com — user needs to create app)

## Session Notes — Automatic (No Exceptions)

At the end of every Claude Code session, automatically:
1. Generate a session summary including: what was built, decisions made, decisions rejected, architecture choices, open items, and what is still outstanding
2. Save as `session-notes/YYYY-MM-DD-[brief-description].md` in this repo
3. Commit to GitHub
4. Ingest into RAG at `https://rag-command-center.onrender.com/ingest/webhook` under collection `shared_decisions`

This happens without being asked. Every session. No exceptions.

## Pre-Build Protocol

Before starting any significant build:
1. Search RAG (`shared_decisions` collection + any relevant collection) for previous session notes on this topic
2. Check for existing skills, tools, or agents that already solve the problem
3. Run a Perplexity audit for significant builds (new integrations, infrastructure changes, multi-hour scope)
4. Write an architecture decision document before writing code
5. Only then start building
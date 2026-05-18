# Session Notes: Ellington Estates — Bea App Build
**Date:** 2026-05-18  
**Project:** Ellington Estates family PWA  
**Status:** Complete — live at ellington-estates-bea.netlify.app

---

## What Was Built

Full voice-first PWA called "Bea" for the Ellington Estates family apiary. Built from scratch in a single session.

### App identity
- **Name:** Bea (Beatrice) — institutional memory for Ellington Estates
- **Voice character:** British, warm, refined. Inspired by Dame Helen Mirren.
- **ElevenLabs voice:** Beatrice (`kkPJzQOWz2Oz9cUaEaQd`) — selected by Chris from 3 presented options

### Technical stack
- Vanilla HTML/CSS/JS — single `index.html`, zero build step
- Netlify functions (Node 18): `bea-chat.js`, `bea-tts.js`, `bea-observations.js`
- Claude Haiku (`claude-haiku-4-5-20251001`) for Bea's intelligence layer
- ElevenLabs TTS — returns base64 audio/mpeg to client
- Web Speech API (`webkitSpeechRecognition`, lang `en-GB`) for voice input
- Supabase: `family_context` schema, `observations` table
- RAG: `ellington_estates` collection at `rag-command-center.onrender.com`
- PWA: `manifest.json`, `sw.js` (network-first nav, cache-first assets)

### Screens
1. **Home** — greeting, gold voice button (press to open overlay), category tabs, recent feed
2. **Browse** — search + category tabs, expand/collapse entries
3. **Ask Bea** — chat UI with typing indicator, suggestion chips, voice input
4. **Settings** — name, email, digest prefs, meeting date, about Bea

### Intelligence (bea-chat.js)
- Intent classification: `voice_log` | `question` | `correction` | `general_chat`
- Parallel: recent observations from Supabase + RAG query for questions
- Suggested category detection from text patterns
- Warm, field-pace 80-word response limit

### Voice overlay flow
1. User presses gold mic button → overlay opens
2. `webkitSpeechRecognition` captures in en-GB
3. Transcript sent to `bea-chat` → Bea confirms what she heard, suggests category
4. User selects/adjusts category → confirms → stored in `family_context.observations`

---

## Deployment

- **GitHub:** ThryveBaseline/ellington-estates-family-app (branch: main)
- **Netlify site:** ellington-estates-bea (site ID: 1b8e0c6e-bc99-42eb-84fd-590fd25e0a26)
- **Live URL:** https://ellington-estates-bea.netlify.app
- **Deploy method:** `netlify deploy --dir . --prod` (no GitHub auto-deploy — Netlify GitHub app not installed)
- **Env vars:** ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, BEA_VOICE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RAG_BASE_URL

---

## Active / Pending

| Feature | Status |
|---|---|
| Home screen + voice overlay | Active |
| Browse + search | Active |
| Ask Bea chat | Active |
| ElevenLabs TTS on responses | Active |
| Settings + localStorage prefs | Active |
| Supabase observations write | Active |
| RAG query for questions | Active |
| PWA install + service worker | Active |
| PNG icons (192, 512) | Placeholder PNGs — replace with real design |
| Family auth / member identity | Not yet — all as 'family' |
| Weekly digest email | Not yet |
| Meeting agenda trigger | Not yet |
| GitHub auto-deploy | Not yet — needs Netlify GitHub app |

---

## Decisions

- Beatrice voice chosen from 3 options (Eleanor, Beatrice, Helena Watson) — Chris selected Beatrice
- No build step intentional — keeps deploy path simple for a family tool
- SUPABASE_SERVICE_ROLE_KEY server-side only — never exposed to client
- Family context schema deliberately excluded from RAG and Carlos business context

# Claude Code — baseline1-app

## Auto Permissions
This project runs with auto permissions. Enable at session start:
```
claude enable auto permissions
```

## Project
ThryveBaseline static frontend app deployed on Netlify.
Stack: HTML/JS · Netlify · Service Worker.

## Deployment
- Netlify auto-deploys from `main` branch
- `netlify.toml` controls build and redirect rules

## Key Files
- `index.html` — main app entry point
- `netlify.toml` — Netlify build configuration
- `sw` — service worker
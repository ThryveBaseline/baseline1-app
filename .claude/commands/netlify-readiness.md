Perform a complete Netlify deployment readiness check for this repository.

## Checks to run

### 1. netlify.toml
- Confirm file exists at repo root
- Verify `[build]` section: `publish` dir, `command`
- Check `[functions]` section: `directory` set to `netlify/functions`
- Verify `[[redirects]]` entries — especially the `/* → /index.html` SPA catch-all with status 200
- Check `[[headers]]` for security headers (CSP, X-Frame-Options, X-Content-Type-Options)
- Note any `[context.production]` or `[context.deploy-preview]` overrides

### 2. Environment variables
- Check `.env.example` exists and lists all required vars
- Cross-reference function code to identify any env vars used but not in `.env.example`
- Confirm none of these are committed to git: API keys, tokens, database credentials
- List all vars that must be set in Netlify dashboard before deploy

### 3. Functions
- List all files in `netlify/functions/`
- For each function, verify:
  - Exports a valid `handler` function
  - Handles OPTIONS (CORS preflight)
  - Handles wrong HTTP methods gracefully
  - Has no hardcoded secrets
  - Returns proper CORS headers

### 4. Build command
- Confirm build command in `netlify.toml` works (or that there is no build step needed)
- Check for missing `package.json` / `node_modules` issues if build is Node-based
- Verify publish directory exists and contains the right files

### 5. Deploy previews
- Check if `[context.deploy-preview]` has correct settings
- Confirm functions work in preview context (env vars scoped correctly)

### 6. Redirects
- Verify SPA redirect exists: `/* → /index.html 200`
- Check any API proxy redirects point to correct external URLs
- Ensure redirect rules don't conflict

### 7. Final checklist
Produce a pass/fail checklist:
```
[ ] netlify.toml present and valid
[ ] [build] section correct
[ ] [functions] directory correct
[ ] SPA redirect present
[ ] All env vars documented in .env.example
[ ] No secrets committed to git
[ ] All functions export handler
[ ] CORS headers present on all functions
[ ] No hardcoded URLs pointing to localhost
[ ] Deploy-preview context configured
```

Report any failures with the file and line where the issue was found.

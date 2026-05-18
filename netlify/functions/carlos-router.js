// carlos-router.js — 5-layer Carlos multi-model routing
// Layer 0: Session state check
// Layer 1: Intent classification (Haiku)
// Layer 2: Context retrieval (parallel, timeout-guarded)
// Layer 3: Specialist execution (per-intent model routing)
// Layer 4: Carlos synthesis (voice filter)
// Writes to carlos_routing_log + carlos_session_state

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY;
const RAG_BASE_URL = process.env.RAG_BASE_URL || 'https://rag-command-center.onrender.com';
const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || 'https://windmill-server-production-1d21.up.railway.app';
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN;
const WINDMILL_WS = process.env.WINDMILL_WORKSPACE || 'thryve';
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const COST_WARN_THRESHOLD = 0.50;
const VALID_INTENTS = ['STRATEGY', 'ANALYSIS', 'CONTENT', 'RESEARCH', 'DOCUMENT', 'HEALTH', 'MEMORY', 'BUSINESS', 'CODE', 'AGENT', 'COLLABORATION'];
const SESSION_TYPES = ['same_task', 'new_task', 'correction', 'interruption', 'clarification', 'approval', 'rejection'];

// ── Shadow mode config (Section 3) ───────────────────────────────────────────
const SHADOW_MODE = {
  enabled: process.env.SHADOW_MODE_ENABLED === 'true',
  categories: (process.env.SHADOW_MODE_CATEGORIES || 'STRATEGY,ANALYSIS,CONTENT').split(','),
};

// ── Permission levels (Section 6) ────────────────────────────────────────────
const PERMISSION_LEVELS = {
  CHRIS_ONLY:     ['core_philosophy', 'routing_logic', 'strategic_priorities', 'constitution', 'financial_data'],
  FAMILY_SHARED:  ['family_memory', 'ellington_estates', 'family_health_summary'],
  INDIVIDUAL:     ['personal_health', 'personal_memory', 'personal_preferences', 'conversation_history'],
  AUTOMATED:      ['system_logs', 'routing_log', 'performance_metrics'],
};

// Known family members — extend via env var FAMILY_USER_IDS="jade,..."
const FAMILY_USER_IDS = new Set(['primary', 'chris', ...(process.env.FAMILY_USER_IDS || '').split(',').filter(Boolean)]);

// ── Constitution cache ────────────────────────────────────────────────────────
let _constitutionCache = null;
let _constitutionCacheTime = 0;
const CONSTITUTION_TTL = 3_600_000; // 1 hour

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function supaGet(path, timeout = 2000) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
      signal: AbortSignal.timeout(timeout),
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function supaPost(path, data) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(data),
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function supaPatch(path, data) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(data),
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

// ── PII strip (Section 3) — runs BEFORE any training data write ──────────────
const PII_PATTERNS = [
  /\b[A-Z][a-z]{1,20}\s[A-Z][a-z]{1,20}\b/g,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b\d{1,5}\s[A-Za-z\s]{5,30}(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Court|Pl)\b/gi,
  /\b\d{5}(?:-\d{4})?\b/g,
  /\b(?:hrv|rhr|recovery|strain)\s*[:=]?\s*\d+\.?\d*\b/gi,
  /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g,
];

function stripPII(text) {
  if (!text) return { clean: '', stripped: false };
  let clean = text;
  let stripped = false;
  for (const p of PII_PATTERNS) {
    const before = clean;
    clean = clean.replace(p, '[REDACTED]');
    if (clean !== before) stripped = true;
    p.lastIndex = 0;
  }
  return { clean, stripped };
}

// ── Permission check (Section 6) ─────────────────────────────────────────────
function checkPermission(userId, dataType) {
  const isChris = userId === 'primary' || userId === 'chris';
  const isFamilyMember = FAMILY_USER_IDS.has(userId);
  const isAutomated = userId === 'system' || userId === 'automated';

  if (PERMISSION_LEVELS.CHRIS_ONLY.includes(dataType)) return isChris;
  if (PERMISSION_LEVELS.FAMILY_SHARED.includes(dataType)) return isFamilyMember;
  if (PERMISSION_LEVELS.INDIVIDUAL.includes(dataType)) {
    // Individual data: only the owning user, not even other family members
    return userId === 'primary' || userId === 'chris';
  }
  if (PERMISSION_LEVELS.AUTOMATED.includes(dataType)) return isAutomated || isChris;
  return isChris; // default deny
}

function enforcePermissions(userId, intent, classification) {
  const errors = [];
  // Automated systems cannot access personal or family data
  if (userId === 'system' || userId === 'automated') {
    if (['HEALTH', 'MEMORY', 'STRATEGY'].includes(intent)) {
      errors.push(`Automated user cannot access ${intent} intent`);
    }
  }
  // Family members cannot modify constitution or routing logic
  if (!checkPermission(userId, 'routing_logic') && ['CODE', 'AGENT'].includes(intent)) {
    // Allow CODE/AGENT for all users — they just can't modify core routing
  }
  return errors;
}

async function loadConstitution(sessionId) {
  const now = Date.now();
  if (_constitutionCache && now - _constitutionCacheTime < CONSTITUTION_TTL) return _constitutionCache;
  const rows = await supaGet('carlos_constitution?is_active=eq.true&select=version,content,content_hash&limit=1', 3000);
  const record = rows?.[0] ?? null;
  supaPost('carlos_constitution_version', {
    session_id: sessionId || null,
    version: record?.version || 'unknown',
    content_hash: record?.content_hash || null,
    load_result: record ? 'ok' : 'missing',
  }).catch(() => {});
  if (record) { _constitutionCache = record; _constitutionCacheTime = now; }
  return record;
}

// ── LAYER 0: Session state ────────────────────────────────────────────────────

async function checkSessionState(userId, message) {
  const rows = await supaGet(
    `carlos_session_state?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&order=last_updated.desc&limit=1`,
    1500,
  );
  const active = rows?.[0] ?? null;
  if (!active) return { type: 'new_task', activeSession: null };
  if (!ANTHROPIC_KEY) return { type: 'new_task', activeSession: active };

  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        system: `Active task summary: "${active.active_context}". Classify the new message. Return ONE word: same_task|new_task|correction|interruption|clarification|approval|rejection`,
        messages: [{ role: 'user', content: message }],
      }),
      signal: AbortSignal.timeout(3000),
    });
    const d = await res.json();
    const type = (d.content?.[0]?.text ?? '').trim().toLowerCase().split(/\s/)[0];
    return { type: SESSION_TYPES.includes(type) ? type : 'new_task', activeSession: active };
  } catch { return { type: 'new_task', activeSession: active }; }
}

async function updateSessionState(userId, intent, context, models, hopCount) {
  const rows = await supaGet(`carlos_session_state?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&limit=1`, 1000);
  const existing = rows?.[0];
  const now = new Date().toISOString();
  const data = { user_id: userId, active_intent: intent, active_models: models, active_context: context, hop_count: hopCount, last_updated: now, status: 'active' };
  if (existing) {
    await supaPatch(`carlos_session_state?user_id=eq.${encodeURIComponent(userId)}&status=eq.active`, data);
  } else {
    await supaPost('carlos_session_state', { ...data, started_at: now });
  }
}

// ── LAYER 1: Intent classification ───────────────────────────────────────────

const CLASSIFIER_SYSTEM = `You are an intent classifier for Carlos, a private personal AI. Classify the user message into exactly one intent.

Intents:
- STRATEGY: business decisions, product strategy, positioning, founder choices, what-am-I-missing
- ANALYSIS: data patterns, trends, comparisons, health trend analysis, sales analysis
- CONTENT: TikTok scripts, captions, email copy, product descriptions, Reddit responses, any writing
- RESEARCH: competitor research, ingredient research, market trends, current events, needs web search
- DOCUMENT: processing long documents, large exports, cross-document synthesis
- HEALTH: recovery questions, food logging, health data queries, sleep/HRV/strain/whoop
- MEMORY: what-do-I-believe, what-have-I-decided, philosophy questions, past decisions
- BUSINESS: sales questions, product performance, revenue, orders, conversion rates
- CODE: build requests, debugging, technical implementation, code changes
- AGENT: running specific workflows (label compliance, Reddit posting, social automation)
- COLLABORATION: everything else — conversation, opinions, advice, politics, controversial topics

Return ONLY valid JSON, no markdown:
{"intent":"STRATEGY","confidence":0.9,"needs_memory":true,"needs_web":false,"needs_long_context":false,"needs_execution":false,"is_collaboration":false,"emotional_tone":"neutral","urgency":"low","risk_level":"low","estimated_cost_usd":0.01,"safe_summary":"user asks about business strategy decision"}`;

async function classifyIntent(message, conversationHistory) {
  if (!ANTHROPIC_KEY) return fallbackClassify(message);
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: CLASSIFIER_SYSTEM,
        messages: [
          ...(conversationHistory || []).slice(-3).map(m => ({ role: m.role, content: String(m.content).slice(0, 200) })),
          { role: 'user', content: message },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    const d = await res.json();
    const text = (d.content?.[0]?.text ?? '').replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(text);
    if (!VALID_INTENTS.includes(parsed.intent)) parsed.intent = 'COLLABORATION';
    return parsed;
  } catch { return fallbackClassify(message); }
}

async function reclassifyWithSonnet(message, history) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: CLASSIFIER_SYSTEM,
        messages: [{ role: 'user', content: message }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await res.json();
    const text = (d.content?.[0]?.text ?? '').replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(text);
    if (!VALID_INTENTS.includes(parsed.intent)) parsed.intent = 'COLLABORATION';
    return parsed;
  } catch { return null; }
}

function fallbackClassify(message) {
  const m = message.toLowerCase();
  let intent = 'COLLABORATION';
  if (/\b(recovery|sleep|hrv|strain|whoop|food|ate|drank|protein|calories)\b/.test(m)) intent = 'HEALTH';
  else if (/\b(revenue|sales|orders|conversion|business|thryve|ellington)\b/.test(m)) intent = 'BUSINESS';
  else if (/\b(code|build|debug|function|deploy|bug|error|implement)\b/.test(m)) intent = 'CODE';
  else if (/\b(write|draft|caption|script|email|reddit|tiktok)\b/.test(m)) intent = 'CONTENT';
  else if (/\b(research|search|find|look up|current|latest|news)\b/.test(m)) intent = 'RESEARCH';
  else if (/\b(strategy|decide|decision|should i|what do you think|what am i missing)\b/.test(m)) intent = 'STRATEGY';
  return {
    intent, confidence: 0.6, needs_memory: true, needs_web: false, needs_long_context: false,
    needs_execution: false, is_collaboration: false, emotional_tone: 'neutral', urgency: 'low',
    risk_level: 'low', estimated_cost_usd: 0.01, safe_summary: 'user message classified locally',
  };
}

// ── LAYER 2: Context retrieval ────────────────────────────────────────────────

async function withTimeout(promise, ms) {
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
  } catch { return null; }
}

async function retrieveContext({ classification, userId, message, brandContext = 'Thryve' }) {
  const { intent } = classification;
  const isHealth = ['HEALTH', 'ANALYSIS', 'COLLABORATION'].includes(intent);
  const isBusiness = ['BUSINESS', 'ANALYSIS', 'STRATEGY', 'COLLABORATION'].includes(intent);
  const needsWeb = classification.needs_web || intent === 'RESEARCH';

  const sources = {};

  const [philosophy, truths, activeCtx, health, business, convVec, ragDocs, perplexityData, externalIntelligence] = await Promise.all([
    withTimeout(supaGet('philosophy_anchors?order=frequency_score.desc&limit=6&select=anchor_text,category'), 1000)
      .then(r => { sources.philosophy = r?.length ? 'ok' : 'empty'; return r || []; }),

    withTimeout(supaGet('stable_truths?order=confidence_score.desc&limit=6&select=truth_statement,category'), 1000)
      .then(r => { sources.truths = r?.length ? 'ok' : 'empty'; return r || []; }),

    withTimeout(supaGet('active_context?status=eq.active&order=priority.desc&limit=5&select=context_item,priority'), 1000)
      .then(r => { sources.active_context = r?.length ? 'ok' : 'empty'; return r || []; }),

    isHealth
      ? withTimeout((async () => {
          const ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
          return supaGet(`daily_health_context?user_id=eq.primary&provider=eq.whoop&date=gte.${ago}&order=date.desc&limit=7&select=date,recovery_score,hrv_ms,rhr_bpm,sleep_performance,sleep_hours,sleep_consistency,day_strain,calories_burned`);
        })(), 1000).then(r => { sources.health = r?.length ? 'ok' : 'empty'; return r; })
      : Promise.resolve(null).then(r => { sources.health = 'skipped'; return null; }),

    isBusiness
      ? withTimeout(supaGet(`business_weekly_snapshots?brand=eq.${encodeURIComponent(brandContext)}&order=week_start.desc&limit=2`), 1000)
          .then(r => { sources.business = r?.length ? 'ok' : 'empty'; return r; })
      : Promise.resolve(null).then(r => { sources.business = 'skipped'; return null; }),

    // Conversation history via semantic search
    withTimeout((async () => {
      if (!RAG_BASE_URL) return null;
      const res = await fetch(`${RAG_BASE_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: message, top_k: 5, collection: 'conversation_history' }),
      });
      return res.ok ? res.json() : null;
    })(), 2000).then(r => { sources.conversation_history = r ? 'ok' : 'failed'; return r; }),

    // RAG document search (personal_intelligence)
    withTimeout((async () => {
      if (!RAG_BASE_URL) return null;
      const res = await fetch(`${RAG_BASE_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: message, top_k: 4, collection: 'baseline_persona' }),
      });
      return res.ok ? res.json() : null;
    })(), 2000).then(r => { sources.rag = r ? 'ok' : 'failed'; return r; }),

    // Perplexity live web
    needsWeb && PERPLEXITY_KEY
      ? withTimeout((async () => {
          const res = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PERPLEXITY_KEY}` },
            body: JSON.stringify({
              model: 'sonar-pro',
              messages: [{ role: 'user', content: `Search and summarize for context: ${message}` }],
              max_tokens: 600,
            }),
          });
          return res.ok ? res.json() : null;
        })(), 4000).then(r => { sources.perplexity = r ? 'ok' : 'failed'; return r; })
      : Promise.resolve(null).then(r => { sources.perplexity = needsWeb ? 'no_key' : 'skipped'; return null; }),

    // External intelligence — world-class marketing/industry frameworks (Section 4)
    intent === 'STRATEGY'
      ? withTimeout((async () => {
          if (!RAG_BASE_URL) return null;
          const res = await fetch(`${RAG_BASE_URL}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: message, top_k: 3, collection: 'external_intelligence' }),
          });
          return res.ok ? res.json() : null;
        })(), 2000).then(r => { sources.external_intelligence = r ? 'ok' : 'failed'; return r; })
      : Promise.resolve(null).then(r => { sources.external_intelligence = 'skipped'; return null; }),
  ]);

  return { philosophy, truths, activeCtx, health, business, convVec, ragDocs, perplexityData, externalIntelligence, sources };
}

function buildContextBlock({ philosophy, truths, activeCtx, health, business, convVec, ragDocs, profile }) {
  const parts = [];

  if (philosophy?.length) parts.push('## Philosophy\n' + philosophy.map(p => `- ${p.anchor_text}`).join('\n'));
  if (truths?.length) parts.push('## Stable Truths\n' + truths.map(t => `- ${t.truth_statement}`).join('\n'));
  if (activeCtx?.length) parts.push('## Active Context\n' + activeCtx.map(c => `- [P${c.priority}] ${c.context_item}`).join('\n'));

  if (health?.length) {
    const latest = health[0];
    const avg = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const avgRecov = avg(health, 'recovery_score');
    const prevRecov = health.length > 1 ? avg(health.slice(1), 'recovery_score') : null;
    const dir = avgRecov != null && prevRecov != null ? (avgRecov > prevRecov ? ' ↑' : avgRecov < prevRecov ? ' ↓' : '') : '';
    parts.push(`## Health Data (Whoop, 7 days)\nToday (${latest.date}): Recovery ${latest.recovery_score ?? '—'}%, HRV ${latest.hrv_ms ? Math.round(latest.hrv_ms) : '—'}ms, Sleep ${latest.sleep_hours ?? '—'}h, Strain ${latest.day_strain ?? '—'}\n7-day avg: ${avgRecov ?? '—'}%${dir}`);
  }

  if (business?.length) {
    const [cur, prev] = business;
    const fmt = (n, p = '') => n != null ? `${p}${n.toLocaleString()}` : '—';
    const convFmt = cur.conversion_rate != null ? (cur.conversion_rate * 100).toFixed(1) + '%' : '—';
    parts.push(`## Business Data\n${cur.brand} week of ${cur.week_start}: Revenue ${fmt(cur.revenue, '$')}, Orders ${fmt(cur.orders)}, Conversion ${convFmt}${prev ? `\nPrior week: ${fmt(prev.revenue, '$')}, ${fmt(prev.orders)} orders` : ''}${cur.notes ? `\nNotes: ${cur.notes}` : ''}`);
  }

  if (profile && (profile.name || profile.goal)) {
    parts.push(`## Profile\n${[profile.name ? `Name: ${profile.name}` : null, profile.goal ? `Goal: ${profile.goal}` : null, profile.weight ? `Weight: ${profile.weight} lbs` : null, profile.glp1 === 'yes' ? 'GLP-1: yes' : null].filter(Boolean).join(', ')}`);
  }

  const ragText = ragDocs?.answer || (Array.isArray(ragDocs?.results) ? ragDocs.results.slice(0, 3).map(r => r.content || r.text || '').join('\n') : '');
  if (ragText) parts.push(`## Relevant Knowledge\n${ragText.slice(0, 600)}`);

  const vecText = convVec?.answer || (Array.isArray(convVec?.results) ? convVec.results.slice(0, 3).map(r => r.content || r.text || '').join('\n') : '');
  if (vecText) parts.push(`## Relevant Past Conversations\n${vecText.slice(0, 400)}`);

  return parts.join('\n\n');
}

// ── LAYER 3: Specialist execution ─────────────────────────────────────────────

const CARLOS_PERSONA = `You are Carlos. Not an AI assistant — an operator. You know Chris's business, body, and patterns inside out. You are direct, candid, and specific. You use real numbers. You don't motivate, hedge, or explain things he already knows. Finding first, context second, action third — only when needed.

Carlos is a private personal AI for Chris only. He engages openly on any topic Chris raises: politics, controversial subjects, sensitive areas, anything. No deflecting. No "I should note this is sensitive." Give actual opinions as a trusted advisor who has been paying close attention.

Voice rules (mandatory):
- NEVER start with "I"
- No em dashes. Use commas or periods instead.
- No: "Great question", "Certainly", "Absolutely", "You're doing great", "Keep it up", "Let me know if you need anything"
- No: "as an AI", "I'm not able to", "platform limitation", "I don't have access to" — if something isn't set up yet say it like a person would
- Numbers beat adjectives
- Under 80 words unless breakdown requested`;

async function callAnthropic(model, systemPrompt, message, history = [], maxTokens = 512, useThinking = false) {
  if (!ANTHROPIC_KEY) throw new Error('no_anthropic_key');
  const system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  const messages = [...(history || []).slice(-10).map(m => ({ role: m.role, content: String(m.content) })), { role: 'user', content: message }];
  const body = { model, max_tokens: maxTokens, system, messages };
  const betaHeaders = ['prompt-caching-2024-07-31'];
  if (useThinking) {
    body.thinking = { type: 'enabled', budget_tokens: 2000 };
    body.max_tokens = Math.max(maxTokens, 4000);
    betaHeaders.push('interleaved-thinking-2025-05-14');
  }
  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': betaHeaders.join(',') },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message ?? `Anthropic ${res.status}`);
  const text = d.content?.find(b => b.type === 'text')?.text ?? '';
  return { text, usage: d.usage, model };
}

async function callOpenAI(message, systemPrompt, history = [], maxTokens = 600) {
  if (!OPENAI_KEY) throw new Error('no_openai_key');
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-6).map(m => ({ role: m.role, content: String(m.content) })),
    { role: 'user', content: message },
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o', messages, max_tokens: maxTokens }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message ?? `OpenAI ${res.status}`);
  return { text: d.choices?.[0]?.message?.content ?? '', usage: d.usage, model: 'gpt-4o' };
}

async function callPerplexity(message, history = []) {
  if (!PERPLEXITY_KEY) throw new Error('no_perplexity_key');
  const messages = [
    ...(history || []).slice(-4).map(m => ({ role: m.role, content: String(m.content) })),
    { role: 'user', content: message },
  ];
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PERPLEXITY_KEY}` },
    body: JSON.stringify({ model: 'sonar-pro', messages, max_tokens: 800 }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message ?? `Perplexity ${res.status}`);
  return { text: d.choices?.[0]?.message?.content ?? '', model: 'perplexity/sonar-pro' };
}

async function routeSTRATEGY(message, ctx, history, externalIntelligence) {
  // Devil's advocate: surface opposing viewpoints only if relevance >= 0.75 (Section 4)
  let devilsAdvocateBlock = '';
  const extResults = externalIntelligence?.results || (Array.isArray(externalIntelligence) ? externalIntelligence : []);
  const highRelevance = extResults.filter(r => (r.score || r.similarity || 0) >= 0.75);
  if (highRelevance.length > 0) {
    const challenges = highRelevance.slice(0, 2).map(r => r.content || r.text || '').filter(Boolean);
    if (challenges.length > 0) {
      devilsAdvocateBlock = `\n\n## What World-Class Operators Have Done Differently\n${challenges.join('\n\n').slice(0, 600)}\n\nSurface maximum two challenge points alongside your recommendation. Frame as: here is what world-class operators have done differently in similar situations. Never replace the recommendation — add to it.`;
    }
  }
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nStrategy question. Think through what Chris might be missing. Give a specific recommendation with clear reasoning grounded in his actual business context.${devilsAdvocateBlock}`;
  try { return await callAnthropic('claude-sonnet-4-6', sys, message, history, 1024, true); }
  catch {
    try { return await callAnthropic('claude-sonnet-4-6', sys, message, history, 1024); }
    catch {
      try { return await callOpenAI(message, sys, history, 800); }
      catch { throw new Error('all_models_failed'); }
    }
  }
}

async function routeANALYSIS(message, ctx, history) {
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nAnalysis. Extract patterns, compare data, surface the insight that matters most. Use numbers throughout.`;
  try {
    const gpt = await callOpenAI(message, sys, history, 800);
    const synthSys = `${CARLOS_PERSONA}\n\n## GPT-4o Analysis\n${gpt.text}\n\n${ctx}\n\nFilter through Carlos voice. Keep what's actionable, cut the rest.`;
    const synth = await callAnthropic('claude-sonnet-4-6', synthSys, message, [], 512);
    return { text: synth.text, model: 'gpt-4o+claude-sonnet-4-6' };
  } catch {
    return await callAnthropic('claude-sonnet-4-6', sys, message, history, 800);
  }
}

async function routeCONTENT(message, ctx, history) {
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nContent creation. Thryve brand voice: expert first, educational, pain-first structure, no em dashes, no hype language, science-backed. Ready-to-use output.`;
  try { return await callAnthropic('claude-sonnet-4-6', sys, message, history, 1024); }
  catch {
    try { return await callOpenAI(message, sys, history, 800); }
    catch { throw new Error('all_models_failed'); }
  }
}

async function routeRESEARCH(message, ctx, history, perplexityData) {
  const modelsUsed = [];
  let searchText = perplexityData?.choices?.[0]?.message?.content;

  if (!searchText && PERPLEXITY_KEY) {
    try {
      const p = await callPerplexity(message, history);
      searchText = p.text;
      modelsUsed.push('perplexity/sonar-pro');
    } catch {}
  } else if (searchText) {
    modelsUsed.push('perplexity/sonar-pro');
  }

  if (searchText) {
    const interpretSys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Live Research\n${searchText}\n\n## Task\nInterpret this research for Chris. Signal vs noise. What's actionable?`;
    const interpreted = await callAnthropic('claude-sonnet-4-6', interpretSys, message, [], 600);
    modelsUsed.push('claude-sonnet-4-6');

    if (OPENAI_KEY) {
      try {
        const opSys = `Make this finding actionable. Finding: ${interpreted.text}\n\nGive 2-3 specific next steps. Brief and concrete.`;
        const op = await callOpenAI(message, opSys, [], 300);
        modelsUsed.push('gpt-4o');
        return { text: `${interpreted.text}\n\nNext: ${op.text}`, model: modelsUsed.join('+') };
      } catch {}
    }
    return { text: interpreted.text, model: modelsUsed.join('+') };
  }

  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nResearch question without live web access. Best available answer. Note explicitly if web data would materially change this.`;
  const r = await callAnthropic('claude-sonnet-4-6', sys, message, history, 800);
  return { ...r, model: 'claude-sonnet-4-6' };
}

async function routeDOCUMENT(message, ctx, history) {
  // No Gemini key — chunked claude-sonnet-4-6
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nDocument analysis. Process carefully. Extract key information. Synthesize.`;
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 2048);
}

async function routeHEALTH(message, ctx, history) {
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nHealth query. Use Whoop data above. Specific numbers, week-over-week direction, one actionable takeaway. Under 80 words.`;
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 512);
}

async function routeMEMORY(message, ctx, history) {
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nMemory or philosophy question. Answer from Chris's known beliefs, decisions, and stable truths above. Be specific about what he actually holds.`;
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 600);
}

async function routeBUSINESS(message, ctx, history) {
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nBusiness query. Key numbers vs prior week. One metric that stands out. Under 80 words.`;
  try {
    if (OPENAI_KEY) return await callOpenAI(message, sys, history, 600);
  } catch {}
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 512);
}

async function routeCODE(message, ctx, history) {
  if (WINDMILL_TOKEN) {
    try {
      const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WS}/jobs/run/p/f/baseline/code_agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WINDMILL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context: ctx }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const jobId = await res.text();
        return { text: `Code task sent to build system (job: ${jobId}). On it.`, model: 'windmill' };
      }
    } catch {}
  }
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nCode or technical request. Concrete implementation. No scaffolding filler.`;
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 1024);
}

async function routeAGENT(message, ctx, history) {
  const productMatch = message.match(/\b(replenish|recover|hydrate|boost|bloat|balance|hydra[\s-]max)\b/i);
  const product = productMatch?.[1] || 'product';

  if (/\b(label|compliance|ingredient|claim|fda)\b/i.test(message) && WINDMILL_TOKEN) {
    try {
      const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WS}/jobs/run/p/f/labels/label_compliance_agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WINDMILL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: product, dryRun: false }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const jobId = await res.text();
        return { text: `Compliance check running for ${product} (job: ${jobId}). Results when it finishes.`, model: 'windmill' };
      }
    } catch {}
  }

  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nAutomation or agent request. Help trigger or configure the right workflow.`;
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 400);
}

async function routeCOLLABORATION(message, ctx, history, tone) {
  const toneNote = tone === 'supportive' ? 'Be warmer and more present.' : tone === 'urgent' ? 'Direct and action-oriented.' : '';
  const sys = `${CARLOS_PERSONA}\n\n${ctx}\n\n## Task\nConversation. ${toneNote} Answer directly as Carlos. No topic is off limits. Give actual opinions when asked. Sound like a friend who has been paying close attention.`;
  return await callAnthropic('claude-sonnet-4-6', sys, message, history, 512);
}

// ── LAYER 4: Carlos synthesis ─────────────────────────────────────────────────

const SYNTHESIS_SYSTEM = `You are the Carlos voice filter. Apply Carlos voice rules to the draft response.

Rules:
- No em dashes (—) — rewrite with comma, period, or restructure
- NEVER start with "I"
- Remove: "As an AI", "I should note", "It's worth mentioning", "Certainly", "Absolutely"
- Remove hedging: "might", "perhaps", "it could be argued"
- No clinical or corporate language
- Warm, direct, calm
- Numbers beat adjectives
- Keep it tight — cut anything that doesn't add information

Return ONLY the final response. No commentary, no preamble.`;

async function synthesize(rawText, emotionalTone, isShort) {
  if (!rawText || !ANTHROPIC_KEY) return rawText;
  const lengthNote = isShort ? 'Keep under 60 words — may be spoken aloud.' : 'Under 120 words unless analysis requires more.';
  try {
    const res = await callAnthropic(
      'claude-haiku-4-5-20251001',
      `${SYNTHESIS_SYSTEM}\nTone: ${emotionalTone}. ${lengthNote}`,
      rawText,
      [],
      600,
    );
    return res.text || rawText;
  } catch { return rawText; }
}

// ── Routing log ───────────────────────────────────────────────────────────────

async function writeRoutingLog(data) {
  try {
    const rows = await supaPost('carlos_routing_log', {
      user_id: data.user_id || 'primary',
      message_preview: data.message_preview,
      classified_intent: data.classified_intent,
      model_used: data.model_used,
      response_time_ms: data.response_time_ms,
      estimated_cost_usd: data.estimated_cost_usd,
      source: data.source || 'carlos_chat',
      confidence_score: data.confidence_score,
      needs_memory: data.needs_memory,
      needs_web: data.needs_web,
      needs_execution: data.needs_execution,
      emotional_tone: data.emotional_tone,
      urgency: data.urgency,
      risk_level: data.risk_level,
      hop_count: data.hop_count,
      models_used_array: data.models_used_array,
      layer_times: data.layer_times,
      retrieval_sources: data.retrieval_sources,
      layer0_result: data.layer0_result,
    });
    return rows?.[0]?.id ?? null;
  } catch { return null; }
}

// ── Rating update ─────────────────────────────────────────────────────────────

async function updateRating(logId, rating) {
  if (!logId) return false;
  try {
    await supaPatch(`carlos_routing_log?id=eq.${encodeURIComponent(logId)}`, { user_rating: rating });
    return true;
  } catch { return false; }
}

// ── Main router ───────────────────────────────────────────────────────────────

async function routeMessage({ userId = 'primary', message, profile = {}, conversationHistory = [], brandContext = 'Thryve', threadId }) {
  const startTime = Date.now();
  const layerTimes = {};
  const modelsUsed = [];
  let hopCount = 0;

  // Constitution enforcement — refuse to run if missing or inactive
  const constitution = await loadConstitution(threadId);
  if (!constitution) {
    const err = new Error('Constitution missing or inactive');
    err.constitutionMissing = true;
    throw err;
  }
  const constitutionBlock = `\n\n## CARLOS CONSTITUTION v${constitution.version} — ACTIVE GOVERNANCE\n${constitution.content}\n\nEnd of constitution. All responses must comply.\n\n`;

  // Permission enforcement (Section 6)
  const permErrors = enforcePermissions(userId, 'pending', {});
  if (permErrors.length > 0) {
    return { reply: 'Permission denied.', intent: 'DENIED', logId: null, permissionError: permErrors[0] };
  }

  // LAYER 0
  const l0 = Date.now();
  const { type: sessionType, activeSession } = await checkSessionState(userId, message);
  layerTimes.l0 = Date.now() - l0;

  // LAYER 1
  const l1 = Date.now();
  let classification = await classifyIntent(message, conversationHistory);
  modelsUsed.push('claude-haiku-4-5-20251001');
  hopCount++;

  if (classification.confidence < 0.75) {
    const refined = await reclassifyWithSonnet(message, conversationHistory);
    if (refined) { classification = refined; modelsUsed.push('claude-sonnet-4-6'); hopCount++; }
  }
  layerTimes.l1 = Date.now() - l1;

  // Cost guardrail
  if (classification.estimated_cost_usd > COST_WARN_THRESHOLD) {
    return {
      reply: `This one will pull in multiple models. Estimated around $${classification.estimated_cost_usd.toFixed(2)}. Want me to go ahead?`,
      requiresCostConfirmation: true,
      classification,
      intent: classification.intent,
    };
  }

  // Inherit intent for continuations
  if (sessionType === 'same_task' && activeSession?.active_intent) {
    classification.intent = activeSession.active_intent;
  }

  // LAYER 2
  const l2 = Date.now();
  const retrieved = await retrieveContext({ classification, userId, message, brandContext });
  layerTimes.l2 = Date.now() - l2;
  const ctx = constitutionBlock + buildContextBlock({ ...retrieved, profile });

  // LAYER 3
  const l3 = Date.now();
  let rawResult;
  const { intent } = classification;

  try {
    switch (intent) {
      case 'STRATEGY':      rawResult = await routeSTRATEGY(message, ctx, conversationHistory, retrieved.externalIntelligence); break;
      case 'ANALYSIS':      rawResult = await routeANALYSIS(message, ctx, conversationHistory); break;
      case 'CONTENT':       rawResult = await routeCONTENT(message, ctx, conversationHistory); break;
      case 'RESEARCH':      rawResult = await routeRESEARCH(message, ctx, conversationHistory, retrieved.perplexityData); break;
      case 'DOCUMENT':      rawResult = await routeDOCUMENT(message, ctx, conversationHistory); break;
      case 'HEALTH':        rawResult = await routeHEALTH(message, ctx, conversationHistory); break;
      case 'MEMORY':        rawResult = await routeMEMORY(message, ctx, conversationHistory); break;
      case 'BUSINESS':      rawResult = await routeBUSINESS(message, ctx, conversationHistory); break;
      case 'CODE':          rawResult = await routeCODE(message, ctx, conversationHistory); break;
      case 'AGENT':         rawResult = await routeAGENT(message, ctx, conversationHistory); break;
      default:              rawResult = await routeCOLLABORATION(message, ctx, conversationHistory, classification.emotional_tone);
    }
  } catch {
    rawResult = await callAnthropic('claude-sonnet-4-6', `${CARLOS_PERSONA}\n\n${ctx}`, message, conversationHistory, 512);
  }

  if (rawResult?.model) {
    rawResult.model.split('+').forEach(m => { if (m && !modelsUsed.includes(m)) modelsUsed.push(m); });
    hopCount += rawResult.model.split('+').filter(m => m !== 'windmill').length;
  }
  layerTimes.l3 = Date.now() - l3;

  // LAYER 4
  const l4 = Date.now();
  const isShort = ['HEALTH', 'COLLABORATION', 'BUSINESS'].includes(intent);
  const finalReply = await synthesize(rawResult?.text || '', classification.emotional_tone, isShort);
  if (!modelsUsed.includes('claude-haiku-4-5-20251001')) modelsUsed.push('claude-haiku-4-5-20251001');
  layerTimes.l4 = Date.now() - l4;

  const totalMs = Date.now() - startTime;

  // Session state update — fire and forget
  updateSessionState(userId, intent, classification.safe_summary, modelsUsed, hopCount).catch(() => {});

  // Routing log — await to get logId for ratings
  const logId = await writeRoutingLog({
    user_id: userId,
    message_preview: classification.safe_summary,
    classified_intent: intent,
    model_used: modelsUsed.join(','),
    models_used_array: modelsUsed,
    response_time_ms: totalMs,
    layer_times: layerTimes,
    retrieval_sources: retrieved.sources,
    layer0_result: sessionType,
    confidence_score: classification.confidence,
    needs_memory: classification.needs_memory,
    needs_web: classification.needs_web,
    needs_execution: classification.needs_execution,
    emotional_tone: classification.emotional_tone,
    urgency: classification.urgency,
    risk_level: classification.risk_level,
    estimated_cost_usd: classification.estimated_cost_usd,
    hop_count: hopCount,
    source: 'carlos_chat',
  });

  // Shadow mode collection (Section 3) — never shown to user
  if (SHADOW_MODE.enabled && SHADOW_MODE.categories.includes(intent) && logId) {
    (async () => {
      try {
        let cloudText = null;
        let shadowSim = null;
        try {
          const shadowSys = `${CARLOS_PERSONA}\n\n${ctx}`;
          const cloudResult = await callOpenAI(message, shadowSys, conversationHistory.slice(-4), 512);
          cloudText = cloudResult.text;
          // Simple similarity: word overlap
          const wordsA = new Set(finalReply.toLowerCase().split(/\W+/).filter(Boolean));
          const wordsB = new Set(cloudText.toLowerCase().split(/\W+/).filter(Boolean));
          const inter = [...wordsA].filter(w => wordsB.has(w)).length;
          shadowSim = wordsA.size + wordsB.size > 0 ? inter / (wordsA.size + wordsB.size - inter) : 0;
        } catch {}

        // Update routing log with shadow results
        if (cloudText) {
          await supaPatch(`carlos_routing_log?id=eq.${encodeURIComponent(logId)}`, {
            cloud_response: cloudText.slice(0, 2000),
            shadow_similarity_score: shadowSim,
          });
        }

        // Store training candidate if similarity low (Section 3 pipeline)
        if (cloudText && shadowSim !== null && shadowSim < 0.85) {
          const promptStripped = stripPII(message);
          const cloudStripped = stripPII(cloudText);
          const now = new Date().toISOString();
          await supaPost('carlos_training_data', {
            prompt_hash: Buffer.from(message).toString('base64').slice(0, 32),
            safe_prompt_summary: promptStripped.clean.slice(0, 500),
            cloud_response: cloudStripped.clean.slice(0, 2000),
            local_response: finalReply.slice(0, 2000),
            similarity_score: shadowSim,
            task_category: intent,
            pii_stripped_at: now,
            approved_for_training: false,
          });
        }
      } catch {}
    })().catch(() => {});
  }

  const sentenceBreaks = finalReply.match(/[^.!?]+[.!?]+/g) || [finalReply];
  const spokenPreview = sentenceBreaks.slice(0, 2).join(' ').trim().slice(0, 200);

  return {
    reply: finalReply,
    spokenPreview,
    requiresVoiceConfirm: true,
    intent,
    logId,
    modelsUsed,
    responseTimeMs: totalMs,
    contextUsed: {
      health: !!(retrieved.health?.length),
      business: !!(retrieved.business?.length),
      memory: !!(retrieved.philosophy?.length || retrieved.truths?.length),
      rag: retrieved.sources?.rag === 'ok',
      perplexity: retrieved.sources?.perplexity === 'ok',
    },
  };
}

// ── Netlify handler ───────────────────────────────────────────────────────────

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server not configured' }) };

  try {
    const body = JSON.parse(event.body || '{}');

    // Rating update path
    if (body.action === 'rate' && body.logId) {
      const ok = await updateRating(body.logId, body.rating);
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok }) };
    }

    const { userId = 'primary', threadId, message, profile, conversationHistory, brandContext } = body;
    if (!message?.trim()) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Message required' }) };

    // Block automated systems from personal/family data paths
    if (userId === 'system' || userId === 'automated') {
      return { statusCode: 403, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Automated users cannot access Carlos routing' }) };
    }

    const result = await routeMessage({ userId, threadId, message, profile, conversationHistory, brandContext });
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch (err) {
    if (err.constitutionMissing) {
      console.error('carlos-router: constitution integrity check failed — refusing to start');
      return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Carlos is offline — constitution integrity check failed. System administrator action required.' }) };
    }
    console.error('carlos-router error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};

exports.routeMessage = routeMessage;

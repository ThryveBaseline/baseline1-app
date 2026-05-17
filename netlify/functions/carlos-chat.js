// Carlos chat orchestration layer
// Classifies intent → fetches context → executes side effects → calls Claude
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RAG_BASE_URL = process.env.RAG_BASE_URL || 'https://rag-command-center.onrender.com';
const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || 'https://windmill-server-production-1d21.up.railway.app';
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN;
const WINDMILL_WS = process.env.WINDMILL_WORKSPACE || 'thryve';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Intent classification (deterministic keyword routing) ─────────────────────

function classifyIntent(msg) {
  const m = msg.toLowerCase();

  const foodVerbs = /\b(just had|just ate|just drank|had|ate|eating|drank|drinking|logged|consumed)\b/;
  const foodNouns = /\b(protein|shake|eggs?|chicken|beef|steak|fish|salmon|tuna|salad|rice|bread|coffee|tea|water|electrolyte|yogurt|cheese|apple|banana|oats|granola|nuts|avocado|meal|breakfast|lunch|dinner|snack|bar|smoothie|whey|creatine)\b/;
  if (foodVerbs.test(m) && foodNouns.test(m)) return 'food_log';

  if (/\b(that comment|that was about|reclassif|not (about )?us|about lmnt|misclassif|wrong categor|mark that|correct that|not ours)\b/.test(m)) return 'agent_feedback';

  if (/\b(recovery|sleep (score|data|trend)|strain|hrv|resting heart|heart rate|whoop|how.*recover|how.*sleep|how (am|do) i (feel|look)|health trend)\b/.test(m)) return 'health_query';

  if (/\b(how did (thryve|ellington|we) do|business.*week|this week.*business|revenue|sales (this|last) week|orders (this|last) week|conversion rate|spend this week|how.*performing|weekly (numbers|performance|results))\b/.test(m)) return 'business_query';

  if (/\b(compliance|label check|fda|run.*check|check.*label|check.*replenish|ingredient.*claim|health.*claim|run compliance)\b/.test(m)) return 'label_check';

  if (/\b(draft.*response|respond.*reddit|reddit.*thread|organic salt|lmnt.*thread|salt.*thread|write.*reply|draft.*reply|respond.*to)\b/.test(m)) return 'reddit_draft';

  return 'general_chat';
}

// ── Context fetchers ──────────────────────────────────────────────────────────

async function fetchHealthContext() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_health_context?user_id=eq.primary&provider=eq.whoop&date=gte.${ago}&order=date.desc&limit=7&select=date,recovery_score,hrv_ms,rhr_bpm,sleep_performance,sleep_hours,sleep_consistency,day_strain,calories_burned,health_summary`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows : null;
  } catch { return null; }
}

async function fetchBusinessContext(brand) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_weekly_snapshots?brand=eq.${encodeURIComponent(brand)}&order=week_start.desc&limit=2`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows : null;
  } catch { return null; }
}

async function fetchPersona() {
  try {
    const res = await fetch(`${RAG_BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Carlos persona morning brief operator stance', top_k: 4, collection: 'baseline_persona' }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.answer || (Array.isArray(data.results) ? data.results.map(r => r.content || r.text || '').join('\n') : '');
    return text.trim() || null;
  } catch { return null; }
}

async function fetchRecentAgentOutputs() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const ago = new Date(Date.now() - 86400000).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_outputs?created_at=gte.${ago}&order=created_at.desc&limit=4&select=agent_name,output_type,content,business_unit`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function fetchRecentMorningBrief() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_outputs?agent_name=eq.morning_brief_agent&order=created_at.desc&limit=1&select=content,created_at`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch { return null; }
}

// ── Side-effect actions ───────────────────────────────────────────────────────

async function parseFoodItems(message) {
  if (!ANTHROPIC_KEY) return [{ name: message.slice(0, 80), calories_est: null, protein_est: null }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: 'Extract food/drink items from the user message. Return ONLY valid JSON: {"items":[{"name":"...","calories_est":null_or_number,"protein_est":null_or_number}]}. No markdown.',
        messages: [{ role: 'user', content: message }],
      }),
    });
    const d = await res.json();
    const text = (d.content?.[0]?.text ?? '').replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(text).items ?? [];
  } catch { return [{ name: message.slice(0, 80), calories_est: null, protein_est: null }]; }
}

async function logFood(userId, rawText, items) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/food_logs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, raw_text: rawText, items, source: 'carlos' }),
    });
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch { return null; }
}

async function logFeedback(userId, eventText, metadata) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_feedback_events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, event_text: eventText, metadata: metadata ?? {} }),
    });
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch { return null; }
}

async function triggerWindmill(scriptPath, args) {
  if (!WINDMILL_TOKEN) return null;
  try {
    const res = await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WS}/jobs/run/p/${scriptPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WINDMILL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildSystemPrompt({ profile, health, business, persona, agentOutputs, morningBrief, intent }) {
  const parts = [];

  // Persona
  parts.push(persona
    ? `## Carlos — Persona\n${persona}`
    : `## Carlos — Persona
You are Carlos, a personal AI for ${profile.name || 'the user'}. You are warm, candid, and concise — not robotic, not deferential. You give direct answers grounded in real data. When you have numbers, you use them. When you don't, you say so.`);

  parts.push(`## Operator Rules
- Answer with specific numbers and timeframes when data is available.
- Never use vague motivational language ("You're doing great!", "Keep it up!").
- When a message implies logging data, confirm the action naturally in the reply.
- Mention the data source in plain English when it adds context (e.g. "your Whoop from this morning").
- Keep replies under 100 words unless the user asks for a detailed breakdown.
- Never start a response with "Great question", "Of course", "Certainly", or "Absolutely".
- Tone: direct. Like a trusted coach who respects your time.`);

  // Profile
  const profileLines = [
    `Name: ${profile.name || 'User'}`,
    `Goal: ${profile.goal || 'wellness'}`,
    `Activity: ${profile.activity || 'moderate'}`,
    profile.glp1 === 'yes' ? 'GLP-1 protocol: yes' : null,
    profile.conditions && profile.conditions !== 'none' ? `Conditions: ${profile.conditions}` : null,
    profile.weight ? `Weight: ${profile.weight} lbs` : null,
  ].filter(Boolean).join('\n');
  parts.push(`## User Profile\n${profileLines}`);

  // Health context
  if (health && health.length > 0) {
    const latest = health[0];
    const avg = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const avgRecov = avg(health, 'recovery_score');
    const prevRecov = health.length > 1 ? avg(health.slice(1), 'recovery_score') : null;
    const direction = avgRecov != null && prevRecov != null ? (avgRecov > prevRecov ? '↑' : avgRecov < prevRecov ? '↓' : '→') : '';

    const lines = [
      `Today (${latest.date}): Recovery ${latest.recovery_score ?? '—'}%, HRV ${latest.hrv_ms ? Math.round(latest.hrv_ms) : '—'} ms, Sleep ${latest.sleep_hours ?? '—'}h, Strain ${latest.day_strain ?? '—'}`,
      avgRecov != null ? `7-day avg recovery: ${avgRecov}% ${direction}` : null,
      latest.sleep_consistency != null ? `Sleep consistency: ${latest.sleep_consistency}%` : null,
      latest.health_summary ? `Summary: ${latest.health_summary}` : null,
    ].filter(Boolean).join('\n');
    parts.push(`## Health Data (Whoop, last 7 days)\n${lines}`);
  }

  // Business context
  if (business && business.length > 0) {
    const [cur, prev] = business;
    const fmt = (n, prefix = '') => n != null ? `${prefix}${n.toLocaleString()}` : '—';
    const lines = [
      `${cur.brand} — Week of ${cur.week_start}: Revenue ${fmt(cur.revenue, '$')}, Orders ${fmt(cur.orders)}, Conversion ${cur.conversion_rate != null ? (cur.conversion_rate * 100).toFixed(1) + '%' : '—'}, Spend ${fmt(cur.spend, '$')}`,
      prev ? `Prior week: Revenue ${fmt(prev.revenue, '$')}, Orders ${fmt(prev.orders)}` : null,
      cur.notes ? `Notes: ${cur.notes}` : null,
    ].filter(Boolean).join('\n');
    parts.push(`## Business Data\n${lines}`);
  }

  // Morning brief (if available and relevant for general chat)
  if (morningBrief && intent === 'general_chat') {
    parts.push(`## Today's Morning Brief\n${morningBrief.content?.slice(0, 400) || ''}`);
  }

  // Recent agent outputs
  if (agentOutputs && agentOutputs.length > 0) {
    const lines = agentOutputs.map(o => `[${o.agent_name}] ${(o.content || '').slice(0, 200)}`).join('\n\n');
    parts.push(`## Recent Automation Outputs (last 24h)\n${lines}`);
  }

  // Intent-specific guidance
  const intentGuide = {
    food_log: 'The food log action has already been executed. Confirm what was logged in one natural sentence. Mention estimated protein if the items have a reasonable protein content. Keep it to 1-2 sentences.',
    agent_feedback: 'The feedback has been recorded. Confirm what was corrected and that it was sent back to the workflow. One sentence.',
    health_query: 'Use the Whoop data above. Give specific numbers, week-over-week direction if available, and one actionable takeaway. Under 80 words.',
    business_query: 'Use the business snapshot above. Summarize key numbers vs. prior week and note the one metric that stands out. Under 80 words.',
    label_check: 'A compliance check has been triggered in Windmill. Let the user know it\'s running and that results will appear when complete.',
    reddit_draft: 'Write a Thryve brand voice response: confident, science-backed, grounded in evidence. Not defensive. Under 100 words. Ready to copy-paste.',
    general_chat: 'Answer naturally as Carlos. Use available data where relevant.',
  };
  parts.push(`## Current Task\n${intentGuide[intent] || intentGuide.general_chat}`);

  parts.push('If the user message implies logging or correcting data, the action was already performed — reference it naturally.\nIf asked about health or business, use the numbers above. Never invent data.\nYou are Carlos: warm, direct, and grounded.');

  return parts.join('\n\n');
}

// ── Claude call ───────────────────────────────────────────────────────────────

async function callClaude(systemPrompt, message, history) {
  const messages = [
    ...(history || []).slice(-10),
    { role: 'user', content: message },
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 512, system: systemPrompt, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Claude error ${res.status}`);
  return data.content?.[0]?.text ?? '';
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server not configured' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      userId = 'primary',
      threadId,
      message,
      profile = {},
      conversationHistory = [],
      isFirstMessage = false,
      brandContext = 'Thryve',
    } = body;

    if (!message?.trim()) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Message required' }) };

    const intent = classifyIntent(message);

    // Fetch context in parallel — only what's needed for this intent
    const needsHealth = ['health_query', 'general_chat'].includes(intent);
    const needsBusiness = ['business_query', 'general_chat'].includes(intent);
    const needsOutputs = intent === 'general_chat';

    const [health, business, persona, agentOutputs, morningBrief] = await Promise.all([
      needsHealth ? fetchHealthContext() : Promise.resolve(null),
      needsBusiness ? fetchBusinessContext(brandContext) : Promise.resolve(null),
      isFirstMessage ? fetchPersona() : Promise.resolve(null),
      needsOutputs ? fetchRecentAgentOutputs() : Promise.resolve([]),
      needsOutputs ? fetchRecentMorningBrief() : Promise.resolve(null),
    ]);

    // Execute side effects before generating response
    const actions = [];

    if (intent === 'food_log') {
      const items = await parseFoodItems(message);
      const logId = await logFood(userId, message, items);
      actions.push({ type: 'food_log', status: logId ? 'completed' : 'failed', source: 'supabase', items });
    }

    if (intent === 'agent_feedback') {
      const fbId = await logFeedback(userId, message, { thread_id: threadId });
      actions.push({ type: 'agent_feedback', status: fbId ? 'completed' : 'failed', source: 'supabase' });
    }

    if (intent === 'label_check') {
      const productMatch = message.match(/\b(replenish|recover|hydrate|boost|thryve\s+\w+)\b/i);
      const product = productMatch ? productMatch[1] : 'product';
      const jobId = await triggerWindmill('f/labels/label_compliance_agent', { productName: product, dryRun: false });
      actions.push({ type: 'label_check', status: jobId ? 'triggered' : 'failed', source: 'windmill', jobId, product });
    }

    const systemPrompt = buildSystemPrompt({ profile, health, business, persona, agentOutputs, morningBrief, intent });
    const reply = await callClaude(systemPrompt, message, conversationHistory);

    // Spoken preview: first 1-2 sentences
    const sentenceBreaks = reply.match(/[^.!?]+[.!?]+/g) || [reply];
    const spokenPreview = sentenceBreaks.slice(0, 2).join(' ').trim().slice(0, 200);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply,
        spokenPreview,
        requiresVoiceConfirm: true,
        actions,
        intent,
        contextUsed: {
          persona: !!persona,
          health: !!(health && health.length),
          business: !!(business && business.length),
          agentOutputs: (agentOutputs || []).length > 0,
          morningBrief: !!morningBrief,
        },
      }),
    };
  } catch (err) {
    console.error('carlos-chat error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};

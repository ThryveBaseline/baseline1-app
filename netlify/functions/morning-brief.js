// Memory-aware morning brief generation
// Fetches stable_truths, active_context, philosophy_anchors from Supabase
// and injects them into the brief context before calling Claude.
// Cached: memory tables change weekly, not per request.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Module-level memory cache — 1 week TTL (memory changes weekly, not per request)
let _memCache = null;
let _memCacheAt = 0;
const MEM_TTL = 7 * 24 * 60 * 60 * 1000;

async function fetchMemory() {
  const now = Date.now();
  if (_memCache && now - _memCacheAt < MEM_TTL) return _memCache;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const [tr, ac, ph] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/stable_truths?order=confidence_score.desc&limit=6&select=truth_statement,category`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }),
      fetch(`${SUPABASE_URL}/rest/v1/active_context?status=eq.active&order=priority.desc&limit=5&select=context_item,priority`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }),
      fetch(`${SUPABASE_URL}/rest/v1/philosophy_anchors?order=frequency_score.desc&limit=5&select=anchor_text`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }),
    ]);
    const [truths, ctx, phil] = await Promise.all([
      tr.ok ? tr.json() : [],
      ac.ok ? ac.json() : [],
      ph.ok ? ph.json() : [],
    ]);
    _memCache = { truths, ctx, phil };
    _memCacheAt = now;
    return _memCache;
  } catch { return null; }
}

function buildMemoryBlock(mem) {
  if (!mem) return '';
  const lines = [];
  if (mem.phil?.length) {
    lines.push('## Operating Philosophy');
    mem.phil.forEach(p => lines.push(`- ${p.anchor_text}`));
  }
  if (mem.truths?.length) {
    lines.push('\n## What We Know About This Person');
    mem.truths.forEach(t => lines.push(`- ${t.truth_statement}`));
  }
  if (mem.ctx?.length) {
    lines.push('\n## Currently Front of Mind');
    mem.ctx.forEach(c => lines.push(`- [P${c.priority}] ${c.context_item}`));
  }
  return lines.join('\n');
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Not configured' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { system: clientSystem, messages, model, max_tokens } = body;

    const memory = await fetchMemory();
    const memBlock = buildMemoryBlock(memory);

    const enhancedSystem = memBlock
      ? `${clientSystem}\n\n${memBlock}`
      : clientSystem;

    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 600, system: enhancedSystem, messages }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Claude error ${res.status}`);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

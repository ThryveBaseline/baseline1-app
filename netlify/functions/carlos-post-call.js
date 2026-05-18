// ElevenLabs post-call webhook — stores conversation, updates last_check_in, triggers distillation.
// POST /api/carlos-post-call
// Called by ElevenLabs after each conversation ends.
// Verifies HMAC signature if ELEVENLABS_WEBHOOK_SECRET is set.
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || 'https://windmill-server-production-1d21.up.railway.app';
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN;
const WINDMILL_WS = process.env.WINDMILL_WORKSPACE || 'thryve';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

function verifySignature(body, signature, secret) {
  if (!secret || !signature) return true; // if no secret configured, allow all
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const sig = signature.replace(/^sha256=/, '');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}

async function supaPost(path, data) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch { return false; }
}

function buildSummary(transcript) {
  if (!transcript || transcript.length === 0) return 'Voice conversation — no transcript available.';
  const lines = transcript
    .filter(t => t.role === 'user' || t.role === 'agent')
    .map(t => `${t.role === 'user' ? 'Chris' : 'Carlos'}: ${(t.message || '').slice(0, 200)}`)
    .slice(0, 10);
  return lines.join(' | ').slice(0, 500) || 'Voice conversation.';
}

function hasSignificantContext(transcript) {
  if (!transcript) return false;
  const userText = transcript.filter(t => t.role === 'user').map(t => t.message || '').join(' ');
  // Trigger distillation if the conversation contains health logging, decisions, or substantial context
  const triggers = /just (ate|had|drank|finished)|logged|recovery|business|decided|going to|planning|goal/i;
  return triggers.test(userText) && userText.length > 100;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  // Verify ElevenLabs HMAC signature
  const sig = event.headers['elevenlabs-signature'] || event.headers['x-elevenlabs-signature'];
  if (!verifySignature(event.body, sig, WEBHOOK_SECRET)) {
    console.error('carlos-post-call: invalid signature');
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  try {
    const data = JSON.parse(event.body || '{}');
    const {
      conversation_id,
      agent_id,
      status,
      transcript = [],
      metadata = {},
      analysis = {},
    } = data;

    if (!conversation_id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing conversation_id' }) };
    }

    const userId = metadata.user_id || 'primary';
    const durationSeconds = metadata.duration_seconds || null;
    const summary = analysis.transcript_summary || buildSummary(transcript);

    // Store conversation to Supabase
    await supaPost('conversation_history', {
      user_id: userId,
      conversation_id,
      agent_id,
      summary,
      duration_seconds: durationSeconds,
      transcript: transcript.length > 0 ? transcript : null,
      status,
    });

    // Update last_check_in in a profile/context table if it exists
    // Using active_context as a lightweight last-seen marker
    await supaPost('active_context', {
      user_id: userId,
      context_item: `Last Carlos conversation: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
      priority: 1,
      status: 'active',
      related_topics: ['carlos', 'last_check_in'],
    });

    // Trigger memory distillation if conversation had significant content
    if (hasSignificantContext(transcript) && WINDMILL_TOKEN) {
      await fetch(`${WINDMILL_BASE}/api/w/${WINDMILL_WS}/jobs/run/p/f%2Fbaseline%2Fmemory%2Fmemory_distillation_agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WINDMILL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'post_call', conversation_id, dryRun: false }),
      }).catch(() => {}); // fire and forget — don't block response
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('carlos-post-call error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

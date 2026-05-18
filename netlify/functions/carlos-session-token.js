// Carlos session token — fetches user context, returns ElevenLabs signed URL + initiation payload.
// POST /api/carlos-session-token
// Body: { userId?: string }
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const CARLOS_AGENT_ID = process.env.CARLOS_AGENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function supa(path) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  if (!ELEVENLABS_API_KEY || !CARLOS_AGENT_ID) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Carlos agent not configured — run setup/create-carlos-agent.js first' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const userId = body.userId || 'primary';

    // Fetch context in parallel
    const [truths, philosophy, activeCtx, recentHistory, healthRows] = await Promise.all([
      supa('stable_truths?order=confidence_score.desc&limit=6&select=truth_statement,category'),
      supa('philosophy_anchors?order=frequency_score.desc&limit=6&select=anchor_text,category'),
      supa('active_context?status=eq.active&order=priority.desc&limit=5&select=context_item,priority'),
      supa(`conversation_history?user_id=eq.${userId}&order=created_at.desc&limit=3&select=summary,created_at`),
      supa(`daily_health_context?user_id=eq.primary&provider=eq.whoop&order=date.desc&limit=7&select=date,recovery_score,hrv_ms,rhr_bpm,sleep_performance,sleep_hours,day_strain,health_summary`),
    ]);

    // Build dynamic variable values
    const stableTruths = (truths || []).map(t => `- ${t.truth_statement}`).join('\n') || 'Not yet populated.';
    const philosophyText = (philosophy || []).map(p => `- ${p.anchor_text}`).join('\n') || 'Not yet populated.';
    const activeContext = (activeCtx || []).map(c => `- [P${c.priority}] ${c.context_item}`).join('\n') || 'None';

    let healthSummary = 'No health data available yet.';
    if (healthRows && healthRows.length > 0) {
      const latest = healthRows[0];
      const avgRecov = healthRows.reduce((s, r) => s + (r.recovery_score || 0), 0) / healthRows.length;
      healthSummary = [
        `Today (${latest.date}): Recovery ${latest.recovery_score ?? '—'}%, HRV ${latest.hrv_ms ? Math.round(latest.hrv_ms) : '—'}ms, Sleep ${latest.sleep_hours ?? '—'}h, Strain ${latest.day_strain ?? '—'}`,
        `7-day avg recovery: ${Math.round(avgRecov)}%`,
        latest.health_summary ? `Summary: ${latest.health_summary}` : null,
      ].filter(Boolean).join('. ');
    }

    const recentHistoryText = (recentHistory || [])
      .map((c, i) => `${i + 1}. ${new Date(c.created_at).toLocaleDateString()}: ${(c.summary || '').slice(0, 150)}`)
      .join('\n') || 'No prior conversations.';

    const lastCheckIn = recentHistory && recentHistory[0]
      ? new Date(recentHistory[0].created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      : 'No previous check-in';

    const dynamicVariables = {
      user_name: 'Chris',
      user_id: userId,
      last_check_in: lastCheckIn,
      health_summary: healthSummary,
      stable_truths: stableTruths,
      philosophy_anchors: philosophyText,
      active_context: activeContext,
      recent_history: recentHistoryText,
    };

    // Get signed URL from ElevenLabs
    const signedUrlRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${CARLOS_AGENT_ID}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } },
    );

    if (!signedUrlRes.ok) {
      const err = await signedUrlRes.text();
      throw new Error(`ElevenLabs signed URL failed: ${signedUrlRes.status} ${err.slice(0, 200)}`);
    }

    const { signed_url } = await signedUrlRes.json();

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signed_url,
        agent_id: CARLOS_AGENT_ID,
        dynamic_variables: dynamicVariables,
        // The client sends this as the first WebSocket message immediately on open
        initiation_payload: {
          type: 'conversation_initiation_client_data',
          dynamic_variables: dynamicVariables,
          conversation_config_override: {
            tts: {
              // Request PCM 16kHz for direct Web Audio playback without µ-law decoding
              optimize_streaming_latency: 3,
            },
          },
        },
      }),
    };
  } catch (err) {
    console.error('carlos-session-token error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

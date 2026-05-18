// Tool webhook for Carlos ElevenAgent.
// ElevenLabs calls this when the agent needs data during a conversation.
// POST /api/carlos-tools
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function supa(path) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
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

async function getHealthData() {
  const ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const rows = await supa(`daily_health_context?user_id=eq.primary&provider=eq.whoop&date=gte.${ago}&order=date.desc&limit=7&select=date,recovery_score,hrv_ms,rhr_bpm,sleep_performance,sleep_hours,sleep_consistency,day_strain,calories_burned,health_summary`);
  if (!rows || rows.length === 0) return { result: 'No Whoop data available for the past 7 days.' };

  const latest = rows[0];
  const avgRecov = rows.reduce((s, r) => s + (r.recovery_score || 0), 0) / rows.length;
  const summary = [
    `Today (${latest.date}): Recovery ${latest.recovery_score ?? '—'}%, HRV ${latest.hrv_ms ? Math.round(latest.hrv_ms) : '—'}ms, Sleep ${latest.sleep_hours ?? '—'}h, Strain ${latest.day_strain ?? '—'}`,
    `7-day avg recovery: ${Math.round(avgRecov)}%`,
    latest.sleep_consistency != null ? `Sleep consistency: ${latest.sleep_consistency}%` : null,
    latest.health_summary ? `Note: ${latest.health_summary}` : null,
  ].filter(Boolean).join('. ');
  return { result: summary };
}

async function logHealthEntry(rawText) {
  // Use Claude Haiku to extract food items
  let items = [{ name: rawText.slice(0, 80), calories_est: null, protein_est: null }];
  if (ANTHROPIC_KEY && rawText) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: 'Extract food/drink items from user text. Return ONLY valid JSON: {"items":[{"name":"...","calories_est":null_or_number,"protein_est":null_or_number}]}. No markdown.',
          messages: [{ role: 'user', content: rawText }],
        }),
      });
      const d = await r.json();
      const text = (d.content?.[0]?.text ?? '').replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(text);
      if (parsed.items) items = parsed.items;
    } catch {}
  }

  await supaPost('food_logs', { user_id: 'primary', raw_text: rawText, items, source: 'carlos_voice' });
  const names = items.map(i => i.name).join(', ');
  const totalProtein = items.reduce((s, i) => s + (i.protein_est || 0), 0);
  return { result: `Logged: ${names}${totalProtein > 0 ? ` (~${Math.round(totalProtein)}g protein)` : ''}.` };
}

async function getWeeklySummary(brand) {
  const safeBrand = brand === 'ellington' ? 'Ellington Estates' : 'Thryve';
  const rows = await supa(`business_weekly_snapshots?brand=eq.${encodeURIComponent(safeBrand)}&order=week_start.desc&limit=2`);
  if (!rows || rows.length === 0) return { result: `No weekly data available for ${safeBrand} yet.` };
  const [cur, prev] = rows;
  const fmt = n => n != null ? n.toLocaleString() : '—';
  const lines = [
    `${safeBrand} week of ${cur.week_start}: Revenue $${fmt(cur.revenue)}, Orders ${fmt(cur.orders)}, Conversion ${cur.conversion_rate != null ? (cur.conversion_rate * 100).toFixed(1) + '%' : '—'}`,
    prev ? `Prior week: Revenue $${fmt(prev.revenue)}, Orders ${fmt(prev.orders)}` : null,
    cur.notes ? `Notes: ${cur.notes}` : null,
  ].filter(Boolean).join('. ');
  return { result: lines };
}

async function getAgentFeedback() {
  const ago = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await supa(`agent_feedback_events?user_id=eq.primary&created_at=gte.${ago}&order=created_at.desc&limit=5&select=event_text,created_at`);
  if (!rows || rows.length === 0) return { result: 'No recent feedback events.' };
  return { result: rows.map(r => `- ${r.event_text}`).join('\n') };
}

async function updateAgentFeedback(eventText, correction) {
  await supaPost('agent_feedback_events', {
    user_id: 'primary',
    event_text: eventText,
    metadata: { correction: correction || null, source: 'carlos_voice' },
  });
  return { result: `Feedback recorded: "${eventText.slice(0, 60)}" was corrected${correction ? ` to "${correction}"` : ''}.` };
}

async function getMemoryContext() {
  const [truths, philosophy, activeCtx] = await Promise.all([
    supa('stable_truths?order=confidence_score.desc&limit=6&select=truth_statement,category'),
    supa('philosophy_anchors?order=frequency_score.desc&limit=6&select=anchor_text,category'),
    supa('active_context?status=eq.active&order=priority.desc&limit=5&select=context_item,priority'),
  ]);
  const parts = [];
  if (truths && truths.length > 0) parts.push('Stable truths:\n' + truths.map(t => `- ${t.truth_statement}`).join('\n'));
  if (philosophy && philosophy.length > 0) parts.push('Philosophy:\n' + philosophy.map(p => `- ${p.anchor_text}`).join('\n'));
  if (activeCtx && activeCtx.length > 0) parts.push('Active context:\n' + activeCtx.map(c => `- [P${c.priority}] ${c.context_item}`).join('\n'));
  return { result: parts.join('\n\n') || 'Memory not yet populated.' };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    const toolName = event.queryStringParameters?.tool || body.tool_name || body.name;

    let result;
    switch (toolName) {
      case 'get_user_health_data':
      case 'get_health_data':
        result = await getHealthData();
        break;
      case 'log_health_entry':
        result = await logHealthEntry(body.raw_text || '');
        break;
      case 'get_weekly_summary':
        result = await getWeeklySummary(body.brand || 'thryve');
        break;
      case 'get_agent_feedback':
        result = await getAgentFeedback();
        break;
      case 'update_agent_feedback':
        result = await updateAgentFeedback(body.event_text || '', body.correction || '');
        break;
      case 'get_memory_context':
        result = await getMemoryContext();
        break;
      default:
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('carlos-tools error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

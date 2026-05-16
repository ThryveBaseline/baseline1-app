// Returns latest daily_health_context from Supabase for the frontend.
// Called by the app on load to check connection status and populate Whoop metrics.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    // Check if any connection exists
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/health_connections?user_id=eq.primary&provider=eq.whoop&select=provider,provider_user_id,updated_at&limit=1`,
      { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY } },
    );
    const connections = connRes.ok ? await connRes.json() : [];
    const connected = connections.length > 0;

    if (!connected) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connected: false }),
      };
    }

    // Fetch last 7 days of health context
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const ctxRes = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_health_context?user_id=eq.primary&provider=eq.whoop&date=gte.${sevenDaysAgo}&order=date.desc&limit=7&select=date,recovery_score,hrv_ms,rhr_bpm,sleep_performance,sleep_hours,sleep_consistency,day_strain,calories_burned,health_summary`,
      { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY } },
    );
    const records = ctxRes.ok ? await ctxRes.json() : [];
    const latest = records[0] ?? null;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: true, latest, history: records }),
    };
  } catch (err) {
    console.error('whoop-data error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) };
  }
};

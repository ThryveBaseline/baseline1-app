// Returns action-item data for the Today screen: social, reddit, intel, failures, labels
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function fetchAgentOutputs(type, limit = 10) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/agent_outputs?output_type=eq.${type}&created_at=gte.${ago}&order=created_at.desc&limit=${limit}&select=agent_name,output_type,content,metadata,created_at`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function fetchLabelReviews() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/label_reviews?status=eq.pending&order=created_at.desc&limit=10&select=product_name,status,issue_count,created_at`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function formatItem(raw, titleField, metaFn, urgentFn) {
  return raw.map(r => ({
    title: r[titleField] || (r.content || '').slice(0, 120),
    meta: metaFn ? metaFn(r) : null,
    urgent: urgentFn ? urgentFn(r) : false,
    warn: false,
  }));
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const [socialRaw, redditRaw, intelRaw, failureRaw, labelRaw] = await Promise.all([
    fetchAgentOutputs('social_comment'),
    fetchAgentOutputs('reddit_opportunity'),
    fetchAgentOutputs('intelligence_flag'),
    fetchAgentOutputs('automation_failure'),
    fetchLabelReviews(),
  ]);

  const social = formatItem(socialRaw, 'content', r => r.metadata?.platform || r.agent_name, r => r.metadata?.urgent);
  const reddit = redditRaw.slice(0, 3).map(r => ({
    title: (r.content || '').slice(0, 160),
    meta: r.metadata?.subreddit ? `r/${r.metadata.subreddit}` : r.agent_name,
    urgent: false, warn: false,
  }));
  const intel = formatItem(intelRaw, 'content', r => r.agent_name, r => r.metadata?.priority === 'immediate');
  const failures = formatItem(failureRaw, 'content', r => {
    const ts = r.created_at ? new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
    return [r.agent_name, ts].filter(Boolean).join(' · ');
  }, () => true);
  const labels = labelRaw.map(r => ({
    title: `${r.product_name || 'Product'} — ${r.issue_count || 0} issue${r.issue_count !== 1 ? 's' : ''} flagged`,
    meta: 'pending review',
    urgent: false, warn: true,
  }));

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ social, reddit, intel, failures, labels }),
  };
};

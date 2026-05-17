// Returns action-item data for the Today screen: social, reddit, intel, failures, labels
// Primary source: Notion (when env vars set). Falls back to Supabase agent_outputs.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_SOCIAL_DB = process.env.NOTION_SOCIAL_RESPONSE_QUEUE_DB_ID;
const NOTION_REDDIT_DB = process.env.NOTION_REDDIT_OPPS_DB_ID;
const NOTION_AI_DB = process.env.NOTION_AI_UPDATES_DB_ID;
const NOTION_LABEL_DB = process.env.NOTION_LABEL_COMPLIANCE_DB_ID;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function queryNotion(dbId, filter, sorts, pageSize = 20) {
  if (!NOTION_API_KEY || !dbId) return [];
  try {
    const body = { page_size: pageSize };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

function getProp(page, name, type) {
  const prop = page.properties?.[name];
  if (!prop) return null;
  if (type === 'title') return prop.title?.[0]?.plain_text || null;
  if (type === 'rich_text') return prop.rich_text?.[0]?.plain_text || null;
  if (type === 'select') return prop.select?.name || null;
  if (type === 'number') return prop.number ?? null;
  if (type === 'url') return prop.url || null;
  if (type === 'checkbox') return prop.checkbox ?? null;
  return null;
}

async function fetchSocialItems() {
  const pages = await queryNotion(
    NOTION_SOCIAL_DB,
    { property: 'Approval', checkbox: { equals: false } },
    [{ property: 'Priority', direction: 'ascending' }],
    10,
  );
  if (pages.length) {
    return pages.map(p => ({
      notionPageId: p.id,
      title: getProp(p, 'Name', 'title') || 'Untitled comment',
      detail: getProp(p, 'Suggested Reply', 'rich_text') || '',
      meta: [getProp(p, 'Platform', 'select'), getProp(p, 'Sentiment', 'select')].filter(Boolean).join(' · '),
      urgent: getProp(p, 'Priority', 'select') === 'High' || getProp(p, 'Sentiment', 'select') === 'Escalate',
      warn: false,
    }));
  }
  return fetchSupabaseOutputs('social_comment');
}

async function fetchRedditItems() {
  const pages = await queryNotion(
    NOTION_REDDIT_DB,
    { property: 'Status', select: { equals: 'New' } },
    [{ property: 'Opportunity Score', direction: 'descending' }],
    3,
  );
  if (pages.length) {
    return pages.map(p => ({
      notionPageId: p.id,
      title: getProp(p, 'Thread', 'title') || 'Reddit thread',
      detail: [getProp(p, 'Why It Matters', 'rich_text'), getProp(p, 'Suggested Response', 'rich_text')].filter(Boolean).join('\n\n'),
      meta: `r/${getProp(p, 'Subreddit', 'rich_text') || 'unknown'} · Score: ${getProp(p, 'Opportunity Score', 'number') ?? '–'}`,
      url: getProp(p, 'Thread URL', 'url'),
      urgent: false,
      warn: false,
    }));
  }
  return fetchSupabaseOutputs('reddit_opportunity', 3);
}

async function fetchAIItems() {
  const pages = await queryNotion(
    NOTION_AI_DB,
    { property: 'Alert Status', select: { equals: 'Alert Sent' } },
    [{ property: 'Impact', direction: 'ascending' }],
    20,
  );

  const intel = [];
  const failures = [];

  for (const p of pages) {
    const name = getProp(p, 'Name', 'title') || '';
    const impact = getProp(p, 'Impact', 'select');
    const platform = getProp(p, 'Platform', 'select');
    const item = {
      notionPageId: p.id,
      title: name,
      detail: getProp(p, 'Action', 'rich_text') || '',
      meta: [platform, impact].filter(Boolean).join(' · '),
      urgent: impact === 'High',
      warn: false,
    };
    if (name.startsWith('FAILURE:')) {
      failures.push({ ...item, title: name.replace(/^FAILURE:\s*/, ''), warn: true });
    } else {
      intel.push(item);
    }
  }

  const intelFinal = intel.length ? intel : await fetchSupabaseOutputs('intelligence_flag');
  const failuresFinal = failures.length ? failures : await fetchSupabaseOutputs('automation_failure');
  return { intel: intelFinal, failures: failuresFinal };
}

async function fetchLabelItems() {
  const pages = await queryNotion(
    NOTION_LABEL_DB,
    { property: 'Reviewer Status', select: { equals: 'Pending' } },
    [{ property: 'Blocking', direction: 'descending' }],
    10,
  );
  if (pages.length) {
    return pages.map(p => {
      const product = getProp(p, 'Product', 'rich_text') || getProp(p, 'Name', 'title') || 'Product';
      const blocking = getProp(p, 'Blocking', 'number') ?? 0;
      const high = getProp(p, 'High Risk', 'number') ?? 0;
      const riskLevel = getProp(p, 'Risk Level', 'select') || 'Unknown';
      return {
        notionPageId: p.id,
        title: `${product} — ${blocking} blocking${high ? `, ${high} high` : ''}`,
        detail: getProp(p, 'Required Changes', 'rich_text') || '',
        meta: `${riskLevel} risk · Pending review`,
        urgent: riskLevel === 'Blocked' || blocking > 0,
        warn: riskLevel === 'High' || high > 0,
      };
    });
  }
  return fetchLabelsFallback();
}

async function fetchSupabaseOutputs(type, limit = 10) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/agent_outputs?output_type=eq.${type}&created_at=gte.${ago}&order=created_at.desc&limit=${limit}&select=agent_name,output_type,content,metadata,created_at`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => ({
      notionPageId: null,
      title: (r.content || '').slice(0, 120),
      detail: r.content || '',
      meta: r.agent_name || type,
      urgent: r.metadata?.urgent || r.metadata?.priority === 'immediate',
      warn: type === 'automation_failure',
    }));
  } catch { return []; }
}

async function fetchLabelsFallback() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/label_reviews?status=eq.pending&order=created_at.desc&limit=10&select=product_name,status,issue_count,created_at`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => ({
      notionPageId: null,
      title: `${r.product_name || 'Product'} — ${r.issue_count || 0} issue${r.issue_count !== 1 ? 's' : ''} flagged`,
      detail: '',
      meta: 'pending review',
      urgent: false,
      warn: true,
    }));
  } catch { return []; }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const [socialItems, redditItems, aiResult, labelItems] = await Promise.all([
    fetchSocialItems(),
    fetchRedditItems(),
    fetchAIItems(),
    fetchLabelItems(),
  ]);

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      social: socialItems,
      reddit: redditItems,
      intel: aiResult.intel,
      failures: aiResult.failures,
      labels: labelItems,
    }),
  };
};

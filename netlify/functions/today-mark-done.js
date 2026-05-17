// Archives a Notion page — used by Today screen "Mark done" action
const NOTION_API_KEY = process.env.NOTION_API_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  if (!NOTION_API_KEY) {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  let pageId;
  try {
    ({ pageId } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: CORS, body: 'Invalid JSON' };
  }

  if (!pageId) return { statusCode: 400, headers: CORS, body: 'pageId required' };

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archived: true }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers: CORS, body: err };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, pageId }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: e.message };
  }
};

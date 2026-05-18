// carlos-chat.js — thin proxy to carlos-router
// All routing logic lives in carlos-router.js
const { routeMessage } = require('./carlos-router');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId = 'primary', threadId, message, profile = {}, conversationHistory = [], brandContext = 'Thryve' } = body;
    if (!message?.trim()) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Message required' }) };

    const result = await routeMessage({ userId, threadId, message, profile, conversationHistory, brandContext });
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch (err) {
    console.error('carlos-chat error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};

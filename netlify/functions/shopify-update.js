// shopify-update.js — push approved product body HTML to Shopify via GraphQL
const SHOPIFY_TOKEN = process.env.SHOPIFY_THRYVE_ADMIN_ACCESS_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_THRYVE_STORE_DOMAIN || 'thryve-systems.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title }
      userErrors { field message }
    }
  }
`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  if (!SHOPIFY_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'SHOPIFY_THRYVE_ADMIN_ACCESS_TOKEN not configured' }) };

  try {
    const { productId, body } = JSON.parse(event.body || '{}');
    if (!productId || !body) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'productId and body required' }) };

    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
      body: JSON.stringify({ query: MUTATION, variables: { input: { id: productId, body } } }),
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: `Shopify API error ${res.status}` }) };

    const errors = data.data?.productUpdate?.userErrors;
    if (errors?.length) return { statusCode: 422, headers: CORS, body: JSON.stringify({ error: errors[0].message, userErrors: errors }) };

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, product: data.data?.productUpdate?.product }),
    };
  } catch (err) {
    console.error('shopify-update error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

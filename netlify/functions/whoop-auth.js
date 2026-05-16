// Whoop OAuth 2.0 — Authorization redirect
// Called when user clicks "Connect Whoop" in the app.
// Redirects to Whoop authorization page; after user approves, Whoop calls /api/whoop-callback.
exports.handler = async function(event) {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'WHOOP_CLIENT_ID and WHOOP_REDIRECT_URI must be set in Netlify environment variables.' }),
    };
  }

  const scopes = [
    'read:profile',
    'read:body_measurement',
    'read:cycles',
    'read:recovery',
    'read:sleep',
    'read:workout',
    'offline',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state: 'baseline-app',
  });

  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?${params}`;

  return {
    statusCode: 302,
    headers: { Location: authUrl },
    body: '',
  };
};

// Whoop OAuth 2.0 — Token exchange callback
// Whoop redirects here after user authorizes. Exchanges code for tokens, stores in Supabase.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const WHOOP_REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;

exports.handler = async function(event) {
  const { code, error: oauthError } = event.queryStringParameters || {};

  if (oauthError) {
    return redirect('/?whoop=error&reason=' + encodeURIComponent(oauthError));
  }
  if (!code) {
    return redirect('/?whoop=error&reason=no_code');
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        redirect_uri: WHOOP_REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('Whoop token exchange failed:', tokenRes.status, text);
      return redirect('/?whoop=error&reason=token_exchange_failed');
    }

    const tokens = await tokenRes.json();
    // tokens: { access_token, refresh_token, expires_in, token_type, scope }

    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Fetch Whoop user profile to get their user ID
    let providerUserId = null;
    try {
      const profileRes = await fetch('https://api.prod.whoop.com/developer/v2/user/profile/basic', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        providerUserId = String(profile.user_id ?? '');
      }
    } catch (e) {
      // non-fatal — store connection anyway
    }

    // Upsert connection in Supabase
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/health_connections`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: 'primary',
        provider: 'whoop',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_expiry: expiry,
        scope: tokens.scope ?? null,
        provider_user_id: providerUserId,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      const text = await upsertRes.text();
      console.error('Supabase upsert failed:', upsertRes.status, text);
      return redirect('/?whoop=error&reason=db_error');
    }

    return redirect('/?whoop=connected');
  } catch (err) {
    console.error('whoop-callback error:', err);
    return redirect('/?whoop=error&reason=unexpected');
  }
};

function redirect(path) {
  return { statusCode: 302, headers: { Location: path }, body: '' };
}

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '100kb' }));

const WEBEX_API = 'https://webexapis.com';
const CALL_TOKEN_PATH = process.env.WEBEX_CALL_TOKEN_PATH || '/v1/telephony/click2call/callToken';
const GUEST_TOKEN_PATH = '/v1/guests/token';
const GUEST_NAME = process.env.WEBEX_GUEST_NAME || 'Unidos por la colaboración';
const CALLED_NUMBER = process.env.CLICK_TO_CALL_CALLED_NUMBER || '9605';

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;
let currentRefreshToken = process.env.WEBEX_REFRESH_TOKEN || '';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

async function parseResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return { raw: text }; }
}

async function refreshAccessToken() {
  const clientId = requiredEnv('WEBEX_CLIENT_ID');
  const clientSecret = requiredEnv('WEBEX_CLIENT_SECRET');
  if (!currentRefreshToken) throw new Error('Falta WEBEX_REFRESH_TOKEN');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: currentRefreshToken,
  });

  const response = await fetch(`${WEBEX_API}/v1/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await parseResponse(response);
  if (!response.ok || !data.access_token) {
    console.error('Webex token refresh failed:', response.status, data);
    throw new Error(`Webex OAuth refresh failed (${response.status})`);
  }

  cachedAccessToken = data.access_token;
  const expiresIn = Number(data.expires_in || 0);
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 120) * 1000;

  // Some OAuth responses rotate the refresh token. Keep it in memory for this process.
  if (data.refresh_token) currentRefreshToken = data.refresh_token;

  return cachedAccessToken;
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }
  return refreshAccessToken();
}

async function webexRequest(pathname, options = {}, retry = true) {
  let token = await getAccessToken(false);
  let response = await fetch(`${WEBEX_API}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if ((response.status === 401 || response.status === 403) && retry) {
    token = await getAccessToken(true);
    response = await fetch(`${WEBEX_API}${pathname}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }
  return response;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'jabberguestnew', time: new Date().toISOString() });
});

// Browser receives only the short-lived guest access token.
app.post('/api/guest-token', async (req, res) => {
  try {
    const response = await webexRequest(GUEST_TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: 'Webex Click To Call Demo',
        displayName: GUEST_NAME,
      }),
    });
    const data = await parseResponse(response);
    if (!response.ok || !data.accessToken) {
      console.error('Guest token failed:', response.status, data);
      return res.status(response.status || 502).json({ error: 'No se pudo obtener el guest token' });
    }
    res.json({ accessToken: data.accessToken });
  } catch (err) {
    console.error('guest-token:', err);
    res.status(500).json({ error: 'Error interno obteniendo guest token' });
  }
});

// Browser receives only the short-lived JWE/call token. Credentials remain server-side.
app.post('/api/call-token', async (req, res) => {
  try {
    const calledNumber = req.body?.calledNumber || CALLED_NUMBER;
    const guestName = req.body?.guestName || GUEST_NAME;

    const response = await webexRequest(CALL_TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calledNumber, guestName }),
    });
    const data = await parseResponse(response);
    if (!response.ok || !data.callToken) {
      console.error('Call token failed:', response.status, data);
      return res.status(response.status || 502).json({ error: 'No se pudo obtener el call token' });
    }
    res.json({ callToken: data.callToken });
  } catch (err) {
    console.error('call-token:', err);
    res.status(500).json({ error: 'Error interno obteniendo call token' });
  }
});

// Serve the original GitHub Pages application from the same Render service.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'DemoCalling.html'));
});

app.listen(PORT, () => {
  console.log(`jabberguestnew listening on port ${PORT}`);
});

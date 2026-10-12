import crypto from 'node:crypto';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function cookieValue(cookieHeader, name) {
  return String(cookieHeader || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

function verifyJwt(jwt, secret) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3 || !secret) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!String(payload.openId || '').startsWith('cron_')) return null;
    if (payload.appId && process.env.MANUS_PROJECT_ID && payload.appId !== process.env.MANUS_PROJECT_ID) return null;
    return payload;
  } catch (_) { return null; }
}

export async function authenticateScheduledRequest(req) {
  const jwt = cookieValue(req.headers.cookie, 'app_session_id');
  const claims = verifyJwt(jwt, process.env.MANUS_JWT_SECRET);
  if (!claims) return { ok: false, status: 401, error: 'scheduled callback authentication failed' };
  const oauthBase = process.env.MANUS_OAUTH_API_URL;
  if (!oauthBase || !process.env.MANUS_PROJECT_ID) return { ok: false, status: 503, error: 'scheduled callback identity service is not configured' };
  try {
    const response = await fetch(`${oauthBase}/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jwt_token: jwt, project_id: process.env.MANUS_PROJECT_ID }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { ok: false, status: 401, error: 'scheduled callback identity lookup failed' };
    const identity = await response.json();
    if (identity.projectId && identity.projectId !== process.env.MANUS_PROJECT_ID) return { ok: false, status: 403, error: 'scheduled callback project mismatch' };
    return { ok: true, identity };
  } catch (_) { return { ok: false, status: 503, error: 'scheduled callback identity service unavailable' }; }
}

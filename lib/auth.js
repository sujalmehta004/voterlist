const crypto = require('crypto');

const COOKIE_NAME = 'voterlist_session';
const SESSION_SECONDS = 8 * 60 * 60;

function getSecret() {
  const secret = process.env.VOTERLIST_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('VOTERLIST_SESSION_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function signature(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function hasValidSession(req) {
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookieValue = cookieHeader.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);

    if (!cookieValue) return false;
    const [payload, suppliedSignature] = cookieValue.split('.');
    if (!payload || !suppliedSignature) return false;

    const expectedSignature = signature(payload);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return false;
    }

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Number.isInteger(session.expiresAt) && session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

module.exports = { createSession, hasValidSession, setSessionCookie, clearSessionCookie };

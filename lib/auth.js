const crypto = require('crypto');
const connectToDatabase = require('./db');
const Config = require('./models/Config');

const COOKIE_NAME = 'voterlist_session';
const SESSION_SECONDS = 400 * 24 * 60 * 60;

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

function createSession(sessionVersion = 0) {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    sessionVersion,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function verifySessionToken(req, sessionVersion) {
  try {
    const cookieHeader = req.headers?.cookie || '';
    const cookieValue = cookieHeader.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);

    if (!cookieValue) return null;
    const [payload, suppliedSignature] = cookieValue.split('.');
    if (!payload || !suppliedSignature) return null;

    const expectedSignature = signature(payload);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return null;
    }

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const tokenVersion = session.sessionVersion ?? 0;
    if (!Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) return null;
    if (sessionVersion !== undefined && tokenVersion !== sessionVersion) return null;
    return session;
  } catch {
    return null;
  }
}

async function hasValidSession(req, res) {
  const session = verifySessionToken(req);
  if (!session) return false;

  await connectToDatabase();
  const config = await Config.findOne({ key: 'default' }).select('sessionVersion').lean();
  const sessionVersion = Number.isSafeInteger(config?.sessionVersion) ? config.sessionVersion : 0;
  if (!verifySessionToken(req, sessionVersion)) return false;
  if (res) setSessionCookie(res, createSession(sessionVersion));
  return true;
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

module.exports = {
  createSession,
  verifySessionToken,
  hasValidSession,
  setSessionCookie,
  clearSessionCookie,
};

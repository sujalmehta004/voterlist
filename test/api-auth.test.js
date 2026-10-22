const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, hasValidSession, setSessionCookie } = require('../lib/auth');
const authApi = require('../api/auth');
const recordsApi = require('../api/records');
const checkStatusApi = require('../api/check-status');
const publicRecordApi = require('../api/public-record');
const voterSearchApi = require('../api/voter-search');

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) {
      try {
        this.body = JSON.parse(body);
      } catch {
        this.body = body;
      }
      return this;
    },
  };
}

async function invoke(handler, req) {
  const res = mockResponse();
  await handler(req, res);
  return res;
}

test('signed admin session cookie is accepted only with its signature', () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const res = mockResponse();
  setSessionCookie(res, createSession());
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  assert.equal(hasValidSession({ headers: { cookie } }), true);
  assert.equal(hasValidSession({ headers: { cookie: 'voterlist_session=invalid.payload' } }), false);
  assert.equal(hasValidSession({ headers: {} }), false);
});

test('management APIs reject requests without an admin session', async () => {
  const request = { method: 'POST', url: '/api/check-status', headers: {}, body: {} };
  assert.equal((await invoke(recordsApi, { ...request, method: 'GET', url: '/api/records' })).statusCode, 401);
  assert.equal((await invoke(checkStatusApi, request)).statusCode, 401);
  assert.equal((await invoke(voterSearchApi, request)).statusCode, 401);
  assert.equal((await invoke(authApi, { ...request, method: 'PUT', url: '/api/auth' })).statusCode, 401);
});

test('auth status reports unauthenticated without connecting to the database', async () => {
  const response = await invoke(authApi, { method: 'GET', headers: {} });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { authenticated: false });
});

test('password changes require matching valid new-password fields', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const cookie = cookieResponse.headers['Set-Cookie'].split(';')[0];
  const request = {
    method: 'PUT',
    url: '/api/auth',
    headers: { cookie },
    body: { currentPassword: 'current', newPassword: 'short', confirmPassword: 'short' },
  };

  const shortPassword = await invoke(authApi, request);
  assert.equal(shortPassword.statusCode, 400);
  assert.match(shortPassword.body.error, /at least 8 characters/);

  const mismatch = await invoke(authApi, {
    ...request,
    body: { currentPassword: 'current', newPassword: 'long-enough', confirmPassword: 'different' },
  });
  assert.equal(mismatch.statusCode, 400);
  assert.match(mismatch.body.error, /do not match/);
});

test('invalid public verification codes do not query MongoDB', async () => {
  const response = await invoke(publicRecordApi, {
    method: 'GET',
    url: '/api/public-record?code=not-a-code',
    headers: { host: 'localhost' },
  });
  assert.equal(response.statusCode, 404);
});

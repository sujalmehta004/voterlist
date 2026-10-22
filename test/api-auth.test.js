const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, hasValidSession, setSessionCookie } = require('../lib/auth');
const authApi = require('../api/auth');
const workspaceSettingsApi = require('../api/workspace-settings');
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
  assert.equal((await invoke(workspaceSettingsApi, {
    ...request,
    method: 'GET',
    url: '/api/workspace-settings',
  })).statusCode, 401);
  assert.equal((await invoke(workspaceSettingsApi, {
    ...request,
    method: 'POST',
    url: '/api/workspace-settings',
  })).statusCode, 401);
});

test('workspace settings require valid visibility values and keep one tab visible', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const cookie = cookieResponse.headers['Set-Cookie'].split(';')[0];
  const request = {
    method: 'PUT',
    url: '/api/workspace-settings',
    headers: { cookie },
    body: { hideEntryTab: true, hideOldEntryTab: true, hideDatabaseTab: true },
  };

  const bothHidden = await invoke(workspaceSettingsApi, request);
  assert.equal(bothHidden.statusCode, 400);
  assert.match(bothHidden.body.error, /at least one workspace tab/i);

  const invalidValues = await invoke(workspaceSettingsApi, {
    ...request,
    body: { hideEntryTab: 'true', hideOldEntryTab: false, hideDatabaseTab: false },
  });
  assert.equal(invalidValues.statusCode, 400);
  assert.match(invalidValues.body.error, /choose whether to hide/i);

});

test('workspace settings password verification requires a password', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const cookie = cookieResponse.headers['Set-Cookie'].split(';')[0];
  const response = await invoke(workspaceSettingsApi, {
    method: 'POST',
    url: '/api/workspace-settings',
    headers: { cookie },
    body: {},
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /enter the admin password/i);
});

test('auth status reports unauthenticated without connecting to the database', async () => {
  const response = await invoke(authApi, { method: 'GET', headers: {} });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { authenticated: false });
});

test('login reports missing deployment configuration without attempting database access', async () => {
  const previousMongoUri = process.env.MONGODB_URI;
  const previousSessionSecret = process.env.VOTERLIST_SESSION_SECRET;
  process.env.MONGODB_URI = 'mongodb://unused.example/test';
  delete process.env.VOTERLIST_SESSION_SECRET;
  try {
    const missingSessionSecret = await invoke(authApi, {
      method: 'POST',
      url: '/api/auth',
      headers: {},
      body: { password: 'admin-password' },
    });
    assert.equal(missingSessionSecret.statusCode, 503);
    assert.match(missingSessionSecret.body.error, /VOTERLIST_SESSION_SECRET/);

    process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
    delete process.env.MONGODB_URI;
    const missingMongoUri = await invoke(authApi, {
      method: 'POST',
      url: '/api/auth',
      headers: {},
      body: { password: 'admin-password' },
    });
    assert.equal(missingMongoUri.statusCode, 503);
    assert.match(missingMongoUri.body.error, /database access is not configured/i);
  } finally {
    if (previousMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousMongoUri;
    if (previousSessionSecret === undefined) delete process.env.VOTERLIST_SESSION_SECRET;
    else process.env.VOTERLIST_SESSION_SECRET = previousSessionSecret;
  }
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

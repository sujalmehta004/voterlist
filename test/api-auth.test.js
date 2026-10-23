const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  createSession,
  verifySessionToken,
  hasValidSession,
  setSessionCookie,
} = require('../lib/auth');
const Config = require('../lib/models/Config');
const VoterlistData = require('../lib/models/VoterlistData');
const VoterlistHistory = require('../lib/models/VoterlistHistory');
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

async function withSessionDatabase(callback, sessionVersion = 0, adminPassword = '') {
  const previousMongoUri = process.env.MONGODB_URI;
  const originalConnect = mongoose.connect;
  const originalFindOne = Config.findOne;
  const databaseCache = global.voterlistMongoose;
  const previousConnection = databaseCache?.connection;
  const previousPromise = databaseCache?.promise;
  process.env.MONGODB_URI = 'mongodb://mocked.example/test';
  if (databaseCache) {
    databaseCache.connection = null;
    databaseCache.promise = null;
  }
  mongoose.connect = async () => ({});
  Config.findOne = () => ({
    select() { return this; },
    async lean() { return { sessionVersion, adminUnlockPassword: adminPassword }; },
  });
  try {
    return await callback();
  } finally {
    mongoose.connect = originalConnect;
    Config.findOne = originalFindOne;
    if (databaseCache) {
      databaseCache.connection = previousConnection;
      databaseCache.promise = previousPromise;
    }
    if (previousMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousMongoUri;
  }
}

test('signed persistent admin session is accepted only with its signature and current password version', () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const res = mockResponse();
  setSessionCookie(res, createSession(4));
  assert.match(res.headers['Set-Cookie'], /Max-Age=34560000/);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  const request = { headers: { cookie } };
  assert.equal(verifySessionToken(request, 4).sessionVersion, 4);
  assert.equal(verifySessionToken(request, 5), null);
  assert.equal(verifySessionToken({ headers: { cookie: 'voterlist_session=invalid.payload' } }), null);
  assert.equal(verifySessionToken({ headers: {} }), null);
});

test('active sessions renew and password version changes revoke existing tokens', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const originalResponse = mockResponse();
  setSessionCookie(originalResponse, createSession(7));
  const request = { headers: { cookie: originalResponse.headers['Set-Cookie'].split(';')[0] } };
  const renewedResponse = mockResponse();

  assert.equal(await withSessionDatabase(
    () => hasValidSession(request, renewedResponse),
    7,
  ), true);
  const renewedCookie = renewedResponse.headers['Set-Cookie'].split(';')[0];
  assert.equal(verifySessionToken({ headers: { cookie: renewedCookie } }, 7).sessionVersion, 7);
  assert.equal(await withSessionDatabase(() => hasValidSession(request), 8), false);
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
  assert.equal((await invoke(recordsApi, {
    ...request,
    method: 'DELETE',
    url: '/api/records',
    body: { recordId: '507f1f77bcf86cd799439011', password: 'admin-password' },
  })).statusCode, 401);
});

test('record deletion requires the admin password on every request', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const request = {
    method: 'DELETE',
    url: '/api/records',
    headers: { cookie: cookieResponse.headers['Set-Cookie'].split(';')[0] },
    body: { recordId: '507f1f77bcf86cd799439011', password: '' },
  };

  await withSessionDatabase(async () => {
    const missingPassword = await invoke(recordsApi, request);
    assert.equal(missingPassword.statusCode, 400);
    assert.match(missingPassword.body.error, /enter the admin password/i);
  });

  await withSessionDatabase(async () => {
    const wrongPassword = await invoke(recordsApi, {
      ...request,
      body: {
        recordIds: [
          '507f1f77bcf86cd799439011',
          '507f1f77bcf86cd799439012',
        ],
        password: 'incorrect-password',
      },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.match(wrongPassword.body.error, /password is incorrect/i);
  }, 0, 'correct-admin-password');
});

test('record deletion removes selected records and their history after password verification', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const recordIds = [
    '507f1f77bcf86cd799439011',
    '507f1f77bcf86cd799439012',
  ];
  const request = {
    method: 'DELETE',
    url: '/api/records',
    headers: { cookie: cookieResponse.headers['Set-Cookie'].split(';')[0] },
    body: { recordIds, password: 'correct-admin-password' },
  };
  const originalFind = VoterlistData.find;
  const originalDeleteRecords = VoterlistData.deleteMany;
  const originalDeleteHistory = VoterlistHistory.deleteMany;
  let removedRecordIds;
  let removedHistoryIds;
  VoterlistData.find = () => ({
    select() { return this; },
    async lean() { return recordIds.map((_id) => ({ _id })); },
  });
  VoterlistData.deleteMany = async ({ _id }) => {
    removedRecordIds = _id.$in;
    return { deletedCount: recordIds.length };
  };
  VoterlistHistory.deleteMany = async ({ recordId }) => {
    removedHistoryIds = recordId.$in;
    return { deletedCount: recordIds.length };
  };

  try {
    const response = await withSessionDatabase(
      () => invoke(recordsApi, request),
      0,
      'correct-admin-password',
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { deleted: true, recordIds });
    assert.deepEqual(removedRecordIds, recordIds);
    assert.deepEqual(removedHistoryIds, recordIds);
  } finally {
    VoterlistData.find = originalFind;
    VoterlistData.deleteMany = originalDeleteRecords;
    VoterlistHistory.deleteMany = originalDeleteHistory;
  }
});

test('workspace settings require valid visibility values and keep one tab visible', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const cookie = cookieResponse.headers['Set-Cookie'].split(';')[0];
  await withSessionDatabase(async () => {
    const request = {
      method: 'PUT',
      url: '/api/workspace-settings',
      headers: { cookie },
      body: {
        hideEntryTab: true,
        hideOldEntryTab: true,
        hideDatabaseTab: true,
        hidePrintMultipleButton: false,
        hideDeleteMultipleButton: false,
        hideRecordDeleteButton: false,
        automaticStatusRetries: 3,
      },
    };

    const bothHidden = await invoke(workspaceSettingsApi, request);
    assert.equal(bothHidden.statusCode, 400);
    assert.match(bothHidden.body.error, /at least one workspace tab/i);

    const invalidValues = await invoke(workspaceSettingsApi, {
      ...request,
      body: {
        hideEntryTab: 'true',
        hideOldEntryTab: false,
        hideDatabaseTab: false,
        hidePrintMultipleButton: false,
        hideDeleteMultipleButton: false,
        hideRecordDeleteButton: false,
        automaticStatusRetries: 3,
      },
    });
    assert.equal(invalidValues.statusCode, 400);
    assert.match(invalidValues.body.error, /visibility settings or automatic retry count/i);

    for (const automaticStatusRetries of [0, 16, 1.5, '3']) {
      const invalidRetryCount = await invoke(workspaceSettingsApi, {
        ...request,
        body: {
          hideEntryTab: false,
          hideOldEntryTab: false,
          hideDatabaseTab: false,
          hidePrintMultipleButton: false,
          hideDeleteMultipleButton: false,
          hideRecordDeleteButton: false,
          automaticStatusRetries,
        },
      });
      assert.equal(invalidRetryCount.statusCode, 400);
    }
  });
});

test('workspace settings password verification requires a password', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const cookie = cookieResponse.headers['Set-Cookie'].split(';')[0];
  const response = await withSessionDatabase(() => invoke(workspaceSettingsApi, {
    method: 'POST',
    url: '/api/workspace-settings',
    headers: { cookie },
    body: {},
  }));

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

  await withSessionDatabase(async () => {
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
});

test('invalid public verification codes do not query MongoDB', async () => {
  const response = await invoke(publicRecordApi, {
    method: 'GET',
    url: '/api/public-record?code=not-a-code',
    headers: { host: 'localhost' },
  });
  assert.equal(response.statusCode, 404);
});

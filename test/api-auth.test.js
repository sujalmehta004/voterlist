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
const verificationManifestApi = require('../api/verification-manifest');
const importRecordsApi = require('../api/import-records');
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
  assert.equal((await invoke(importRecordsApi, { ...request, method: 'POST', url: '/api/import-records' })).statusCode, 401);
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

test('record import adds new NINs, updates changed records with history, and skips file duplicates', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const originalStartSession = mongoose.startSession;
  const originalFind = VoterlistData.find;
  const originalFindOne = VoterlistData.findOne;
  const originalCreate = VoterlistData.create;
  const originalSaveRecordUpdate = require('../lib/voterlist-history').saveRecordUpdate;
  const existingNin = '123-456-789-0';
  const currentRecord = {
    _id: 'existing-record-id',
    nin: existingNin,
    dobAd: '1990-01-02',
    dobBs: '1946-09-18',
    fullName: 'OLD NAME',
    mobile: '9800000000',
    status: 'DONE',
    notes: '',
    abedanNumber: '',
    voterListNumber: '',
    qrToken: '9'.repeat(32),
    async save() {},
  };
  const unchangedRecord = {
    _id: 'unchanged-record-id',
    nin: '345-678-901-2',
    dobAd: '1990-01-02',
    dobBs: '1946-09-18',
    fullName: 'SAME NAME',
    mobile: '9830000000',
    status: 'DONE',
    notes: '',
    abedanNumber: '',
    voterListNumber: '',
    qrToken: '5'.repeat(32),
    async save() { throw new Error('Unchanged records must not be saved.'); },
  };
  const backup = {
    application: 'Voterlist System',
    formatVersion: 1,
    recordCount: 4,
    records: [
      {
        nin: existingNin,
        dobAd: '1990-01-02',
        dobBs: '1946-09-18',
        fullName: 'EXISTING NAME',
        mobile: '9800000000',
        status: 'DONE',
        notes: '',
        qrToken: '1'.repeat(32),
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-02T00:00:00.000Z',
      },
      {
        nin: '234-567-890-1',
        dobAd: '1990-01-02',
        dobBs: '1946-09-18',
        fullName: 'NEW NAME',
        mobile: '9810000000',
        status: 'NOT ONLINE',
        notes: '',
        qrToken: '2'.repeat(32),
        createdAt: '2021-01-01T00:00:00.000Z',
        updatedAt: '2021-01-02T00:00:00.000Z',
      },
      {
        nin: '234-567-890-1',
        dobAd: '1990-01-02',
        dobBs: '1946-09-18',
        fullName: 'DUPLICATE NAME',
        mobile: '9820000000',
        status: 'PENDING',
        notes: '',
        qrToken: '3'.repeat(32),
        createdAt: '2021-01-01T00:00:00.000Z',
        updatedAt: '2021-01-02T00:00:00.000Z',
      },
      {
        nin: unchangedRecord.nin,
        dobAd: unchangedRecord.dobAd,
        dobBs: unchangedRecord.dobBs,
        fullName: unchangedRecord.fullName,
        mobile: unchangedRecord.mobile,
        status: unchangedRecord.status,
        notes: unchangedRecord.notes,
        abedanNumber: unchangedRecord.abedanNumber,
        voterListNumber: unchangedRecord.voterListNumber,
        qrToken: '6'.repeat(32),
        createdAt: '2021-01-01T00:00:00.000Z',
        updatedAt: '2021-01-02T00:00:00.000Z',
      },
    ],
  };
  let insertedRecords = [];
  let savedUpdate = null;
  mongoose.startSession = async () => ({
    async withTransaction(callback) { return callback(); },
    async endSession() {},
  });
  VoterlistData.find = (filter) => ({
    select() { return this; },
    session() { return this; },
    async lean() {
      if (filter.nin) return [currentRecord, unchangedRecord];
      return [];
    },
  });
  VoterlistData.findOne = () => ({ session: async () => currentRecord });
  VoterlistData.create = async (records) => {
    insertedRecords = records;
    return records;
  };
  require('../lib/voterlist-history').saveRecordUpdate = async (recordId, changes, options) => {
    savedUpdate = { recordId, changes, options };
  };

  try {
    const response = await withSessionDatabase(() => invoke(importRecordsApi, {
      method: 'POST',
      url: '/api/import-records',
      headers: { cookie: cookieResponse.headers['Set-Cookie'].split(';')[0] },
      body: {
        action: 'import',
        mode: 'add-and-update',
        backup,
      },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { imported: true, added: 1, updated: 1, unchanged: 1, duplicateFile: 1, invalid: 0 });
    assert.equal(insertedRecords.length, 1);
    assert.equal(insertedRecords[0].nin, '234-567-890-1');
    assert.equal(insertedRecords[0].fullName, 'NEW NAME');
    assert.equal(currentRecord.fullName, 'EXISTING NAME');
    assert.equal(unchangedRecord.fullName, 'SAME NAME');
    assert.equal(savedUpdate.recordId, 'existing-record-id');
    assert.deepEqual(savedUpdate.changes, [
      { field: 'fullName', before: 'OLD NAME', after: 'EXISTING NAME' },
    ]);
    assert.ok(savedUpdate.options.session);
  } finally {
    mongoose.startSession = originalStartSession;
    VoterlistData.find = originalFind;
    VoterlistData.findOne = originalFindOne;
    VoterlistData.create = originalCreate;
    require('../lib/voterlist-history').saveRecordUpdate = originalSaveRecordUpdate;
  }
});

test('record import preview reports changed, unchanged, duplicate, and invalid records', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const originalFind = VoterlistData.find;
  VoterlistData.find = (filter) => ({
    select() { return this; },
    async lean() {
      if (filter.nin) return [
        { nin: '123-456-789-0', fullName: 'TEST VOTER', mobile: '9800000000', dobAd: '1989-01-02', dobBs: '1946-09-18', status: 'DONE' },
        {
          nin: '345-678-901-2',
          dobAd: '1990-01-02',
          dobBs: '1946-09-18',
          fullName: 'UNCHANGED VOTER',
          mobile: '9820000000',
          status: 'DONE',
          notes: 'same',
          abedanNumber: 'A-1',
          voterListNumber: 'V-1',
          qrToken: '4'.repeat(32),
        },
      ];
      return [];
    },
  });

  try {
    const response = await withSessionDatabase(() => invoke(importRecordsApi, {
      method: 'POST',
      url: '/api/import-records',
      headers: { cookie: cookieResponse.headers['Set-Cookie'].split(';')[0] },
      body: {
        action: 'preview',
        backup: {
          application: 'Voterlist System',
          formatVersion: 1,
          recordCount: 4,
          records: [{
            nin: '123-456-789-0',
            dobAd: '1990-01-02',
            dobBs: '1946-09-18',
            fullName: 'TEST VOTER',
            mobile: '9800000000',
            status: 'NOT ONLINE',
            notes: '',
            qrToken: '1'.repeat(32),
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
          }, {
            nin: '123-456-789-0',
            dobAd: '1990-01-02',
            dobBs: '1946-09-18',
            fullName: 'DUPLICATE',
            mobile: '9800000000',
            status: 'NOT ONLINE',
            qrToken: '2'.repeat(32),
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
          }, {
            nin: '234-567-890-1',
            dobAd: '1990-01-02',
            dobBs: '1946-09-18',
            fullName: 'NEW RECORD',
            mobile: '9810000000',
            status: 'UNKNOWN',
            qrToken: '3'.repeat(32),
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
          }, {
            nin: '345-678-901-2',
            dobAd: '1990-01-02',
            dobBs: '1946-09-18',
            fullName: 'UNCHANGED VOTER',
            mobile: '9820000000',
            status: 'DONE',
            notes: 'same',
            abedanNumber: 'A-1',
            voterListNumber: 'V-1',
            qrToken: '4'.repeat(32),
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
          }],
        },
      },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.counts, { total: 4, new: 0, changed: 1, unchanged: 1, duplicateFile: 1, invalid: 1 });
    assert.deepEqual(response.body.items.map((item) => item.category), ['changed', 'duplicate-file', 'invalid', 'unchanged']);
    assert.match(response.body.items[0].reason, /first name or date of birth differs/i);
    assert.ok(response.body.items[0].changes.some((change) => change.field === 'dobAd'));
  } finally {
    VoterlistData.find = originalFind;
  }
});

test('record import rejects any mode that could overwrite or remove existing records', async () => {
  process.env.VOTERLIST_SESSION_SECRET = 'test-secret-value-that-is-at-least-thirty-two-characters';
  const cookieResponse = mockResponse();
  setSessionCookie(cookieResponse, createSession());
  const response = await withSessionDatabase(() => invoke(importRecordsApi, {
    method: 'POST',
    url: '/api/import-records',
    headers: { cookie: cookieResponse.headers['Set-Cookie'].split(';')[0] },
    body: { action: 'import', mode: 'replace', backup: {} },
  }));

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /cannot be removed/i);
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
        hideSinglePrintButton: false,
        hideDeleteMultipleButton: false,
        hideRecordDeleteButton: false,
        hideVisitRecordQrLink: false,
        automaticStatusRetries: 3,
        checkAllConcurrency: 5,
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
        hideSinglePrintButton: false,
        hideDeleteMultipleButton: false,
        hideRecordDeleteButton: false,
        hideVisitRecordQrLink: false,
        automaticStatusRetries: 3,
        checkAllConcurrency: 5,
      },
    });
    assert.equal(invalidValues.statusCode, 400);
    assert.match(invalidValues.body.error, /visibility, automatic retry, or Check All concurrency settings/i);

    for (const automaticStatusRetries of [0, 16, 1.5, '3']) {
      const invalidRetryCount = await invoke(workspaceSettingsApi, {
        ...request,
        body: {
          hideEntryTab: false,
          hideOldEntryTab: false,
          hideDatabaseTab: false,
          hidePrintMultipleButton: false,
          hideSinglePrintButton: false,
          hideDeleteMultipleButton: false,
          hideRecordDeleteButton: false,
          hideVisitRecordQrLink: false,
          automaticStatusRetries,
          checkAllConcurrency: 5,
        },
      });
      assert.equal(invalidRetryCount.statusCode, 400);
    }

    for (const checkAllConcurrency of [0, 16, 1.5, '5']) {
      const invalidConcurrency = await invoke(workspaceSettingsApi, {
        ...request,
        body: {
          hideEntryTab: false,
          hideOldEntryTab: false,
          hideDatabaseTab: false,
          hidePrintMultipleButton: false,
          hideSinglePrintButton: false,
          hideDeleteMultipleButton: false,
          hideRecordDeleteButton: false,
          hideVisitRecordQrLink: false,
          automaticStatusRetries: 3,
          checkAllConcurrency,
        },
      });
      assert.equal(invalidConcurrency.statusCode, 400);
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

test('verification app manifest launches only the scanned QR record', async () => {
  const code = 'a'.repeat(32);
  const response = await invoke(verificationManifestApi, {
    method: 'GET',
    url: `/api/verification-manifest?code=${code}`,
    headers: { host: 'localhost' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.start_url, `/verify/${code}`);
  assert.equal(response.body.scope, `/verify/${code}`);
  assert.equal(response.body.id, `/verify/${code}`);
  assert.equal(response.body.display, 'standalone');
});

test('verification app manifest rejects invalid QR codes', async () => {
  const response = await invoke(verificationManifestApi, {
    method: 'GET',
    url: '/api/verification-manifest?code=invalid',
    headers: { host: 'localhost' },
  });
  assert.equal(response.statusCode, 400);
});

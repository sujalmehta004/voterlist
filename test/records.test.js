const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeNin,
  isValidFullName,
  isValidIsoDate,
  firstNameFromFullName,
  extractVoterIdentifiers,
  extractSearchMessage,
  statusFromSearch,
  isVoterServerUnavailable,
  findVoterServerUnavailableMessage,
  containsPortraitData,
} = require('../lib/records');
const {
  mergeHistoryDocuments,
  responseHash,
  uniqueResponses,
} = require('../lib/voterlist-history');

test('normalizes a 10-digit NIN', () => {
  assert.equal(normalizeNin('615-385-908-6'), '615-385-908-6');
  assert.equal(normalizeNin('6153859086'), '615-385-908-6');
  assert.equal(normalizeNin('12345'), '');
});

test('accepts names with letters, spaces, periods, and Nepali diacritics only', () => {
  assert.equal(isValidFullName('Sujal Mehta'), true);
  assert.equal(isValidFullName('S. Mehta'), true);
  assert.equal(isValidFullName('राम बहादुर'), true);
  assert.equal(isValidFullName('राम बहादुर थापा'), true);
  assert.equal(isValidFullName("Sujal O'Mehta"), false);
  assert.equal(isValidFullName('Sujal-Mehta'), false);
  assert.equal(isValidFullName('...'), false);
});

test('validates calendar dates, not just date strings', () => {
  assert.equal(isValidIsoDate('2000-02-29'), true);
  assert.equal(isValidIsoDate('2001-02-29'), false);
  assert.equal(isValidIsoDate('2000-13-01'), false);
});

test('gets first name from saved full name', () => {
  assert.equal(firstNameFromFullName('  SUJAL   MEHTA '), 'SUJAL');
  assert.equal(firstNameFromFullName(''), '');
});

test('finds voter-list and Abedan identifiers in nested search data', () => {
  assert.deepEqual(
    extractVoterIdentifiers({ person: { VoterListNumber: 'VL-123' }, result: { abedanNo: 9876 } }),
    { voterListNumber: 'VL-123', abedanNumber: '9876' },
  );
  assert.deepEqual(
    extractVoterIdentifiers({ NIN: '6153859086', status: 'success', voterListNumber: '0' }),
    { voterListNumber: '', abedanNumber: '' },
  );
  assert.deepEqual(
    extractVoterIdentifiers({ VoterListNo: '31315829' }),
    { voterListNumber: '31315829', abedanNumber: '' },
  );
});

test('extracts a voter-list number from a Nepali success message', () => {
  const data = {
    success: true,
    data: { message: 'तपाईको निवेदन स्वीकृत भइसकेको छ । तपाईको मतदाता नं 31315829 रहेको छ ।' },
  };
  assert.deepEqual(extractVoterIdentifiers(data), {
    voterListNumber: '31315829',
    abedanNumber: '',
  });
  assert.deepEqual(
    extractVoterIdentifiers({ message: 'तपाईको निवेदन स्वीकृत भइसकेको छ । तपाईको मतदाता नं 31339269 रहेको छ ।' }),
    { voterListNumber: '31339269', abedanNumber: '' },
  );
  assert.equal(extractSearchMessage(data), 'तपाईको निवेदन स्वीकृत भइसकेको छ । तपाईको मतदाता नं 31315829 रहेको छ ।');
});

test('extracts an Abedan number and Nepali digit voter-list numbers from messages', () => {
  assert.deepEqual(
    extractVoterIdentifiers({ message: 'तपाईको आवेदन नं १२३४५६ रहेको छ ।' }),
    { voterListNumber: '', abedanNumber: '123456' },
  );
  assert.deepEqual(
    extractVoterIdentifiers({ message: 'मतदाता नं ३१३१५८२९ रहेको छ ।' }),
    { voterListNumber: '31315829', abedanNumber: '' },
  );
  assert.deepEqual(
    extractVoterIdentifiers({ message: 'Abedan number: AB-123456' }),
    { voterListNumber: '', abedanNumber: 'AB-123456' },
  );
});

test('keeps successful searches without a number PENDING and failed searches NOT ONLINE', () => {
  const pendingMessage = 'Search succeeded but no voter-list / Abedan number was returned; marked PENDING.';
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: '' }), 'PENDING');
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: '' }, '', { portraitReceived: true }), 'PENDING');
  assert.equal(statusFromSearch(false, { voterListNumber: '', abedanNumber: '' }), 'NOT ONLINE');
  assert.equal(statusFromSearch(true, { voterListNumber: '31315829', abedanNumber: '' }), 'DONE');
  assert.equal(statusFromSearch(false, { voterListNumber: '31339269', abedanNumber: '' }), 'DONE');
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: 'AB-123456' }), 'DONE');
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: '' }, 'no record found.please verify nin, dob, and first name'), 'NOT ONLINE');
  assert.deepEqual(extractVoterIdentifiers({ message: pendingMessage }), { voterListNumber: '', abedanNumber: '' });
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: '' }, pendingMessage), 'PENDING');
});

test('recognizes nested voterlist outages and preserves the existing status', () => {
  const outage = 'NID सर्भरबाट डेटा प्राप्त हुन सकेन। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।';
  const ninOutage = 'NIN सर्भरबाट डेटा प्राप्त हुन सकेन। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।';
  assert.equal(isVoterServerUnavailable(outage), true);
  assert.equal(isVoterServerUnavailable(ninOutage), true);
  assert.equal(isVoterServerUnavailable('No record found'), false);
  const nestedResponse = {
    message: 'The search could not be completed.',
    data: { error: ninOutage },
  };
  const outageMessage = findVoterServerUnavailableMessage(nestedResponse);
  assert.equal(outageMessage, ninOutage);
  assert.equal(
    statusFromSearch(false, { voterListNumber: '', abedanNumber: '' }, outageMessage, { currentStatus: 'DONE' }),
    'DONE',
  );
  assert.equal(
    statusFromSearch(false, { voterListNumber: '', abedanNumber: '' }, outageMessage, { currentStatus: 'NOT ONLINE' }),
    'NOT ONLINE',
  );
  assert.equal(
    statusFromSearch(false, { voterListNumber: '', abedanNumber: '' }, outageMessage, { currentStatus: 'PENDING' }),
    'PENDING',
  );
});

test('detects portrait responses without retaining their image payload in the sanitized record', () => {
  const response = {
    success: true,
    data: {
      person: { PortraitImage: '/9j/large-private-image-data' },
      VoterListNo: '31315829',
      message: 'Activated',
    },
  };
  assert.equal(containsPortraitData(response), true);
  const identifiers = extractVoterIdentifiers(response);
  assert.equal(identifiers.voterListNumber, '31315829');
  assert.equal(statusFromSearch(true, identifiers), 'DONE');
  assert.equal(containsPortraitData({ success: true, data: { message: 'No portrait' } }), false);
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: '' }), 'PENDING');
  assert.equal(statusFromSearch(true, { voterListNumber: '', abedanNumber: '' }), 'PENDING');
});

test('consolidates repeated check history to unique responses and preserves edit history', () => {
  const response = { httpStatus: 404, body: { error: 'no record found' } };
  const history = mergeHistoryDocuments([
    {
      action: 'STATUS_CHECK',
      changedAt: new Date('2026-01-01T10:00:00Z'),
      responseHash: 'same-response',
      fullResponse: response,
    },
    {
      action: 'STATUS_CHECK',
      changedAt: new Date('2026-01-02T10:00:00Z'),
      responseHash: 'same-response',
      fullResponse: response,
    },
    {
      action: 'UPDATED',
      changedAt: new Date('2026-01-03T10:00:00Z'),
      changes: [{ field: 'notes', before: '', after: 'Updated' }],
    },
  ]);

  assert.equal(history.requestCount, 2);
  assert.equal(history.responses.length, 1);
  assert.equal(history.responses[0].fullResponse.body.error, 'no record found');
  assert.equal(history.updates.length, 1);
  assert.equal(history.updates[0].changes[0].after, 'Updated');

  const mergedAfterMigration = mergeHistoryDocuments([
    {
      requestCount: 2,
      responses: [{ responseHash: 'same-response', fullResponse: response }],
      updates: [{
        changedAt: new Date('2026-01-03T10:00:00Z'),
        changes: [{ field: 'notes', before: '', after: 'Updated' }],
      }],
    },
    {
      action: 'STATUS_CHECK',
      changedAt: new Date('2026-01-01T10:00:00Z'),
      responseHash: 'same-response',
      fullResponse: response,
    },
    {
      action: 'UPDATED',
      changedAt: new Date('2026-01-03T10:00:00Z'),
      changes: [{ field: 'notes', before: '', after: 'Updated' }],
    },
  ]);

  assert.equal(mergedAfterMigration.requestCount, 2);
  assert.equal(mergedAfterMigration.responses.length, 1);
  assert.equal(mergedAfterMigration.updates.length, 1);

  const differentlyOrdered = mergeHistoryDocuments([
    {
      action: 'STATUS_CHECK',
      fullResponse: { httpStatus: 404, body: { error: 'no record found' } },
    },
    {
      action: 'STATUS_CHECK',
      fullResponse: { body: { error: 'no record found' }, httpStatus: 404 },
    },
  ]);
  assert.equal(differentlyOrdered.responses.length, 1);
});

test('deduplicates saved response messages independently of HTTP status and payload metadata', () => {
  const message = 'NIN सर्भरबाट डेटा प्राप्त हुन सकेन। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।';
  const firstResponse = {
    httpStatus: 200,
    body: { message, traceId: 'first-request' },
  };
  const repeatedResponse = {
    httpStatus: 503,
    body: { traceId: 'second-request', message },
  };
  assert.equal(responseHash(firstResponse), responseHash(repeatedResponse));

  const unique = uniqueResponses([
    { changedAt: new Date('2026-01-02T10:00:00Z'), fullResponse: repeatedResponse },
    { changedAt: new Date('2026-01-01T10:00:00Z'), fullResponse: firstResponse },
  ]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].fullResponse.body.traceId, 'second-request');

  const merged = mergeHistoryDocuments([
    {
      action: 'STATUS_CHECK',
      changedAt: new Date('2026-01-01T10:00:00Z'),
      fullResponse: firstResponse,
    },
    {
      action: 'STATUS_CHECK',
      changedAt: new Date('2026-01-02T10:00:00Z'),
      fullResponse: repeatedResponse,
    },
  ]);
  assert.equal(merged.responses.length, 1);
});

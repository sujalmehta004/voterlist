const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareVoterlistImport } = require('../lib/voterlist-import');

function validBackup(records = [validRecord()]) {
  return {
    application: 'Voterlist System',
    formatVersion: 1,
    recordCount: records.length,
    records,
  };
}

function validRecord(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    nin: '123-456-789-0',
    dobAd: '1990-01-02',
    dobBs: '1946-09-18',
    fullName: 'TEST VOTER',
    mobile: '9800000000',
    status: 'NOT ONLINE',
    notes: '',
    abedanNumber: '',
    voterListNumber: '',
    qrToken: '12345678901234567890123456789012',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('prepares a valid Voterlist backup while discarding unrelated export fields', () => {
  const [record] = prepareVoterlistImport(validBackup([validRecord({
    statusCheckCount: 12,
    uniqueSearchResponses: [{ message: 'not part of record data' }],
  })]));
  assert.equal(record.nin, '123-456-789-0');
  assert.equal(record.fullName, 'TEST VOTER');
  assert.equal(record.createdAt.toISOString(), '2020-01-01T00:00:00.000Z');
  assert.equal(Object.hasOwn(record, 'statusCheckCount'), false);
  assert.equal(Object.hasOwn(record, 'uniqueSearchResponses'), false);
});

test('rejects backups with mismatched record counts or duplicate NINs', () => {
  assert.throws(
    () => prepareVoterlistImport({ ...validBackup(), recordCount: 3 }),
    /matching record count/i,
  );
  assert.throws(
    () => prepareVoterlistImport(validBackup([validRecord(), validRecord({
      _id: '507f1f77bcf86cd799439012',
      qrToken: '22345678901234567890123456789012',
    })])),
    /duplicate NINs/i,
  );
});

test('rejects records that violate stored voter data requirements', () => {
  for (const record of [
    validRecord({ mobile: '980' }),
    validRecord({ status: 'UNKNOWN' }),
    validRecord({ qrToken: 'invalid' }),
    validRecord({ dobAd: '1990-02-30' }),
  ]) {
    assert.throws(() => prepareVoterlistImport(validBackup([record])));
  }
});

const {
  normalizeNin,
  normalizeFullName,
  isValidFullName,
  isValidIsoDate,
} = require('./records');

const MAX_IMPORT_RECORDS = 1000;
const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function importError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateBackupEnvelope(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)
    || backup.application !== 'Voterlist System'
    || backup.formatVersion !== 1
    || !Array.isArray(backup.records)
    || backup.records.length < 1
    || backup.records.length > MAX_IMPORT_RECORDS
    || backup.recordCount !== backup.records.length) {
    throw importError('Choose a valid Voterlist System JSON backup with a matching record count.');
  }
}

function parseImportTimestamp(value, field, recordNumber) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw importError(`Record ${recordNumber} has an invalid ${field} timestamp.`);
  }
  return date;
}

function prepareRecord(source, index) {
  const recordNumber = index + 1;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw importError(`Record ${recordNumber} is not a valid record object.`);
  }

  const rawNin = String(source.nin || '').trim();
  if (!/^[\d-]+$/.test(rawNin)) {
    throw importError(`Record ${recordNumber} has an invalid NIN.`);
  }
  const nin = normalizeNin(rawNin);
  if (!nin) throw importError(`Record ${recordNumber} must have a 10-digit NIN.`);

  const fullName = normalizeFullName(source.fullName);
  if (!isValidFullName(fullName) || fullName.length > 160) {
    throw importError(`Record ${recordNumber} has an invalid full name.`);
  }
  const dobAd = String(source.dobAd || '').trim();
  const dobBs = String(source.dobBs || '').trim();
  if (!isValidIsoDate(dobAd) || !/^\d{4}-\d{2}-\d{2}$/.test(dobBs)) {
    throw importError(`Record ${recordNumber} has an invalid date of birth.`);
  }
  const mobile = String(source.mobile || '').trim();
  if (!/^\d{10}$/.test(mobile)) {
    throw importError(`Record ${recordNumber} must have a 10-digit mobile number.`);
  }
  const status = String(source.status || '').trim().toUpperCase();
  if (!['NOT ONLINE', 'PENDING', 'DONE'].includes(status)) {
    throw importError(`Record ${recordNumber} has an invalid status.`);
  }
  const notes = String(source.notes || '').trim();
  if (notes.length > 2000) throw importError(`Record ${recordNumber} notes exceed 2,000 characters.`);
  const qrToken = String(source.qrToken || '').trim();
  if (!QR_TOKEN_PATTERN.test(qrToken)) {
    throw importError(`Record ${recordNumber} has an invalid QR token.`);
  }

  const record = {
    nin,
    dobAd,
    dobBs,
    fullName,
    mobile,
    status,
    notes,
    abedanNumber: String(source.abedanNumber || '').trim(),
    voterListNumber: String(source.voterListNumber || '').trim(),
    qrToken,
    createdAt: parseImportTimestamp(source.createdAt, 'createdAt', recordNumber),
    updatedAt: parseImportTimestamp(source.updatedAt, 'updatedAt', recordNumber),
  };
  if (source._id !== undefined) record._id = String(source._id);
  return record;
}

function prepareVoterlistImport(backup) {
  validateBackupEnvelope(backup);
  const nins = new Set();
  const qrTokens = new Set();
  return backup.records.map((source, index) => {
    const record = prepareRecord(source, index);
    if (nins.has(record.nin)) {
      throw importError(`The backup contains duplicate NINs (record ${index + 1}).`);
    }
    if (qrTokens.has(record.qrToken)) {
      throw importError(`The backup contains duplicate QR tokens (record ${index + 1}).`);
    }
    nins.add(record.nin);
    qrTokens.add(record.qrToken);
    return record;
  });
}

function inspectVoterlistImport(backup) {
  validateBackupEnvelope(backup);
  const seenNins = new Map();
  const seenQrTokens = new Set();
  const records = [];
  const items = [];

  backup.records.forEach((source, index) => {
    let record;
    try {
      record = prepareRecord(source, index);
    } catch (error) {
      items.push({ index, category: 'invalid', reason: error.message });
      return;
    }
    if (seenNins.has(record.nin)) {
      items.push({
        index,
        category: 'duplicate-file',
        reason: `Duplicate NIN in this file; first appears in record ${seenNins.get(record.nin) + 1}.`,
        duplicateOfIndex: seenNins.get(record.nin),
      });
      return;
    }
    seenNins.set(record.nin, index);
    if (seenQrTokens.has(record.qrToken)) {
      items.push({ index, category: 'invalid', reason: 'This QR token is repeated in the file.' });
      return;
    }
    seenQrTokens.add(record.qrToken);
    records.push({ index, record });
  });

  return { records, items };
}

module.exports = {
  MAX_IMPORT_RECORDS,
  prepareVoterlistImport,
  inspectVoterlistImport,
};

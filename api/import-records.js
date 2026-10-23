const mongoose = require('mongoose');
const connectToDatabase = require('../lib/db');
const VoterlistData = require('../lib/models/VoterlistData');
const { hasValidSession } = require('../lib/auth');
const { readJsonBody, sendJson } = require('../lib/http');
const { inspectVoterlistImport } = require('../lib/voterlist-import');
const voterlistHistory = require('../lib/voterlist-history');
const { normalizeNin, firstNameFromFullName } = require('../lib/records');

const COMPARISON_FIELDS = [
  'nin',
  'fullName',
  'dobAd',
  'dobBs',
  'mobile',
  'status',
  'abedanNumber',
  'voterListNumber',
  'notes',
  'qrToken',
  'createdAt',
  'updatedAt',
];
const IMPORTABLE_FIELDS = [
  'fullName',
  'dobAd',
  'dobBs',
  'mobile',
  'status',
  'notes',
  'abedanNumber',
  'voterListNumber',
];

function compareImportRecord(existing, imported) {
  const changes = IMPORTABLE_FIELDS
    .filter((field) => String(existing[field] ?? '') !== String(imported[field] ?? ''))
    .map((field) => ({
      field,
      before: existing[field] ?? '',
      after: imported[field] ?? '',
    }));
  const identityChanged = firstNameFromFullName(existing.fullName).toLocaleLowerCase()
    !== firstNameFromFullName(imported.fullName).toLocaleLowerCase()
    || String(existing.dobAd || '') !== imported.dobAd
    || String(existing.dobBs || '') !== imported.dobBs;
  return { changes, identityChanged };
}

function importError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function classifyImport(backup, session = null) {
  const { records, items } = inspectVoterlistImport(backup);
  const nins = records.map(({ record }) => record.nin);
  let existingQuery = VoterlistData.find({ nin: { $in: nins } })
    .select(`nin ${COMPARISON_FIELDS.filter((field) => field !== 'nin').join(' ')}`);
  if (session) existingQuery = existingQuery.session(session);
  const existingRecords = await existingQuery.lean();
  const existingByNin = new Map(existingRecords.map((record) => [normalizeNin(record.nin), record]));
  const candidateRecords = records.filter(({ record }) => !existingByNin.has(record.nin));
  let tokenQuery = null;
  if (candidateRecords.length) {
    let query = VoterlistData.find({
      qrToken: { $in: candidateRecords.map(({ record }) => record.qrToken) },
    }).select(`qrToken ${COMPARISON_FIELDS.join(' ')}`);
    if (session) query = query.session(session);
    tokenQuery = await query.lean();
  }
  const existingByQrToken = new Map((tokenQuery || []).map((record) => [record.qrToken, record]));

  for (const item of items) {
    if (item.category === 'duplicate-file') {
      const duplicate = records.find(({ index }) => index === item.duplicateOfIndex);
      if (duplicate) item.comparisonRecord = backup.records[duplicate.index];
    }
  }
  for (const { index, record } of records) {
    const existing = existingByNin.get(record.nin);
    if (existing) {
      const { changes, identityChanged } = compareImportRecord(existing, record);
      const changed = changes.length > 0;
      items.push({
        index,
        category: changed ? 'changed' : 'unchanged',
        reason: !changed
          ? 'The matching NIN, first name, dates of birth, and record data are unchanged.'
          : identityChanged
            ? 'The NIN matches, but the first name or date of birth differs. This record will be updated and the differences added to update history.'
            : 'This record has changed data and will be updated with the differences added to update history.',
        existingRecord: existing,
        changes,
      });
      continue;
    }
    const tokenMatch = existingByQrToken.get(record.qrToken);
    if (tokenMatch) {
      items.push({
        index,
        category: 'invalid',
        reason: 'This QR token is already assigned to a different database record.',
        existingRecord: tokenMatch,
      });
      continue;
    }
    items.push({ index, category: 'new', reason: 'This record has a new NIN and will be added.' });
  }
  items.sort((left, right) => left.index - right.index);

  const counts = {
    total: backup.records.length,
    new: 0,
    changed: 0,
    unchanged: 0,
    duplicateFile: 0,
    invalid: 0,
  };
  for (const item of items) {
    if (item.category === 'duplicate-file') counts.duplicateFile += 1;
    else counts[item.category] += 1;
  }
  return { counts, items };
}

module.exports = async function importRecords(req, res) {
  let session;
  try {
    if (!await hasValidSession(req, res)) {
      return sendJson(res, 401, { error: 'Sign in to import voter records.' });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

    let body;
    try {
      body = await readJsonBody(req, { maxBytes: 1_000_000 });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
    if (Buffer.byteLength(JSON.stringify(body)) > 1_000_000) {
      return sendJson(res, 413, { error: 'The JSON backup must be smaller than 1 MB.' });
    }
    if (!['preview', 'import'].includes(body?.action)) {
      return sendJson(res, 400, { error: 'Choose whether to preview or import the records.' });
    }
    if (body.action === 'import' && body.mode !== 'add-and-update') {
      return sendJson(res, 400, { error: 'Imports may add new records and update changed matching records only; records cannot be removed.' });
    }

    await connectToDatabase();
    if (body.action === 'preview') {
      const preview = await classifyImport(body.backup);
      return sendJson(res, 200, preview);
    }

    const inspection = inspectVoterlistImport(body.backup);
    if (inspection.items.some((item) => item.category === 'invalid')) {
      return sendJson(res, 400, { error: 'Fix invalid records in the JSON file before importing.' });
    }
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const preview = await classifyImport(body.backup, session);
      if (preview.counts.invalid > 0) {
        throw importError('One or more QR tokens conflict with existing records. Refresh the preview before importing.', 409);
      }
      const itemByIndex = new Map(preview.items.map((item) => [item.index, item]));
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      for (const { index, record: importedRecord } of inspection.records) {
        const item = itemByIndex.get(index);
        if (item.category === 'duplicate-file') continue;
        if (item.category === 'new') {
          const newRecord = { ...importedRecord };
          delete newRecord._id;
          await VoterlistData.create([newRecord], { session, timestamps: false });
          added += 1;
          continue;
        }
        if (item.category === 'unchanged') {
          unchanged += 1;
          continue;
        }
        if (item.category !== 'changed') continue;

        const record = await VoterlistData.findOne({ nin: importedRecord.nin }).session(session);
        if (!record) {
          throw importError('A matching record changed while importing. Refresh the preview and try again.', 409);
        }
        const changes = IMPORTABLE_FIELDS
          .filter((field) => String(record[field] ?? '') !== String(importedRecord[field] ?? ''))
          .map((field) => ({
            field,
            before: record[field] ?? '',
            after: importedRecord[field] ?? '',
          }));
        if (!changes.length) {
          unchanged += 1;
          continue;
        }
        for (const field of IMPORTABLE_FIELDS) record[field] = importedRecord[field];
        await record.save({ session });
        await voterlistHistory.saveRecordUpdate(record._id, changes, { session });
        updated += 1;
      }
      result = {
        added,
        updated,
        unchanged,
        duplicateFile: preview.counts.duplicateFile,
        invalid: preview.counts.invalid,
      };
    });
    return sendJson(res, 200, { imported: true, ...result });
  } catch (error) {
    console.error('Voterlist JSON import failed:', error.code || error.statusCode || 'unexpected error');
    if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
    if (error.code === 11000) {
      return sendJson(res, 409, { error: 'A matching record or QR token changed during import. Refresh the preview; no records were changed.' });
    }
    return sendJson(res, 500, { error: 'The voter records could not be imported. No records were changed.' });
  } finally {
    if (session) await session.endSession();
  }
};

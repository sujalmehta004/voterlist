const mongoose = require('mongoose');
const crypto = require('crypto');
const connectToDatabase = require('../lib/db');
const VoterlistData = require('../lib/models/VoterlistData');
const VoterlistHistory = require('../lib/models/VoterlistHistory');
const { saveRecordUpdate } = require('../lib/voterlist-history');
const { hasValidSession } = require('../lib/auth');
const { readJsonBody, sendJson } = require('../lib/http');
const {
  normalizeNin,
  isValidFullName,
  isValidIsoDate,
} = require('../lib/records');

module.exports = async function records(req, res) {
  if (!hasValidSession(req)) return sendJson(res, 401, { error: 'Sign in to manage records.' });

  try {
    await connectToDatabase();

    if (req.method === 'GET') {
      const [records, checkCounts] = await Promise.all([
        VoterlistData.find({})
          .sort({ createdAt: -1 })
          .lean(),
        VoterlistHistory.aggregate([
          {
            $group: {
              _id: '$recordId',
              legacyCount: {
                $sum: {
                  $cond: [{ $eq: ['$action', 'STATUS_CHECK'] }, 1, 0],
                },
              },
              consolidatedCount: { $max: { $ifNull: ['$requestCount', 0] } },
            },
          },
          {
            $project: {
              count: { $max: ['$legacyCount', '$consolidatedCount'] },
            },
          },
        ]),
      ]);
      const countsByRecordId = new Map(checkCounts.map(({ _id, count }) => [String(_id), count]));
      for (const record of records) {
        record.statusCheckCount = countsByRecordId.get(String(record._id)) || 0;
      }
      return sendJson(res, 200, { records });
    }
    if (!['POST', 'PUT'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });

    const body = await readJsonBody(req);
    const nin = normalizeNin(body.nin);
    const fullName = String(body.fullName || '').trim().replace(/\s+/g, ' ');
    const dobAd = String(body.dobAd || '').trim();
    const dobBs = String(body.dobBs || '').trim();
    const mobile = String(body.mobile || '').trim();
    const notes = String(body.notes || '').trim();
    const status = String(body.status || 'NOT ONLINE').trim().toUpperCase();
    const isOldEntry = body.entryType === 'old';
    const registeredDate = String(body.registeredDate || '').trim();

    if (!/^\d{10}$/.test(String(body.nin || ''))) {
      return sendJson(res, 400, { error: 'NIN must contain exactly 10 digits.' });
    }
    if (!nin) return sendJson(res, 400, { error: 'Enter a valid 10-digit NIN.' });
    if (!isValidFullName(fullName) || fullName.length > 160) {
      return sendJson(res, 400, { error: 'Name can contain letters, spaces, and periods only.' });
    }
    if (!isValidIsoDate(dobAd)) return sendJson(res, 400, { error: 'Enter a valid date of birth in AD.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobBs)) {
      return sendJson(res, 400, { error: 'The converted BS date is missing or invalid.' });
    }
    if (!/^\d{10}$/.test(mobile)) {
      return sendJson(res, 400, { error: 'Mobile number must contain exactly 10 digits.' });
    }
    if (notes.length > 2000) return sendJson(res, 400, { error: 'Notes must be 2,000 characters or fewer.' });
    if (req.method === 'POST' && isOldEntry && !isValidIsoDate(registeredDate)) {
      return sendJson(res, 400, { error: 'Enter a valid registration date.' });
    }
    if (req.method === 'POST' && !['NOT ONLINE', 'PENDING'].includes(status)) {
      return sendJson(res, 400, { error: 'New records can only start as NOT ONLINE or PENDING.' });
    }
    if (req.method === 'PUT' && !['NOT ONLINE', 'PENDING', 'DONE'].includes(status)) {
      return sendJson(res, 400, { error: 'Choose a valid record status.' });
    }

    if (req.method === 'PUT') {
      if (String(body.confirmText || '') !== 'UPDATE') {
        return sendJson(res, 400, { error: 'Type UPDATE exactly to confirm this change.' });
      }
      const recordId = String(body.recordId || '').trim();
      if (!mongoose.isValidObjectId(recordId)) {
        return sendJson(res, 400, { error: 'Select a valid record to update.' });
      }

      const record = await VoterlistData.findById(recordId);
      if (!record) return sendJson(res, 404, { error: 'The voterlist record no longer exists.' });
      const values = { nin, dobAd, dobBs, fullName, mobile, notes, status };
      const identityFields = ['nin', 'dobAd', 'dobBs', 'fullName'];
      const identityChanged = identityFields.some((field) => String(record[field] ?? '') !== String(values[field]));
      if (identityChanged) {
        Object.assign(values, {
          status: status === record.status ? 'NOT ONLINE' : status,
          voterListNumber: '',
          abedanNumber: '',
        });
      }
      const changes = Object.entries(values)
        .filter(([field, after]) => String(record[field] ?? '') !== String(after))
        .map(([field, after]) => ({ field, before: record[field] ?? '', after }));
      if (!changes.length) {
        return sendJson(res, 200, { record: record.toObject(), unchanged: true });
      }

      Object.assign(record, values);
      await record.save();
      try {
        await saveRecordUpdate(record._id, changes);
      } catch (error) {
        console.error('Voterlist update history could not be saved:', error.message);
        return sendJson(res, 500, {
          error: 'The record was updated, but its update history could not be saved. Contact the administrator.',
          record: record.toObject(),
        });
      }
      return sendJson(res, 200, { record: record.toObject() });
    }

    const recordValues = {
      nin,
      dobAd,
      dobBs,
      fullName,
      mobile,
      notes,
      status,
      qrToken: crypto.randomBytes(24).toString('base64url'),
    };
    let record;
    if (isOldEntry) {
      const [year, month, day] = registeredDate.split('-').map(Number);
      const createdAt = new Date(Date.UTC(year, month - 1, day, 12));
      record = new VoterlistData({ ...recordValues, createdAt, updatedAt: new Date() });
      await record.save({ timestamps: false });
    } else {
      record = await VoterlistData.create(recordValues);
    }
    return sendJson(res, 201, { record });
  } catch (error) {
    if (error.code === 11000) return sendJson(res, 409, { error: 'A record for this NIN already exists.' });
    if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
      return sendJson(res, 400, { error: 'The record details are invalid.' });
    }
    console.error('Voterlist records API failed:', error.message);
    return sendJson(res, 500, { error: 'Unable to load or save voterlist records.' });
  }
};

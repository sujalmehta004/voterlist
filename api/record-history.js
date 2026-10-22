const mongoose = require('mongoose');
const connectToDatabase = require('../lib/db');
const VoterlistData = require('../lib/models/VoterlistData');
const { consolidateRecordHistory } = require('../lib/voterlist-history');
const { hasValidSession } = require('../lib/auth');
const { sendJson } = require('../lib/http');

module.exports = async function recordHistory(req, res) {
  if (!hasValidSession(req)) return sendJson(res, 401, { error: 'Sign in to view record history.' });
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });

  try {
    const recordId = String(req.query?.recordId || '').trim();
    if (!mongoose.isValidObjectId(recordId)) {
      return sendJson(res, 400, { error: 'Select a valid voterlist record.' });
    }

    await connectToDatabase();
    const exists = await VoterlistData.exists({ _id: recordId });
    if (!exists) return sendJson(res, 404, { error: 'The voterlist record no longer exists.' });

    const history = await consolidateRecordHistory(recordId);
    return sendJson(res, 200, {
      responses: history.responses || [],
      updates: [...(history.updates || [])].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt)),
    });
  } catch (error) {
    console.error('Voterlist record history API failed:', error.message);
    return sendJson(res, 500, { error: 'Unable to load this record’s history.' });
  }
};

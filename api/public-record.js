const connectToDatabase = require('../lib/db');
const VoterlistData = require('../lib/models/VoterlistData');
const { sendJson } = require('../lib/http');

module.exports = async function publicRecord(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const code = String(url.searchParams.get('code') || '').trim();
    if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return sendJson(res, 404, { error: 'Verification record not found.' });

    await connectToDatabase();
    const record = await VoterlistData.findOne({ qrToken: code })
      .select('nin dobAd dobBs fullName mobile status notes abedanNumber voterListNumber createdAt')
      .lean();
    if (!record) return sendJson(res, 404, { error: 'Verification record not found.' });
    return sendJson(res, 200, { record });
  } catch (error) {
    console.error('Public voterlist verification failed:', error.message);
    return sendJson(res, 500, { error: 'Verification is temporarily unavailable.' });
  }
};

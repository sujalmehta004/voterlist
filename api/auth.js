const connectToDatabase = require('../lib/db');
const Config = require('../lib/models/Config');
const { createSession, hasValidSession, setSessionCookie, clearSessionCookie } = require('../lib/auth');
const { readJsonBody, sendJson } = require('../lib/http');

module.exports = async function auth(req, res) {
  try {
    if (req.method === 'GET') {
      return sendJson(res, 200, { authenticated: hasValidSession(req) });
    }
    if (req.method === 'DELETE') {
      clearSessionCookie(res);
      return sendJson(res, 200, { authenticated: false });
    }
    if (req.method === 'PUT') {
      if (!hasValidSession(req)) return sendJson(res, 401, { error: 'Sign in to change the admin password.' });
      const body = await readJsonBody(req);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      const confirmPassword = String(body.confirmPassword || '');
      if (!currentPassword || !newPassword || !confirmPassword) {
        return sendJson(res, 400, { error: 'Enter the current password and both new password fields.' });
      }
      if (newPassword.length < 8) {
        return sendJson(res, 400, { error: 'The new password must be at least 8 characters.' });
      }
      if (newPassword !== confirmPassword) {
        return sendJson(res, 400, { error: 'The new passwords do not match.' });
      }

      await connectToDatabase();
      const config = await Config.findOne({ key: 'default' }).select('adminUnlockPassword').lean();
      const expectedPassword = String(
        config?.adminUnlockPassword || process.env.VOTERLIST_ADMIN_PASSWORD || ''
      );
      if (!expectedPassword) {
        return sendJson(res, 503, { error: 'No admin password is configured in the database.' });
      }
      if (currentPassword !== expectedPassword) {
        return sendJson(res, 401, { error: 'The current admin password is incorrect.' });
      }
      if (!config?.adminUnlockPassword) {
        return sendJson(res, 503, { error: 'The shared Config record has no database password to update.' });
      }

      await Config.updateOne(
        { key: 'default' },
        { $set: { adminUnlockPassword: newPassword } },
        { runValidators: true },
      );
      return sendJson(res, 200, { updated: true });
    }
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    const body = await readJsonBody(req);
    const password = String(body.password || '');
    if (!password) return sendJson(res, 400, { error: 'Enter the admin password.' });

    await connectToDatabase();
    const config = await Config.findOne({ key: 'default' }).select('adminUnlockPassword').lean();
    const expectedPassword = String(
      config?.adminUnlockPassword || process.env.VOTERLIST_ADMIN_PASSWORD || ''
    );
    if (!expectedPassword) {
      return sendJson(res, 503, {
        error: 'No admin password is configured. Set VOTERLIST_ADMIN_PASSWORD or configure the shared Config record.',
      });
    }
    if (password !== expectedPassword) return sendJson(res, 401, { error: 'Incorrect admin password.' });

    setSessionCookie(res, createSession());
    return sendJson(res, 200, { authenticated: true });
  } catch (error) {
    console.error('Voterlist authentication failed:', error.message);
    return sendJson(res, 500, { error: 'Authentication is temporarily unavailable.' });
  }
};

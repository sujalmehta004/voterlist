const connectToDatabase = require('../lib/db');
const Config = require('../lib/models/Config');
const VoterlistConfig = require('../lib/models/VoterlistConfig');
const { hasValidSession } = require('../lib/auth');
const { readJsonBody, sendJson } = require('../lib/http');

function getWorkspaceSettings(config) {
  return {
    hideEntryTab: Boolean(config?.hideEntryTab),
    hideOldEntryTab: Boolean(config?.hideOldEntryTab),
    hideDatabaseTab: Boolean(config?.hideDatabaseTab),
  };
}

module.exports = async function workspaceSettings(req, res) {
  try {
    if (!await hasValidSession(req, res)) return sendJson(res, 401, { error: 'Sign in to manage workspace settings.' });
    if (!['GET', 'POST', 'PUT'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });

    let body;
    if (req.method === 'POST' || req.method === 'PUT') {
      const parsedBody = await readJsonBody(req);
      body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
        ? parsedBody
        : {};
    }
    if (req.method === 'POST' && !String(body.password || '')) {
      return sendJson(res, 400, { error: 'Enter the admin password to continue.' });
    }
    if (req.method === 'PUT') {
      if (typeof body.hideEntryTab !== 'boolean'
        || typeof body.hideOldEntryTab !== 'boolean'
        || typeof body.hideDatabaseTab !== 'boolean') {
        return sendJson(res, 400, { error: 'Choose whether to hide each workspace tab.' });
      }
      if (body.hideEntryTab && body.hideOldEntryTab && body.hideDatabaseTab) {
        return sendJson(res, 400, { error: 'At least one workspace tab must remain visible.' });
      }
    }

    await connectToDatabase();

    if (req.method === 'GET') {
      const config = await VoterlistConfig.findOneAndUpdate(
        { key: 'default' },
        { $setOnInsert: { key: 'default' } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();
      return sendJson(res, 200, { settings: getWorkspaceSettings(config) });
    }

    if (req.method === 'POST') {
      const config = await Config.findOne({ key: 'default' }).select('adminUnlockPassword').lean();
      const expectedPassword = String(
        config?.adminUnlockPassword || process.env.VOTERLIST_ADMIN_PASSWORD || ''
      );
      if (!expectedPassword) {
        return sendJson(res, 503, { error: 'No admin password is configured.' });
      }
      if (String(body.password) !== expectedPassword) {
        return sendJson(res, 401, { error: 'The admin password is incorrect.' });
      }
      return sendJson(res, 200, { verified: true });
    }

    const config = await VoterlistConfig.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          hideEntryTab: body.hideEntryTab,
          hideOldEntryTab: body.hideOldEntryTab,
          hideDatabaseTab: body.hideDatabaseTab,
        },
        $setOnInsert: { key: 'default' },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return sendJson(res, 200, { settings: getWorkspaceSettings(config) });
  } catch (error) {
    console.error('Voterlist workspace settings API failed:', error.message);
    return sendJson(res, 500, { error: 'Unable to load or save workspace settings.' });
  }
};

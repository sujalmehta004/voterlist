const connectToDatabase = require('../lib/db');
const VoterlistData = require('../lib/models/VoterlistData');
const { saveRecordUpdate, saveStatusResponse } = require('../lib/voterlist-history');
const searchVoter = require('./voter-search');
const { hasValidSession } = require('../lib/auth');
const { readJsonBody, sendJson } = require('../lib/http');
const {
  normalizeNin,
  isValidIsoDate,
  firstNameFromFullName,
  extractVoterIdentifiers,
  extractSearchMessage,
  statusFromSearch,
  findVoterServerUnavailableMessage,
  containsPortraitData,
} = require('../lib/records');

const PORTRAIT_SUCCESS_MESSAGE = 'NIN ACTIVATED, PORTRAIT RECEIVED SUCCESSFULLY';

function invokeVoterSearch(req, body) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ statusCode: this.statusCode, data }); return this; },
      end(data) { resolve({ statusCode: this.statusCode, data }); return this; },
    };
    Promise.resolve(searchVoter({
      method: 'POST',
      headers: req.headers,
      body: { ...body, parallelCount: 1 },
    }, response)).catch(reject);
  });
}

module.exports = async function checkStatus(req, res) {
  if (!hasValidSession(req)) return sendJson(res, 401, { error: 'Sign in to check a record.' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

  try {
    const body = await readJsonBody(req);
    const nin = normalizeNin(body.nin);
    const dobAd = String(body.dobAd || '').trim();
    const firstname = String(body.firstname || '').trim();
    if (!nin || !isValidIsoDate(dobAd) || !firstname) {
      return sendJson(res, 400, { error: 'Enter a valid NIN, AD date of birth, and first name.' });
    }

    await connectToDatabase();
    const record = await VoterlistData.findOne({ nin });
    if (!record) return sendJson(res, 404, { error: 'Create the voterlist record before checking its status.' });
    if (record.dobAd !== dobAd
      || firstNameFromFullName(record.fullName).toLocaleLowerCase() !== firstname.toLocaleLowerCase()) {
      return sendJson(res, 400, { error: 'The DOB and first name must match the saved voterlist record.' });
    }

    const search = await invokeVoterSearch(req, { nin, dob: dobAd, firstname });
    const searchSucceeded = search.statusCode >= 200
      && search.statusCode < 300
      && search.data?.success === true;
    const remoteMessage = extractSearchMessage(search.data);
    const outageMessage = findVoterServerUnavailableMessage(search.data);
    const serverUnavailable = Boolean(outageMessage);
    const portraitReceived = searchSucceeded && containsPortraitData(search.data);
    const identifiers = extractVoterIdentifiers(search.data);
    const identifier = identifiers.voterListNumber || identifiers.abedanNumber;
    const status = statusFromSearch(
      searchSucceeded,
      identifiers,
      outageMessage || remoteMessage,
      { portraitReceived, currentStatus: record.status },
    );
    const voterListNumber = serverUnavailable ? record.voterListNumber : identifiers.voterListNumber;
    const abedanNumber = serverUnavailable ? record.abedanNumber : identifiers.abedanNumber;

    const updated = await VoterlistData.findOneAndUpdate(
      { _id: record._id },
      {
        $set: {
          status,
          abedanNumber,
          voterListNumber,
        },
        $unset: { lastCheckedAt: 1, lastCheckMessage: 1 },
      },
      { new: true, runValidators: true, strict: false },
    );
    if (!updated) {
      return sendJson(res, 404, { error: 'The voterlist record no longer exists.' });
    }
    const fullResponse = {
      httpStatus: search.statusCode,
      body: portraitReceived
        ? { success: true, message: PORTRAIT_SUCCESS_MESSAGE }
        : search.data,
    };
    const { requestCount, responses } = await saveStatusResponse(updated._id, {
      searchSucceeded,
      fullResponse,
    });
    if (record.status !== status) {
      await saveRecordUpdate(updated._id, [{
        field: 'status',
        before: record.status,
        after: status,
      }]);
    }
    return sendJson(res, 200, {
      record: { ...updated.toObject(), statusCheckCount: requestCount },
      searchSucceeded,
      requestCount,
      responses,
      response: fullResponse,
      retryable: serverUnavailable,
    });
  } catch (error) {
    console.error('Voterlist status check failed:', error.message);
    return sendJson(res, 500, { error: 'Unable to check status right now. Please try again later.' });
  }
};

const crypto = require('crypto');
const mongoose = require('mongoose');
const VoterlistHistory = require('./models/VoterlistHistory');

function stableResponseValue(value) {
  if (Array.isArray(value)) return value.map(stableResponseValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableResponseValue(value[key])]),
  );
}

function responseHash(fullResponse) {
  return crypto.createHash('sha256').update(JSON.stringify(stableResponseValue(fullResponse))).digest('hex');
}

function mergeHistoryDocuments(documents) {
  const responses = new Map();
  const updates = new Map();
  let requestCount = 0;
  let legacyRequestCount = 0;

  for (const document of documents) {
    requestCount += Number(document.requestCount) || 0;
    if (document.action === 'STATUS_CHECK') {
      legacyRequestCount += 1;
      if (document.fullResponse !== null && document.fullResponse !== undefined) {
        const hash = document.responseHash || responseHash(document.fullResponse);
        if (!responses.has(hash)) {
          responses.set(hash, {
            changedAt: document.changedAt || new Date(),
            searchSucceeded: document.searchSucceeded ?? null,
            responseHash: hash,
            fullResponse: document.fullResponse,
          });
        }
      }
    }
    if (document.action === 'UPDATED') {
      const update = {
        changedAt: document.changedAt || new Date(),
        changes: document.changes || [],
      };
      updates.set(JSON.stringify([update.changedAt, update.changes]), update);
    }

    for (const response of document.responses || []) {
      const hash = response.responseHash || responseHash(response.fullResponse);
      if (!responses.has(hash)) responses.set(hash, { ...response, responseHash: hash });
    }
    for (const update of document.updates || []) {
      updates.set(JSON.stringify([update.changedAt, update.changes]), update);
    }
  }

  return {
    responses: [...responses.values()].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt)),
    updates: [...updates.values()].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt)),
    requestCount: Math.max(requestCount, legacyRequestCount),
  };
}

async function consolidateRecordHistory(recordId) {
  const objectId = new mongoose.Types.ObjectId(String(recordId));
  const existing = await VoterlistHistory.findById(objectId).lean();
  if (existing) {
    await VoterlistHistory.deleteMany({ recordId: objectId, _id: { $ne: objectId } });
    return existing;
  }

  const documents = await VoterlistHistory.find({ recordId: objectId }).lean();
  const merged = mergeHistoryDocuments(documents);
  let canonical;
  try {
    canonical = await VoterlistHistory.findOneAndUpdate(
      { _id: objectId },
      { $setOnInsert: { recordId: objectId, ...merged } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: false },
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    canonical = await VoterlistHistory.findById(objectId).lean();
    if (!canonical) throw error;
  }
  await VoterlistHistory.deleteMany({
    recordId: objectId,
    _id: { $ne: objectId },
  });
  return canonical;
}

async function saveStatusResponse(recordId, { searchSucceeded, responseHash: hash, fullResponse }) {
  const history = await consolidateRecordHistory(recordId);
  const historyId = history._id;
  const existingResponse = (history.responses || []).some((response) => response.responseHash === hash);
  const response = {
    changedAt: new Date(),
    searchSucceeded,
    responseHash: hash,
    fullResponse,
  };
  if (existingResponse) {
    const savedHistory = await VoterlistHistory.findOneAndUpdate(
      { _id: historyId },
      { $inc: { requestCount: 1 } },
      { new: true },
    );
    return { requestCount: savedHistory.requestCount, addedUniqueResponse: false };
  }

  const result = await VoterlistHistory.updateOne(
    { _id: historyId, 'responses.responseHash': { $ne: hash } },
    { $inc: { requestCount: 1 }, $push: { responses: response } },
    { runValidators: true },
  );
  if (!result.modifiedCount) {
    await VoterlistHistory.updateOne({ _id: historyId }, { $inc: { requestCount: 1 } });
  }
  const savedHistory = await VoterlistHistory.findById(historyId).select('requestCount').lean();
  return { requestCount: savedHistory.requestCount, addedUniqueResponse: Boolean(result.modifiedCount) };
}

async function saveRecordUpdate(recordId, changes) {
  const history = await consolidateRecordHistory(recordId);
  await VoterlistHistory.updateOne(
    { _id: history._id },
    { $push: { updates: { changedAt: new Date(), changes } } },
    { runValidators: true },
  );
}

module.exports = {
  responseHash,
  mergeHistoryDocuments,
  consolidateRecordHistory,
  saveStatusResponse,
  saveRecordUpdate,
};

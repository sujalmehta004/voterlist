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

function responseMessage(value, depth = 0) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || depth > 8) return '';
  for (const key of ['message', 'error', 'detail', 'description']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const message = responseMessage(item, depth + 1);
        if (message) return message;
      }
    } else if (entry && typeof entry === 'object') {
      const message = responseMessage(entry, depth + 1);
      if (message) return message;
    }
  }
  return '';
}

function responseHash(fullResponse) {
  const message = responseMessage(fullResponse);
  const identity = message
    ? JSON.stringify(['message', message])
    : JSON.stringify(['response', stableResponseValue(fullResponse)]);
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function uniqueResponses(responses = []) {
  const byHash = new Map();
  for (const response of responses) {
    const hash = responseHash(response.fullResponse);
    if (!byHash.has(hash)) byHash.set(hash, { ...response, responseHash: hash });
  }
  return [...byHash.values()].sort((left, right) => new Date(left.changedAt) - new Date(right.changedAt));
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
        const hash = responseHash(document.fullResponse);
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
      const hash = responseHash(response.fullResponse);
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

async function consolidateRecordHistory(recordId, { session } = {}) {
  const objectId = new mongoose.Types.ObjectId(String(recordId));
  let existingQuery = VoterlistHistory.findById(objectId);
  if (session) existingQuery = existingQuery.session(session);
  const existing = await existingQuery.lean();
  if (existing) {
    const responses = uniqueResponses(existing.responses);
    if (responses.length !== (existing.responses || []).length
      || responses.some((response, index) => response.responseHash !== existing.responses[index]?.responseHash)) {
      await VoterlistHistory.updateOne(
        { _id: objectId },
        { $set: { responses } },
        session ? { session } : {},
      );
      existing.responses = responses;
    }
    await VoterlistHistory.deleteMany(
      { recordId: objectId, _id: { $ne: objectId } },
      session ? { session } : {},
    );
    return existing;
  }

  let documentsQuery = VoterlistHistory.find({ recordId: objectId });
  if (session) documentsQuery = documentsQuery.session(session);
  const documents = await documentsQuery.lean();
  const merged = mergeHistoryDocuments(documents);
  let canonical;
  try {
    canonical = await VoterlistHistory.findOneAndUpdate(
      { _id: objectId },
      { $setOnInsert: { recordId: objectId, ...merged } },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: false,
        ...(session ? { session } : {}),
      },
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    let canonicalQuery = VoterlistHistory.findById(objectId);
    if (session) canonicalQuery = canonicalQuery.session(session);
    canonical = await canonicalQuery.lean();
    if (!canonical) throw error;
  }
  await VoterlistHistory.deleteMany({
    recordId: objectId,
    _id: { $ne: objectId },
  }, session ? { session } : {});
  return canonical;
}

async function saveStatusResponse(recordId, { searchSucceeded, fullResponse }) {
  const history = await consolidateRecordHistory(recordId);
  const historyId = history._id;
  const hash = responseHash(fullResponse);
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
    ).lean();
    return {
      requestCount: savedHistory.requestCount,
      addedUniqueResponse: false,
      responses: uniqueResponses(savedHistory.responses),
    };
  }

  const result = await VoterlistHistory.updateOne(
    { _id: historyId, 'responses.responseHash': { $ne: hash } },
    { $inc: { requestCount: 1 }, $push: { responses: response } },
    { runValidators: true },
  );
  if (!result.modifiedCount) {
    await VoterlistHistory.updateOne({ _id: historyId }, { $inc: { requestCount: 1 } });
  }
  const savedHistory = await VoterlistHistory.findById(historyId).select('requestCount responses').lean();
  const savedResponses = savedHistory.responses || [];
  const responses = uniqueResponses(savedResponses);
  if (responses.length !== savedResponses.length) {
    await VoterlistHistory.updateOne({ _id: historyId }, { $set: { responses } });
  }
  return {
    requestCount: savedHistory.requestCount,
    addedUniqueResponse: Boolean(result.modifiedCount),
    responses,
  };
}

async function saveRecordUpdate(recordId, changes, { session } = {}) {
  const history = await consolidateRecordHistory(recordId, { session });
  await VoterlistHistory.updateOne(
    { _id: history._id },
    { $push: { updates: { changedAt: new Date(), changes } } },
    { runValidators: true, ...(session ? { session } : {}) },
  );
}

module.exports = {
  responseHash,
  responseMessage,
  uniqueResponses,
  mergeHistoryDocuments,
  consolidateRecordHistory,
  saveStatusResponse,
  saveRecordUpdate,
};

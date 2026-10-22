const mongoose = require('mongoose');

const ChangeSchema = new mongoose.Schema({
  field: { type: String, required: true },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const ResponseSchema = new mongoose.Schema({
  changedAt: { type: Date, default: Date.now, required: true },
  searchSucceeded: { type: Boolean, default: null },
  responseHash: { type: String, required: true },
  fullResponse: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const UpdateSchema = new mongoose.Schema({
  changedAt: { type: Date, default: Date.now, required: true },
  changes: { type: [ChangeSchema], default: [] },
}, { _id: false });

const VoterlistHistorySchema = new mongoose.Schema({
  recordId: { type: mongoose.Schema.Types.ObjectId, required: true },
  responses: { type: [ResponseSchema], default: [] },
  updates: { type: [UpdateSchema], default: [] },
  requestCount: { type: Number, default: 0 },
  action: { type: String, enum: ['CREATED', 'UPDATED', 'STATUS_CHECK'] },
  changedAt: { type: Date },
  changes: { type: [ChangeSchema] },
  searchSucceeded: { type: Boolean, default: null },
  responseHash: { type: String, default: '' },
  fullResponse: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  versionKey: false,
  collection: 'VoterlistHistory',
});

VoterlistHistorySchema.index({ recordId: 1 });
VoterlistHistorySchema.index({ action: 1, recordId: 1 });

module.exports = mongoose.models.VoterlistHistory
  || mongoose.model('VoterlistHistory', VoterlistHistorySchema, 'VoterlistHistory');

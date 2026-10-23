const mongoose = require('mongoose');

const VoterlistConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  hideEntryTab: { type: Boolean, default: false },
  hideOldEntryTab: { type: Boolean, default: false },
  hideDatabaseTab: { type: Boolean, default: false },
  hidePrintMultipleButton: { type: Boolean, default: false },
  hideDeleteMultipleButton: { type: Boolean, default: false },
  hideRecordDeleteButton: { type: Boolean, default: false },
  automaticStatusRetries: { type: Number, default: 3, min: 1, max: 15 },
}, { collection: 'voterlistconfig' });

module.exports = mongoose.models.VoterlistConfig
  || mongoose.model('VoterlistConfig', VoterlistConfigSchema);

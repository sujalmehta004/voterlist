const mongoose = require('mongoose');

const VoterlistConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  hideEntryTab: { type: Boolean, default: false },
  hideDatabaseTab: { type: Boolean, default: false },
}, { collection: 'voterlistconfig' });

module.exports = mongoose.models.VoterlistConfig
  || mongoose.model('VoterlistConfig', VoterlistConfigSchema);

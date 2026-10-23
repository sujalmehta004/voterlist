const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  adminUnlockPassword: { type: String, trim: true },
  sessionVersion: { type: Number, default: 0, min: 0 },
}, { collection: 'configs' });

module.exports = mongoose.models.Config
  || mongoose.model('Config', ConfigSchema);

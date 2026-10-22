const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  adminUnlockPassword: { type: String, trim: true },
}, { collection: 'configs' });

module.exports = mongoose.models.Config
  || mongoose.model('Config', ConfigSchema);

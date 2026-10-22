const mongoose = require('mongoose');

const VoterlistDataSchema = new mongoose.Schema({
  nin: { type: String, required: true, trim: true, unique: true, index: true },
  dobAd: { type: String, required: true, trim: true },
  dobBs: { type: String, required: true, trim: true },
  fullName: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['NOT ONLINE', 'PENDING', 'DONE'],
    default: 'NOT ONLINE',
    index: true,
  },
  notes: { type: String, default: '', trim: true, maxlength: 2000 },
  abedanNumber: { type: String, default: '', trim: true },
  voterListNumber: { type: String, default: '', trim: true },
  qrToken: { type: String, required: true, unique: true, index: true },
}, {
  timestamps: true,
  collection: 'VoterlistData',
});

module.exports = mongoose.models.VoterlistData
  || mongoose.model('VoterlistData', VoterlistDataSchema, 'VoterlistData');

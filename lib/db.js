const mongoose = require('mongoose');

let cached = global.voterlistMongoose;
if (!cached) {
  cached = global.voterlistMongoose = { connection: null, promise: null };
}

async function connectToDatabase() {
  if (cached.connection) return cached.connection;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
  }

  try {
    cached.connection = await cached.promise;
    return cached.connection;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
}

module.exports = connectToDatabase;
module.exports.connectToDatabase = connectToDatabase;

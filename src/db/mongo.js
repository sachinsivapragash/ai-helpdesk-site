// MongoDB access for chat logs and feedback. If MONGODB_URI is not set (local dev)
// or the connection fails, documents are kept in memory and /health reports "degraded".
const { MongoClient, ObjectId } = require('mongodb');
const config = require('../config');

let db = null;
let lastError = null;
const memory = { chat_logs: [], feedback: [] };

async function connect() {
  if (!config.mongoUri) {
    lastError = 'MONGODB_URI not set - using in-memory store';
    console.warn(`[mongo] ${lastError}`);
    return;
  }
  try {
    const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(config.mongoDb);
    await db.collection('chat_logs').createIndex({ sessionId: 1, createdAt: -1 });
    await db.collection('feedback').createIndex({ messageId: 1 });
    lastError = null;
    console.log('[mongo] connected');
  } catch (err) {
    lastError = err.message;
    console.error('[mongo] connection failed, using in-memory store:', err.message);
  }
}

async function insert(collection, doc) {
  const record = { ...doc, createdAt: new Date() };
  if (db) {
    const { insertedId } = await db.collection(collection).insertOne(record);
    return insertedId.toString();
  }
  const id = new ObjectId().toString();
  memory[collection].push({ _id: id, ...record });
  return id;
}

async function count(collection) {
  if (db) return db.collection(collection).estimatedDocumentCount();
  return memory[collection].length;
}

async function feedbackSummary() {
  if (db) {
    const rows = await db.collection('feedback')
      .aggregate([{ $group: { _id: '$rating', n: { $sum: 1 } } }]).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }
  return memory.feedback.reduce((acc, f) => ({ ...acc, [f.rating]: (acc[f.rating] || 0) + 1 }), {});
}

async function ping() {
  if (!db) return { ok: false, mode: 'memory', detail: lastError };
  const started = Date.now();
  await db.command({ ping: 1 });
  return { ok: true, mode: 'mongodb', latencyMs: Date.now() - started };
}

module.exports = { connect, insert, count, feedbackSummary, ping };

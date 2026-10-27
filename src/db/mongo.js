// MongoDB access for chat logs and feedback. If MONGODB_URI is not set (local dev), the
// connection fails, or MongoDB goes down later, documents are kept in memory so the chat
// keeps working; /health reports "degraded" and the app keeps trying to reconnect.
const { MongoClient, ObjectId } = require('mongodb');
const config = require('../config');

const RETRY_MS = 30 * 1000;
let client = null;
let db = null;
let lastError = null;
let connecting = null;
const memory = { chat_logs: [], feedback: [] };

async function connect() {
  if (!config.mongoUri) {
    lastError = 'MONGODB_URI not set - using in-memory store';
    console.warn(`[mongo] ${lastError}`);
    return;
  }
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      client = client || new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      db = client.db(config.mongoDb);
      await db.collection('chat_logs').createIndex({ sessionId: 1, createdAt: -1 });
      await db.collection('feedback').createIndex({ messageId: 1 });
      lastError = null;
      console.log('[mongo] connected');
      await flushMemory();
    } catch (err) {
      db = null;
      lastError = err.message;
      console.error(`[mongo] connection failed, using in-memory store, retrying in ${RETRY_MS / 1000}s:`, err.message);
      setTimeout(connect, RETRY_MS).unref();
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

function insertInMemory(collection, record) {
  const id = new ObjectId().toString();
  memory[collection].push({ _id: id, ...record });
  return id;
}

// Saves records kept in memory during an outage once MongoDB is reachable again.
async function flushMemory() {
  for (const collection of Object.keys(memory)) {
    if (!memory[collection].length) continue;
    const pending = memory[collection].splice(0);
    try {
      await db.collection(collection).insertMany(pending.map(({ _id, ...rest }) => ({ _id: new ObjectId(_id), ...rest })));
      console.log(`[mongo] saved ${pending.length} ${collection} record(s) kept during the outage`);
    } catch (err) {
      memory[collection].unshift(...pending);
    }
  }
}

async function insert(collection, doc) {
  const record = { ...doc, createdAt: new Date() };
  if (db) {
    try {
      const { insertedId } = await db.collection(collection).insertOne(record);
      await flushMemory();
      return insertedId.toString();
    } catch (err) {
      lastError = `last write failed: ${err.message}`;
      console.error(`[mongo] insert into ${collection} failed, kept in memory:`, err.message);
    }
  }
  return insertInMemory(collection, record);
}

async function count(collection) {
  const pending = memory[collection].length;
  if (db) return (await db.collection(collection).estimatedDocumentCount()) + pending;
  return pending;
}

async function feedbackSummary() {
  const summary = memory.feedback.reduce((acc, f) => ({ ...acc, [f.rating]: (acc[f.rating] || 0) + 1 }), {});
  if (db) {
    const rows = await db.collection('feedback')
      .aggregate([{ $group: { _id: '$rating', n: { $sum: 1 } } }]).toArray();
    for (const r of rows) summary[r._id] = (summary[r._id] || 0) + r.n;
  }
  return summary;
}

async function ping() {
  if (!db) return { ok: false, mode: 'memory', detail: lastError };
  const started = Date.now();
  try {
    await db.command({ ping: 1 });
  } catch (err) {
    return { ok: false, mode: 'mongodb', detail: err.message, unsavedInMemory: memory.chat_logs.length + memory.feedback.length };
  }
  return { ok: true, mode: 'mongodb', latencyMs: Date.now() - started };
}

async function close() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { connect, insert, count, feedbackSummary, ping, close };

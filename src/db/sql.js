// SQL access layer. Uses PostgreSQL when DATABASE_URL is set (production),
// otherwise an embedded PGlite database (same SQL dialect) for local development.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { seed } = require('./seed');

let client = null;
let driver = null;

async function connect() {
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    client = new Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
    driver = 'postgres';
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const dir = path.join(__dirname, '..', '..', 'data', 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
    driver = 'pglite';
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (driver === 'pglite') await client.exec(schema);
  else await client.query(schema);
  await seed(query);
  console.log(`[sql] connected (${driver})`);
}

async function query(text, params = []) {
  if (!client) throw new Error('SQL database not connected');
  const result = await client.query(text, params);
  return result.rows;
}

async function ping() {
  const started = Date.now();
  await query('SELECT 1');
  return { driver, latencyMs: Date.now() - started };
}

async function close() {
  if (client) await (driver === 'pglite' ? client.close() : client.end());
  client = null;
}

module.exports = { connect, query, ping, close, get driver() { return driver; } };

// 📍 In Datei: db.js (GitHub Web-Editor)
const { Pool } = require("pg");

const ssl =
  process.env.DATABASE_CA_CERT && process.env.DATABASE_CA_CERT.trim().startsWith("-----BEGIN CERTIFICATE-----")
    ? { ca: process.env.DATABASE_CA_CERT }
    : { rejectUnauthorized: false }; // Fallback fürs MVP

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl
});

async function pingDb() {
  const r = await pool.query("select 1 as ok");
  return r.rows[0];
}

module.exports = { pool, pingDb };

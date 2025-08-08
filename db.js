// 📍 In Datei: db.js (GitHub Web-Editor)
const { Pool } = require("pg");

function buildSsl() {
  const b64 = process.env.DATABASE_CA_B64;
  if (b64 && b64.length > 0) {
    const ca = Buffer.from(b64, "base64").toString("utf8");
    return { ca }; // volle Verifikation
  }
  // Fallback (nur DEV/MVP)
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSsl()
});

async function pingDb() {
  const r = await pool.query("select 1 as ok");
  return r.rows[0];
}

module.exports = { pool, pingDb };

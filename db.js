// 📍 In Datei: db.js (GitHub Web-Editor)
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // von DO injiziert
  ssl: {
    rejectUnauthorized: true,                 // Zertifikat prüfen
    ca: process.env.DATABASE_CA_CERT          // von DO injiziert (PEM)
  }
});

async function pingDb() {
  const r = await pool.query("select 1 as ok");
  return r.rows[0];
}

module.exports = { pool, pingDb };

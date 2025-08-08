// 📍 In Datei: db.js (GitHub Web-Editor)
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // DigitalOcean Managed Postgres: self-signed / custom CA
  // Für MVP erlauben wir SSL ohne Zertifikatsprüfung.
  // (Später kannst du auf CA-Validierung umstellen.)
  ssl: { rejectUnauthorized: false }
});

async function pingDb() {
  const r = await pool.query("select 1 as ok");
  return r.rows[0];
}

module.exports = { pool, pingDb };

// 📍 In Datei: db.js (GitHub Web-Editor)
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("ondigitalocean.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

async function pingDb() {
  const r = await pool.query("select 1 as ok");
  return r.rows[0];
}

module.exports = { pool, pingDb };

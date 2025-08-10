// 📍 In Datei: db.js (GitHub Web-Editor)
const { Pool } = require("pg");

// Hart auf DO-Managed-Postgres mit injizierten Einzelwerten.
// Vorteil: Keine Parsing-Probleme mit URL, SSL klar via CA.
const pool = new Pool({
  host: "db-postgresql-lst-concept-do-user-22806567-0.g.db.ondigitalocean.com",
  port: 25060,
  user: doadmin,
  password: "AVNS_zO3Crk5VjEai0a5FlYE",
  database: "defaultdb",
  ssl: {
    rejectUnauthorized: true,
    ca: process.env.DATABASE_CA_CERT, // von DO injiziert (PEM)
  },
});

async function pingDb() {
  const r = await pool.query("select 1 as ok");
  return r.rows[0];
}

module.exports = { pool, pingDb };

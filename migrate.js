// 📍 Datei: migrate.js
const { pool } = require("./db");

async function migrate() {
  console.log("[DB] Migration gestartet...");

  try {
    // Tabelle: node
    await pool.query(`
      CREATE TABLE IF NOT EXISTS node (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content_json JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    // Tabelle: edge
    await pool.query(`
      CREATE TABLE IF NOT EXISTS edge (
        id SERIAL PRIMARY KEY,
        from_node_id INT REFERENCES node(id) ON DELETE CASCADE,
        to_node_id INT REFERENCES node(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    // Tabelle: session
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        id SERIAL PRIMARY KEY,
        current_node_id INT REFERENCES node(id) ON DELETE SET NULL,
        state_json JSONB DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'running',
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    // Tabelle: decision
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decision (
        id SERIAL PRIMARY KEY,
        session_id INT REFERENCES session(id) ON DELETE CASCADE,
        node_id INT REFERENCES node(id) ON DELETE CASCADE,
        chosen_edge_id INT REFERENCES edge(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    // 🔹 Eindeutigkeit: gleiche Labels vom selben from_node_id nicht doppelt
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_edge_from_label
      ON edge(from_node_id, lower(label));
    `);

    console.log("[DB] Migration erfolgreich abgeschlossen ✅");
  } catch (err) {
    console.error("[DB] Fehler bei Migration ❌", err);
  } finally {
    await pool.end();
  }
}

migrate();

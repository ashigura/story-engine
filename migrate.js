// 📍 Datei: migrate.js
const { pool } = require("./db");

/**
 * Führe DB-Migrationen aus.
 * @param {{ endPool?: boolean }} opts - endPool=true schließt den Pool am Ende (für CLI-Nutzung).
 */
async function migrate(opts = {}) {
  const { endPool = false } = opts;
  console.log("[DB] Migration gestartet…");

  try {
    // -- Tabellen anlegen (idempotent) --------------------------------------

    // node
    await pool.query(`
      CREATE TABLE IF NOT EXISTS node (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content_json JSONB DEFAULT '{}'::jsonb
      );
    `);

    // edge
    await pool.query(`
      CREATE TABLE IF NOT EXISTS edge (
        id SERIAL PRIMARY KEY,
        from_node_id INT REFERENCES node(id) ON DELETE CASCADE,
        to_node_id   INT REFERENCES node(id) ON DELETE CASCADE,
        label TEXT NOT NULL
      );
    `);

    // session
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        id SERIAL PRIMARY KEY,
        current_node_id INT REFERENCES node(id) ON DELETE SET NULL,
        state_json JSONB DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'running',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // decision
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decision (
        id SERIAL PRIMARY KEY,
        session_id INT REFERENCES session(id) ON DELETE CASCADE,
        node_id INT REFERENCES node(id) ON DELETE CASCADE,
        chosen_edge_id INT REFERENCES edge(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // -- Schema-Angleichungen (Spalten nachziehen, falls älteres Schema) ----

    await pool.query(`
      ALTER TABLE node
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

      ALTER TABLE edge
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
        ADD COLUMN IF NOT EXISTS condition_json JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS effect_json    JSONB DEFAULT '{}'::jsonb;

      ALTER TABLE session
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
    `);

    // -- Indizes -------------------------------------------------------------

    // schnelleres Lookup
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_edge_from ON edge(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_session_status ON session(status);
      CREATE INDEX IF NOT EXISTS idx_decision_session ON decision(session_id);
    `);

    // Eindeutigkeit: Label je Quelle (case-insensitive)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_edge_from_label
      ON edge (from_node_id, lower(label));
    `);

    // Snapshots (Spielstände)
await pool.query(`
  CREATE TABLE IF NOT EXISTS snapshot (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES session(id) ON DELETE CASCADE,
    label TEXT,
    state_json JSONB DEFAULT '{}'::jsonb,
    current_node_id INT REFERENCES node(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_snapshot_session ON snapshot(session_id);
  CREATE INDEX IF NOT EXISTS idx_snapshot_created ON snapshot(created_at);
`);

    -- chat events (eingehende Nachrichten/Reaktionen aus MultiChat)
create table if not exists chat_event (
  id            bigserial primary key,
  session_id    int not null,
  platform      text not null,               -- z.B. twitch, youtube, kick, ...
  user_id       text not null,
  username      text not null,
  message       text,                         -- roher text (falls vorhanden)
  kind          text not null default 'message', -- message | reaction | command
  payload_json  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists ix_chat_event_session_created on chat_event(session_id, created_at desc);
create index if not exists ix_chat_event_processed on chat_event(processed_at);



    console.log("[DB] Migration erfolgreich abgeschlossen ✅");
  } catch (err) {
    console.error("[DB] Fehler bei Migration ❌", err);
    throw err;
  } finally {
    if (endPool) {
      try { await pool.end(); } catch {}
    }
  }
}

module.exports = { migrate };

// CLI-Nutzung: `node migrate.js`
if (require.main === module) {
  migrate({ endPool: true })
    .catch(() => process.exit(1))
    .then(() => process.exit(0));
}



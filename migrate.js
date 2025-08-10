// 📍 In Datei: migrate.js (GitHub Web-Editor)
const { pool } = require("./db");

async function migrate() {
  const sql = `
  -- Tabellen (idempotent)
  create table if not exists node(
    id serial primary key,
    title text not null,
    content_json jsonb not null default '{}'::jsonb
  );

  create table if not exists edge(
    id serial primary key,
    from_node_id int not null references node(id) on delete cascade,
    to_node_id int not null references node(id) on delete cascade,
    label text not null,
    condition_json jsonb not null default '{}'::jsonb,
    effect_json jsonb not null default '{}'::jsonb
  );

  create table if not exists session(
    id serial primary key,
    current_node_id int references node(id),
    state_json jsonb not null default '{}'::jsonb,
    status text not null default 'running',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists decision(
    id serial primary key,
    session_id int not null references session(id) on delete cascade,
    node_id int not null references node(id),
    chosen_edge_id int not null references edge(id),
    created_at timestamptz not null default now()
  );

  -- sinnvolle Indexe
  create index if not exists idx_edge_from on edge(from_node_id);
  create index if not exists idx_session_status on session(status);
  create index if not exists idx_decision_session on decision(session_id);
  `;

  await pool.query(sql);
  console.log("Migration erfolgreich abgeschlossen.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration fehlgeschlagen:", err);
  process.exit(1);
});

// 📍 In Datei: index.js (GitHub Web-Editor)
const express = require("express");
const { pingDb, pool } = require("./db");

const app = express();
const port = process.env.PORT || 8080;

// simple API key check
app.use((req, res, next) => {
  if (req.path === "/health") return next(); // health ohne key
  const key = req.header("x-api-key");
  if (!process.env.API_KEY || key === process.env.API_KEY) return next();
  res.status(401).json({ error: "unauthorized" });
});

app.use(express.json());

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// db ping
app.get("/db/ping", async (_req, res) => {
  try {
    const row = await pingDb();
    res.json({ db: "ok", row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ db: "error", message: String(e) });
  }
});

// create session (optional body: { startNodeId })
// 📍 In Datei: index.js (GitHub Web-Editor) – ersetzt /sessions
app.post("/sessions", async (req, res) => {
  const client = await pool.connect();
  try {
    // Validierung vor BEGIN
    let startNodeId = req.body?.startNodeId ?? null;
    if (startNodeId !== null) {
      const n = Number(startNodeId);
      if (!Number.isFinite(n)) return res.status(400).json({ error: "invalid startNodeId" });
      startNodeId = n;
      const chk = await client.query("select 1 from node where id=$1", [startNodeId]);
      if (chk.rowCount === 0) return res.status(400).json({ error: "invalid startNodeId" });
    }

    await client.query("BEGIN");
    const q = await client.query(
      `insert into session (current_node_id, state_json, status)
       values ($1, '{}'::jsonb, 'running') returning id`,
      [startNodeId]
    );
    await client.query("COMMIT");

    const id = q.rows[0].id;
    res.setHeader("Location", `/sessions/${id}`);
    res.status(201).json({ id });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "create_failed", message: String(e) });
  } finally {
    client.release();
  }
});


// get session (returns node + options)

app.get("/sessions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_session_id" });
  const s = await pool.query(`select * from session where id=$1`, [id]);
});

  if (!s.rowCount) return res.status(404).json({ error: "not_found" });

  const session = s.rows[0];

  // options: all edges from current_node (if set), otherwise empty
  let options = [];
  if (session.current_node_id) {
    const e = await pool.query(
      `select id, label, to_node_id from edge where from_node_id=$1 order by id asc`,
      [session.current_node_id]
    );
    options = e.rows;
  }
  res.json({
    id: session.id,
    status: session.status,
    currentNodeId: session.current_node_id,
    state: session.state_json,
    options,
  });
});

// apply decision: { edgeId }
// 📍 In Datei: index.js (GitHub Web-Editor) – ersetzt /sessions/:id/decision
app.post("/sessions/:id/decision", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  const edgeId = Number(req.body?.edgeId);
  if (!Number.isFinite(edgeId)) return res.status(400).json({ error: "edgeId_required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const s = await client.query(`select * from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }

    const session = s.rows[0];
    if (!session.current_node_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_current_node_set" });
    }

    const e = await client.query(`select * from edge where id=$1`, [edgeId]);
    if (!e.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "edge_not_found" });
    }

    const edge = e.rows[0];
    if (edge.from_node_id !== session.current_node_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "edge_not_from_current_node" });
    }

    // TODO: conditions/effects später
    await client.query(
      `insert into decision (session_id, node_id, chosen_edge_id)
       values ($1, $2, $3)`,
      [session.id, session.current_node_id, edge.id]
    );
    await client.query(
      `update session set current_node_id=$1, updated_at=now() where id=$2`,
      [edge.to_node_id, session.id]
    );

    await client.query("COMMIT");
    res.json({ ok: true, toNodeId: edge.to_node_id });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "apply_failed", message: String(e) });
  } finally {
    client.release();
  }
});


app.listen(port, () => console.log("Server on :" + port));

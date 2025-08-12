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

  try {
    const s = await pool.query(`select * from session where id=$1`, [id]);
    if (!s.rowCount) return res.status(404).json({ error: "not_found" });

    const session = s.rows[0];

    // Optionen sammeln
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "read_failed", message: String(err) });
  }
});

// 📍 In Datei: index.js (GitHub Web-Editor) — neue Route: dynamische Edges anlegen
app.post("/sessions/:id/expand", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  const edges = req.body?.edges;
  if (!Array.isArray(edges) || edges.length === 0) {
    return res.status(400).json({ error: "edges_required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Session sperren & aktuellen Node bestimmen
    const s = await client.query(`select * from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }
    const session = s.rows[0];
    const fromNodeId = session.current_node_id;
    if (!fromNodeId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_current_node_set" });
    }

    const addedEdges = [];

    for (const spec of edges) {
      // 1) Label prüfen
      const label = (spec?.label ?? "").trim();
      if (!label) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "edge_label_required" });
      }

      // 2) Ziel bestimmen: genau EINES von newNode ODER toNodeId
      const hasNew = !!spec?.newNode;
      const hasTo = spec?.toNodeId !== undefined && spec?.toNodeId !== null;

      if (hasNew === hasTo) { // beides true ODER beides false
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "choose_newNode_or_toNodeId" });
      }

      let toNodeId;

      if (hasNew) {
        const title = (spec.newNode?.title ?? "").trim();
        const content = spec.newNode?.content ?? {};
        if (!title) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "newNode_title_required" });
        }
        const ins = await client.query(
          `insert into node (title, content_json) values ($1, $2) returning id`,
          [title, content]
        );
        toNodeId = ins.rows[0].id;
      } else {
        toNodeId = Number(spec.toNodeId);
        if (!Number.isFinite(toNodeId)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "invalid_toNodeId" });
        }
        const chk = await client.query(`select 1 from node where id=$1`, [toNodeId]);
        if (!chk.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "invalid_toNodeId" });
        }
      }

      // (Optional) Labels pro fromNode einzigartig machen
      const dup = await client.query(
        `select 1 from edge where from_node_id=$1 and lower(label)=lower($2)`,
        [fromNodeId, label]
      );
      if (dup.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "edge_conflict", detail: "label exists for this node" });
      }

      // (Optional) spätere Felder condition/effect/weight vorbereiten
      const condition = spec?.condition ?? {};
      const effect = spec?.effect ?? {};

      const e = await client.query(
        `insert into edge (from_node_id, to_node_id, label, condition_json, effect_json)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [fromNodeId, toNodeId, label, condition, effect]
      );

      addedEdges.push({ id: e.rows[0].id, label, toNodeId });
    }

    await client.query("COMMIT");
    res.json({ sessionId, fromNodeId, addedEdges });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(err);
    res.status(500).json({ error: "expand_failed", message: String(err) });
  } finally {
    client.release();
  }
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

// Admin: Nodes anzeigen
app.get("/admin/nodes", async (_req, res) => {
  const nodes = await pool.query("SELECT id, title FROM node ORDER BY id ASC");
  res.json(nodes.rows);
});

// Admin: Reset + Seed
app.post("/admin/reset", async (_req, res) => {
  try {
    const seed = require("./seed");
    const result = await seed();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: "reset_failed", message: String(err) });
  }
});

// 📍 In Datei: index.js — Startknoten dynamisch setzen
app.post("/sessions/:id/start", async (req, res) => {
  const sessionId = Number(req.params.id);
  const { nodeTitle, nodeContent } = req.body || {};

  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });
  if (!nodeTitle || !nodeTitle.trim()) return res.status(400).json({ error: "nodeTitle_required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Session prüfen & sperren
    const s = await client.query(`SELECT * FROM session WHERE id=$1 FOR UPDATE`, [sessionId]);
    if (!s.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }
    const session = s.rows[0];

    // Falls bereits gesetzt, optional 409 zurück (wir erlauben idempotente Setzung)
    if (session.current_node_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "already_started", currentNodeId: session.current_node_id });
    }

    // Neuen Start-Node anlegen
    const ins = await client.query(
      `INSERT INTO node (title, content_json) VALUES ($1, $2) RETURNING id, title, content_json`,
      [String(nodeTitle).trim(), nodeContent || {}]
    );
    const newNode = ins.rows[0];

    // Session auf diesen Node setzen
    await client.query(
      `UPDATE session SET current_node_id=$1, updated_at=now() WHERE id=$2`,
      [newNode.id, sessionId]
    );

    await client.query("COMMIT");
    res.json({ ok: true, startNode: newNode });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "start_failed", message: String(e) });
  } finally {
    client.release();
  }
});


app.post("/sessions/:id/add-option", async (req, res) => {
  const sessionId = Number(req.params.id);
  const { label, nodeTitle, nodeContent } = req.body;

  if (!label || !nodeTitle) {
    return res.status(400).json({ error: "label_and_nodeTitle_required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Session prüfen
    const s = await client.query(`SELECT * FROM session WHERE id=$1 FOR UPDATE`, [sessionId]);
    if (!s.rowCount) return res.status(404).json({ error: "session_not_found" });
    const session = s.rows[0];
    if (!session.current_node_id) {
      return res.status(400).json({ error: "no_current_node_set" });
    }

    // Neuen Node erstellen
    const newNode = await client.query(
      `INSERT INTO node (title, content_json) VALUES ($1, $2) RETURNING id, title, content_json`,
      [nodeTitle, nodeContent || {}]
    );

    const newNodeId = newNode.rows[0].id;

    // Neue Edge erstellen
    const newEdge = await client.query(
      `INSERT INTO edge (from_node_id, to_node_id, label) VALUES ($1, $2, $3) RETURNING id, label, to_node_id`,
      [session.current_node_id, newNodeId, label]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      newNode: newNode.rows[0],
      newEdge: newEdge.rows[0]
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "add_option_failed", message: String(e) });
  } finally {
    client.release();
  }
});

// 📍 In Datei: index.js — Edge bearbeiten (Label / Ziel / Condition / Effect)
app.patch("/edges/:edgeId", async (req, res) => {
  const edgeId = Number(req.params.edgeId);
  if (!Number.isFinite(edgeId)) return res.status(400).json({ error: "invalid_edge_id" });

  const { label, toNodeId, condition, effect } = req.body || {};
  if (label === undefined && toNodeId === undefined && condition === undefined && effect === undefined) {
    return res.status(400).json({ error: "no_fields_to_update" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // aktuelle Edge + from_node holen (für Validierung/Uniqueness)
    const cur = await client.query(`select * from edge where id=$1 for update`, [edgeId]);
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "edge_not_found" });
    }
    const edge = cur.rows[0];

    // Validierungen
    let newLabel = label !== undefined ? String(label).trim() : edge.label;
    if (!newLabel) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "label_required" });
    }

    let newToNodeId = edge.to_node_id;
    if (toNodeId !== undefined) {
      const n = Number(toNodeId);
      if (!Number.isFinite(n)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_toNodeId" });
      }
      const chk = await client.query(`select 1 from node where id=$1`, [n]);
      if (!chk.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_toNodeId" });
      }
      newToNodeId = n;
    }

    // (optional) Label-Unique je from_node_id absichern
    if (newLabel && newLabel.toLowerCase() !== String(edge.label).toLowerCase()) {
      const dup = await client.query(
        `select 1 from edge where from_node_id=$1 and lower(label)=lower($2) and id<>$3`,
        [edge.from_node_id, newLabel, edgeId]
      );
      if (dup.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "edge_conflict", detail: "label exists for this node" });
      }
    }

    const newCondition = condition !== undefined ? condition : edge.condition_json ?? {};
    const newEffect    = effect    !== undefined ? effect    : edge.effect_json ?? {};

    const upd = await client.query(
      `update edge
         set label=$1,
             to_node_id=$2,
             condition_json=$3,
             effect_json=$4,
             updated_at=now()
       where id=$5
       returning id, from_node_id, to_node_id, label, condition_json, effect_json`,
      [newLabel, newToNodeId, newCondition, newEffect, edgeId]
    );

    await client.query("COMMIT");
    res.json({ ok: true, edge: upd.rows[0] });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "edge_update_failed", message: String(e) });
  } finally {
    client.release();
  }
});

//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
app.listen(port, () => console.log("Server on :" + port));

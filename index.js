// --- Condition/Effekt: Evaluator ---
function getAtPath(state, path) {
  // Pfad wie "inventory.key" oder "flags.visitedNorth"
  return String(path || "").split(".").filter(Boolean).reduce((acc, k) => (acc ?? {})[k], state);
}
function setAtPath(state, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let obj = state;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof obj[k] !== "object" || obj[k] === null) obj[k] = {};
    obj = obj[k];
  }
  obj[parts[parts.length - 1]] = value;
  return state;
}

function evalSingleCond(state, c) {
  // Schema: { key, op, value } | { exists, key } | { notExists, key }
  if (!c) return true;
  if (c.exists) return getAtPath(state, c.key) !== undefined;
  if (c.notExists) return getAtPath(state, c.key) === undefined;

  const cur = getAtPath(state, c.key);
  const v = c.value;
  switch (c.op) {
    case "==": return cur === v;
    case "!=": return cur !== v;
    case ">":  return typeof cur === "number" && cur >  v;
    case "<":  return typeof cur === "number" && cur <  v;
    case ">=": return typeof cur === "number" && cur >= v;
    case "<=": return typeof cur === "number" && cur <= v;
    case "in": return Array.isArray(v) && v.includes(cur);
    case "not-in": return Array.isArray(v) && !v.includes(cur);
    case "includes":
      if (Array.isArray(cur)) return cur.includes(v);
      if (typeof cur === "string") return cur.includes(String(v));
      return false;
    default: return true; // unbekannte Ops ignorieren (fail-open)
  }
}
function evalCondition(state, condition = {}) {
  // condition = { all?: [], any?: [], not?: [] } oder { requires?: [] } (alt)
  const all = condition.all ?? condition.requires ?? [];
  const any = condition.any ?? [];
  const not = condition.not ?? [];
  const allOk = all.every(c => evalSingleCond(state, c));
  const anyOk = any.length === 0 ? true : any.some(c => evalSingleCond(state, c));
  const notOk = not.every(c => !evalSingleCond(state, c));
  return allOk && anyOk && notOk;
}

function applyEffect(state, effect = {}) {
  // effect = { set?: {k:v,...}, add?: {k:num,...}, toggle?: [k,...], push?: {k:val,...}, remove?: [k,...] }
  const next = JSON.parse(JSON.stringify(state || {}));

  if (effect.set) {
    for (const [k, v] of Object.entries(effect.set)) setAtPath(next, k, v);
  }
  if (effect.add) {
    for (const [k, n] of Object.entries(effect.add)) {
      const cur = getAtPath(next, k);
      setAtPath(next, k, (Number(cur) || 0) + Number(n));
    }
  }
  if (Array.isArray(effect.toggle)) {
    for (const k of effect.toggle) {
      const cur = !!getAtPath(next, k);
      setAtPath(next, k, !cur);
    }
  }
  if (effect.push) {
    for (const [k, v] of Object.entries(effect.push)) {
      const cur = getAtPath(next, k);
      if (Array.isArray(cur)) { cur.push(v); }
      else { setAtPath(next, k, [v]); }
    }
  }
  if (Array.isArray(effect.remove)) {
    for (const k of effect.remove) {
      const parts = String(k).split(".").filter(Boolean);
      const last = parts.pop();
      let obj = next;
      for (const p of parts) { obj = obj?.[p]; }
      if (obj && Object.prototype.hasOwnProperty.call(obj, last)) delete obj[last];
    }
  }

  return next;
}




// 📍 In Datei: index.js (GitHub Web-Editor)
const express = require("express");
const { pingDb, pool } = require("./db");

const app = express();
const port = process.env.PORT || 8080;

// simple API key check (Health & Admin-UI sind öffentlich lesbar)
app.use((req, res, next) => {
  // Public: health + statische Admin-UI
  if (req.path === "/health" || req.path.startsWith("/admin-ui")) return next();

  // Key aus Header ODER Query (falls mal nötig ?key=...)
  const key = req.header("x-api-key") || req.query.key;
  const expected = process.env.API_KEY;

  // Wenn kein erwarteter Key gesetzt ist -> durchlassen
  if (!expected) return next();

  // Prüfen
  if (key === expected) return next();

  return res.status(401).json({ error: "unauthorized" });
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
     // Optionen gefiltert nach condition_json
  let options = [];
  if (session.current_node_id) {
    const e = await pool.query(
      `select id, label, to_node_id, condition_json from edge where from_node_id=$1 order by id asc`,
      [session.current_node_id]
    );
    const st = session.state_json || {};
    options = e.rows.filter(row => evalCondition(st, row.condition_json));
    // Für die Antwort brauchen wir condition nicht:
    options = options.map(({ id, label, to_node_id }) => ({ id, label, to_node_id }));
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

// 📍 In Datei: index.js — Entscheidungsverlauf einer Session
app.get("/sessions/:id/history", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    const q = await pool.query(
      `
      SELECT
        d.id,
        d.created_at,
        d.node_id           AS from_node_id,
        n1.title            AS from_title,
        e.label             AS edge_label,
        e.to_node_id        AS to_node_id,
        n2.title            AS to_title
      FROM decision d
      JOIN edge   e  ON e.id = d.chosen_edge_id
      LEFT JOIN node n1 ON n1.id = d.node_id
      LEFT JOIN node n2 ON n2.id = e.to_node_id
      WHERE d.session_id = $1
      ORDER BY d.created_at ASC, d.id ASC
      `,
      [sessionId]
    );
    res.json({ sessionId, history: q.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "history_failed", message: String(e) });
  }
});

// 📍 In Datei: index.js — Rewind: letzte n Entscheidungen zurücknehmen
app.post("/sessions/:id/rewind", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  const steps = Number(req.body?.steps);
  if (!Number.isFinite(steps) || steps < 1) {
    return res.status(400).json({ error: "invalid_steps", hint: "steps must be >= 1" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Alle Entscheidungen inkl. Ziel/Effect holen (chronologisch)
    const all = await client.query(
      `
      SELECT
        d.id,
        d.node_id,
        e.to_node_id,
        e.effect_json,
        d.created_at
      FROM decision d
      JOIN edge e ON e.id = d.chosen_edge_id
      WHERE d.session_id = $1
      ORDER BY d.created_at ASC, d.id ASC
      `,
      [sessionId]
    );

    const count = all.rowCount;
    if (count === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "nothing_to_rewind" });
    }
    if (steps > count) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "steps_exceed_history", available: count });
    }

    const rows = all.rows;
    const cutoff = count - steps;                // Anzahl verbleibender Entscheidungen
    const remaining = rows.slice(0, cutoff);     // bleiben
    const toDelete  = rows.slice(cutoff);        // werden zurückgenommen

    // Entscheidungen löschen (die letzten 'steps')
    const idsToDelete = toDelete.map(r => r.id);
    await client.query(`DELETE FROM decision WHERE id = ANY($1::int[])`, [idsToDelete]);

    // State neu aufbauen, indem wir die verbleibenden Decisions re‑playen
    let newState = {};
    for (const r of remaining) {
      const eff = r.effect_json || {};
      // applyEffect aus deinem Code nutzen:
      newState = (typeof applyEffect === "function")
        ? applyEffect(newState, eff)
        : newState;
    }

    // Neuen current_node_id bestimmen:
    // - wenn noch Entscheidungen übrig: letztes remaining -> to_node_id
    // - sonst: Startknoten = node_id der ersten (ursprünglichen) Entscheidung
    let newCurrentNodeId;
    if (remaining.length > 0) {
      newCurrentNodeId = remaining[remaining.length - 1].to_node_id;
    } else {
      // keine verbleibenden Entscheidungen -> zurück auf den Startknoten (erste ursprüngliche node_id)
      newCurrentNodeId = rows[0].node_id;
    }

    await client.query(
      `UPDATE session SET current_node_id=$1, state_json=$2, updated_at=now() WHERE id=$3`,
      [newCurrentNodeId, newState, sessionId]
    );

    await client.query("COMMIT");
    res.json({
      ok: true,
      sessionId,
      steps,
      newCurrentNodeId,
      remainingDecisions: remaining.length
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "rewind_failed", message: String(e) });
  } finally {
    client.release();
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

        // Effect anwenden
    const newState = applyEffect(session.state_json || {}, edge.effect_json || {});

   
    await client.query(
      `insert into decision (session_id, node_id, chosen_edge_id)
       values ($1, $2, $3)`,
      [session.id, session.current_node_id, edge.id]
    );
    await client.query(
      `update session set current_node_id=$1, state_json=$2, updated_at=now() where id=$3`,
      [edge.to_node_id, newState, session.id]
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


// 📍 In Datei: index.js — Edge löschen
app.delete("/edges/:edgeId", async (req, res) => {
  const edgeId = Number(req.params.edgeId);
  if (!Number.isFinite(edgeId)) return res.status(400).json({ error: "invalid_edge_id" });

  try {
    const del = await pool.query(`delete from edge where id=$1 returning id`, [edgeId]);
    if (!del.rowCount) return res.status(404).json({ error: "edge_not_found" });
    res.json({ ok: true, deletedEdgeId: edgeId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "edge_delete_failed", message: String(e) });
  }
});

// Snapshot anlegen
app.post("/sessions/:id/snapshot", async (req, res) => {
  const sessionId = Number(req.params.id);
  const label = (req.body?.label ?? "").toString().trim() || null;
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    const s = await pool.query(`SELECT id, current_node_id, state_json FROM session WHERE id=$1`, [sessionId]);
    if (!s.rowCount) return res.status(404).json({ error: "session_not_found" });
    const session = s.rows[0];

    const ins = await pool.query(
      `INSERT INTO snapshot (session_id, label, state_json, current_node_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, session_id, label, current_node_id, created_at`,
      [sessionId, label, session.state_json || {}, session.current_node_id]
    );

    res.status(201).json({ ok: true, snapshot: ins.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "snapshot_failed", message: String(e) });
  }
});

// Snapshots einer Session auflisten
app.get("/sessions/:id/snapshots", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    const q = await pool.query(
      `SELECT id, label, current_node_id, created_at
       FROM snapshot
       WHERE session_id=$1
       ORDER BY created_at DESC, id DESC`,
      [sessionId]
    );
    res.json({ sessionId, snapshots: q.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "list_snapshots_failed", message: String(e) });
  }
});

// Snapshot wiederherstellen
app.post("/sessions/:id/restore/:snapId", async (req, res) => {
  const sessionId = Number(req.params.id);
  const snapId = Number(req.params.snapId);
  const clearHistory = Boolean(req.body?.clearHistory); // optional
  if (!Number.isFinite(sessionId) || !Number.isFinite(snapId))
    return res.status(400).json({ error: "invalid_ids" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const s = await client.query(`SELECT id FROM session WHERE id=$1 FOR UPDATE`, [sessionId]);
    if (!s.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }

    const snap = await client.query(
      `SELECT id, state_json, current_node_id FROM snapshot WHERE id=$1 AND session_id=$2`,
      [snapId, sessionId]
    );
    if (!snap.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "snapshot_not_found" });
    }
    const { state_json, current_node_id } = snap.rows[0];

    // Optional: History leeren (alle Entscheidungen entfernen)
    if (clearHistory) {
      await client.query(`DELETE FROM decision WHERE session_id=$1`, [sessionId]);
    }

    await client.query(
      `UPDATE session SET current_node_id=$1, state_json=$2, updated_at=now() WHERE id=$3`,
      [current_node_id, state_json || {}, sessionId]
    );

    await client.query("COMMIT");
    res.json({ ok: true, sessionId, restoredTo: { snapId, currentNodeId: current_node_id } });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "restore_failed", message: String(e) });
  } finally {
    client.release();
  }
});

// Snapshot löschen (optional)
app.delete("/sessions/:id/snapshots/:snapId", async (req, res) => {
  const sessionId = Number(req.params.id);
  const snapId = Number(req.params.snapId);
  if (!Number.isFinite(sessionId) || !Number.isFinite(snapId))
    return res.status(400).json({ error: "invalid_ids" });

  try {
    const del = await pool.query(
      `DELETE FROM snapshot WHERE id=$1 AND session_id=$2 RETURNING id`,
      [snapId, sessionId]
    );
    if (!del.rowCount) return res.status(404).json({ error: "snapshot_not_found" });
    res.json({ ok: true, deletedSnapshotId: snapId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "delete_snapshot_failed", message: String(e) });
  }
});

// Session-State patchen (set/remove mit unserem applyEffect)
app.patch("/sessions/:id/state", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  // Body: { set?: {...}, add?: {...}, toggle?: [...], push?: {...}, remove?: [...] }
  const effect = {
    set:    req.body?.set,
    add:    req.body?.add,
    toggle: req.body?.toggle,
    push:   req.body?.push,
    remove: req.body?.remove
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = await client.query(`SELECT id, state_json, current_node_id FROM session WHERE id=$1 FOR UPDATE`, [sessionId]);
    if (!s.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "session_not_found" }); }

    const cur = s.rows[0];
    const nextState = applyEffect(cur.state_json || {}, effect || {});
    await client.query(
      `UPDATE session SET state_json=$1, updated_at=now() WHERE id=$2`,
      [nextState, sessionId]
    );
    await client.query("COMMIT");
    res.json({ ok: true, state: nextState });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "state_patch_failed", message: String(e) });
  } finally {
    client.release();
  }
});

// Graph für eine Session
app.get("/sessions/:id/graph", async (req, res) => {
  const sessionId = Number(req.params.id);
  const mode = String(req.query.mode || "all").toLowerCase();
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    // aktuellen Knoten holen (für Farbcodierung und fallback)
    const s = await pool.query(`select current_node_id from session where id=$1`, [sessionId]);
    if (!s.rowCount) return res.status(404).json({ error: "session_not_found" });
    const currentNodeId = s.rows[0].current_node_id;

    if (mode === "visited") {
      // besuchte Knoten = from_node_id / to_node_id aus decisions + current_node_id
      const q = await pool.query(
        `
        with decs as (
          select d.node_id as from_id, e.to_node_id as to_id, e.id as edge_id
          from decision d
          join edge e on e.id = d.chosen_edge_id
          where d.session_id = $1
        ),
        nodeset as (
          select from_id as id from decs
          union
          select to_id   as id from decs
          union
          select $2::int as id
        )
        select
          coalesce(json_agg(n order by n.id), '[]'::json) as nodes,
          coalesce(json_agg(ed order by ed.id), '[]'::json) as edges
        from
          (select id, title from node where id in (select id from nodeset) and id is not null) n,
          lateral (
            select e.id, e.from_node_id, e.to_node_id, e.label
            from edge e
            where e.id in (select edge_id from decs)
          ) ed
        `,
        [sessionId, currentNodeId ?? null]
      );

      // Wenn keine Decisions existieren, kippt das CROSS-Product obigen SELECTs auf null zurück.
      // Fallback: nur currentNode als einzelner Knoten.
      let nodes = [];
      let edges = [];
      if (q.rowCount && q.rows[0].nodes && Array.isArray(q.rows[0].nodes)) {
        nodes = q.rows[0].nodes;
      }
      if (q.rowCount && q.rows[0].edges && Array.isArray(q.rows[0].edges)) {
        edges = q.rows[0].edges;
      }
      if (!nodes.length && currentNodeId) {
        const one = await pool.query(`select id, title from node where id=$1`, [currentNodeId]);
        nodes = one.rows;
        edges = [];
      }

      const visitedNodeIds = nodes.map(n => n.id);
      return res.json({ sessionId, mode, currentNodeId, visitedNodeIds, nodes, edges });
    }

    // mode = all
    const [nodes, edges] = await Promise.all([
      pool.query(`select id, title from node order by id asc`),
      pool.query(`select id, from_node_id, to_node_id, label from edge order by id asc`)
    ]);
    res.json({
      sessionId, mode, currentNodeId,
      visitedNodeIds: [], // optional
      nodes: nodes.rows,
      edges: edges.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "graph_failed", message: String(e) });
  }
});


// Static Admin-UI (serves files from /public)
const path = require("path");
app.use("/admin-ui", express.static(path.join(__dirname, "public")));

//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
app.listen(port, () => console.log("Server on :" + port));

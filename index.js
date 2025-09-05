// ==== Manual Parser & Endpoint (drop-in) ====
// direkt unter deinen require(...) Aufrufen einfügen:
const fs = require("fs").promises;
const path = require("path");

// @SECTION/@FIELD Parser – KEINE Normalisierung der Feldnamen
function parseManual(md) {
  const out = {
    policy_version: "1.0.0",
    storyframe: {},
    canon: {},
    limits: {},
    visual: {},
    taboos: []
  };

  const lines = String(md || "").split(/\r?\n/);
  let currentSection = null;

  // Zuordnung der SECTION → Zielobjekt
  const targetForSection = (raw) => {
    if (!raw) return null;
    const s = raw.toLowerCase();
    if (s.includes("2.1") || s.includes("storyframe")) return "storyframe";
    if (s.includes("2.2") || s.includes("canon/world") || s.includes("canon")) return "canon";
    if (s.includes("limits")) return "limits";
    if (s.includes("visual")) return "visual";
    if (s.includes("tabu")) return "taboos";
    return null;
  };

  const setKV = (obj, keyRaw, valRaw) => {
    if (!obj) return;
    const key = String(keyRaw).trim();     // Feldnamen bleiben exakt wie im Manual
    const val = String(valRaw).trim();
    if (val === "") { obj[key] = ""; return; }
    obj[key] = val.includes(",")
      ? val.split(",").map(s => s.trim()).filter(Boolean)
      : val;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // SECTION: @SECTION:<name> oder Markdown-Heading "## …"
    let m = line.match(/^@SECTION\s*:\s*(.+)$/i);
    if (m) { currentSection = m[1].trim(); continue; }
    m = line.match(/^#{1,6}\s+(.+)$/);
    if (m) { currentSection = m[1].trim(); continue; }

    // FIELD: `@FIELD:key` (optional) : value
    m = line.match(/^`?@FIELD\s*:\s*([^`]+?)`?\s*(?:\([^)]+\))?\s*:\s*(.*)$/i);
    if (m) {
      const tgtName = targetForSection(currentSection);
      const tgt =
        tgtName === "storyframe" ? out.storyframe :
        tgtName === "canon"      ? out.canon :
        tgtName === "limits"     ? out.limits :
        tgtName === "visual"     ? out.visual :
        tgtName === "taboos"     ? out : null;

      if (tgtName === "taboos") {
        const val = m[2].trim();
        if (val) {
          const arr = val.includes(",") ? val.split(",").map(s=>s.trim()).filter(Boolean) : [val];
          out.taboos.push(...arr);
        }
      } else {
        setKV(tgt, m[1], m[2]);
      }
    }
  }

  // Komfort: pitch_auto, wenn pitch leer oder fehlt
  if ("pitch" in out.storyframe) {
    const pv = String(out.storyframe["pitch"] || "").trim();
    if (!pv) { out.storyframe["pitch_auto"] = true; delete out.storyframe["pitch"]; }
  } else {
    out.storyframe["pitch_auto"] = true;
  }

  return out;
}

// GET /manual/json – liefert kompiliertes JSON aus der .md neben index.js
app.get("/manual/json", async (_req, res) => {
  try {
    const manualPath = process.env.MANUAL_PATH || path.join(__dirname, "Story_Design_Manual.md");
    const md = await fs.readFile(manualPath, "utf8");
    const json = parseManual(md);
    res.json(json);
  } catch (err) {
    console.error("manual/json parse_failed:", err);
    res.status(500).json({ error: "parse_failed", detail: String(err) });
  }
});
// ==== /Manual Parser & Endpoint ====



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


function resolveEdgeByVoteMap(options, text) {
  if (!text) return null;
  const t = String(text).toLowerCase();

  for (const opt of options) {
    const map = opt.vote_map_json || {};

    // Unterstütze ALLE Felder: aliases, patterns (Alt), regex
    const aliases = Array.isArray(map.aliases)  ? map.aliases  : [];
    const patterns = Array.isArray(map.patterns) ? map.patterns : []; // <- Alt
    const regexes = Array.isArray(map.regex)    ? map.regex    : [];

    // 1) aliases
    for (const a of aliases) {
      const aa = String(a || '').toLowerCase();
      if (aa && t.includes(aa)) return Number(opt.id);
    }

    // 2) patterns (Alt-Schema, identisch wie aliases behandeln)
    for (const p of patterns) {
      const pp = String(p || '').toLowerCase();
      if (pp && t.includes(pp)) return Number(opt.id);
    }

    // 3) regex
    for (const r of regexes) {
      try {
        const re = new RegExp(r, "i");
        if (re.test(t)) return Number(opt.id);
      } catch {} // invalid regex? skip
    }
  }
  return null;
}

// ---- Restream Token Helpers (DB) ----
async function getRestreamToken() {
  const q = await pool.query(`select * from restream_token where id=1`);
  return q.rowCount ? q.rows[0] : null;
}

async function saveRestreamToken({ access_token, refresh_token, expires_in }) {
  const expires_at = new Date(Date.now() + (Math.max(30, Number(expires_in || 3600)) * 1000)); // default 1h
  await pool.query(`
    insert into restream_token (id, access_token, refresh_token, expires_at)
    values (1, $1, $2, $3)
    on conflict (id) do update
    set access_token=$1, refresh_token=$2, expires_at=$3
  `, [access_token, refresh_token, expires_at]);
  return { access_token, refresh_token, expires_at };
}




// ----- Vote Parsing (sehr einfach, MVP) -----
const EMOJI_MAP = new Map([ ["👍",1], ["👎",2], ["1️⃣",1], ["2️⃣",2], ["3️⃣",3], ["4️⃣",4] ]);
function parseVoteIndex(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim().toLowerCase();
  // Befehle: !vote 2 | vote 2 | #2 | option 2
  const m = t.match(/(?:!?\s*vote|option|#)\s*([1-9][0-9]?)/) || t.match(/\b([1-9][0-9]?)\b/);
  if (m) return Number(m[1]);
  for (const [emo, idx] of EMOJI_MAP) if (t.includes(emo)) return idx;
  return null;
}

// Sichtbare Optionen (wie im GET /sessions/:id)
async function getVisibleOptions(sessionId) {
  const s = await pool.query(`select current_node_id, state_json from session where id=$1`, [sessionId]);
  if (!s.rowCount) return { currentNodeId: null, options: [] };
  const { current_node_id, state_json } = s.rows[0];
  if (!current_node_id) return { currentNodeId: null, options: [] };
  const e = await pool.query(
  `select id, label, to_node_id, condition_json, vote_map_json
     from edge
    where from_node_id=$1
    order by id asc`,
  [current_node_id]
);

  const st = state_json || {};
  const visible = e.rows.filter(row => evalCondition(st, row.condition_json));
  return { currentNodeId: current_node_id, options: visible };
}

// Stimmen abgeben (interne Helper)
async function castVote(sessionId, edgeId, voterId) {
  // reuse deines vote/cast Codes direkt hier (kleiner interner Call)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = await client.query(`select id, state_json from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) { await client.query("ROLLBACK"); return { ok:false, error:"session_not_found" }; }
    const state = s.rows[0].state_json || {};
    const vote = state.vote;
    if (!vote?.active) { await client.query("ROLLBACK"); return { ok:false, error:"no_active_vote" }; }

    const allowed = new Set((vote.options || []).map(Number));
    if (!allowed.has(edgeId)) { await client.query("ROLLBACK"); return { ok:false, error:"edge_not_in_vote" }; }

    vote.voters = vote.voters || {};
    if (voterId) {
      const prev = vote.voters[voterId];
      if (prev && prev !== edgeId) {
        vote.tally[String(prev)] = Math.max(0, Number(vote.tally[String(prev)] || 0) - 1);
      }
      vote.voters[voterId] = edgeId;
    }
    vote.tally[String(edgeId)] = Number(vote.tally[String(edgeId)] || 0) + 1;

    const next = { ...state, vote };
    await client.query(`update session set state_json=$1, updated_at=now() where id=$2`, [next, sessionId]);
    await client.query("COMMIT");

    if (typeof publish === "function") publish(sessionId, "vote/tally", { tally: vote.tally });
    return { ok:true };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    return { ok:false, error:String(e) };
  } finally {
    client.release();
  }
}

// Einfacher Worker: verarbeitet neue chat_event Zeilen -> Vote
const VOTE_COOLDOWN_MS = 4000; // per user/session
const lastVoteMap = new Map(); // key: sessionId|userId

setInterval(async () => {
  try {
    // Hole ein paar ungearbeitete Events
    const q = await pool.query(`
      select id, session_id, platform, user_id, username, message, kind, payload_json, created_at
      from chat_event
      where processed_at is null
      order by created_at asc
      limit 50
    `);

    for (const ev of q.rows) {
      const key = `${ev.session_id}|${ev.user_id}`;
      const now = Date.now();
      const last = lastVoteMap.get(key) || 0;

      let handled = false;
      let outcome = null;

      // Sichtbare Optionen am aktuellen Node
      const { options } = await getVisibleOptions(ev.session_id);

      // Textquelle bestimmen (Nachricht oder z.B. Reaktions-Name)
      const text =
        (ev.message || "").toString() ||
        (ev.payload_json?.reaction_text || ev.payload_json?.reaction || "").toString();

      // Nur wenn Optionen vorhanden & Vote aktiv: versuchen zu mappen
      if (options.length) {
        // 1) Alias/Regex-Mapping über vote_map_json
        let edgeId = resolveEdgeByVoteMap(options, text);

        // 2) Fallback: numerische Indizes (!vote 2, #2, 1️⃣, …)
        if (!edgeId) {
          const idx = parseVoteIndex(text);
          if (idx && idx >= 1 && idx <= options.length) {
            edgeId = Number(options[idx - 1].id);
          }
        }

        // Wenn wir eine Option erkannt haben → Stimme abgeben (mit Cooldown)
        if (edgeId) {
          if (now - last >= VOTE_COOLDOWN_MS) {
            const r = await castVote(ev.session_id, edgeId, `${ev.platform}:${ev.user_id}`);
            handled = !!r.ok;
            outcome = r.ok ? `vote->edge:${edgeId}` : r.error;
            if (r.ok) lastVoteMap.set(key, now);
          } else {
            handled = true;
            outcome = "cooldown";
          }
        }
      }

      await pool.query(
        `update chat_event
            set processed_at = now(),
                payload_json = jsonb_set(coalesce(payload_json,'{}'::jsonb),'{outcome}', to_jsonb($1::text), true)
          where id=$2`,
        [ outcome || "ignored", ev.id ]
      );

      if (typeof publish === "function") {
        publish(ev.session_id, "ingest/processed", {
          platform: ev.platform,
          username: ev.username,
          message: ev.message,
          outcome: outcome || "ignored"
        });
      }
    }
  } catch (e) {
    console.error("ingest worker error", e);
  }
}, 200);




// 📍 In Datei: index.js (GitHub Web-Editor)
const express = require("express");
const { pingDb, pool } = require("./db");

const app = express();
const port = process.env.PORT || 8080;

// simple API key check (Health & Admin-UI sind öffentlich lesbar)
app.use((req, res, next) => {
  // Public: health + statische Admin-UI
  if (req.path === "/health" || req.path.startsWith("/admin-ui") || req.path === "/ws" || req.path === "/restream/login" || req.path === "/oauth/restream/callback" || req.path === "/bridge/status" || req.path === "/restream/webchat-url" ||  req.path === "/ingest/message") return next();


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
    
publish(q.rows[0].id, "session/created", {});

    

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
    publish(sessionId, "rewind/applied", { steps, newCurrentNodeId });

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


// ----- REPLACE: /sessions/:id/expand -----
app.post("/sessions/:id/expand", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ error: "invalid_session_id" });
  }

  const edges = Array.isArray(req.body?.edges) ? req.body.edges : null;
  if (!edges || edges.length === 0) {
    return res.status(400).json({ error: "edges_required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Session + current node locken
    const s = await client.query(
      `select * from session where id=$1 for update`,
      [sessionId]
    );
    if (!s.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }
    const session = s.rows[0];
    if (!session.current_node_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_current_node_set" });
    }

    const created = []; // { edge, node? }

    for (const item of edges) {
      const label = (item?.label || "").trim();
      if (!label) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "edge_label_required" });
      }

      let toNodeId = Number(item?.toNodeId);
      let newNode = null;

      // Optional: neuen Ziel-Node anlegen, falls nodeTitle angegeben ist
      if (!Number.isFinite(toNodeId)) {
        const nodeTitle = (item?.nodeTitle || "").trim();
        const nodeContent = item?.nodeContent ?? {};
        if (!nodeTitle) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "either_toNodeId_or_nodeTitle_required" });
        }

        const insNode = await client.query(
          `insert into node (title, content_json) values ($1, $2::jsonb)
           returning id, title, content_json`,
          [nodeTitle, JSON.stringify(nodeContent ?? {})]
        );
        newNode = insNode.rows[0];
        toNodeId = newNode.id;
      }

      // Optional: Condition/Effect übernehmen
      const condition = item?.condition ?? null;
const effect    = item?.effect    ?? null;
const voteMap   = item?.voteMap   ?? null;

const insEdge = await client.query(
  `insert into edge (from_node_id, to_node_id, label, condition_json, effect_json, vote_map_json)
   values ($1, $2, $3,
           coalesce($4::jsonb, '{}'::jsonb),
           coalesce($5::jsonb, '{}'::jsonb),
           coalesce($6::jsonb, '{}'::jsonb))
   returning id, from_node_id, to_node_id, label, condition_json, effect_json, vote_map_json`,
  [
    session.current_node_id,
    toNodeId,
    label,
    condition ? JSON.stringify(condition) : null,
    effect    ? JSON.stringify(effect)    : null,
    voteMap   ? JSON.stringify(voteMap)   : null
  ]
);


      created.push({ edge: insEdge.rows[0], node: newNode });
    }

    await client.query("COMMIT");
    res.json({ ok: true, created });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "expand_failed", message: String(e) });
  } finally {
    client.release();
  }
});

const https = require("https");
const querystring = require("querystring");

function fetchRestream(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "GET",
      hostname: "api.restream.io",
      path,
      headers: { "Authorization": `Bearer ${token}` }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, text: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

app.get("/restream/webchat-url", async (req, res) => {
  try {
    const tok = await getRestreamToken(); // <- deine existierende Token-Funktion
    if (!tok?.access_token) return res.status(401).json({ error: "no_access_token" });
    const r = await fetchRestream("/v2/user/webchat/url", tok.access_token);
    res.status(r.status).json(r.json || { raw: r.text });
  } catch (e) {
    res.status(500).json({ error: "webchat_url_failed", message: String(e) });
  }
});


// GET /restream/login -> redirect zu Restream OAuth
app.get("/restream/login", (req, res) => {
  const cid   = process.env.RESTREAM_CLIENT_ID;
  const ruri  = process.env.RESTREAM_REDIRECT_URI;
  if (!cid || !ruri) return res.status(500).send("RESTREAM_CLIENT_* / REDIRECT_URI fehlt.");
  const state = Math.random().toString(36).slice(2);
  const url = `https://api.restream.io/login?response_type=code&client_id=${encodeURIComponent(cid)}&redirect_uri=${encodeURIComponent(ruri)}&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

// GET /oauth/restream/callback?code=... -> tauscht Code gegen Tokens
app.get("/oauth/restream/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("code fehlt");

  const cid  = process.env.RESTREAM_CLIENT_ID;
  const csec = process.env.RESTREAM_CLIENT_SECRET;
  const ruri = process.env.RESTREAM_REDIRECT_URI;
  if (!cid || !csec || !ruri) return res.status(500).send("RESTREAM_CLIENT_* / REDIRECT_URI fehlt.");

  const body = querystring.stringify({
    grant_type: "authorization_code",
    code,
    redirect_uri: ruri
  });
  const auth = Buffer.from(`${cid}:${csec}`).toString("base64");

  const tokenResp = await new Promise((resolve, reject) => {
    const reqOAuth = https.request({
      method: "POST",
      hostname: "api.restream.io",
      path: "/oauth/token",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, r => {
      let data = "";
      r.on("data", c => data += c);
      r.on("end", () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`Token exchange failed ${r.statusCode}: ${data}`));
        }
      });
    });
    reqOAuth.on("error", reject);
    reqOAuth.write(body);
    reqOAuth.end();
  });

  const saved = await saveRestreamToken(tokenResp); // speichert access+refresh+expires_at
  res.send(`
    <h3>Restream verbunden ✅</h3>
    <pre>${JSON.stringify({
      access_token: saved.access_token.slice(0,8) + "...",
      refresh_token: (tokenResp.refresh_token || "").slice(0,8) + "...",
      expires_at: saved.expires_at
    }, null, 2)}</pre>
    <p>Du kannst dieses Fenster schließen.</p>
  `);
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
if (typeof publish === "function") {
  publish(sessionId, "decision/applied", { toNodeId: edge.to_node_id, edgeId: edge.id });
}


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

// Admin: Reset (optional mit/oder ohne Seed)
app.post("/admin/reset", async (req, res) => {
  const doSeed = req.body?.seed !== false; // Standard: true, aber body { "seed": false } = nur leeren
  try {
    // DB leeren
    await pool.query("DELETE FROM decision");
    await pool.query("DELETE FROM session");
    await pool.query("DELETE FROM edge");
    await pool.query("DELETE FROM node");

    let seedInfo = null;
    if (doSeed) {
      const seed = require("./seed");
      seedInfo = await seed(); // legt „Startpunkt + 2 Edges“ an
    }

    res.json({ ok: true, seeded: doSeed, ...(seedInfo || {}) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "reset_failed", message: String(err) });
  }
});

// Admin: Clear (immer ohne Seed)
app.post("/admin/clear", async (_req, res) => {
  try {
    await pool.query("DELETE FROM decision");
    await pool.query("DELETE FROM session");
    await pool.query("DELETE FROM edge");
    await pool.query("DELETE FROM node");
    res.json({ ok: true, cleared: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "clear_failed", message: String(e) });
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


// ----- REPLACE this whole handler in index.js -----
app.post("/sessions/:id/add-option", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  const label = (req.body?.label || "").trim();
  if (!label) return res.status(400).json({ error: "newEdge_label_required" });

  const nodeTitle = (req.body?.nodeTitle || "").trim();
  const nodeContent = req.body?.nodeContent ?? {};

    // Optional gleich übernehmen:
const condition = req.body?.condition ?? null;
const effect    = req.body?.effect    ?? null;
const voteMap   = req.body?.voteMap   ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Session prüfen + aktuellen Node holen (für from_node_id)
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

    // Ziel-Node anlegen
    if (!nodeTitle) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "newNode_title_required" });
    }
    const insNode = await client.query(
      `insert into node (title, content_json) values ($1, $2::jsonb) returning id, title, content_json`,
      [nodeTitle, JSON.stringify(nodeContent ?? {})]
    );
    const newNode = insNode.rows[0];

    // Edge anlegen (inkl. Condition/Effect, falls vorhanden)


const insEdge = await client.query(
  `insert into edge (from_node_id, to_node_id, label, condition_json, effect_json, vote_map_json)
   values ($1, $2, $3,
           coalesce($4::jsonb, '{}'::jsonb),
           coalesce($5::jsonb, '{}'::jsonb),
           coalesce($6::jsonb, '{}'::jsonb))
   returning id, from_node_id, to_node_id, label, condition_json, effect_json, vote_map_json`,
  [
    session.current_node_id,
    newNode.id,
    label,
    condition ? JSON.stringify(condition) : null,
    effect    ? JSON.stringify(effect)    : null,
    voteMap   ? JSON.stringify(voteMap)   : null
  ]
);

    const newEdge = insEdge.rows[0];

    await client.query("COMMIT");
    res.json({ ok: true, newNode, newEdge });
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

  const { label, toNodeId, condition, effect, voteMap } = req.body || {};
if (label === undefined && toNodeId === undefined && condition === undefined && effect === undefined && voteMap === undefined) {
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
    const newVoteMap   = voteMap   !== undefined ? voteMap   : edge.vote_map_json ?? {};


      const upd = await client.query(
      `update edge
          set label=$1,
              to_node_id=$2,
              condition_json=$3::jsonb,
              effect_json=$4::jsonb,
              vote_map_json=$5::jsonb,
              updated_at=now()
        where id=$6
        returning id, from_node_id, to_node_id, label, condition_json, effect_json, vote_map_json`,
      [
        newLabel,
        newToNodeId,
        JSON.stringify(newCondition),
        JSON.stringify(newEffect),
        JSON.stringify(newVoteMap),
        edgeId
      ]
    );


    await client.query("COMMIT");

// optional: betroffene Sessions benachrichtigen
if (typeof publish === "function") {
  const fromId = edge.from_node_id; // 'edge' hast du oben vor dem Update geladen
  const qSess = await pool.query(
    `select id from session where current_node_id = $1`,
    [fromId]
  );
  for (const r of qSess.rows) {
    publish(r.id, "edge/updated", { edgeId });
  }
}



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
    // 1) Edge VOR dem Löschen laden (wir brauchen from_node_id)
    const qEdge = await pool.query(
      `SELECT id, from_node_id FROM edge WHERE id = $1`,
      [edgeId]
    );
    if (!qEdge.rowCount) return res.status(404).json({ error: "edge_not_found" });

    const { from_node_id } = qEdge.rows[0];

    // 2) Betroffene Sessions ermitteln (alle, die gerade an diesem from_node sind)
    const qSess = await pool.query(
      `SELECT id FROM session WHERE current_node_id = $1`,
      [from_node_id]
    );
    const sessionIds = qSess.rows.map(r => r.id);

    // 3) Edge löschen
    await pool.query(`DELETE FROM edge WHERE id = $1`, [edgeId]);

    // 4) Live-Event für alle betroffenen Sessions senden (falls publish vorhanden)
    if (typeof publish === "function") {
      for (const sid of sessionIds) {
        publish(sid, "edge/updated", { edgeId, deleted: true });
      }
    }

    // 5) Antwort
    res.json({ ok: true, deletedEdgeId: edgeId, affectedSessions: sessionIds });
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

// PATCH /sessions/:id/state  → State setzen (vollständig ersetzen)
// Optional: ?mode=merge für JSONB-Merge statt Full-Replace
app.patch("/sessions/:id/state", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_session_id" });

  // Wir akzeptieren beliebiges JSON-Objekt; bei null/leer -> {}
  const incoming = (req.body && typeof req.body === "object") ? req.body : {};

  try {
    let q;
    if ((req.query.mode || "").toLowerCase() === "merge") {
      // JSONB-Merge (bestehender state_json || incoming)
      q = await pool.query(
        `update session
           set state_json = coalesce(state_json,'{}'::jsonb) || $1::jsonb,
               updated_at = now()
         where id = $2
         returning state_json`,
        [JSON.stringify(incoming), id]
      );
    } else {
      // Full-Replace
      q = await pool.query(
        `update session
           set state_json = $1::jsonb,
               updated_at = now()
         where id = $2
         returning state_json`,
        [JSON.stringify(incoming), id]
      );
    }

    if (!q.rowCount) return res.status(404).json({ error: "session_not_found" });
    const state = q.rows[0].state_json || {};
    res.json({ ok: true, state });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "state_patch_failed", message: String(e) });
  }
});


// Graph für eine Session
app.get("/sessions/:id/graph", async (req, res) => {
  const sessionId = Number(req.params.id);
  const mode = String(req.query.mode || "all").toLowerCase();
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    // aktuellen Knoten holen
    const s = await pool.query(`select current_node_id from session where id=$1`, [sessionId]);
    if (!s.rowCount) return res.status(404).json({ error: "session_not_found" });
    const currentNodeId = s.rows[0].current_node_id;

    if (mode === "visited") {
      // besuchte Knoten & gewählte Edges aus decision ableiten
      const visitedQ = await pool.query(
        `
        with decs as (
          select d.node_id as from_id, e.to_node_id as to_id, d.chosen_edge_id as edge_id
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
        select coalesce(array_agg(id), '{}') as ids from nodeset
        `,
        [sessionId, currentNodeId ?? null]
      );
      const visitedNodeIds = visitedQ.rows[0]?.ids ?? [];

      const [nodesQ, edgesQ] = await Promise.all([
        visitedNodeIds.length
          ? pool.query(`select id, title from node where id = any($1::int[]) order by id asc`, [visitedNodeIds])
          : pool.query(`select id, title from node where false`),
        pool.query(
          `select id, from_node_id, to_node_id, label, condition_json, effect_json
           from edge
           where id in (select chosen_edge_id from decision where session_id = $1)
           order by id asc`,
          [sessionId]
        )
      ]);

      return res.json({
        sessionId,
        mode,
        currentNodeId,
        visitedNodeIds,
        nodes: nodesQ.rows || [],
        edges: edgesQ.rows || []
      });
    }

    // mode = all  → alle Knoten/Edges inkl. condition_json/effect_json
    const [nodesQ, edgesQ, visitedQ] = await Promise.all([
      pool.query(`select id, title from node order by id asc`),
      pool.query(`select id, from_node_id, to_node_id, label, condition_json, effect_json, vote_map_json from edge order by id asc`),
      pool.query(
        `
        with decs as (
          select d.node_id as from_id, e.to_node_id as to_id
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
        select coalesce(array_agg(id), '{}') as ids from nodeset
        `,
        [sessionId, currentNodeId ?? null]
      )
    ]);

    return res.json({
      sessionId,
      mode,
      currentNodeId,
      visitedNodeIds: visitedQ.rows[0]?.ids ?? [],
      nodes: nodesQ.rows || [],
      edges: edgesQ.rows || []
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "graph_failed", message: String(e) });
  }
});

// Start a live vote for the current node's options
app.post("/sessions/:id/vote/start", async (req, res) => {
  const sessionId = Number(req.params.id);
  const durationSec = Number(req.body?.durationSec || 0); // optional, rein informativ
  let optionIds = Array.isArray(req.body?.options) ? req.body.options.map(Number) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = await client.query(`select id, current_node_id, state_json from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "session_not_found" }); }
    const session = s.rows[0];
    if (!session.current_node_id) { await client.query("ROLLBACK"); return res.status(409).json({ error: "no_current_node_set" }); }

    // mögliche Optionen am aktuellen Node laden
    const e = await client.query(
      `select id, label, to_node_id, condition_json from edge where from_node_id=$1 order by id asc`,
      [session.current_node_id]
    );
    // Sichtbarkeit filtern wie in GET /sessions/:id
    const st = session.state_json || {};
    const visible = e.rows.filter(row => evalCondition(st, row.condition_json));

    if (!optionIds) optionIds = visible.map(r => r.id);
    const allowed = new Set(visible.map(r => r.id));
    const invalid = optionIds.filter(id => !allowed.has(id));
    if (invalid.length) { await client.query("ROLLBACK"); return res.status(400).json({ error: "options_invalid_for_current_node", invalid }); }

    const now = new Date().toISOString();
    const vote = {
      active: true,
      nodeId: session.current_node_id,
      options: optionIds,         // Edge-IDs
      tally: Object.fromEntries(optionIds.map(id => [String(id), 0])),
      voters: {},                 // optionales Duplikat-Tracking: voterId -> edgeId
      startedAt: now,
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null
    };

    const next = { ...(session.state_json || {}), vote };
    await client.query(`update session set state_json=$1, updated_at=now() where id=$2`, [next, sessionId]);
    await client.query("COMMIT");
    
    publish(sessionId, "vote/started", {
  options: vote.options,
  startedAt: vote.startedAt,
  durationSec: vote.durationSec
});


    res.status(201).json({ ok: true, vote });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "vote_start_failed", message: String(e) });
  } finally {
    client.release();
  }
});

// Cast a vote for an edge option
app.post("/sessions/:id/vote/cast", async (req, res) => {
  const sessionId = Number(req.params.id);
  const edgeId = Number(req.body?.edgeId);
  const voterId = (req.body?.voterId ?? "").toString(); // optional dedupe

  if (!Number.isFinite(edgeId)) return res.status(400).json({ error: "edgeId_required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = await client.query(`select id, state_json from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "session_not_found" }); }
    const session = s.rows[0];
    const state = session.state_json || {};
    const vote = state.vote;
    if (!vote?.active) { await client.query("ROLLBACK"); return res.status(409).json({ error: "no_active_vote" }); }

    const allowed = new Set((vote.options || []).map(Number));
    if (!allowed.has(edgeId)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "edge_not_in_vote" }); }

    // Einfaches Dedupe: gleicher voterId darf nur 1x stimmen (optional)
    vote.voters = vote.voters || {};
    if (voterId) {
      const prev = vote.voters[voterId];
      if (prev && prev !== edgeId) {
        // Stimme umhängen
        vote.tally[String(prev)] = Math.max(0, Number(vote.tally[String(prev)] || 0) - 1);
      }
      vote.voters[voterId] = edgeId;
    }

    vote.tally[String(edgeId)] = Number(vote.tally[String(edgeId)] || 0) + 1;

    const next = { ...state, vote };
    await client.query(`update session set state_json=$1, updated_at=now() where id=$2`, [next, sessionId]);
    await client.query("COMMIT");
    publish(sessionId, "vote/tally", { tally: vote.tally });

    res.json({ ok: true, tally: vote.tally });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "vote_cast_failed", message: String(e) });
  } finally {
    client.release();
  }
});

app.get("/sessions/:id/vote", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });
  const s = await pool.query(`select state_json from session where id=$1`, [sessionId]);
  if (!s.rowCount) return res.status(404).json({ error: "session_not_found" });
  res.json(s.rows[0].state_json?.vote || { active: false });
});

// Close vote; optionally apply winning edge as decision
app.post("/sessions/:id/vote/close", async (req, res) => {
  const sessionId = Number(req.params.id);
  const apply = Boolean(req.body?.apply);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const s = await client.query(`select id, state_json from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "session_not_found" }); }
    const session = s.rows[0];
    const state = session.state_json || {};
    const vote = state.vote;
    if (!vote?.active) { await client.query("ROLLBACK"); return res.status(409).json({ error: "no_active_vote" }); }

    // Gewinner bestimmen (höchster Count; bei Gleichstand erster)
    const entries = Object.entries(vote.tally || {}).map(([k,v]) => [Number(k), Number(v)]);
    entries.sort((a,b) => b[1] - a[1]);
    const winner = entries[0]?.[0] ?? null;

    // Vote beenden
    const ended = { ...vote, active: false, endedAt: new Date().toISOString(), winner };
    const nextState = { ...state, vote: ended };

    await client.query(`update session set state_json=$1, updated_at=now() where id=$2`, [nextState, sessionId]);

    let applied = null;
    if (apply && Number.isFinite(winner)) {
      // Entscheidung anwenden (wie /decision)
      const s2 = await client.query(`select * from session where id=$1 for update`, [sessionId]);
      const sess = s2.rows[0];
      const e = await client.query(`select * from edge where id=$1`, [winner]);
      if (e.rowCount) {
        const edge = e.rows[0];
        // effect anwenden
        const newState = applyEffect(nextState || {}, edge.effect_json || {});
        await client.query(
          `insert into decision (session_id, node_id, chosen_edge_id) values ($1, $2, $3)`,
          [sess.id, sess.current_node_id, edge.id]
        );
        await client.query(
          `update session set current_node_id=$1, state_json=$2, updated_at=now() where id=$3`,
          [edge.to_node_id, newState, sess.id]
        );
        applied = { toNodeId: edge.to_node_id, edgeId: edge.id };
      }
    }

    await client.query("COMMIT");
    publish(sessionId, "vote/closed", { winner, applied });

    res.json({ ok: true, winner, applied });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "vote_close_failed", message: String(e) });
  } finally {
    client.release();
  }
});

const http = require("http");
const WebSocket = require("ws");

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

// einfache Subscriptions pro Verbindung
wss.on("connection", (ws) => {
  ws.subscriptions = new Set();

  ws.on("message", (buf) => {
    let msg = null;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg?.type === "subscribe" && Number.isFinite(Number(msg.sessionId))) {
      ws.subscriptions.add(Number(msg.sessionId));
      ws.send(JSON.stringify({ type: "subscribed", sessionId: Number(msg.sessionId) }));
    }
    if (msg?.type === "unsubscribe" && Number.isFinite(Number(msg.sessionId))) {
      ws.subscriptions.delete(Number(msg.sessionId));
      ws.send(JSON.stringify({ type: "unsubscribed", sessionId: Number(msg.sessionId) }));
    }
  });

  ws.on("close", () => { ws.subscriptions.clear(); });
});

// Broadcast‑Helper
function publish(sessionId, type, payload = {}) {
  const msg = JSON.stringify({ type, sessionId, ...payload, ts: Date.now() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.subscriptions?.has(sessionId)) {
      ws.send(msg);
    }
  });
}
// Auto-Close abgelaufener Votes (alle 2s)
setInterval(async () => {
  try {
    const q = await pool.query(`
      SELECT id, state_json
      FROM session
      WHERE (state_json->'vote'->>'active')::bool = true
        AND (state_json->'vote'->>'durationSec') ~ '^[0-9]+$'
        AND (
          (state_json->'vote'->>'startedAt')::timestamptz
          + ((state_json->'vote'->>'durationSec')::int * interval '1 second')
        ) <= now()
    `);

    for (const row of q.rows) {
      const sessionId = row.id;
      const vote = row.state_json?.vote || {};
      const tally = vote.tally || {};
      const entries = Object.entries(tally).map(([k, v]) => [Number(k), Number(v)]);
      entries.sort((a, b) => b[1] - a[1]);
      const winner = entries[0]?.[0] ?? null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const ended = { ...vote, active: false, endedAt: new Date().toISOString(), winner };
        const nextState = { ...row.state_json, vote: ended };
        await client.query(
          `UPDATE session SET state_json=$1, updated_at=now() WHERE id=$2`,
          [nextState, sessionId]
        );

        let applied = null;
        if (Number.isFinite(winner)) {
          const e = await client.query(`SELECT * FROM edge WHERE id=$1`, [winner]);
          if (e.rowCount) {
            const s2 = await client.query(`SELECT * FROM session WHERE id=$1 FOR UPDATE`, [sessionId]);
            const sess = s2.rows[0];
            const edge = e.rows[0];
            const newState = applyEffect(nextState || {}, edge.effect_json || {});
            await client.query(
              `INSERT INTO decision (session_id, node_id, chosen_edge_id) VALUES ($1, $2, $3)`,
              [sess.id, sess.current_node_id, edge.id]
            );
            await client.query(
              `UPDATE session SET current_node_id=$1, state_json=$2, updated_at=now() WHERE id=$3`,
              [edge.to_node_id, newState, sess.id]
            );
            applied = { toNodeId: edge.to_node_id, edgeId: edge.id };
          }
        }

        await client.query("COMMIT");
        if (typeof publish === "function") {
          publish(sessionId, "vote/closed", { winner, applied });
        }
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("auto-close vote failed", err);
      } finally {
        client.release();
      }
    }
  } catch (e) {
    console.error("vote auto closer tick error", e);
  }
}, 2000);

// Sichtbare Optionen (Edges) für die aktuelle Position
app.get("/sessions/:id/options", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    const s = await pool.query(`select current_node_id, state_json from session where id=$1`, [sessionId]);
    if (!s.rowCount) return res.status(404).json({ error: "session_not_found" });
    const { current_node_id, state_json } = s.rows[0];
    if (!current_node_id) return res.json({ sessionId, options: [] });

    const e = await pool.query(
      `select id, label, to_node_id, condition_json from edge where from_node_id=$1 order by id asc`,
      [current_node_id]
    );
    const st = state_json || {};
    const visible = e.rows.filter(row => evalCondition(st, row.condition_json));
    res.json({ sessionId, currentNodeId: current_node_id, options: visible });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "options_failed", message: String(e) });
  }
});

// Direkt zu einem Node springen (kein Decision‑Eintrag)
app.post("/sessions/:id/jump", async (req, res) => {
  const sessionId = Number(req.params.id);
  const toNodeId = Number(req.body?.toNodeId);
  if (!Number.isFinite(sessionId) || !Number.isFinite(toNodeId))
    return res.status(400).json({ error: "invalid_ids" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = await client.query(`select id from session where id=$1 for update`, [sessionId]);
    if (!s.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "session_not_found" }); }

    // Node existiert?
    const n = await client.query(`select id from node where id=$1`, [toNodeId]);
    if (!n.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "target_node_not_found" }); }

    await client.query(`update session set current_node_id=$1, updated_at=now() where id=$2`, [toNodeId, sessionId]);
    await client.query("COMMIT");

    // WS‑Update (falls vorhanden)
    if (typeof publish === "function") publish(sessionId, "jump/applied", { toNodeId });

    res.json({ ok: true, toNodeId });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(e);
    res.status(500).json({ error: "jump_failed", message: String(e) });
  } finally {
    client.release();
  }
});

// Session beenden (Status = ended)
app.post("/sessions/:id/end", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    const u = await pool.query(
      `update session set status='ended', updated_at=now() where id=$1 returning id, status`,
      [sessionId]
    );
    if (!u.rowCount) return res.status(404).json({ error: "session_not_found" });

    if (typeof publish === "function") publish(sessionId, "session/ended", {});
    res.json({ ok: true, id: sessionId, status: "ended" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "end_failed", message: String(e) });
  }
});

// Admin: alle Sessions grob listen
app.get("/admin/sessions", async (_req, res) => {
  try {
    const q = await pool.query(`
      select s.id, s.status, s.current_node_id, n.title as current_title, s.updated_at
      from session s
      left join node n on n.id = s.current_node_id
      order by s.updated_at desc nulls last, s.id desc
      limit 200
    `);
    res.json({ sessions: q.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "list_sessions_failed", message: String(e) });
  }
});


// Ingest: nimmt normalisierte Chat-/Reaction-Events entgegen (für Casterlabs-Bridge)
app.post("/ingest/message", async (req, res) => {
  const key = req.header("x-ingest-key");
  if (!process.env.INGEST_KEY || key !== process.env.INGEST_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const {
    sessionId,               // Pflicht: wohin routen
    platform = "unknown",    // twitch|youtube|...
    userId = "unknown",
    username = "unknown",
    message = "",
    kind = "message",        // message|reaction|command
    payload = {}             // beliebige Extras (emotes, badges, amount, ...)
  } = req.body || {};

  const sid = Number(sessionId);
  if (!Number.isFinite(sid)) return res.status(400).json({ error: "invalid_session_id" });

  try {
    await pool.query(
      `insert into chat_event (session_id, platform, user_id, username, message, kind, payload_json)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [sid, String(platform), String(userId), String(username), String(message||""), String(kind||"message"), payload||{}]
    );
    // optional: leichter Push in UI
    if (typeof publish === "function") publish(sid, "ingest/new", { platform, username, message, kind });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "ingest_failed", message: String(e) });
  }
});





// Static Admin-UI (serves files from /public)
const path = require("path");
app.use("/admin-ui", express.static(path.join(__dirname, "public")));

const { startRestreamBridge, getBridgeStatus, getBridgeStatusExtra } = require("./restream-bridge.js");

// Runtime-Config für Session-Routing (falls noch nicht vorhanden)
const bridgeConfig = {
  defaultSessionId: 0,
  platformSessionMap: {},
  useFocused: false,
  focusedSessionId: 0
};

function normPlatform(p) {
  return String(p || "").trim().toLowerCase();
}

// Bridge Status-Route (optional)
app.get("/bridge/status", (req, res) => {
  const status = getBridgeStatus ? getBridgeStatus() : { enabled:false };
  const extra  = getBridgeStatusExtra ? getBridgeStatusExtra() : null;
  res.json({
    status,
    token_exists: !!status.token_exists,
    expires_at: status.expires_at || null,
    config: bridgeConfig,
    ws_debug: extra // <- zeigt totalWsReceived, lastWsAt, lastEventPreview
  });
});


// ---- Bridge Config API ----

// GET aktuelle Konfig
app.get("/bridge/config", (req, res) => {
  res.json({ ok: true, config: bridgeConfig });
});

// PATCH Teile der Konfig ändern
app.patch("/bridge/config", express.json(), (req, res) => {
  const b = req.body || {};

  if (b.defaultSessionId !== undefined) {
    const n = Number(b.defaultSessionId);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "invalid_defaultSessionId" });
    bridgeConfig.defaultSessionId = n;
  }

  if (b.useFocused !== undefined) {
    bridgeConfig.useFocused = !!b.useFocused;
  }

  if (b.focusedSessionId !== undefined) {
    const n = Number(b.focusedSessionId);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "invalid_focusedSessionId" });
    bridgeConfig.focusedSessionId = n;
  }

  if (b.platformSessionMap && typeof b.platformSessionMap === "object") {
    const map = {};
    for (const [k, v] of Object.entries(b.platformSessionMap)) {
      const p = normPlatform(k);
      const n = Number(v);
      if (!p) continue;
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "invalid_platformSessionMap_value", key: k, value: v });
      map[p] = n;
    }
    bridgeConfig.platformSessionMap = map;
  }

  res.json({ ok: true, config: bridgeConfig });
});

// POST Fokus direkt setzen (praktisch für Button "Set focus")
app.post("/bridge/focus", express.json(), (req, res) => {
  const sid = Number((req.body || {}).sessionId);
  if (!Number.isFinite(sid) || sid < 0) return res.status(400).json({ error: "invalid_sessionId" });
  bridgeConfig.useFocused = true;
  bridgeConfig.focusedSessionId = sid;
  res.json({ ok: true, config: bridgeConfig });
});

// GET /bridge/token  -> gibt masked Token + Ablauf zurück (API-Key nötig)
app.get("/bridge/token", async (req, res) => {
  try {
    const key = req.header("x-api-key");
    if (!process.env.API_KEY || key !== process.env.API_KEY) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const tok = await getRestreamToken().catch(() => null);
    if (!tok) return res.json({ ok: true, token_exists: false });

    const raw = tok.access_token || "";
    const masked =
      raw.length <= 12
        ? "***"
        : raw;

    res.json({
      ok: true,
      token_exists: true,
      access_token_masked: masked,
      token_type: tok.token_type || "bearer",
      expires_at: tok.expires_at || null,
      scope: tok.scope || null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "token_read_failed", message: String(e) });
  }
});



// Bridge Start – nutzt DB-Token + Auto-Refresh
(async () => {
  try {
const tokenExists = await getRestreamToken().catch(() => null);
if (tokenExists) {
  startRestreamBridge({
    // Session Routing
    getSessionIdFor: (platform) => {
      const p = normPlatform(platform);
          if (bridgeConfig.useFocused && bridgeConfig.focusedSessionId) return bridgeConfig.focusedSessionId;
          if (bridgeConfig.platformSessionMap && Number.isFinite(Number(bridgeConfig.platformSessionMap[p]))) {
            return Number(bridgeConfig.platformSessionMap[p]);
          }
          if (Number.isFinite(Number(bridgeConfig.defaultSessionId))) {
            return Number(bridgeConfig.defaultSessionId);
          }
          return 0; // deaktiviert, wenn nichts konfiguriert
        },
    // Token-Mgmt (DB)
    tokenGetter: async () => await getRestreamToken(),
    tokenSaver:  async (t)   => await saveRestreamToken(t),
    clientId:     process.env.RESTREAM_CLIENT_ID,
    clientSecret: process.env.RESTREAM_CLIENT_SECRET
  });
  console.log("🔌 Restream-Bridge gestartet (OAuth/refresh aktiv).");
} else {
  console.log("ℹ️ Kein Restream-Token in DB – bitte OAuth starten: /restream/login");
}
} catch (err) {
    console.error("❌ Fehler beim Start der Restream-Bridge:", err);
  }
})();



//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
server.listen(port, () => console.log("HTTP+WS on :" + port));


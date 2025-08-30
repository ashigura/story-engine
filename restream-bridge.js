// restream-bridge.js (CommonJS, robust, mit Countern & Auto-Refresh)
const WebSocket = require("ws");
const https = require("https");
const querystring = require("querystring");

// fetch() (Node 18+ nativ; Fallback node-fetch)
let _fetch = global.fetch;
if (!_fetch) { try { _fetch = require("node-fetch"); } catch {} }
const fetchFn = (...a) => _fetch(...a);

// Restream Plattform-IDs -> Namen
const PLATFORM_BY_ID = {
  2: 'twitch',
  13: 'youtube',
  19: 'facebook_profile',
  20: 'facebook_page',
  21: 'facebook_group',
  24: 'dlive',
  25: 'discord',
  26: 'linkedin',
  27: 'trovo'
};

// Verbindungstracking
const connections = new Map(); // connectionIdentifier -> { eventSourceId, target, connectionUuid, status, reason }

// Bridge-Status (für /bridge/status)
const state = {
  enabled: false,
  wsConnected: false,
  lastMessageAt: null,
  totalForwarded: 0,
  totalErrors: 0,
  lastError: null,
  token_exists: false,
  expires_at: null
};

// WS-Debug
let totalWsReceived = 0;
let lastWsAt = null;
let lastEventPreview = null;
const actionCounters = {};
const lastActions = []; // Ringpuffer

// Sammle wenige Rohframes für Diagnose:
const rawSamples = []; // Ringpuffer der letzten 5 Frames
function pushRawSample(kind, obj) {
  try {
    rawSamples.push({ at: new Date().toISOString(), kind, sample: obj });
    if (rawSamples.length > 5) rawSamples.shift();
  } catch {}
}


// ---------- Utility: HTML -> Text ----------
function stripHtmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// ---------- Event-Normalisierung (robust) ----------
function extractText(ev) {
  const p = (ev && ev.payload) || ev || {};

  // 1) KOI/Restream: fragments[].text
  if (Array.isArray(p.fragments) && p.fragments.length) {
    const t = p.fragments.map(f => (f && (f.text || stripHtmlToText(f.html) || f.raw) || '')).join(' ').trim();
    if (t) return t;
  }

  // 2) message.* Varianten
  if (p.message) {
    if (typeof p.message === 'string' && p.message.trim()) return p.message.trim();
    if (typeof p.message === 'object') {
      const mt = p.message.text || stripHtmlToText(p.message.html) || p.message.raw;
      if (mt && String(mt).trim()) return String(mt).trim();
    }
  }

  // 3) plain fields
  const t3 = p.text || stripHtmlToText(p.html) || p.raw;
  if (t3 && String(t3).trim()) return String(t3).trim();

  // 4) event.* verschachtelt
  if (p.event) {
    const e = p.event;
    if (Array.isArray(e.fragments) && e.fragments.length) {
      const tt = e.fragments.map(f => (f && (f.text || stripHtmlToText(f.html) || f.raw) || '')).join(' ').trim();
      if (tt) return tt;
    }
    const t4 = e.text || (e.message && (e.message.text || stripHtmlToText(e.message.html) || e.message.raw)) || stripHtmlToText(e.html) || e.raw;
    if (t4 && String(t4).trim()) return String(t4).trim();
  }

  return '';
}

function extractAuthor(ev) {
  const p = (ev && ev.payload) || ev || {};
  const cand = p.sender || p.author || (p.event && (p.event.sender || p.event.author)) || {};
  const id = cand.id || cand.userId || '';
  const username = cand.username || cand.name || '';
  const name = cand.displayName || cand.name || username || '';
  return { id, name, username };
}

function extractPlatform(payload, connections, PLATFORM_BY_ID) {
  // 1) über connectionIdentifier → eventSourceId → Mapping
  const ci = payload && payload.connectionIdentifier ? connections.get(payload.connectionIdentifier) : null;
  if (ci && ci.eventSourceId != null) {
    const p = PLATFORM_BY_ID[ci.eventSourceId];
    if (p) return p;
  }
  // 2) direkt aus payload/event
  const fromEvent = (payload && payload.event && payload.event.platform) || (payload && payload.platform) || '';
  if (fromEvent) return String(fromEvent).toLowerCase();

  return 'unknown';
}




function bumpActionCounter(name, sample) {
  const k = String(name || 'unknown').toLowerCase();
  actionCounters[k] = (actionCounters[k] || 0) + 1;
  const entry = { at: new Date().toISOString(), action: k };
  if (sample) entry.sample = sample;
  lastActions.push(entry);
  if (lastActions.length > 30) lastActions.shift();
}

function getConnectionsSnapshot() {
  const out = [];
  for (const [cid, info] of connections.entries()) {
    out.push({ connectionIdentifier: cid, ...info });
  }
  return out;
}

function getBridgeStatus() { return { ...state }; }
function getBridgeStatusExtra() {
  return {
    totalWsReceived,
    lastWsAt,
    lastEventPreview,
    actionCounters,
    lastActions,
    connections: getConnectionsSnapshot()
  };
}
module.exports.getBridgeStatus = getBridgeStatus;
module.exports.getBridgeStatusExtra = getBridgeStatusExtra;
module.exports.getConnectionsSnapshot = getConnectionsSnapshot;

// ---------- Token Refresh ----------
function refreshRestreamToken({ clientId, clientSecret, refreshToken }) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const req = https.request({
      method: "POST",
      hostname: "api.restream.io",
      path: "/oauth/token",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`refresh failed ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------- Event-Normalisierung ----------
function pickTextFromEvent(ev) {
  const p = (ev && ev.payload) || ev || {};
  const fromHtml = (typeof p.html === 'string') ? p.html.replace(/<[^>]*>/g, '') : undefined;
  return p.text ?? p.message ?? fromHtml ?? p.raw ?? '';
}
function pickAuthorFromEvent(ev) {
  const p = (ev && ev.payload) || ev || {};
  const a = p.author || {};
  return {
    id: a.id || a.userId || '',
    name: a.displayName || a.name || a.username || '',
    username: a.username || a.name || ''
  };
}
function lowerPlatformGuess(platform) {
  return (platform || '').toString().trim().toLowerCase();
}

// ---------- Bridge Start ----------
function startRestreamBridge({
  getSessionIdFor,          // (platform)=>number
  tokenGetter,              // async ()=> { access_token, refresh_token, expires_at }
  tokenSaver,               // async (tokenResp)->savedToken
  clientId, clientSecret,
  ingestKey = process.env.INGEST_KEY,
  engineIngestUrl = `http://127.0.0.1:${process.env.PORT || 8080}/ingest/message`,
}) {
  if (!ingestKey)   { console.log("ℹ️ Bridge: INGEST_KEY fehlt -> aus."); return; }
  if (!clientId || !clientSecret) { console.log("ℹ️ Bridge: Client-Creds fehlen -> aus."); return; }
  if (typeof getSessionIdFor !== "function" || !tokenGetter || !tokenSaver) {
    console.log("ℹ️ Bridge: Callbacks fehlen -> aus."); return;
  }
  state.enabled = true;

  let ws = null;
  let refreshTimer = null;

  async function scheduleRefresh(expires_at_iso) {
    state.expires_at = expires_at_iso || null;
    clearTimeout(refreshTimer);
    if (!expires_at_iso) return;
    try {
      const expiresAt = new Date(expires_at_iso).getTime();
      const now = Date.now();
      const ms = Math.max(15_000, (expiresAt - now) - 5 * 60_000);
      refreshTimer = setTimeout(async () => {
        try {
          const tok = await tokenGetter();
          if (!tok?.refresh_token) throw new Error("no refresh token");
          const r = await refreshRestreamToken({ clientId, clientSecret, refreshToken: tok.refresh_token });
          const saved = await tokenSaver(r);
          state.token_exists = !!saved?.access_token;
          state.expires_at   = saved?.expires_at || null;
          console.log("♻️  Restream token refreshed, new exp:", state.expires_at);
          if (ws) { try { ws.close(); } catch {} } // Reconnect
        } catch (e) {
          console.error("❌ Token refresh failed:", e.message || String(e));
          setTimeout(() => scheduleRefresh(new Date(Date.now() + 10*60_000).toISOString()), 60_000);
        }
      }, ms);
    } catch {}
  }

  async function connect() {
    const tok = await tokenGetter();
    state.token_exists = !!tok?.access_token;
    state.expires_at   = tok?.expires_at || null;

    if (!tok?.access_token) {
      console.log("ℹ️ Bridge: kein Access-Token vorhanden – bitte /restream/login verwenden.");
      return;
    }

    scheduleRefresh(tok.expires_at);

    const url = `wss://chat.api.restream.io/ws?accessToken=${encodeURIComponent(tok.access_token)}`;
    console.log("🔌 Verbinde Restream:", url.replace(/accessToken=[^&]+/, "accessToken=****"));

    ws = new WebSocket(url);

    ws.on("open", () => {
      state.wsConnected = true;
      console.log("🟢 Restream WS verbunden.");
    });

    ws.on("close", async (code, reason) => {
      state.wsConnected = false;
      console.log(`⚠️ WS geschlossen (${code}) ${reason || ""}`);
      if (code === 1008 || code === 4001 || String(reason).toLowerCase().includes("auth")) {
        try {
          const cur = await tokenGetter();
          if (cur?.refresh_token) {
            const r = await refreshRestreamToken({ clientId, clientSecret, refreshToken: cur.refresh_token });
            await tokenSaver(r);
            console.log("♻️  Refresh nach WS-Close ok → Reconnect in 1s");
          }
        } catch (e) {
          console.error("❌ Refresh nach WS-Close fehlgeschlagen:", e.message || e);
        }
      }
      setTimeout(connect, 1000);
    });

    ws.on("error", (err) => {
      state.wsConnected = false;
      state.lastError = (err && err.message) || String(err);
      console.error("❌ Restream WS Fehler:", state.lastError);
    });

    ws.on("message", async (buf) => {
      // ZÄHLER & TIMESTAMP *sofort* setzen:
      totalWsReceived++;
      lastWsAt = new Date().toISOString();

      // Robust: manche Frames sind { data:"<json>" }, manche direkt { action, payload }
      let root;
      try { root = JSON.parse(String(buf)); } catch { return; }
      pushRawSample("root", root);
      

      let actionObj = null;
      if (root && typeof root.data === "string") {
        try { actionObj = JSON.parse(root.data); } catch {}
      }
    if (actionObj) pushRawSample("actionObj", { action: actionObj.action || actionObj.type, keys: Object.keys(actionObj) });

      
      if (!actionObj && root && (root.action || root.type)) {
        actionObj = root;
      }
      if (!actionObj) return;

      const rawAction = actionObj.action || actionObj.type || 'unknown';
      const action = String(rawAction).toLowerCase();
      const payload = actionObj.payload || {};
      bumpActionCounter(action);

      if (!['connection_info','connection_closed','heartbeat','event','message','chat_message','reply_created','reply_accepted','reply_confirmed','reply_failed','relay_accepted','relay_confirmed','relay_failed'].includes(action)) {
        bumpActionCounter('unknown_action', Object.keys(actionObj));
      }

      if (process.env.BRIDGE_DEBUG === "1") {
        if (action !== "heartbeat") {
          console.log("[RESTREAM]", action, payload?.connectionIdentifier || "");
        }
      }

      // --- Fallback: Manche Backends liefern Chat im reply_* Payload ---
if (action === "reply_created" || action === "reply_accepted" || action === "reply_confirmed") {
  // Suche generisch nach message-ähnlichem Objekt in payload
  const p = payload || {};
  const ev = p.event || p.message || p.msg || p.data || null;

 const text = extractText(payload.event || payload);
if (text) {
  const author = extractAuthor(payload.event || payload);
  const platform = extractPlatform(payload, connections, PLATFORM_BY_ID);

  lastEventPreview = {
    at: lastWsAt,
    platform,
    username: author.name || author.username || null,
    text
  };

  const sessionId = Number(getSessionIdFor(platform) || 0);
  if (sessionId) {
    state.lastMessageAt = new Date().toISOString();
    try {
      const r = await fetchFn(engineIngestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingest-key": process.env.INGEST_KEY },
        body: JSON.stringify({
          sessionId,
          platform,
          userId: author.id || author.username || "",
          username: author.name || author.username || "",
          message: text
        })
      });
      if (!r || !r.ok) {
        state.totalErrors++;
        const t = r ? await r.text().catch(()=>"") : "";
        console.error("❌ ingest (reply_* path)", r && r.status, t);
      } else {
        state.totalForwarded++;
      }
    } catch (e) {
      state.totalErrors++;
      console.error("❌ ingest fetch error (reply_* path):", e?.message || String(e));
    }
  }
}

  // Nicht returnen – evtl. kommt zusätzlich noch ein echtes event später im selben Frame-Fluss
}


      if (action === "connection_info") {
        connections.set(payload.connectionIdentifier, {
          eventSourceId: payload.eventSourceId,
          target: payload.target,
          connectionUuid: payload.connectionUuid,
          status: payload.status,
          reason: payload.reason || null
        });
        return;
      }

      if (action === "connection_closed") {
        const cid = payload.connectionUuid;
        for (const [key, info] of connections.entries()) {
          if (info.connectionUuid === cid) {
            connections.delete(key);
            break;
          }
        }
        return;
      }

      if (action === "heartbeat") return;

      // Chat-Events (je nach Quelle "event", "message" oder "chat_message")
      const isEventLike = (action === 'event' || action === 'message' || action === 'chat_message');
      if (isEventLike) {
        const ci = connections.get(payload.connectionIdentifier) || null;

        // Plattform bestimmen
        let platform = ci ? (PLATFORM_BY_ID[ci.eventSourceId] || 'unknown') : 'unknown';
        if (platform === 'unknown') {
          const p1 = lowerPlatformGuess(payload?.event?.platform);
          if (p1) platform = p1;
        }

        const text = extractText(payload.event || payload);
        const author = extractAuthor(payload.event || payload);
        platform = extractPlatform(payload, connections, PLATFORM_BY_ID);


        lastEventPreview = {
          at: lastWsAt,
          platform,
          username: author.name || author.username || null,
          text
        };

        if (!text) return;

        const sessionId = Number(getSessionIdFor(platform) || 0);
        if (!sessionId) return;

        state.lastMessageAt = new Date().toISOString();

        try {
          const r = await fetchFn(engineIngestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-ingest-key": process.env.INGEST_KEY },
            body: JSON.stringify({
              sessionId,
              platform,
              userId: author.id || author.username || "",
              username: author.name || author.username || "",
              message: text
            })
          });
          if (!r || !r.ok) {
            state.totalErrors++;
            const t = r ? await r.text().catch(()=> "") : "";
            console.error("❌ ingest", r && r.status, t);
          } else {
            state.totalForwarded++;
          }
        } catch (e) {
          state.totalErrors++;
          console.error("❌ ingest fetch error:", e && e.message ? e.message : String(e));
        }
      }
    });
  }

  connect();
}
module.exports.startRestreamBridge = startRestreamBridge;

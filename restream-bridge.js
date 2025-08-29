// restream-bridge.js (CommonJS, bereinigt/robust)

const WebSocket = require("ws");
const https = require("https");
const querystring = require("querystring");

let _fetch = global.fetch;
if (!_fetch) { try { _fetch = require("node-fetch"); } catch {} }
const fetchFn = (...a) => _fetch(...a);

// Mappt Restream eventSourceId -> unsere Platform-Strings
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

// Verbindungstracking pro Restream-Connection
const connections = new Map(); // connectionIdentifier -> { eventSourceId, target, connectionUuid, status, reason }

// Bridge-Status
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

// Zusätzliche WS-Debug-Zähler
let totalWsReceived = 0;
let lastWsAt = null;
let lastEventPreview = null;

const actionCounters = {};
const lastActions = []; // Ringpuffer der letzten 20 Actions



function getConnectionsSnapshot() {
  const out = [];
  for (const [cid, info] of connections.entries()) {
    out.push({ connectionIdentifier: cid, ...info });
  }
  return out;
}

module.exports.getConnectionsSnapshot = getConnectionsSnapshot;
module.exports.getBridgeStatusExtra = function () {
  return {
    totalWsReceived,
    lastWsAt,
    lastEventPreview,
    actionCounters,
    lastActions,
    connections: getConnectionsSnapshot()
  };
};



function bumpActionCounter(name, sample) {
  const k = String(name || 'unknown').toLowerCase();
  actionCounters[k] = (actionCounters[k] || 0) + 1;
  const entry = { at: new Date().toISOString(), action: k };
  if (sample) entry.sample = sample;
  lastActions.push(entry);
  if (lastActions.length > 30) lastActions.shift();
}


function getBridgeStatus() {
  return { ...state };
}
function getBridgeStatusExtra() {
  return {
    totalWsReceived,
    lastWsAt,
    lastEventPreview
  };
}
module.exports.getBridgeStatus = getBridgeStatus;
module.exports.getBridgeStatusExtra = getBridgeStatusExtra;

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
  // ev kann je nach Quelle versch. Formen haben.
  // Häufig: ev.payload.text | ev.payload.message | ev.payload.html | ev.payload.raw
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
  getSessionIdFor,          // (platform)=>number   (kommt aus index.js Routing-Logik)
  tokenGetter,              // async ()=> { access_token, refresh_token, expires_at }
  tokenSaver,               // async ({access_token, refresh_token?, expires_in}) -> {access_token, refresh_token, expires_at}
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
      // 5 Minuten vorher refreshen (mind. 15 Sek Puffer)
      const ms = Math.max(15_000, (expiresAt - now) - 5 * 60_000);
      refreshTimer = setTimeout(async () => {
        try {
          const tok = await tokenGetter();
          if (!tok?.refresh_token) throw new Error("no refresh token");
          const r = await refreshRestreamToken({
            clientId, clientSecret, refreshToken: tok.refresh_token
          });
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
      // bei Auth-Fehler sofort Refresh versuchen
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
      // Robust: manche Frames enthalten { data: "<json>" }, andere direkt { action: "...", payload: {...} }
      let root;
      try {
        const txt = String(buf);
        root = JSON.parse(txt);
      } catch {
        return;
      }

      // root kann z.B. { action, payload } sein ODER { data: "<json>" }
let actionObj = null;
if (root && typeof root.data === "string") {
  try { actionObj = JSON.parse(root.data); } catch { /* ignore */ }
}
if (!actionObj && root && (root.action || root.type)) {
  actionObj = root;
}
if (!actionObj) return;

// Manche Streams senden "type" statt "action"
const rawAction = actionObj.action || actionObj.type || 'unknown';
const action = String(rawAction).toLowerCase();
const payload = actionObj.payload || {};
bumpActionCounter(action);

// Optionales Sample der ersten Felder für Unbekanntes
if (!['connection_info','connection_closed','heartbeat','event','reply_created','reply_accepted','reply_confirmed','reply_failed','relay_accepted','relay_confirmed','relay_failed'].includes(action)) {
  bumpActionCounter('unknown_action', Object.keys(actionObj));
}


      // Debug (optional):
      // console.log("[RESTREAM]", action, payload?.connectionIdentifier || "");

      if (action === "connection_info") {
        // status: 'connecting' | 'connected' | 'error'
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
        // Verbindung rausnehmen
        const cid = payload.connectionUuid;
        for (const [key, info] of connections.entries()) {
          if (info.connectionUuid === cid) {
            connections.delete(key);
            break;
          }
        }
        return;
      }

      if (action === "heartbeat") {
        return;
      }
const isEventLike = (action === 'event' || action === 'message' || action === 'chat_message');
      if (isEventLike) {
        const ci = connections.get(payload.connectionIdentifier) || null;

        // Plattform aus connection_info ermitteln, ansonsten fallback
        let platform = ci ? (PLATFORM_BY_ID[ci.eventSourceId] || 'unknown') : 'unknown';
        // Fallbacks (falls Restream evtl. Platform im Event mitsendet):
        if (platform === 'unknown') {
          const p1 = lowerPlatformGuess(payload?.event?.platform);
          if (p1) platform = p1;
        }

        const ev = payload.event || {};
        const text = pickTextFromEvent(ev);
        const author = pickAuthorFromEvent(ev);

        lastEventPreview = {
          at: lastWsAt,
          platform,
          username: author.name || author.username || null,
          text
        };

        if (!text) return;

        // Session bestimmen:
        const sessionId = Number(getSessionIdFor(platform) || 0);
        if (!sessionId) return;

        state.lastMessageAt = new Date().toISOString();

        // Forward an Engine
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
          if (!r.ok) {
            state.totalErrors++;
            const t = await r.text().catch(()=> "");
            console.error("❌ ingest", r.status, t);
          } else {
            state.totalForwarded++;
            // Optional: console.log(`➡ ingest OK: ${platform} | ${author.name || author.username || author.id}: ${text}`);
          }
        } catch (e) {
          state.totalErrors++;
          console.error("❌ ingest fetch error:", e && e.message ? e.message : String(e));
        }
        return;
      }

      // andere Aktionen (reply_*, relay_*) ignorieren wir aktuell
    });
  }

  connect();
}

module.exports.startRestreamBridge = startRestreamBridge;

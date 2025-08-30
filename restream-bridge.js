// restream-bridge.js (CommonJS, minimal, mit eventPayload-Support + rawSamples debug)
const WebSocket = require("ws");
const https = require("https");
const querystring = require("querystring");

// fetch() (Node 18+ nativ; Fallback node-fetch)
let _fetch = global.fetch;
if (!_fetch) { try { _fetch = require("node-fetch"); } catch {} }
const fetchFn = (...a) => _fetch(...a);

// ---- Restream Plattform-IDs -> Namen (bekannte Zuordnung) ----
const PLATFORM_BY_ID = {
  2: "twitch",
  13: "youtube",
  19: "facebook_profile",
  20: "facebook_page",
  21: "facebook_group",
  24: "dlive",
  25: "discord",
  26: "linkedin",
  27: "trovo",
};

// ---- Verbindungstracking ----
const connections = new Map(); // connectionIdentifier -> { eventSourceId, target, connectionUuid, status, reason }

// ---- Bridge-Status für /bridge/status ----
const state = {
  enabled: false,
  wsConnected: false,
  lastMessageAt: null,
  totalForwarded: 0,
  totalErrors: 0,
  lastError: null,
  token_exists: false,
  expires_at: null,
};

// ---- WS-Debug (leichtgewichtig) ----
let totalWsReceived = 0;
let lastWsAt = null;
let lastEventPreview = null;

// wenige Roh-Frames puffern (max 5)
const rawSamples = [];
function pushRawSample(kind, obj) {
  try {
    rawSamples.push({ at: new Date().toISOString(), kind, sample: obj });
    if (rawSamples.length > 5) rawSamples.shift();
  } catch {}
}

// ---- Utils ----
function stripHtmlToText(html) {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// generische Extraktion (fallbacks beibehalten)
function extractText(obj) {
  const p = (obj && obj.payload) || obj || {};

  // KOI/fragmente
  if (Array.isArray(p.fragments) && p.fragments.length) {
    const t = p.fragments
      .map((f) => (f && (f.text || stripHtmlToText(f.html) || f.raw) || ""))
      .join(" ")
      .trim();
    if (t) return t;
  }

  // message.* Varianten
  if (p.message) {
    if (typeof p.message === "string" && p.message.trim()) return p.message.trim();
    if (typeof p.message === "object") {
      const mt = p.message.text || stripHtmlToText(p.message.html) || p.message.raw;
      if (mt && String(mt).trim()) return String(mt).trim();
    }
  }

  // einfache Felder
  const t3 = p.text || stripHtmlToText(p.html) || p.raw;
  if (t3 && String(t3).trim()) return String(t3).trim();

  // verschachtelt unter event
  if (p.event) {
    const e = p.event;
    if (Array.isArray(e.fragments) && e.fragments.length) {
      const tt = e.fragments
        .map((f) => (f && (f.text || stripHtmlToText(f.html) || f.raw) || ""))
        .join(" ")
        .trim();
      if (tt) return tt;
    }
    const t4 =
      e.text ||
      (e.message && (e.message.text || stripHtmlToText(e.message.html) || e.message.raw)) ||
      stripHtmlToText(e.html) ||
      e.raw;
    if (t4 && String(t4).trim()) return String(t4).trim();
  }

  return "";
}

function extractAuthor(obj) {
  const p = (obj && obj.payload) || obj || {};
  const cand = p.sender || p.author || (p.event && (p.event.sender || p.event.author)) || {};
  const id = cand.id || cand.userId || "";
  const username = cand.username || cand.name || "";
  const name = cand.displayName || cand.name || username || "";
  return { id, name, username };
}

function extractPlatform(payload) {
  // 1) über connectionIdentifier → eventSourceId
  const ci = payload && payload.connectionIdentifier ? connections.get(payload.connectionIdentifier) : null;
  if (ci && ci.eventSourceId != null) {
    const p = PLATFORM_BY_ID[ci.eventSourceId];
    if (p) return p;
  }
  // 2) direkt in payload/event
  const fromEvent = (payload && payload.event && payload.event.platform) || (payload && payload.platform) || "";
  if (fromEvent) return String(fromEvent).toLowerCase();
  return "unknown";
}

// ---- Spezifisch für Restream „event“ mit eventPayload ----
function mapPlatformByEventSourceId(id) {
  const m = { 1: "youtube", 2: "twitch", 3: "facebook", 4: "trovo" };
  return m[id] || "unknown";
}

function extractFromEventEnvelope(root) {
  // erwartet: { action:"event", payload:{ eventPayload:{ author:{...}, text:"..." }, eventSourceId, connectionIdentifier } }
  if (!root || root.action !== "event" || !root.payload) return null;
  const p = root.payload;
  const ep = p.eventPayload || {};
  const author = ep.author || {};
  const text = (ep.text || "").trim();

  const platform =
    mapPlatformByEventSourceId(p.eventSourceId) ||
    (() => {
      const ci = p.connectionIdentifier && connections.get(p.connectionIdentifier);
      return (ci && mapPlatformByEventSourceId(ci.eventSourceId)) || "unknown";
    })();

  return {
    platform,
    text,
    author: {
      id: author.id || author.userId || "",
      username: author.username || author.name || author.displayName || "",
      name: author.displayName || author.name || author.username || "",
    },
    eventTypeId: p.eventTypeId || null,
  };
}

// ---- Token Refresh ----
function refreshRestreamToken({ clientId, clientSecret, refreshToken }) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const req = https.request(
      {
        method: "POST",
        hostname: "api.restream.io",
        path: "/oauth/token",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`refresh failed ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---- Exporte Status/Debug ----
function getConnectionsSnapshot() {
  const out = [];
  for (const [cid, info] of connections.entries()) {
    out.push({ connectionIdentifier: cid, ...info });
  }
  return out;
}
function getBridgeStatus() {
  return { ...state };
}
function getBridgeStatusExtra() {
  return {
    totalWsReceived,
    lastWsAt,
    lastEventPreview,
    connections: getConnectionsSnapshot(),
    rawSamples,
  };
}
module.exports.getBridgeStatus = getBridgeStatus;
module.exports.getBridgeStatusExtra = getBridgeStatusExtra;

// ---- Bridge Start ----
function startRestreamBridge({
  getSessionIdFor, // (platform)=>number
  tokenGetter, // async ()=> { access_token, refresh_token, expires_at }
  tokenSaver, // async (tokenResp)->savedToken
  clientId,
  clientSecret,
  ingestKey = process.env.INGEST_KEY,
  engineIngestUrl = `http://127.0.0.1:${process.env.PORT || 8080}/ingest/message`,
}) {
  if (!ingestKey) {
    console.log("ℹ️ Bridge: INGEST_KEY fehlt -> aus.");
    return;
  }
  if (!clientId || !clientSecret) {
    console.log("ℹ️ Bridge: Client-Creds fehlen -> aus.");
    return;
  }
  if (typeof getSessionIdFor !== "function" || !tokenGetter || !tokenSaver) {
    console.log("ℹ️ Bridge: Callbacks fehlen -> aus.");
    return;
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
      const ms = Math.max(15_000, expiresAt - now - 5 * 60_000);
      refreshTimer = setTimeout(async () => {
        try {
          const tok = await tokenGetter();
          if (!tok?.refresh_token) throw new Error("no refresh token");
          const r = await refreshRestreamToken({
            clientId,
            clientSecret,
            refreshToken: tok.refresh_token,
          });
          const saved = await tokenSaver(r);
          state.token_exists = !!saved?.access_token;
          state.expires_at = saved?.expires_at || null;
          console.log("♻️  Restream token refreshed, new exp:", state.expires_at);
          if (ws) {
            try {
              ws.close();
            } catch {}
          } // Reconnect
        } catch (e) {
          console.error("❌ Token refresh failed:", e.message || String(e));
          setTimeout(
            () => scheduleRefresh(new Date(Date.now() + 10 * 60_000).toISOString()),
            60_000
          );
        }
      }, ms);
    } catch {}
  }

  async function connect() {
    const tok = await tokenGetter();
    state.token_exists = !!tok?.access_token;
    state.expires_at = tok?.expires_at || null;

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
            const r = await refreshRestreamToken({
              clientId,
              clientSecret,
              refreshToken: cur.refresh_token,
            });
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
      totalWsReceived++;
      lastWsAt = new Date().toISOString();

      let root;
      try {
        root = JSON.parse(String(buf));
      } catch {
        return;
      }
      pushRawSample("root", root);

      // Manche Frames sind { data:"<json>" }
      if (root && typeof root.data === "string") {
        try {
          const actionObj = JSON.parse(root.data);
          pushRawSample("data", actionObj);
          await handleAction(actionObj);
          return;
        } catch {}
      }
      if (root && (root.action || root.type)) {
        await handleAction(root);
      }
    });
  }

  async function handleAction(actionObj) {
    const rawAction = actionObj.action || actionObj.type || "unknown";
    const action = String(rawAction).toLowerCase();
    const payload = actionObj.payload || {};

    // Verbindungsinfos pflegen
    if (action === "connection_info") {
      connections.set(payload.connectionIdentifier, {
        eventSourceId: payload.eventSourceId,
        target: payload.target,
        connectionUuid: payload.connectionUuid,
        status: payload.status,
        reason: payload.reason || null,
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

    // 1) Neuer bevorzugter Pfad: „event“ + eventPayload (Restream)
    const env = extractFromEventEnvelope(actionObj);
    if (env && env.text) {
      lastEventPreview = {
        at: new Date().toISOString(),
        platform: env.platform,
        username: env.author.name || env.author.username || null,
        text: env.text,
      };

      // Optional: Nur Chat? (wenn eventTypeId==4 als Chat gilt)
      // if (env.eventTypeId !== 4 && env.eventTypeId != null) return;

      const sessionId = Number(getSessionIdFor(env.platform) || 0);
      if (sessionId) {
        await forwardToEngine(sessionId, env.platform, env.author, env.text);
      }
      return;
    }

    // 2) Fallback: reply_* Pfad (einige Integrationen schicken Chat dort)
    if (action === "reply_created" || action === "reply_accepted" || action === "reply_confirmed") {
      const text = extractText(payload.event || payload);
      if (!text) return;

      const author = extractAuthor(payload.event || payload);
      const platform = extractPlatform(payload);

      lastEventPreview = {
        at: new Date().toISOString(),
        platform,
        username: author.name || author.username || null,
        text,
      };

      const sessionId = Number(getSessionIdFor(platform) || 0);
      if (sessionId) {
        await forwardToEngine(sessionId, platform, author, text);
      }
      return;
    }

    // 3) Generischer Fallback: event/message/chat_message mit payload.event
    if (action === "event" || action === "message" || action === "chat_message") {
      const text = extractText(payload.event || payload);
      if (!text) return;

      const author = extractAuthor(payload.event || payload);
      const platform = extractPlatform(payload);

      lastEventPreview = {
        at: new Date().toISOString(),
        platform,
        username: author.name || author.username || null,
        text,
      };

      const sessionId = Number(getSessionIdFor(platform) || 0);
      if (sessionId) {
        await forwardToEngine(sessionId, platform, author, text);
      }
      return;
    }
  }

  async function forwardToEngine(sessionId, platform, author, text) {
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
          message: text,
        }),
      });
      if (!r || !r.ok) {
        state.totalErrors++;
        const t = r ? await r.text().catch(() => "") : "";
        console.error("❌ ingest", r && r.status, t);
      } else {
        state.totalForwarded++;
      }
    } catch (e) {
      state.totalErrors++;
      console.error("❌ ingest fetch error:", e && e.message ? e.message : String(e));
    }
  }

  connect();
}

module.exports.startRestreamBridge = startRestreamBridge;

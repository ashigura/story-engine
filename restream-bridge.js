// restream-bridge.js (CommonJS) – mit Auto-Refresh via tokenGetter/tokenSaver
const WebSocket = require("ws");
const https = require("https");
const querystring = require("querystring");

let totalWsReceived = 0;
let lastWsAt = null;
let lastEventPreview = null;

function markWsReceived(ev) {
  totalWsReceived++;
  lastWsAt = new Date().toISOString();
  try {
    lastEventPreview = {
      at: lastWsAt,
      platform: ev.platform || null,
      username: ev.user?.displayName || ev.username || null,
      text: ev.message || ev.text || null
    };
  } catch {}
}

function getBridgeStatusExtra() {
  return { totalWsReceived, lastWsAt, lastEventPreview };
}

module.exports.getBridgeStatusExtra = getBridgeStatusExtra;


let _fetch = global.fetch;
if (!_fetch) { try { _fetch = require("node-fetch"); } catch {} }
const fetchFn = (...a) => _fetch(...a);

// Restream Plattform-IDs -> Name (anpassen falls nötig)
const PLATFORM_BY_ID = { 2: "twitch", 13: "youtube", 25: "discord" };

const state = {
  enabled: false,
  wsConnected: false,
  lastMessageAt: null,
  totalForwarded: 0,
  totalErrors: 0,
  lastError: null
};

function getBridgeStatus() { return { ...state }; }

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

function startRestreamBridge({
  getSessionIdFor,          // (platform)=>number
  tokenGetter,              // async ()=> { access_token, refresh_token, expires_at }
  tokenSaver,               // async ({access_token, refresh_token?, expires_in})
  clientId, clientSecret,
  ingestKey = process.env.INGEST_KEY,
  engineIngestUrl = `http://127.0.0.1:${process.env.PORT || 8080}/ingest/message`,
}) {
  if (!ingestKey)   { console.log("ℹ️ Bridge: INGEST_KEY fehlt -> aus"); return; }
  if (!clientId || !clientSecret) { console.log("ℹ️ Bridge: Client-Creds fehlen -> aus"); return; }
  if (typeof getSessionIdFor !== "function" || !tokenGetter || !tokenSaver) {
    console.log("ℹ️ Bridge: Callbacks fehlen -> aus");
    return;
  }
  state.enabled = true;

  let ws = null;
  let refreshTimer = null;

  async function scheduleRefresh(expires_at_iso) {
    clearTimeout(refreshTimer);
    try {
      const expiresAt = new Date(expires_at_iso).getTime();
      const now = Date.now();
      // 5 Minuten vor Ablauf refreshen (min 15 Sek Puffer)
      const ms = Math.max(15_000, (expiresAt - now) - 5 * 60_000);
      refreshTimer = setTimeout(async () => {
        try {
          const tok = await tokenGetter();
          if (!tok?.refresh_token) throw new Error("no refresh token");
          const r = await refreshRestreamToken({
            clientId, clientSecret, refreshToken: tok.refresh_token
          });
          const saved = await tokenSaver(r);
          console.log("♻️  Restream token refreshed, new exp:", saved.expires_at);
          // reconnect erzwingen
          if (ws) { try { ws.close(); } catch {} }
        } catch (e) {
          console.error("❌ Token refresh failed:", e.message || String(e));
          // Nochmals später probieren
          setTimeout(() => scheduleRefresh(Date.now() + 10 * 60_000), 60_000);
        }
      }, ms);
    } catch {}
  }

  async function connect() {
    let tok = await tokenGetter();
    if (!tok?.access_token) {
      console.log("ℹ️ Bridge: kein Access-Token vorhanden – bitte /restream/login");
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
      // Bei Auth-Problem -> sofort refresh + reconnect
      if (code === 1008 || code === 4001 || String(reason).toLowerCase().includes("auth")) {
        try {
          const cur = await tokenGetter();
          const r = await refreshRestreamToken({
            clientId, clientSecret, refreshToken: cur?.refresh_token
          });
          await tokenSaver(r);
          console.log("♻️  Refresh nach WS-Close ok → Reconnect in 1s");
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

    ws.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const { action, payload } = msg || {};
      if (action !== "event" || !payload) return;

      const platform = PLATFORM_BY_ID[payload.eventSourceId] || "unknown";
      const eventPayload = payload.eventPayload || {};

      // minimal: Wir erwarten eventPayload.text + author{...}
      const text = typeof eventPayload.text === "string" ? eventPayload.text : "";
      if (!text) return;

      const a = eventPayload.author || {};
      const author = {
        id: a.id || "",
        name: a.displayName || a.name || "",
        username: a.name || ""
      };

      const sessionId = Number(getSessionIdFor(platform) || 0);
      if (!sessionId) return;

      state.lastMessageAt = new Date().toISOString();

      try {
        const r = await fetchFn(engineIngestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-ingest-key": process.env.INGEST_KEY },
          body: JSON.stringify({
            sessionId, platform,
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
          console.log(`➡ ingest OK: ${platform} | ${author.name || author.username || author.id}: ${text}`);
        }
      } catch (e) {
        state.totalErrors++;
        console.error("❌ ingest fetch error:", e && e.message ? e.message : String(e));
      }
    });
  }

  connect();
}

module.exports = { startRestreamBridge, getBridgeStatus };

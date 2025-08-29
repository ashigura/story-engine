// restream-bridge.js (CommonJS)
// Verbindet zu Restream Chat-WS und leitet Nachrichten an deinen Ingest-Endpoint weiter.
// Erwartet, dass du beim Start in index.js eine getSessionIdFor(platform)-Funktion übergibst.

const WebSocket = require("ws");

// Fallback für fetch (Node 18+ hat global fetch)
let _fetch = global.fetch;
if (!_fetch) {
  try { _fetch = require("node-fetch"); } catch { /* ignore */ }
}
const fetchFn = (...a) => _fetch(...a);

// Restream: Plattform-IDs -> Name
const PLATFORM_BY_ID = { 2: "twitch", 13: "youtube", 25: "discord" };

// interner Status
const state = {
  enabled: false,
  wsConnected: false,
  lastMessageAt: null,
  totalForwarded: 0,
  totalErrors: 0,
  lastError: null
};

// sehr konservatives Parsen
function safeParseJSON(txt, fb) {
  try { return JSON.parse(txt); } catch { return fb; }
}

// Text & Author aus Restream-Event extrahieren (eventPayload-Struktur kann je Plattform variieren)
function extractText(eventPayload) {
  if (!eventPayload || typeof eventPayload !== "object") return "";
  if (typeof eventPayload.text === "string") return eventPayload.text;
  // ggf. weitere Felder ergänzen, falls Restream-Formate abweichen
  return "";
}

function extractAuthor(eventPayload) {
  const a = (eventPayload && eventPayload.author) || {};
  return {
    id: a.id || "",
    name: a.displayName || a.name || "",
    username: a.name || ""
  };
}

function getBridgeStatus() {
  return { ...state };
}

/**
 * Startet die Restream-Bridge.
 * @param {Object} opts
 * @param {string} opts.accessToken - RESTREAM_ACCESS_TOKEN (Scope: chat.read)
 * @param {string} [opts.engineIngestUrl] - Ziel für Ingest (Default: http://127.0.0.1:<PORT>/ingest/message)
 * @param {string} opts.ingestKey - x-ingest-key für deinen /ingest/message Endpoint
 * @param {Function} opts.getSessionIdFor - (platform: string) => number (Session-ID zur Laufzeit bestimmen)
 */
function startRestreamBridge({ accessToken, engineIngestUrl, ingestKey, getSessionIdFor }) {
  if (!accessToken) { console.log("ℹ️ Restream-Bridge: kein RESTREAM_ACCESS_TOKEN -> deaktiviert."); return; }
  if (!ingestKey)   { console.log("ℹ️ Restream-Bridge: kein INGEST_KEY -> deaktiviert."); return; }
  if (typeof getSessionIdFor !== "function") {
    console.log("ℹ️ Restream-Bridge: getSessionIdFor(platform) fehlt -> deaktiviert.");
    return;
  }

  // Default: interner Ingest auf denselben Service
  const port = Number(process.env.PORT || 8080);
  const ingestUrl = engineIngestUrl || `http://127.0.0.1:${port}/ingest/message`;

  state.enabled = true;

  function connect() {
    const url = `wss://chat.api.restream.io/ws?accessToken=${encodeURIComponent(accessToken)}`;
    console.log("🔌 Restream-Bridge verbindet zu:", url);

    const ws = new WebSocket(url);

    ws.on("open", () => {
      state.wsConnected = true;
      console.log("🟢 Restream WS verbunden.");
    });

    ws.on("close", (code, reason) => {
      state.wsConnected = false;
      console.log(`⚠️ Restream WS geschlossen (${code}) ${reason || ""} → Reconnect in 3000ms`);
      setTimeout(connect, 3000);
    });

    ws.on("error", (err) => {
      state.wsConnected = false;
      state.lastError = (err && err.message) || String(err);
      console.error("❌ Restream WS Fehler:", state.lastError);
    });

    ws.on("message", async (data) => {
      // Erwartet: { action: "event", payload: { eventSourceId, eventPayload } }
      let msg = safeParseJSON(String(data), null);
      if (!msg || msg.action !== "event" || !msg.payload) return;

      const platform = PLATFORM_BY_ID[msg.payload.eventSourceId] || "unknown";
      const eventPayload = msg.payload.eventPayload || {};

      const text = extractText(eventPayload);
      if (!text) return;

      const author = extractAuthor(eventPayload);
      const sessionId = Number(getSessionIdFor(platform) || 0);
      if (!sessionId) return; // keine Zielsession konfiguriert → ignorieren

      state.lastMessageAt = new Date().toISOString();

      try {
        const r = await fetchFn(ingestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ingest-key": ingestKey
          },
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
          const t = await r.text().catch(() => "");
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

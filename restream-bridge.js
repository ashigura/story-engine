// Datei: restream-bridge.js (läuft im selben Node-Prozess wie deine Engine)
import WebSocket from 'ws';

// platformId -> name (aus Restream)
const PLATFORM_BY_ID = { 2: 'twitch', 13: 'youtube', 25: 'discord' };

const state = {
  enabled: false,
  wsConnected: false,
  lastMessageAt: null,
  totalForwarded: 0,
  totalErrors: 0,
  lastError: null
};

// Sehr konservatives JSON-Parsing
const safeJson = (txt, fb = {}) => {
  try { return JSON.parse(txt); } catch { return fb; }
};

// Event-Payload in Plaintext & Author normalisieren (Restream liefert je Quelle etwas anders)
function extractText(eventPayload) {
  if (!eventPayload || typeof eventPayload !== 'object') return '';
  if (typeof eventPayload.text === 'string') return eventPayload.text;
  return '';
}
function extractAuthor(eventPayload) {
  const a = eventPayload?.author || {};
  return {
    id: a.id || '',
    name: a.displayName || a.name || '',
    username: a.name || ''
  };
}

export function getBridgeStatus() {
  return { ...state };
}

// Startet die Bridge, wenn Token gesetzt ist
export function startRestreamBridge({
  accessToken,
  // Wenn nicht gesetzt, posten wir intern auf localhost -> /ingest/message
  engineIngestUrl = `http://127.0.0.1:${process.env.PORT || 8080}/ingest/message`,
  ingestKey,
  defaultSessionId = 0,
  platformSessionMap = {}
}) {
  if (!accessToken) return console.log('ℹ️  Restream-Bridge: kein RESTREAM_ACCESS_TOKEN -> deaktiviert.');
  if (!ingestKey)   return console.log('ℹ️  Restream-Bridge: kein INGEST_KEY -> deaktiviert.');

  state.enabled = true;

  const routeToSession = (platform) => {
    const v = platformSessionMap?.[platform];
    return Number.isFinite(Number(v)) ? Number(v) : Number(defaultSessionId || 0);
  };

  const connect = () => {
    const url = `wss://chat.api.restream.io/ws?accessToken=${encodeURIComponent(accessToken)}`;
    console.log('🔌 Restream-Bridge verbindet zu:', url);

    const ws = new WebSocket(url);

    ws.on('open', () => {
      state.wsConnected = true;
      console.log('🟢 Restream WS verbunden.');
    });

    ws.on('close', (code, reason) => {
      state.wsConnected = false;
      console.log(`⚠️  Restream WS geschlossen (${code}) ${reason || ''} -> Reconnect in 3s`);
      setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
      state.wsConnected = false;
      state.lastError = err?.message || String(err);
      console.error('❌ Restream WS Fehler:', state.lastError);
    });

    ws.on('message', async (data) => {
      // Erwartet: { action: "event", payload: { eventSourceId, eventPayload } }
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const { action, payload } = msg || {};
      if (action !== 'event' || !payload) return;

      const platform = PLATFORM_BY_ID[payload.eventSourceId] || 'unknown';
      const eventPayload = payload.eventPayload || {};

      const text = extractText(eventPayload);
      if (!text) return;

      const author = extractAuthor(eventPayload);
      const sessionId = routeToSession(platform);
      if (!sessionId) return; // keine Ziel-Session hinterlegt

      state.lastMessageAt = new Date().toISOString();

      // An deinen vorhandenen Ingest-Endpoint weiterreichen (intern)
      try {
        const r = await fetch(engineIngestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ingest-key': ingestKey
          },
          body: JSON.stringify({
            sessionId,
            platform,
            userId: author.id || author.username || '',
            username: author.name || author.username || '',
            message: text
          })
        });
        if (!r.ok) {
          state.totalErrors++;
          const t = await r.text().catch(() => '');
          console.error('❌ ingest', r.status, t);
        } else {
          state.totalForwarded++;
          console.log(`➡ ingest OK: ${platform}|${author.name || author.username || author.id}: ${text}`);
        }
      } catch (e) {
        state.totalErrors++;
        console.error('❌ ingest fetch error:', e?.message || String(e));
      }
    });
  };

  connect();
}

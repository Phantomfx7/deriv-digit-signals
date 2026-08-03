// Shared connection to Deriv's API.
//
// We use the same endpoint Deriv's own charts.deriv.com uses internally —
// wss://api-core.deriv.com/options/v1/ws/public — rather than the older
// wss://ws.derivws.com/websockets/v3 documented in most public tutorials.
// The old endpoint proved unreliable for freshly-registered app_ids during
// testing (immediate handshake failures), while this one connects cleanly
// and needs no app_id in the URL at all for anonymous public market data.
const WS_URL = 'wss://api-core.deriv.com/options/v1/ws/public';

let ws = null;
let currentSymbol = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let keepaliveTimer = null;
let reqIdCounter = 1;
let onOpenQueue = [];
const pendingRequests = new Map();
const tickListeners = new Set();
const statusListeners = new Set();
const symbolSubscriptions = new Map(); // symbol -> Set<callback>, independent of currentSymbol
const activeSubscriptions = new Set(); // symbols we've actually sent a subscribe request for
const PING_INTERVAL_MS = 30000;

function emitStatus(status) {
  statusListeners.forEach((cb) => cb(status));
}

function extractLastDigit(quote) {
  const str = quote.toString();
  const lastChar = str[str.length - 1];
  if (/[0-9]/.test(lastChar)) return parseInt(lastChar, 10);
  // fallback: strip the decimal point and take the last numeral
  return parseInt(str.replace('.', '').slice(-1), 10);
}

export function onTick(cb) {
  tickListeners.add(cb);
  return () => tickListeners.delete(cb);
}

export function onStatus(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function connect(symbol) {
  currentSymbol = symbol;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    // detach handlers first so closing this old socket can't trigger our
    // reconnect logic or overwrite the status the new socket is about to set
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch (e) { /* noop */ }
  }
  emitStatus('connecting');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectAttempts = 0;
    emitStatus('live');
    // Clear out any subscriptions the server might still be holding from a
    // previous, abnormally-closed connection before asking for fresh ones —
    // otherwise repeated reconnects can quietly pile up orphaned streams.
    ws.send(JSON.stringify({ forget_all: 'ticks' }));
    activeSubscriptions.clear();
    // currentSymbol and the multi-market symbols can overlap (e.g. R_100 is
    // both the header's default and one of the card-view markets) — combine
    // them into one set so we never send the same symbol twice.
    const allSymbols = new Set([currentSymbol, ...symbolSubscriptions.keys()]);
    allSymbols.forEach((symbol) => {
      if (!symbol) return;
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      activeSubscriptions.add(symbol);
    });
    const queued = onOpenQueue;
    onOpenQueue = [];
    queued.forEach((fn) => fn());

    // A light periodic ping keeps the connection alive on its own terms,
    // rather than letting it silently time out and forcing a reconnect
    // (Deriv support flagged "reconnect storms" as something to avoid).
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: 1 }));
    }, PING_INTERVAL_MS);
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.req_id && pendingRequests.has(data.req_id)) {
      const { resolve, reject } = pendingRequests.get(data.req_id);
      pendingRequests.delete(data.req_id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data);
      return;
    }

    if (data.error) {
      console.error('[deriv] API error:', data.error);
      emitStatus('error: ' + data.error.message);
      return;
    }
    if (data.msg_type === 'tick' && data.tick) {
      const quote = data.tick.quote;
      const payload = {
        digit: extractLastDigit(quote),
        quote,
        symbol: data.tick.symbol,
        epoch: data.tick.epoch,
      };
      tickListeners.forEach((cb) => cb(payload));
      const subs = symbolSubscriptions.get(data.tick.symbol);
      if (subs) subs.forEach((cb) => cb(payload));
    }
  };

  ws.onerror = (event) => {
    console.error('[deriv] WebSocket error — open DevTools > Network > WS to inspect the handshake:', event);
    emitStatus('connection error');
  };

  ws.onclose = (event) => {
    console.warn(`[deriv] WebSocket closed. code=${event.code} reason="${event.reason || 'none given'}" clean=${event.wasClean}`);
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    emitStatus(`disconnected (code ${event.code}) — retrying…`);
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 15000); // exponential backoff, capped at 15s
  reconnectTimer = setTimeout(() => {
    if (currentSymbol) connect(currentSymbol);
  }, delay);
}

// Tell Deriv we're done before the tab actually closes, so subscriptions
// don't linger server-side waiting for the socket to time out on its own.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ forget_all: 'ticks' })); } catch (e) { /* noop */ }
    }
  });
}

export function changeSymbol(symbol) {
  currentSymbol = symbol;
  if (activeSubscriptions.has(symbol)) return; // already streaming (e.g. shared with a card view)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    activeSubscriptions.add(symbol);
  } else {
    connect(symbol);
  }
}

export function getSymbol() {
  return currentSymbol;
}

// Subscribe to ticks for a specific symbol independent of the single
// "active" market the header/other tabs use. Used by the Matches/Differs
// card view to watch several markets at once on the same connection.
export function subscribeTicks(symbol, callback) {
  let set = symbolSubscriptions.get(symbol);
  if (!set) {
    set = new Set();
    symbolSubscriptions.set(symbol, set);
  }
  set.add(callback);

  if (!activeSubscriptions.has(symbol)) {
    activeSubscriptions.add(symbol);
    const request = () => ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    if (ws && ws.readyState === WebSocket.OPEN) request();
    else onOpenQueue.push(request);
  }
  return () => set.delete(callback);
}

function send(request) {
  return new Promise((resolve, reject) => {
    const req_id = reqIdCounter++;
    pendingRequests.set(req_id, { resolve, reject });
    const payload = JSON.stringify({ ...request, req_id });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      onOpenQueue.push(() => ws.send(payload));
    }
  });
}

// Pulls the live list of tradable symbols straight from Deriv, rather than
// trusting a hardcoded list — Deriv periodically adds/retires instruments
// (this is exactly why a stale "1HZ25V" can suddenly start erroring).
export async function fetchActiveSymbols() {
  const data = await send({ active_symbols: 'brief' });
  return (data.active_symbols || []).filter((s) => s.market === 'synthetic_index');
}

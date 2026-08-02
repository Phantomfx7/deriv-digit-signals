// Shared connection to Deriv's public WebSocket API.
//
// app_id 1089 is Deriv's shared public demo id. It's meant for quick testing,
// but Deriv can throttle or restrict it without notice — if you're seeing
// "InvalidSymbol" errors on symbols that definitely exist (e.g. R_100), your
// own registered app_id is the fix, not a different symbol code.
//
// Get a free one at https://developers.deriv.com/docs/app-registration,
// then set VITE_DERIV_APP_ID in a .env file at the project root:
//   VITE_DERIV_APP_ID=12345
// (see .env.example)
const APP_ID = import.meta.env.VITE_DERIV_APP_ID || 1089;

let ws = null;
let currentSymbol = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let reqIdCounter = 1;
let onOpenQueue = [];
const pendingRequests = new Map();
const tickListeners = new Set();
const statusListeners = new Set();

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

  ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    emitStatus('live');
    ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1 }));
    const queued = onOpenQueue;
    onOpenQueue = [];
    queued.forEach((fn) => fn());
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
      tickListeners.forEach((cb) =>
        cb({
          digit: extractLastDigit(quote),
          quote,
          symbol: data.tick.symbol,
          epoch: data.tick.epoch,
        })
      );
    }
  };

  ws.onerror = (event) => {
    console.error('[deriv] WebSocket error — open DevTools > Network > WS to inspect the handshake:', event);
    emitStatus('connection error');
  };

  ws.onclose = (event) => {
    console.warn(`[deriv] WebSocket closed. code=${event.code} reason="${event.reason || 'none given'}" clean=${event.wasClean}`);
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

export function changeSymbol(symbol) {
  currentSymbol = symbol;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ forget_all: 'ticks' }));
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  } else {
    connect(symbol);
  }
}

export function getSymbol() {
  return currentSymbol;
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
  const data = await send({ active_symbols: 'brief', product_type: 'basic' });
  return (data.active_symbols || []).filter((s) => s.market === 'synthetic_index');
}

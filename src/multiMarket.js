import { subscribeTicks, fetchActiveSymbols } from './deriv.js';

const MAX_BUFFER = 200;

const marketState = new Map(); // symbol -> { digits: [], lastPrice: null }
const marketListeners = new Map(); // symbol -> Set<callback>
let markets = []; // populated dynamically from Deriv's live symbol list
let loadPromise = null;

const STAGGER_MS = 750;

function ensureSubscribed(symbol) {
  if (marketState.has(symbol)) return;
  marketState.set(symbol, { digits: [], lastPrice: null });
  subscribeTicks(symbol, ({ digit, quote }) => {
    const s = marketState.get(symbol);
    s.digits.push(digit);
    if (s.digits.length > MAX_BUFFER) s.digits.shift();
    s.lastPrice = quote;
    const listeners = marketListeners.get(symbol);
    if (listeners) listeners.forEach((cb) => cb(s));
  });
}

// Subscribing to every market at once, all in the same instant, looks like
// exactly the kind of burst pattern connection-abuse detection reacts to.
// Spacing requests out a fraction of a second apart is gentler on the
// same app_id and avoids retriggering the rate limit we hit earlier.
function subscribeAllStaggered(symbols) {
  symbols.forEach(({ symbol }, i) => {
    setTimeout(() => ensureSubscribed(symbol), i * STAGGER_MS);
  });
}

// Pulls every currently-live volatility index straight from Deriv rather
// than hardcoding a list — this is the same fix we used for the market
// dropdown, and for the same reason: Deriv adds/retires instruments
// (especially the 1-second variants) without much notice.
export async function loadMarkets() {
  if (loadPromise) return loadPromise;
  loadPromise = fetchActiveSymbols()
    .then((symbols) => {
      markets = symbols
        .filter((s) => /volatility/i.test(s.underlying_symbol_name))
        .map((s) => ({ symbol: s.underlying_symbol, name: s.underlying_symbol_name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      subscribeAllStaggered(markets);
      return markets;
    })
    .catch((err) => {
      loadPromise = null; // allow a fresh attempt instead of replaying this rejection forever
      throw err;
    });
  return loadPromise;
}

export function getMarkets() {
  return markets;
}

export function subscribeMarket(symbol, callback) {
  let set = marketListeners.get(symbol);
  if (!set) {
    set = new Set();
    marketListeners.set(symbol, set);
  }
  set.add(callback);
  return () => set.delete(callback);
}

export function getMarketDigits(symbol, n) {
  const s = marketState.get(symbol);
  return s ? s.digits.slice(-n) : [];
}

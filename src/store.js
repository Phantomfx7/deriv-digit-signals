import { onTick, onStatus, connect, changeSymbol as wsChangeSymbol } from './deriv.js';

const MAX_BUFFER = 500;

export const state = {
  symbol: 'R_100',
  digits: [],
  lastPrice: null,
  tickCount: 0,
  status: 'connecting',
};

const subscribers = new Set();

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function notify() {
  subscribers.forEach((cb) => cb(state));
}

onTick(({ digit, quote, symbol }) => {
  if (symbol !== state.symbol) return; // ignore ticks from other markets (card view, etc.)
  state.digits.push(digit);
  if (state.digits.length > MAX_BUFFER) state.digits.shift();
  state.lastPrice = quote;
  state.tickCount += 1;
  notify();
});

onStatus((status) => {
  state.status = status;
  notify();
});

export function init() {
  connect(state.symbol);
}

export function changeSymbol(symbol) {
  state.symbol = symbol;
  state.digits = [];
  state.tickCount = 0;
  wsChangeSymbol(symbol);
  notify();
}

// Returns the last N digits (or fewer if not enough ticks yet)
export function lastDigits(n) {
  return state.digits.slice(-n);
}

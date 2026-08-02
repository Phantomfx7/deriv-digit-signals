import { loadMarkets, subscribeMarket, getMarketDigits } from '../multiMarket.js';

const WINDOW = 50;
const COUNTDOWN_MIN = 3;
const COUNTDOWN_MAX = 6;

function computeSignal(symbol) {
  const digits = getMarketDigits(symbol, WINDOW);
  if (digits.length === 0) return { digit: null, confidence: 0, total: 0 };
  const counts = new Array(10).fill(0);
  digits.forEach((d) => counts[d]++);
  let topDigit = 0;
  for (let d = 1; d < 10; d++) if (counts[d] > counts[topDigit]) topDigit = d;
  return { digit: topDigit, confidence: Math.round((counts[topDigit] / digits.length) * 100), total: digits.length };
}

function randomCountdown() {
  return COUNTDOWN_MIN + Math.floor(Math.random() * (COUNTDOWN_MAX - COUNTDOWN_MIN + 1));
}

function cardHtml({ symbol, name }) {
  return `
    <div class="market-card" data-symbol="${symbol}">
      <div class="market-card-head">
        <div>
          <div class="market-card-name">${name}</div>
          <div class="market-card-sym">${symbol}</div>
        </div>
        <div class="live-badge"><span class="live-dot"></span>LIVE</div>
      </div>
      <div class="market-ring">
        <div class="market-ring-inner">
          <span class="market-digit">—</span>
        </div>
      </div>
      <div class="market-confidence">Confidence: —</div>
      <div class="market-entry">ENTRY IN —</div>
    </div>
  `;
}

export function mount(container) {
  let cancelled = false;
  let timer = null;
  const unsubscribers = [];
  const countdowns = new Map();

  container.innerHTML = `<div class="market-cards"><p style="color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:13px;">Loading live markets…</p></div>`;

  loadMarkets().then((markets) => {
    if (cancelled) return;
    const listEl = container.querySelector('.market-cards');
    listEl.innerHTML = markets.map(cardHtml).join('');

    markets.forEach(({ symbol }) => {
      const card = container.querySelector(`.market-card[data-symbol="${symbol}"]`);
      const digitEl = card.querySelector('.market-digit');
      const confEl = card.querySelector('.market-confidence');
      const entryEl = card.querySelector('.market-entry');

      function render() {
        const { digit, confidence, total } = computeSignal(symbol);
        if (total === 0) return;
        digitEl.textContent = digit;
        confEl.textContent = `Confidence: ${confidence}%`;
      }

      const unsub = subscribeMarket(symbol, render);
      unsubscribers.push(unsub);
      render();

      countdowns.set(symbol, randomCountdown());
      entryEl.textContent = `ENTRY IN ${countdowns.get(symbol)}S`;
    });

    // A shared, steady visual pace across all cards — not a claim about
    // when the market will actually move, just a refresh cadence (see the
    // note at the bottom of the page about digit independence).
    timer = setInterval(() => {
      markets.forEach(({ symbol }) => {
        const card = container.querySelector(`.market-card[data-symbol="${symbol}"]`);
        if (!card) return;
        const entryEl = card.querySelector('.market-entry');
        let n = countdowns.get(symbol) - 1;
        if (n <= 0) n = randomCountdown();
        countdowns.set(symbol, n);
        entryEl.textContent = `ENTRY IN ${n}S`;
      });
    }, 1000);
  });

  return () => {
    cancelled = true;
    if (timer) clearInterval(timer);
    unsubscribers.forEach((unsub) => unsub());
  };
}

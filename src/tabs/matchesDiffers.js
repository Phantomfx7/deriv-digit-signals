import { loadMarkets, subscribeMarket, getMarketDigits } from '../multiMarket.js';

const WINDOW = 50;
const SPARK_POINTS = 15;
const UPCOMING_SECONDS = 5;
const ENTRY_SECONDS = 5;
const EXECUTE_SECONDS = 2;

// One palette per card, cycled by index. Volatility 10/25/50 (1s) intentionally
// match the navy/gold, cream/gold, dark-green/green reference; the rest fill
// in with distinct colors so every market is visually easy to tell apart.
const PALETTES = [
  { bg: '#0F1C3F', ring: '#D9A73B', fg: '#FFFFFF', fgMuted: '#A9B4CC' },
  { bg: '#FBF6EC', ring: '#D9A73B', fg: '#14181F', fgMuted: '#8A8272' },
  { bg: '#0B2E22', ring: '#3ED598', fg: '#FFFFFF', fgMuted: '#9FCBB8' },
  { bg: '#3A1220', ring: '#F2637E', fg: '#FFFFFF', fgMuted: '#D8A0AC' },
  { bg: '#241436', ring: '#A78BFA', fg: '#FFFFFF', fgMuted: '#C3B4E0' },
  { bg: '#101826', ring: '#4FA3F0', fg: '#FFFFFF', fgMuted: '#9CB2CC' },
  { bg: '#0B2A2E', ring: '#2DD4BF', fg: '#FFFFFF', fgMuted: '#9FC9C4' },
  { bg: '#1C1A16', ring: '#F0A93B', fg: '#FFFFFF', fgMuted: '#C7BBA0' },
  { bg: '#2E1B10', ring: '#F2884B', fg: '#FFFFFF', fgMuted: '#D7B29C' },
  { bg: '#161233', ring: '#B4A8F5', fg: '#FFFFFF', fgMuted: '#C6BEE8' },
];

function computeSignal(symbol) {
  const digits = getMarketDigits(symbol, WINDOW);
  if (digits.length === 0) return { digit: null, confidence: 0, total: 0 };
  const counts = new Array(10).fill(0);
  digits.forEach((d) => counts[d]++);
  let topDigit = 0;
  for (let d = 1; d < 10; d++) if (counts[d] > counts[topDigit]) topDigit = d;
  return { digit: topDigit, confidence: Math.round((counts[topDigit] / digits.length) * 100), total: digits.length };
}

function initialPhase() {
  return { phase: 'upcoming', remaining: UPCOMING_SECONDS };
}

function advancePhase({ phase, remaining }) {
  const n = remaining - 1;
  if (n > 0) return { phase, remaining: n };
  if (phase === 'upcoming') return { phase: 'entry', remaining: ENTRY_SECONDS };
  if (phase === 'entry') return { phase: 'execute', remaining: EXECUTE_SECONDS };
  return { phase: 'upcoming', remaining: UPCOMING_SECONDS }; // was 'execute'
}

function phaseText({ phase, remaining }) {
  if (phase === 'upcoming') return `Upcoming prediction in ${remaining}s`;
  if (phase === 'entry') return `Entry countdown in ${remaining}sec`;
  return 'Execute Trade Now';
}

function phaseClass({ phase }) {
  return `market-entry phase-${phase}`;
}

function sparkPoints(symbol, color) {
  const digits = getMarketDigits(symbol, SPARK_POINTS);
  if (digits.length < 2) return '';
  const stepX = 120 / (SPARK_POINTS - 1);
  return digits
    .map((d, i) => `${i * stepX},${40 - (d / 9) * 32 - 4}`)
    .join(' ');
}

function pulseIcon(color) {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 7 12 9 6 13 18 16 12 22 12"/></svg>`;
}

function cardHtml({ symbol, name }, palette) {
  return `
    <div class="market-card" data-symbol="${symbol}" style="background:${palette.bg}">
      <div class="market-card-head">
        <div class="market-card-title-group">
          <div class="market-icon" style="background:${palette.ring}22">${pulseIcon(palette.ring)}</div>
          <div>
            <div class="market-card-name" style="color:${palette.fg}">${name}</div>
            <div class="market-card-sym" style="color:${palette.fgMuted}">${symbol}</div>
          </div>
        </div>
        <div class="live-badge"><span class="live-dot"></span>LIVE</div>
      </div>
      <div class="market-body">
        <div class="market-ring" style="background:${palette.ring}">
          <div class="market-ring-inner" style="background:${palette.bg}">
            <span class="market-digit" style="color:${palette.fg}">—</span>
          </div>
        </div>
        <svg class="market-spark" viewBox="0 0 120 40">
          <polyline class="spark-line" fill="none" stroke="${palette.ring}" stroke-width="2" points="" />
        </svg>
      </div>
      <div class="market-confidence">Confidence: —</div>
      <div class="market-entry phase-upcoming">Upcoming prediction in ${UPCOMING_SECONDS}s</div>
    </div>
  `;
}

function loadingHtml() {
  return `<div class="market-load-state">Loading live markets…</div>`;
}

function errorHtml(message) {
  return `<div class="market-load-state">Couldn't load live markets (${message}).<br><button id="md-retry">Retry</button></div>`;
}

export function mount(container) {
  let cancelled = false;
  let timer = null;
  const unsubscribers = [];
  const phases = new Map();

  function cleanupSubs() {
    if (timer) clearInterval(timer);
    timer = null;
    unsubscribers.forEach((unsub) => unsub());
    unsubscribers.length = 0;
    phases.clear();
  }

  function attemptLoad() {
    container.innerHTML = `<div class="market-cards">${loadingHtml()}</div>`;

    loadMarkets().then((markets) => {
      if (cancelled) return;
      const listEl = container.querySelector('.market-cards');
      listEl.innerHTML = markets.map((m, i) => cardHtml(m, PALETTES[i % PALETTES.length])).join('');

      markets.forEach(({ symbol }, i) => {
        const palette = PALETTES[i % PALETTES.length];
        const card = container.querySelector(`.market-card[data-symbol="${symbol}"]`);
        const digitEl = card.querySelector('.market-digit');
        const confEl = card.querySelector('.market-confidence');
        const sparkEl = card.querySelector('.spark-line');

        function render() {
          const { digit, confidence, total } = computeSignal(symbol);
          if (total === 0) return;
          digitEl.textContent = digit;
          confEl.textContent = `Confidence: ${confidence}%`;
          sparkEl.setAttribute('points', sparkPoints(symbol, palette.ring));
        }

        unsubscribers.push(subscribeMarket(symbol, render));
        render();

        phases.set(symbol, initialPhase());
      });

      // A shared, steady visual pace across all cards — not a claim about
      // when the market will actually move, just a refresh cadence (see
      // the note at the bottom of the page about digit independence).
      timer = setInterval(() => {
        markets.forEach(({ symbol }) => {
          const card = container.querySelector(`.market-card[data-symbol="${symbol}"]`);
          if (!card) return;
          const entryEl = card.querySelector('.market-entry');
          const next = advancePhase(phases.get(symbol));
          phases.set(symbol, next);
          entryEl.textContent = phaseText(next);
          entryEl.className = phaseClass(next);
        });
      }, 1000);
    }).catch((err) => {
      if (cancelled) return;
      console.error('[matches-differs] failed to load markets', err);
      container.innerHTML = `<div class="market-cards">${errorHtml(err.message)}</div>`;
      const retryBtn = container.querySelector('#md-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => { cleanupSubs(); attemptLoad(); });
    });
  }

  attemptLoad();

  return () => {
    cancelled = true;
    cleanupSubs();
  };
}

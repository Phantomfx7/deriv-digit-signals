import { loadMarkets, subscribeMarket, getMarketDigits } from '../multiMarket.js';
import { runAnalysisCycle, recordOutcome, getAccuracy } from '../analysisEngine.js';

const WINDOW = 100; // sample size the analysis engine draws on each cycle
const SPARK_POINTS = 15;
const UPCOMING_SECONDS = 10;
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

function initialPhase() {
  return { phase: 'upcoming', remaining: UPCOMING_SECONDS };
}

function advancePhase({ phase, remaining }) {
  const n = remaining - 1;
  if (n > 0) return { phase, remaining: n };
  if (phase === 'upcoming') return { phase: 'entry', remaining: ENTRY_SECONDS };
  if (phase === 'entry') return { phase: 'execute', remaining: EXECUTE_SECONDS };
  return { phase: 'upcoming', remaining: UPCOMING_SECONDS }; // was 'execute' — cycle boundary
}

function phaseText({ phase, remaining }) {
  if (phase === 'upcoming') return `Upcoming prediction in ${remaining}s`;
  if (phase === 'entry') return `Entry countdown in ${remaining}sec`;
  return 'EXECUTE TRADE NOW';
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
        <div class="market-ring-wrap">
          <div class="market-ring" style="background:${palette.ring}">
            <div class="market-ring-inner" style="background:${palette.bg}">
              <span class="market-digit" style="color:${palette.fg}">—</span>
            </div>
          </div>
          <svg class="market-spark" viewBox="0 0 120 40">
            <polyline class="spark-line" fill="none" stroke="${palette.ring}" stroke-width="2" points="" />
          </svg>
        </div>
      </div>
      <div class="market-confidence">Match confidence: —</div>
      <div class="market-honesty" style="color:${palette.fgMuted}">—</div>
      <div class="market-entry phase-upcoming">Upcoming prediction in ${UPCOMING_SECONDS}s</div>
      <div class="market-subtext"></div>
      <div class="market-accuracy" style="color:${palette.fgMuted}">Tracking accuracy…</div>
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
  const cycleResults = new Map(); // symbol -> frozen analysis result for the current cycle
  const runCycleFns = new Map(); // symbol -> function that (re)computes and displays a fresh cycle

  function cleanupSubs() {
    if (timer) clearInterval(timer);
    timer = null;
    unsubscribers.forEach((unsub) => unsub());
    unsubscribers.length = 0;
    phases.clear();
    cycleResults.clear();
    runCycleFns.clear();
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
        const honestyEl = card.querySelector('.market-honesty');
        const sparkEl = card.querySelector('.spark-line');
        const accEl = card.querySelector('.market-accuracy');

        // The sparkline is purely visual and can keep updating live —
        // it's not a confidence claim, just a recent-digits trace.
        function renderSpark() {
          sparkEl.setAttribute('points', sparkPoints(symbol, palette.ring));
        }
        unsubscribers.push(subscribeMarket(symbol, renderSpark));
        renderSpark();

        function updateAccuracyDisplay() {
          const acc = getAccuracy(symbol);
          accEl.textContent = acc
            ? `Top-digit accuracy: ${acc.pct}% (n=${acc.n})`
            : 'Tracking accuracy…';
        }

        // Runs once per analysis cycle — NOT on every tick. This is what
        // keeps the displayed confidence stable through the countdown
        // instead of flickering with every incoming tick.
        function runCycle() {
          const digits = getMarketDigits(symbol, WINDOW);
          if (digits.length === 0) return;
          const result = runAnalysisCycle(symbol, digits);
          cycleResults.set(symbol, result);
          digitEl.textContent = result.topDigit;
          confEl.textContent = `Match confidence: ${Math.round(result.scores[result.topDigit])}%`;
          honestyEl.textContent =
            `entropy ${result.entropy.toFixed(2)}/${result.maxEntropy.toFixed(2)} · χ² p=${result.chiSquarePValue.toFixed(2)}`;
        }

        runCycleFns.set(symbol, runCycle);
        runCycle();
        updateAccuracyDisplay();
        phases.set(symbol, initialPhase());

        // stash for the timer loop below
        card._updateAccuracyDisplay = updateAccuracyDisplay;
      });

      // A shared, steady visual pace across all cards — not a claim about
      // when the market will actually move, just a refresh cadence (see
      // the note at the bottom of the page about digit independence).
      timer = setInterval(() => {
        markets.forEach(({ symbol }) => {
          const card = container.querySelector(`.market-card[data-symbol="${symbol}"]`);
          if (!card) return;
          const entryEl = card.querySelector('.market-entry');
          const subtextEl = card.querySelector('.market-subtext');
          const prev = phases.get(symbol);
          const next = advancePhase(prev);
          phases.set(symbol, next);
          entryEl.textContent = phaseText(next);
          entryEl.className = phaseClass(next);
          subtextEl.textContent = next.phase === 'execute' ? 'Quantum window is open' : '';

          // Cycle boundary: score the just-finished cycle's top-ranked
          // digit against whatever actually arrived, then start a fresh
          // analysis cycle for the next one.
          if (prev.phase === 'execute' && next.phase === 'upcoming') {
            const prevResult = cycleResults.get(symbol);
            const latestDigits = getMarketDigits(symbol, 1);
            const actualDigit = latestDigits[latestDigits.length - 1];
            if (prevResult && actualDigit !== undefined) {
              recordOutcome(symbol, prevResult.topDigit, actualDigit);
            }
            const runCycle = runCycleFns.get(symbol);
            if (runCycle) runCycle();
            if (card._updateAccuracyDisplay) card._updateAccuracyDisplay();
          }
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

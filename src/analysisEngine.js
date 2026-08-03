// Digit-Matching Analysis Engine
//
// Computes a per-digit "model confidence" score from real tick history —
// frequency deviation, gap-since-last-seen, and a Markov transition signal,
// combined with logged, transparent weights. This does NOT and cannot
// predict the next digit: Deriv's synthetic index digits are designed to be
// statistically independent and uniform (~10% each). Nothing here changes
// that. What this module does is faithfully compute real statistics and
// surface an honesty check (entropy + chi-square) alongside the score, and
// track its own long-run accuracy so any drift from ~10% is visible rather
// than hidden.
//
// Scope note: this intentionally does NOT include an ML ensemble
// (Random Forest / Gradient Boosting / LSTM etc). That requires a real
// training pipeline and backend, which a static client-side site doesn't
// have — faking one here would be exactly the kind of "dressed up" score
// this engine is supposed to avoid.

const DIGITS = 10;

export function frequencyVector(digits) {
  const counts = new Array(DIGITS).fill(0);
  digits.forEach((d) => counts[d]++);
  const total = digits.length || 1;
  return counts.map((c) => (c / total) * 100);
}

// "Gap" = how many ticks since each digit last appeared, relative to that
// digit's own historical average gap. A ratio > 1 means it's gone longer
// than its own norm — described neutrally as "overdue," not as evidence
// it's more likely next (it isn't, on genuinely random data).
export function gapVector(digits) {
  const lastSeen = new Array(DIGITS).fill(-1);
  const gapHistory = Array.from({ length: DIGITS }, () => []);
  digits.forEach((d, i) => {
    if (lastSeen[d] !== -1) gapHistory[d].push(i - lastSeen[d]);
    lastSeen[d] = i;
  });
  const n = digits.length;
  const currentGap = lastSeen.map((last) => (last === -1 ? n : n - 1 - last));
  const avgGap = gapHistory.map((g) => (g.length ? g.reduce((a, b) => a + b, 0) / g.length : 10));
  const raw = currentGap.map((g, i) => (avgGap[i] > 0 ? g / avgGap[i] : 1));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((v) => (v / sum) * 100);
}

// 10x10 transition matrix P(next digit = j | current digit = i), returning
// the row for whatever digit currently sits at the end of the buffer.
export function markovVector(digits) {
  const counts = Array.from({ length: DIGITS }, () => new Array(DIGITS).fill(0));
  for (let i = 0; i < digits.length - 1; i++) counts[digits[i]][digits[i + 1]]++;
  const lastDigit = digits[digits.length - 1];
  const row = counts[lastDigit] || new Array(DIGITS).fill(0);
  const total = row.reduce((a, b) => a + b, 0);
  if (total === 0) return new Array(DIGITS).fill(10); // no transition data yet — uniform fallback
  return row.map((c) => (c / total) * 100);
}

export function shannonEntropy(freqVectorPct) {
  const probs = freqVectorPct.map((p) => p / 100);
  return -probs.reduce((sum, p) => (p > 0 ? sum + p * Math.log2(p) : sum), 0);
}

export const MAX_ENTROPY = Math.log2(DIGITS); // ~3.3219 bits, perfectly uniform

// Standard normal CDF via the Abramowitz-Stegun approximation.
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

// Chi-square goodness-of-fit against the uniform distribution (9 d.o.f.).
// p-value via the Wilson-Hilferty approximation — good enough for a UI
// honesty check, not a substitute for a real stats package.
export function chiSquareTest(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  const k = DIGITS - 1;
  const expected = n / DIGITS;
  if (expected === 0) return { stat: 0, pValue: 1 };
  const stat = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  const z = (Math.pow(stat / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  const pValue = Math.max(0, Math.min(1, 1 - normalCdf(z)));
  return { stat, pValue };
}

const WEIGHTS = { freq: 0.4, gap: 0.25, markov: 0.35 }; // logged below with every result

export function combineSignals(freqVec, gapVec, markovVec, weights = WEIGHTS) {
  const combined = freqVec.map(
    (_, i) => freqVec[i] * weights.freq + gapVec[i] * weights.gap + markovVec[i] * weights.markov
  );
  const sum = combined.reduce((a, b) => a + b, 0) || 1;
  return combined.map((v) => (v / sum) * 100);
}

// One full analysis cycle over the current digit buffer. Everything here
// traces back to real data — nothing hardcoded or randomly generated.
export function runAnalysisCycle(symbol, digits) {
  const counts = new Array(DIGITS).fill(0);
  digits.forEach((d) => counts[d]++);

  const freqVec = frequencyVector(digits);
  const gapVec = gapVector(digits);
  const markovVec = markovVector(digits);
  const scores = combineSignals(freqVec, gapVec, markovVec, WEIGHTS);

  let topDigit = 0;
  for (let d = 1; d < DIGITS; d++) if (scores[d] > scores[topDigit]) topDigit = d;

  const entropy = shannonEntropy(freqVec);
  const { stat, pValue } = chiSquareTest(counts);

  return {
    timestamp: Date.now(),
    symbol,
    scores,
    topDigit, // "top-ranked digit this cycle" — not a prediction, not a guarantee
    entropy,
    maxEntropy: MAX_ENTROPY,
    chiSquareStat: stat,
    chiSquarePValue: pValue,
    componentBreakdown: { freqVec, gapVec, markovVec },
    weights: WEIGHTS,
    sampleSize: digits.length,
  };
}

// Running accuracy tracker, per symbol — logs every cycle's top-ranked
// digit against the digit that actually arrived next. On genuinely random
// data this should hover near 10% long-run; if it doesn't, that's worth
// noticing, and it's surfaced rather than hidden.
const accuracyLog = new Map(); // symbol -> { correct, total }

export function recordOutcome(symbol, topDigit, actualDigit) {
  let log = accuracyLog.get(symbol);
  if (!log) {
    log = { correct: 0, total: 0 };
    accuracyLog.set(symbol, log);
  }
  log.total += 1;
  if (topDigit === actualDigit) log.correct += 1;
}

export function getAccuracy(symbol) {
  const log = accuracyLog.get(symbol);
  if (!log || log.total === 0) return null;
  return { pct: Math.round((log.correct / log.total) * 100), n: log.total };
}

// Sanity check, not auto-run: generates a fully uniform-random synthetic
// digit sequence and confirms the engine reports what it should on data
// with no real pattern — entropy near max, chi-square p-value not tiny,
// and no digit's score wildly above ~10%. Call from the console
// (import and run manually) if you want to verify the math is honest.
export function selfTestUniformRandom(n = 5000) {
  const digits = Array.from({ length: n }, () => Math.floor(Math.random() * DIGITS));
  const result = runAnalysisCycle('SELF_TEST', digits);
  const maxScore = Math.max(...result.scores);
  const pass =
    result.entropy > MAX_ENTROPY * 0.97 &&
    result.chiSquarePValue > 0.01 &&
    maxScore < 15;
  return { pass, entropy: result.entropy, maxEntropy: MAX_ENTROPY, chiSquarePValue: result.chiSquarePValue, maxScore, scores: result.scores };
}

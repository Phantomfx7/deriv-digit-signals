import { subscribe, lastDigits } from '../store.js';

export function mount(container) {
  let windowSize = 50;

  container.innerHTML = `
    <div class="threshold-row" style="margin-bottom:14px;">
      <label class="lbl">Sample</label>
      <div class="seg" id="eo-window">
        <button data-n="25">25</button>
        <button data-n="50" class="active">50</button>
        <button data-n="100">100</button>
        <button data-n="250">250</button>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <h2>Even vs Odd split (last <span id="eo-count">50</span> ticks)</h2>
        <div class="hist" id="eo-hist" style="height:160px;"></div>
      </div>
      <div class="card">
        <h2>Signal</h2>
        <div class="signal-block">
          <div class="signal-row">
            <div>
              <div class="signal-name">Even</div>
              <div class="sub" id="eo-even-sub">—</div>
            </div>
            <div class="signal-val even" id="eo-even-pct">—</div>
          </div>
          <div class="signal-row">
            <div>
              <div class="signal-name">Odd</div>
              <div class="sub" id="eo-odd-sub">—</div>
            </div>
            <div class="signal-val odd" id="eo-odd-pct">—</div>
          </div>
        </div>
        <div class="signal-block">
          <div class="signal-row">
            <div>
              <div class="signal-name">Current streak</div>
              <div class="sub" id="eo-streak-sub">—</div>
            </div>
            <div class="signal-val" id="eo-streak-val">—</div>
          </div>
          <div class="signal-row">
            <div>
              <div class="signal-name">Longest streak (session)</div>
              <div class="sub">since page loaded</div>
            </div>
            <div class="signal-val" id="eo-longest-val">—</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const els = {
    hist: container.querySelector('#eo-hist'),
    count: container.querySelector('#eo-count'),
    evenPct: container.querySelector('#eo-even-pct'),
    evenSub: container.querySelector('#eo-even-sub'),
    oddPct: container.querySelector('#eo-odd-pct'),
    oddSub: container.querySelector('#eo-odd-sub'),
    streakVal: container.querySelector('#eo-streak-val'),
    streakSub: container.querySelector('#eo-streak-sub'),
    longestVal: container.querySelector('#eo-longest-val'),
    windowSeg: container.querySelector('#eo-window'),
  };

  let longestStreak = 0;

  function computeStreak(allDigits) {
    if (allDigits.length === 0) return { parity: null, length: 0 };
    const lastParity = allDigits[allDigits.length - 1] % 2;
    let len = 0;
    for (let i = allDigits.length - 1; i >= 0; i--) {
      if (allDigits[i] % 2 === lastParity) len++;
      else break;
    }
    return { parity: lastParity, length: len };
  }

  function render() {
    const digits = lastDigits(windowSize);
    const total = digits.length || 1;
    const evenCount = digits.filter((d) => d % 2 === 0).length;
    const oddCount = total - evenCount;

    els.count.textContent = windowSize;
    els.hist.innerHTML = '';
    [
      { label: 'Even', count: evenCount, cls: 'in-range' },
      { label: 'Odd', count: oddCount, cls: 'lo' },
    ].forEach(({ label, count, cls }) => {
      const pct = ((count / total) * 100).toFixed(1);
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="pct">${pct}%</div>
        <div class="bar ${cls}" style="height:${Math.max((count/total)*100, 2)}%"></div>
        <div class="digit-lbl">${label}</div>
      `;
      els.hist.appendChild(col);
    });

    els.evenPct.textContent = ((evenCount/total)*100).toFixed(1) + '%';
    els.evenSub.textContent = `${evenCount}/${total} ticks`;
    els.oddPct.textContent = ((oddCount/total)*100).toFixed(1) + '%';
    els.oddSub.textContent = `${oddCount}/${total} ticks`;

    // streak uses the full available buffer, not just the windowed sample
    const allDigits = lastDigits(500);
    const streak = computeStreak(allDigits);
    if (streak.length > longestStreak) longestStreak = streak.length;

    if (streak.parity !== null) {
      els.streakVal.textContent = streak.length;
      els.streakVal.className = 'signal-val ' + (streak.parity === 0 ? 'even' : 'odd');
      els.streakSub.textContent = `current run: ${streak.parity === 0 ? 'even' : 'odd'}`;
    }
    els.longestVal.textContent = longestStreak;
  }

  els.windowSeg.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    [...els.windowSeg.children].forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    windowSize = parseInt(e.target.dataset.n, 10);
    render();
  });

  const unsubscribe = subscribe(render);
  render();

  return () => unsubscribe();
}

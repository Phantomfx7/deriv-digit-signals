import { subscribe, lastDigits } from '../store.js';

export function mount(container) {
  let windowSize = 50;
  let threshold = 5; // "over" means digit > threshold, "under" means digit < threshold

  container.innerHTML = `
    <div class="threshold-row" style="margin-bottom:14px;">
      <label class="lbl">Sample</label>
      <div class="seg" id="dg-window">
        <button data-n="25">25</button>
        <button data-n="50" class="active">50</button>
        <button data-n="100">100</button>
        <button data-n="250">250</button>
      </div>
    </div>
    <div class="threshold-row">
      <label class="lbl">Threshold: digit</label>
      <input type="range" id="dg-threshold" min="0" max="9" step="1" value="5">
      <span class="signal-val" id="dg-threshold-val" style="font-size:16px;">5</span>
    </div>
    <div class="grid">
      <div class="card">
        <h2>Digit distribution (last <span id="dg-count">50</span> ticks)</h2>
        <div class="hist" id="dg-hist"></div>
      </div>
      <div class="card">
        <h2>Signal</h2>
        <div class="signal-block">
          <div class="signal-row">
            <div>
              <div class="signal-name" id="dg-over-label">Over 5</div>
              <div class="sub" id="dg-over-sub">—</div>
            </div>
            <div class="signal-val match" id="dg-over-pct">—</div>
          </div>
          <div class="signal-row">
            <div>
              <div class="signal-name" id="dg-under-label">Under 5</div>
              <div class="sub" id="dg-under-sub">—</div>
            </div>
            <div class="signal-val differ" id="dg-under-pct">—</div>
          </div>
          <div class="signal-row">
            <div>
              <div class="signal-name">Equal to threshold</div>
              <div class="sub" id="dg-eq-sub">—</div>
            </div>
            <div class="signal-val" id="dg-eq-pct">—</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const els = {
    hist: container.querySelector('#dg-hist'),
    count: container.querySelector('#dg-count'),
    windowSeg: container.querySelector('#dg-window'),
    thresholdInput: container.querySelector('#dg-threshold'),
    thresholdVal: container.querySelector('#dg-threshold-val'),
    overLabel: container.querySelector('#dg-over-label'),
    overPct: container.querySelector('#dg-over-pct'),
    overSub: container.querySelector('#dg-over-sub'),
    underLabel: container.querySelector('#dg-under-label'),
    underPct: container.querySelector('#dg-under-pct'),
    underSub: container.querySelector('#dg-under-sub'),
    eqPct: container.querySelector('#dg-eq-pct'),
    eqSub: container.querySelector('#dg-eq-sub'),
  };

  function render() {
    const digits = lastDigits(windowSize);
    const counts = new Array(10).fill(0);
    digits.forEach((d) => counts[d]++);
    const total = digits.length || 1;
    const maxCount = Math.max(...counts, 1);

    els.count.textContent = windowSize;
    els.hist.innerHTML = '';
    for (let d = 0; d < 10; d++) {
      const pct = ((counts[d] / total) * 100).toFixed(1);
      const heightPct = (counts[d] / maxCount) * 100;
      let cls = '';
      if (d > threshold) cls = 'hi';
      else if (d < threshold) cls = 'lo';
      else cls = 'in-range';
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="pct">${pct}%</div>
        <div class="bar ${cls}" style="height:${Math.max(heightPct, 2)}%"></div>
        <div class="digit-lbl">${d}</div>
      `;
      els.hist.appendChild(col);
    }

    const overCount = digits.filter((d) => d > threshold).length;
    const underCount = digits.filter((d) => d < threshold).length;
    const eqCount = digits.filter((d) => d === threshold).length;

    els.overLabel.textContent = `Over ${threshold}`;
    els.underLabel.textContent = `Under ${threshold}`;
    els.overPct.textContent = ((overCount/total)*100).toFixed(1) + '%';
    els.overSub.textContent = `${overCount}/${total} ticks`;
    els.underPct.textContent = ((underCount/total)*100).toFixed(1) + '%';
    els.underSub.textContent = `${underCount}/${total} ticks`;
    els.eqPct.textContent = ((eqCount/total)*100).toFixed(1) + '%';
    els.eqSub.textContent = `${eqCount}/${total} ticks`;
  }

  els.windowSeg.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    [...els.windowSeg.children].forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    windowSize = parseInt(e.target.dataset.n, 10);
    render();
  });

  els.thresholdInput.addEventListener('input', (e) => {
    threshold = parseInt(e.target.value, 10);
    els.thresholdVal.textContent = threshold;
    render();
  });

  const unsubscribe = subscribe(render);
  render();

  return () => unsubscribe();
}

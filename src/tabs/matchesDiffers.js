import { state, subscribe, lastDigits } from '../store.js';

export function mount(container) {
  let windowSize = 50;
  let target = -1; // -1 = auto

  container.innerHTML = `
    <div class="threshold-row" style="margin-bottom:14px;">
      <label class="lbl">Sample</label>
      <div class="seg" id="md-window">
        <button data-n="25">25</button>
        <button data-n="50" class="active">50</button>
        <button data-n="100">100</button>
        <button data-n="250">250</button>
      </div>
      <label class="lbl" style="margin-left:18px;">Target digit</label>
      <select id="md-target">
        <option value="-1">Auto (most/least frequent)</option>
        ${[0,1,2,3,4,5,6,7,8,9].map(d => `<option value="${d}">${d}</option>`).join('')}
      </select>
    </div>
    <div class="grid">
      <div class="card">
        <h2>Digit frequency (last <span id="md-count">50</span> ticks)</h2>
        <div class="hist" id="md-hist"></div>
      </div>
      <div class="card">
        <h2>Signal</h2>
        <div class="signal-block">
          <div class="signal-row">
            <div>
              <div class="signal-name">Most frequent (Match)</div>
              <div class="sub" id="md-match-sub">—</div>
            </div>
            <div class="signal-val match" id="md-match-digit">—</div>
          </div>
          <div class="signal-row">
            <div>
              <div class="signal-name">Least frequent (Differ)</div>
              <div class="sub" id="md-differ-sub">—</div>
            </div>
            <div class="signal-val differ" id="md-differ-digit">—</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const els = {
    hist: container.querySelector('#md-hist'),
    count: container.querySelector('#md-count'),
    matchDigit: container.querySelector('#md-match-digit'),
    matchSub: container.querySelector('#md-match-sub'),
    differDigit: container.querySelector('#md-differ-digit'),
    differSub: container.querySelector('#md-differ-sub'),
    windowSeg: container.querySelector('#md-window'),
    targetSelect: container.querySelector('#md-target'),
  };

  function render() {
    const digits = lastDigits(windowSize);
    const counts = new Array(10).fill(0);
    digits.forEach((d) => counts[d]++);
    const total = digits.length || 1;
    const maxCount = Math.max(...counts, 1);

    let maxDigit = 0, minDigit = 0;
    for (let d = 1; d < 10; d++) {
      if (counts[d] > counts[maxDigit]) maxDigit = d;
      if (counts[d] < counts[minDigit]) minDigit = d;
    }

    els.count.textContent = windowSize;
    els.hist.innerHTML = '';
    for (let d = 0; d < 10; d++) {
      const pct = ((counts[d] / total) * 100).toFixed(1);
      const heightPct = (counts[d] / maxCount) * 100;
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="pct">${pct}%</div>
        <div class="bar ${d === maxDigit ? 'hi' : ''} ${d === minDigit ? 'lo' : ''}" style="height:${Math.max(heightPct, 2)}%"></div>
        <div class="digit-lbl">${d}</div>
      `;
      els.hist.appendChild(col);
    }

    const matchD = target >= 0 ? target : maxDigit;
    const differD = target >= 0 ? target : minDigit;
    els.matchDigit.textContent = matchD;
    els.matchSub.textContent = `${counts[matchD]}/${total} ticks (${((counts[matchD]/total)*100).toFixed(1)}%)`;
    els.differDigit.textContent = differD;
    els.differSub.textContent = `${counts[differD]}/${total} ticks (${((counts[differD]/total)*100).toFixed(1)}%)`;
  }

  els.windowSeg.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    [...els.windowSeg.children].forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    windowSize = parseInt(e.target.dataset.n, 10);
    render();
  });

  els.targetSelect.addEventListener('change', (e) => {
    target = parseInt(e.target.value, 10);
    render();
  });

  const unsubscribe = subscribe(render);
  render();

  return () => unsubscribe();
}

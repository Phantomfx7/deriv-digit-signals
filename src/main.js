import './style.css';
import { state, subscribe, init, changeSymbol } from './store.js';
import { fetchActiveSymbols } from './deriv.js';
import * as matchesDiffers from './tabs/matchesDiffers.js';
import * as evenOdd from './tabs/evenOdd.js';
import * as digits from './tabs/digits.js';

const tabs = {
  'matches-differs': matchesDiffers,
  'even-odd': evenOdd,
  'digits': digits,
};

const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  symbolSelect: document.getElementById('symbolSelect'),
  lastPrice: document.getElementById('lastPrice'),
  tickCount: document.getElementById('tickCount'),
  tape: document.getElementById('tape'),
  tapeSymbol: document.getElementById('tapeSymbol'),
  tabsNav: document.getElementById('tabs'),
  tabContent: document.getElementById('tabContent'),
};

let activeTab = 'matches-differs';
let unmountCurrentTab = null;
let lastRenderedTickCount = 0;

function renderHeader() {
  els.lastPrice.textContent = state.lastPrice ?? '—';
  els.tickCount.textContent = state.tickCount;
  els.tapeSymbol.textContent = state.symbol;

  els.statusText.textContent = state.status;
  els.statusDot.className = 'dot' + (
    state.status === 'live' ? ' live' :
    state.status.startsWith('error') || state.status === 'disconnected' ? ' err' : ''
  );

  // append a tape chip whenever a new tick has landed
  if (state.tickCount !== lastRenderedTickCount && state.digits.length > 0) {
    lastRenderedTickCount = state.tickCount;
    const digit = state.digits[state.digits.length - 1];
    const chip = document.createElement('div');
    chip.className = 'chip newest ' + (digit % 2 === 0 ? 'even' : 'odd');
    chip.textContent = digit;
    els.tape.appendChild(chip);

    const chips = els.tape.querySelectorAll('.chip');
    chips.forEach((c, i) => { if (i < chips.length - 1) c.classList.remove('newest'); });

    while (els.tape.children.length > 26) {
      els.tape.removeChild(els.tape.firstChild);
    }
  }
}

function switchTab(tabId) {
  if (unmountCurrentTab) unmountCurrentTab();
  activeTab = tabId;
  [...els.tabsNav.children].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  els.tabContent.innerHTML = '';
  unmountCurrentTab = tabs[tabId].mount(els.tabContent);
}

els.tabsNav.addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const tabId = e.target.dataset.tab;
  if (tabId && tabId !== activeTab) switchTab(tabId);
});

els.symbolSelect.addEventListener('change', (e) => {
  changeSymbol(e.target.value);
  els.tape.innerHTML = '';
  lastRenderedTickCount = 0;
});

async function populateMarkets() {
  try {
    const symbols = await fetchActiveSymbols();
    if (symbols.length === 0) return; // keep the static fallback in index.html

    const sorted = [...symbols].sort((a, b) => a.display_name.localeCompare(b.display_name));
    els.symbolSelect.innerHTML = sorted
      .map((s) => `<option value="${s.symbol}">${s.display_name}</option>`)
      .join('');

    const stillValid = sorted.some((s) => s.symbol === state.symbol);
    if (stillValid) {
      els.symbolSelect.value = state.symbol;
    } else {
      // our default (or last-picked) symbol isn't live anymore — fall back
      // to the first available market instead of erroring
      const fallback = sorted[0].symbol;
      els.symbolSelect.value = fallback;
      changeSymbol(fallback);
    }
  } catch (e) {
    console.warn('[app] could not fetch live symbol list, keeping static options', e);
  }
}

subscribe(renderHeader);
switchTab(activeTab);
init();
populateMarkets();

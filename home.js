/* Landing stack: one card on the desk, dissolved in place.
   Install tabs and the copy button stay here so the wire-up card works
   without a second script. There is no ambient canvas. */

'use strict';

document.documentElement.classList.add('js');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function startCopy() {
  for (const btn of document.querySelectorAll('.term .copy')) {
    btn.addEventListener('click', async () => {
      const pane = btn.closest('.term')?.querySelector('.termpane:not([hidden])');
      const text = pane?.dataset.copy || btn.dataset.copy;
      if (!text) return;
      const label = btn.dataset.label || 'Copy';
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = label; }, 1600);
      } catch (e) {
        btn.textContent = 'Select it';
        setTimeout(() => { btn.textContent = label; }, 1600);
      }
    });
  }
}

function startTermTabs() {
  for (const bar of document.querySelectorAll('.term [role="tablist"]')) {
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    if (!tabs.length) continue;
    const select = (tab) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      }
    };
    tabs.forEach((t, i) => {
      t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });
  }
}

function startStack() {
  const cards = [...document.querySelectorAll('[data-stack-card]')];
  if (!cards.length) return;
  const byId = new Map(cards.map((c) => [c.dataset.stackCard, c]));
  const order = cards.map((c) => c.dataset.stackCard);
  const trail = [];
  let current = order[0];
  const back = document.querySelector('[data-back]');
  const label = document.querySelector('[data-card-label]');
  const count = document.querySelector('[data-card-count]');
  const live = document.querySelector('#stack-live');
  const menu = [...document.querySelectorAll('[data-go]')];

  const titles = {
    welcome: 'Welcome',
    proof: 'Why it answered',
    ask: 'The questions',
    change: 'When it changes',
    how: 'How it works',
    data: 'Your data',
    agents: 'Wire it up',
    close: 'Tell one agent',
  };

  function paintChrome() {
    const n = order.indexOf(current);
    if (label) label.textContent = titles[current] || current;
    if (count) count.textContent = `${n + 1} of ${order.length}`;
    if (back) back.disabled = trail.length === 0;
    for (const el of menu) {
      const on = el.dataset.go === current;
      if (on) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    }
    if (live) live.textContent = titles[current] || current;
  }

  function show(id, { record = true } = {}) {
    const next = byId.get(id);
    if (!next || id === current) return;
    const prev = byId.get(current);
    if (record) trail.push(current);
    if (prev) {
      prev.classList.remove('is-on');
      if (!reduced) {
        prev.classList.add('is-leaving');
        const done = () => prev.classList.remove('is-leaving');
        prev.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 520);
      }
      prev.inert = true;
    }
    next.inert = false;
    next.classList.add('is-on');
    current = id;
    paintChrome();
    history.replaceState(null, '', '#' + id);
    const head = next.querySelector('h1, h2');
    if (head) {
      head.tabIndex = -1;
      head.focus({ preventScroll: true });
    }
  }

  for (const el of menu) {
    el.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      show(el.dataset.go);
    });
  }
  if (back) {
    back.addEventListener('click', () => {
      const prev = trail.pop();
      if (prev) show(prev, { record: false });
    });
  }

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Backspace' && trail.length) {
      e.preventDefault();
      const prev = trail.pop();
      if (prev) show(prev, { record: false });
    }
  });

  const hash = location.hash.replace('#', '');
  cards.forEach((c) => {
    const on = c.dataset.stackCard === (byId.has(hash) ? hash : order[0]);
    c.classList.toggle('is-on', on);
    c.inert = !on;
  });
  current = byId.has(hash) ? hash : order[0];
  paintChrome();
}

document.querySelectorAll('[data-trail]').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (document.referrer && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });
});

startCopy();
startTermTabs();
startStack();

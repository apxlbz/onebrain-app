import "./compat.js?v=5";

/* OneBrain dashboard.
 *
 * No framework, no build step, no CDN. Six views over the /v1 API, each a pure
 * `render(el, params)` registered in VIEWS and selected by the URL hash, so a
 * tab is always linkable and reload-safe. Filters live in the hash too — a
 * filtered list you cannot send to a colleague is a dead end.
 *
 * The one view that is not a list is Search: it renders the retrieval
 * *explanation* — which arm found each result, at what rank, and what every
 * bounded multiplier did to the score. Four fused arms produce an order nobody
 * can reconstruct by eye, and no off-the-shelf observability tool can show it,
 * because only this server knows what the arms are.
 */

'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NUM = new Intl.NumberFormat();
const n = (v) => NUM.format(v || 0);

/** Relative time reads faster than a timestamp when the only question is "is
 *  this fresh?" — which is what these columns are for. Absolute date goes in
 *  `title` so the exact value is one hover away. */
function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}
const exact = (iso) => (iso
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })
      .format(new Date(iso))
  : '');
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);

/** Announce to screen readers without moving focus. Async view swaps are
 *  otherwise silent. */
const announce = (msg) => { $('live').textContent = msg; };

// ---------------------------------------------------------------------- api

async function api(path, opts = {}) {
  // Compat layer: PostgREST + Edge Functions behind the old contract.
  return await window.OB.api(path, opts);
}
const post = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== '' && v != null && v !== false)
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

function fail(target, err) {
  // An error message that names no next step is just noise.
  target.innerHTML = `<div class="empty"><b>Could not load this view</b>
    ${esc(err.message || err)}. Reload the page, or check the Operations tab if
    this keeps happening.</div>`;
}

// ------------------------------------------------------------------ pieces

/** Bar chart of {label, value}. Widths are relative to the largest row —
 *  absolute scaling makes every small source invisible. */
function barlist(rows, { clickable } = {}) {
  if (!rows.length) return '<p class="dim">Nothing yet.</p>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="barlist">${rows.map((r) => `
    <div class="barrow"${clickable
      ? ` data-bar="${esc(r.key ?? r.label)}" role="button" tabindex="0"`
        + ` aria-label="View ${esc(r.label)} — ${r.value}"` : ''}>
      <span class="bl" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bar" style="width:${Math.max(2, (r.value / max) * 100)}%"></span>
      <span class="bn">${n(r.value)}</span>
    </div>`).join('')}</div>`;
}

/** A daily column chart. Days with no data still occupy a column, or the gaps
 *  read as low activity instead of no activity. */
function spark(daily, days = 30, label = 'items') {
  const by = Object.fromEntries((daily || []).map((d) => [d.day, d.n]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day: d, n: by[d] || 0 });
  }
  const max = Math.max(...out.map((o) => o.n), 1);
  const total = out.reduce((a, o) => a + o.n, 0);
  return `<div class="spark" role="img"
      aria-label="${n(total)} ${esc(label)} over the last ${days} days">
    ${out.map((o) => `<i class="${o.n ? '' : 'zero'}"
      style="height:${o.n ? Math.max(4, (o.n / max) * 100) : 2}%"
      title="${o.day}: ${o.n}"></i>`).join('')}</div>`;
}

const tile = (value, label, sub) =>
  `<div class="tile"><div class="tn">${value}</div><div class="tl">${esc(label)}</div>` +
  (sub ? `<div class="ts">${esc(sub)}</div>` : '') + '</div>';

/** Rows and bars act like buttons, so they must answer to the keyboard too. */
function activate(el, fn) {
  el.addEventListener('click', fn);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
  });
}

// ---------------------------------------------------------------- overview

async function viewOverview(root) {
  root.innerHTML = '<div class="spin">Loading…</div>';
  const [s, h, ob] = await Promise.all([
    api('/v1/stats'), api('/v1/health'),
    // Never let the setup prompt take the whole Overview down with it.
    api('/v1/onboarding').catch(() => null),
  ]);

  /* An org whose setup is unfinished has an Overview full of zeroes and no way to
   * know why. Say it once, at the top, with the way out. */
  const setupPrompt = (ob && !ob.completed_at) ? `
    <section class="card setupcard" style="margin-bottom:14px" aria-labelledby="h-setup">
      <h2 class="sec" id="h-setup">Finish setting up ${esc(ob.org || 'your organization')}</h2>
      <p style="margin:0 0 12px">Connect your sources and verify every key and
        connection with a live call. Until then this page mostly shows zeroes.</p>
      <a class="btnlink primary" href="./onboard.html">Open setup</a>
    </section>` : '';

  const issues = h.issues.length ? h.issues.map((i) => `
    <div class="issue">
      <span class="sev ${esc(i.level)}" aria-hidden="true"></span>
      <div class="itxt">
        <div class="it">${esc(i.title)}</div>
        <div class="id2">${esc(i.detail)}</div>
      </div>
      ${i.action ? `<button class="ia" data-act="${esc(i.action)}"
        data-count="${i.count}" data-key="${esc(i.key)}">Fix</button>` : ''}
    </div>`).join('')
    : `<div class="allclear"><span class="sev" aria-hidden="true"></span>
       No issues. Every input became knowledge, and the graph and summaries are
       current.</div>`;

  root.innerHTML = `
    <h1>Overview</h1>
    <p class="lede">${n(s.facts_current)} current facts from ${n(s.raw)} inputs${
      s.last_ingest ? ` · last ingest ${ago(s.last_ingest)}` : ''}</p>

    ${setupPrompt}

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-health">
      <h2 class="sec" id="h-health">Health</h2>
      <div id="issues">${issues}</div>
    </section>

    <div class="tiles" style="margin-bottom:14px">
      ${tile(n(s.facts_current), 'current facts',
             s.facts > s.facts_current ? `${n(s.facts - s.facts_current)} superseded`
                                       : 'nothing retired')}
      ${tile(n(s.raw), 'inputs', s.unenriched ? `${s.unenriched} unprocessed`
                                              : 'all processed')}
      ${tile(n(s.entities), 'entities', `${n(s.edges)} relationships`)}
      ${tile(n(s.summaries), 'summaries', `${n(s.links)} fact links`)}
    </div>

    <div class="split">
      <section class="card" aria-labelledby="h-daily">
        <h2 class="sec" id="h-daily">Facts added — last 30 days</h2>
        ${spark(s.daily, 30, 'facts')}
      </section>
      <section class="card" aria-labelledby="h-src">
        <h2 class="sec" id="h-src">Where memory comes from</h2>
        <div id="srcbars"></div>
      </section>
    </div>

    <section class="card" style="margin-top:12px" aria-labelledby="h-type">
      <h2 class="sec" id="h-type">What kind of thing is stored</h2>
      <div id="typebars"></div>
    </section>`;

  $('srcbars').innerHTML = barlist(
    s.by_source.map((r) => ({ key: r.source, label: r.source, value: r.n })),
    { clickable: true });
  $('typebars').innerHTML = barlist(
    s.by_type.map((r) => ({ key: r.type, label: r.type, value: r.n })),
    { clickable: true });

  // Every breakdown row is a filter into Memories — a count you cannot click
  // is a dead end.
  const drill = (container, key) => container.querySelectorAll('[data-bar]')
    .forEach((r) => activate(r, () => go(`memories?${key}=${encodeURIComponent(r.dataset.bar)}`)));
  drill($('srcbars'), 'source');
  drill($('typebars'), 'type');

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      // Maintenance retires duplicates and prunes rows. Reversible only from a
      // backup, so it asks first.
      if (b.dataset.act === 'maintain'
          && !confirm('Run maintenance? This retires near-duplicate facts and '
                      + 'prunes orphaned graph nodes.')) return;
      b.disabled = true; b.textContent = 'Running…';
      try {
        await post(b.dataset.act === 'reconcile' ? '/v1/reconcile' : '/v1/maintain', {});
        announce('Maintenance finished. Reloading health.');
        viewOverview(root);
      } catch (e) { b.textContent = 'Failed'; b.disabled = false; }
    });
  });
  announce(`Overview loaded. ${h.issues.length} issues.`);
}

// ---------------------------------------------------------------- memories

const MEM = { q: '', source: '', type: '', order: 'recent', history: false,
              offset: 0, limit: 50 };

async function viewMemories(root, params) {
  // Hash is the source of truth, so a filtered list is a shareable URL.
  MEM.source = params.get('source') || '';
  MEM.type = params.get('type') || '';
  MEM.q = params.get('q') || '';
  MEM.order = params.get('order') || 'recent';
  MEM.history = params.get('history') === '1';
  MEM.offset = Number(params.get('offset')) || 0;

  const reg = await api('/v1/memory-types').catch(() => ({ sources: [], types: [] }));
  const opts = (list, sel, all) =>
    `<option value="">${all}</option>` + (list || []).map((x) => {
      const v = x.source || x.type || x;
      return `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}${
        x.count ? ` (${x.count})` : ''}</option>`;
    }).join('');

  root.innerHTML = `
    <h1>Memories</h1>
    <p class="lede">Everything stored, newest first. This is the log — no ranking,
      no embeddings. Open a row to see where it came from.</p>

    <div class="row" style="margin-bottom:14px">
      <input id="mq" type="search" aria-label="Filter by text"
        placeholder="Contains text…" style="flex:1;min-width:180px"
        autocomplete="off" spellcheck="false" value="${esc(MEM.q)}" />
      <select id="msrc" aria-label="Filter by source">${opts(reg.sources, MEM.source, 'All sources')}</select>
      <select id="mtype" aria-label="Filter by type">${opts(reg.types, MEM.type, 'All types')}</select>
      <select id="morder" aria-label="Sort order">
        ${['recent:Newest', 'oldest:Oldest', 'used:Most used', 'important:Most important']
          .map((o) => { const [v, l] = o.split(':');
            return `<option value="${v}"${MEM.order === v ? ' selected' : ''}>${l}</option>`;
          }).join('')}
      </select>
      <button class="chip" id="mhist" aria-pressed="${MEM.history}"
        title="Include facts a newer one has replaced">Show superseded</button>
    </div>
    <div id="mlist" aria-live="polite" aria-busy="false"></div>`;

  const sync = () => {
    const q = qs({ q: MEM.q, source: MEM.source, type: MEM.type,
                   order: MEM.order === 'recent' ? '' : MEM.order,
                   history: MEM.history ? 1 : '', offset: MEM.offset || '' });
    // replaceState, not a hash write: filtering should not stack 30 history
    // entries between the user and the back button.
    history.replaceState(null, '', `#memories${q ? `?${q}` : ''}`);
  };

  const load = async () => {
    const list = $('mlist');
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<div class="spin">Loading…</div>';
    let data;
    try {
      data = await api(`/v1/memories?${qs({ ...MEM, history: MEM.history ? 1 : '' })}`);
    } catch (e) { list.setAttribute('aria-busy', 'false'); return fail(list, e); }
    list.setAttribute('aria-busy', 'false');

    if (!data.items.length) {
      list.innerHTML = `<div class="empty"><b>No memories match</b>${
        MEM.q || MEM.source || MEM.type
          ? 'Try clearing the filters above.'
          : 'Connect a source or call remember() to start building memory.'}</div>`;
      announce('No memories match.');
      return;
    }

    const to = Math.min(data.offset + data.items.length, data.total);
    list.innerHTML = `
      <table class="t"><thead><tr>
        <th style="width:50%">Fact</th><th style="width:13%">Source</th>
        <th style="width:11%">Type</th><th style="width:15%">About</th>
        <th style="width:11%">When</th>
      </tr></thead><tbody>
      ${data.items.map((f) => `
        <tr data-id="${esc(f.id)}" tabindex="0" role="button"
            aria-label="Open details for this fact">
          <td><span class="clamp2">${esc(f.content)}</span>${f.is_current ? ''
            : ' <span class="pill" title="A newer fact replaced this">superseded</span>'}</td>
          <td class="tight">${esc(f.source)}</td>
          <td class="tight">${esc(f.type)}</td>
          <td class="tight">${esc([f.entity, f.product, f.topic, f.system]
            .filter(Boolean)[0] || '—')}</td>
          <td class="tight" title="${esc(exact(f.happened_at || f.created_at))}">${
            ago(f.happened_at || f.created_at)}</td>
        </tr>`).join('')}
      </tbody></table>
      <div class="row" style="margin-top:14px">
        <span class="dim num">${data.offset + 1}–${to} of ${n(data.total)}</span>
        <span class="grow"></span>
        <button id="mprev" ${data.offset ? '' : 'disabled'}>Previous</button>
        <button id="mnext" ${to < data.total ? '' : 'disabled'}>Next</button>
      </div>`;

    list.querySelectorAll('tr[data-id]').forEach((tr) =>
      activate(tr, () => openFact(tr.dataset.id, tr)));
    const page = (delta) => {
      MEM.offset = Math.max(0, MEM.offset + delta);
      sync(); load();
      $('view').scrollIntoView({ block: 'start' });
    };
    $('mprev').onclick = () => page(-MEM.limit);
    $('mnext').onclick = () => page(MEM.limit);
    announce(`${n(data.total)} memories, showing ${data.offset + 1} to ${to}.`);
  };

  const refilter = () => { MEM.offset = 0; sync(); load(); };
  let t;
  $('mq').addEventListener('input', (e) => {
    // Instant-feeling, but not one request per keystroke.
    clearTimeout(t);
    MEM.q = e.target.value.trim();
    t = setTimeout(refilter, 250);
  });
  $('msrc').onchange = (e) => { MEM.source = e.target.value; refilter(); };
  $('mtype').onchange = (e) => { MEM.type = e.target.value; refilter(); };
  $('morder').onchange = (e) => { MEM.order = e.target.value; refilter(); };
  $('mhist').onclick = (e) => {
    MEM.history = !MEM.history;
    e.currentTarget.setAttribute('aria-pressed', String(MEM.history));
    refilter();
  };
  load();
}

// ------------------------------------------------------- fact detail drawer

/** Modal plumbing shared by the drawer and the palette: remember what had
 *  focus, keep Tab inside while open, and give focus back on close. Without
 *  the restore, dismissing a dialog drops a keyboard user at the top of the
 *  document. */
function openModal(el, firstFocus) {
  modalReturn.set(el, document.activeElement);
  el.hidden = false;
  (firstFocus || el.querySelector('button, input, [tabindex]'))?.focus();
}
function closeModal(el) {
  if (el.hidden) return;
  el.hidden = true;
  const back = modalReturn.get(el);
  modalReturn.delete(el);
  if (back && document.contains(back)) back.focus();
}
const modalReturn = new WeakMap();

function trapTab(el, e) {
  if (e.key !== 'Tab') return;
  const items = [...el.querySelectorAll(
    'a[href], button:not(:disabled), input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

async function openFact(id, opener) {
  const body = $('dbody');
  body.innerHTML = '<div class="spin">Loading…</div>';
  openModal($('drawer'), $('dclose'));
  if (opener) modalReturn.set($('drawer'), opener);

  let f;
  try { f = await api(`/v1/memories/${encodeURIComponent(id)}`); }
  catch (e) { return fail(body, e); }

  const facets = [['entity', f.entity], ['product', f.product],
                  ['topic', f.topic], ['system', f.system]].filter((r) => r[1]);

  // The supersession chain, oldest first. This is the view none of the
  // competing products can render: because a superseded fact is retired rather
  // than overwritten, "what was true before, and what changed it" is real data.
  const past = (f.history.replaced || []).slice().reverse();
  const chain = (past.length || f.history.replaced_by) ? `
    <section class="dsec" aria-labelledby="h-hist">
      <h2 class="sec" id="h-hist">History</h2>
      <div class="timeline">
        ${past.map((p) => `<div class="tnode past">
            <div class="tc">${esc(p.content)}</div>
            <div class="tw" title="${esc(exact(p.created_at))}">recorded ${
              ago(p.created_at)} · replaced by this fact</div>
          </div>`).join('')}
        <div class="tnode ${f.is_current ? 'now' : 'past'}">
          <div class="tc"><b>${esc(f.content)}</b></div>
          <div class="tw" title="${esc(exact(f.created_at))}">recorded ${
            ago(f.created_at)}${f.is_current ? ' · current' : ''}</div>
        </div>
        ${f.history.replaced_by ? `<div class="tnode now">
            <div class="tc">${esc(f.history.replaced_by.content)}</div>
            <div class="tw" title="${esc(exact(f.history.replaced_by.created_at))}">recorded ${
              ago(f.history.replaced_by.created_at)} · replaced this fact</div>
          </div>` : ''}
      </div>
    </section>` : '';

  const linkList = (rows, heading, id2) => rows.length ? `
    <section class="dsec" aria-labelledby="${id2}">
      <h2 class="sec" id="${id2}">${heading}</h2>
      ${rows.map((r) => `<div class="hit" data-goto="${esc(r.id)}" tabindex="0"
        role="button"><div class="hc">${esc(r.content)}</div></div>`).join('')}
    </section>` : '';

  body.innerHTML = `
    <div class="pill" style="margin-bottom:9px">${esc(f.type)}</div>
    <h2 id="dtitle" style="font-size:15px;font-weight:500;line-height:1.55;margin:0"
      >${esc(f.content)}</h2>
    ${f.is_current ? ''
      : '<p class="dim" style="margin:10px 0 0">Superseded — recall no longer returns this.</p>'}

    <section class="dsec" aria-labelledby="h-det">
      <h2 class="sec" id="h-det">Details</h2>
      <div class="kv">
        <span class="k">Source</span><span class="v">${esc(f.source || '—')}</span>
        <span class="k">Recorded</span><span class="v" title="${esc(exact(f.created_at))}">${ago(f.created_at)}</span>
        ${f.happened_at ? `<span class="k">Happened</span><span class="v" title="${
          esc(exact(f.happened_at))}">${ago(f.happened_at)}</span>` : ''}
        ${facets.map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join('')}
        ${f.tags.length ? `<span class="k">Tags</span><span class="v">${f.tags.map(esc).join(', ')}</span>` : ''}
        <span class="k">Importance</span><span class="v num">${(f.importance ?? 0).toFixed(2)}</span>
        <span class="k">Times served</span><span class="v num">${n(f.use_count)}</span>
        <span class="k">Usefulness</span><span class="v num">${(f.feedback_weight ?? 0.5).toFixed(2)}</span>
        <span class="k">Fact id</span><span class="v mono" translate="no">${esc(f.id)}</span>
      </div>
    </section>
    ${chain}
    ${f.relations.length ? `<section class="dsec" aria-labelledby="h-rel">
      <h2 class="sec" id="h-rel">Relationships asserted</h2>
      ${f.relations.map((r) => `<div>${esc(r.src)}
        <span class="dim">${esc(r.rel)}</span> ${esc(r.dst)}</div>`).join('')}
    </section>` : ''}
    ${linkList(f.related, 'Related facts', 'h-related')}
    ${linkList(f.siblings, 'Also extracted from this input', 'h-sib')}
    ${f.raw_content ? `<section class="dsec" aria-labelledby="h-raw">
      <h2 class="sec" id="h-raw">Original input</h2>
      <div class="raw" tabindex="0">${esc(f.raw_content)}${
        f.raw_truncated ? '\n\n… truncated' : ''}</div>
    </section>` : ''}`;

  body.querySelectorAll('[data-goto]').forEach((d) =>
    activate(d, () => openFact(d.dataset.goto)));
}

// ------------------------------------------------------------------ search

const SEARCH = { q: '', limit: 8, source: '', type: '', deep: false, history: false };

async function viewSearch(root, params) {
  SEARCH.q = params.get('q') || SEARCH.q;
  SEARCH.limit = Number(params.get('k')) || SEARCH.limit;

  root.innerHTML = `
    <h1>Search</h1>
    <p class="lede">Exactly what an agent gets when it calls
      <span class="mono" translate="no">recall</span> — and why. Each result shows
      which retrieval arm found it and what moved its rank.</p>

    <div class="searchbar">
      <input id="sq" type="search" aria-label="Ask memory a question"
        placeholder="Ask memory something…" autocomplete="off"
        spellcheck="false" value="${esc(SEARCH.q)}" />
      <button class="primary" id="sgo">Search</button>
    </div>

    <div class="knobs">
      <label class="field" for="sk">Results
        <input id="sk" type="number" inputmode="numeric" min="1" max="50"
          value="${SEARCH.limit}" style="width:64px" /></label>
      <label class="field" for="ssrc">Source
        <input id="ssrc" placeholder="any" autocomplete="off" spellcheck="false"
          value="${esc(SEARCH.source)}" style="width:120px" /></label>
      <label class="field" for="stype">Type
        <input id="stype" placeholder="any" autocomplete="off" spellcheck="false"
          value="${esc(SEARCH.type)}" style="width:110px" /></label>
      <div class="toggles">
        <button class="chip" id="sdeep" aria-pressed="false"
          title="A second retrieval seeded by the first round's text">Deep</button>
        <button class="chip" id="shist" aria-pressed="false"
          title="Include facts a newer one has replaced">Include superseded</button>
      </div>
    </div>

    <div id="sout" aria-live="polite" aria-busy="false"></div>`;

  const run = async () => {
    const out = $('sout');
    if (!SEARCH.q) {
      out.innerHTML = `<div class="empty"><b>Ask a question</b>Results appear with a
        full score breakdown — which arm found each one, and what moved its rank.</div>`;
      return;
    }
    history.replaceState(null, '', `#search?${qs({ q: SEARCH.q,
      k: SEARCH.limit === 8 ? '' : SEARCH.limit })}`);
    out.setAttribute('aria-busy', 'true');
    out.innerHTML = '<div class="spin">Searching…</div>';
    const t0 = performance.now();
    let data;
    try {
      data = await post('/v1/recall', {
        query: SEARCH.q, limit: SEARCH.limit, explain: true,
        source: SEARCH.source || undefined, type: SEARCH.type || undefined,
        deep: SEARCH.deep, include_history: SEARCH.history,
      });
    } catch (e) { out.setAttribute('aria-busy', 'false'); return fail(out, e); }
    out.setAttribute('aria-busy', 'false');
    const took = Math.round(performance.now() - t0);

    if (!data.results.length) {
      out.innerHTML = `<div class="empty"><b>Memory has nothing for this</b>
        Either the topic was never captured, or the source it lives in isn't
        connected yet. Answered in ${took}&nbsp;ms.</div>`;
      announce('No results.');
      return;
    }
    out.innerHTML =
      `<p class="dim" style="margin:0 0 6px">${data.results.length} results in ${took}&nbsp;ms</p>`
      + data.results.map((r, i) => hitHTML(r, i)).join('');
    out.querySelectorAll('[data-id]').forEach((d) => {
      if (String(d.dataset.id).startsWith('summary:')) return;
      d.tabIndex = 0; d.setAttribute('role', 'button');
      activate(d, () => openFact(d.dataset.id, d));
    });
    announce(`${data.results.length} results in ${took} milliseconds.`);
  };

  $('sk').oninput = (e) => { SEARCH.limit = Math.max(1, Math.min(50, +e.target.value || 8)); };
  $('ssrc').oninput = (e) => { SEARCH.source = e.target.value.trim(); };
  $('stype').oninput = (e) => { SEARCH.type = e.target.value.trim(); };
  $('sq').oninput = (e) => { SEARCH.q = e.target.value.trim(); };
  $('sq').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  $('sgo').onclick = run;
  const toggle = (id, key) => { $(id).onclick = (e) => {
    SEARCH[key] = !SEARCH[key];
    e.currentTarget.setAttribute('aria-pressed', String(SEARCH[key]));
    run();
  }; };
  toggle('sdeep', 'deep');
  toggle('shist', 'history');
  run();
}

/** One result, with its score decomposition.
 *
 *  The arm chips are the point: "lexical #1" means an exact-token match put it
 *  first; "semantic #7 + graph #2" means it won on consensus rather than any
 *  single arm. A multiplier chip appears only when it actually changed the
 *  score, so the strip stays short on the common path. */
function hitHTML(r, i) {
  const x = r.explain || {};
  const chips = Object.entries(x.arms || {}).map(([arm, rank]) =>
    `<span class="arm ${esc(arm)}" title="Ranked #${rank} by the ${arm} arm">${
      esc(arm)}&nbsp;#${rank}</span>`);
  if (r.via_summary) chips.push('<span class="arm">summary</span>');
  if (r.via_deep) chips.push('<span class="arm">deep pass</span>');
  if (!chips.length && r.via_graph) chips.push('<span class="arm graph">graph</span>');

  const mult = (key, label) => {
    const v = x[key];
    if (v == null || Math.abs(v - 1) < 0.0005) return '';
    return `<span class="arm" title="${label}">${v > 1 ? '+' : ''}${
      ((v - 1) * 100).toFixed(1)}% ${key}</span>`;
  };
  const boosts = [
    mult('recency', 'Newer facts win otherwise-equal ties'),
    mult('importance', 'Write-time salience prior'),
    mult('frequency', 'This fact keeps getting served'),
    mult('feedback', 'Learned usefulness from ratings'),
  ].filter(Boolean).join('');

  const moved = x.reranked && x.fused_rank
    ? `<span class="arm moved" title="The cross-encoder reordered this">reranked ${
        x.fused_rank}→${x.final_rank}</span>`
    : '';
  let sum = (x.terms || []).map((t) =>
    `1/(${x.rrf_k}+${t.rank})${t.weight !== 1 ? `×${t.weight}` : ''}`).join(' + ');
  // fused_score includes the bounded multipliers, so the printed equation must
  // too — an explanation that doesn't compute is worse than none.
  const factors = ['recency', 'importance', 'frequency', 'feedback']
    .filter((k) => x[k] != null && Math.abs(x[k] - 1) >= 0.0005);
  if (sum && factors.length) {
    sum = `(${sum}) × ${factors.map((k) => x[k].toFixed(3)).join(' × ')}`;
  }

  return `
    <div class="hit" data-id="${esc(r.id)}">
      <div class="hrank num" aria-hidden="true">${i + 1}</div>
      <div class="hbody">
        <div class="hc">${esc(r.content)}</div>
        <div class="hm">
          <span class="pill">${esc(r.source || '—')}</span>
          ${r.scoped === false && (SEARCH.source || SEARCH.type)
            ? '<span class="pill" title="Your filter was too narrow, so general memory filled in">unscoped fallback</span>'
            : ''}
          ${chips.join('')}${moved}${boosts}
        </div>
        ${sum ? `<div class="faint mono hsum" title="Reciprocal rank fusion">score = ${
          esc(sum)} = ${(x.fused_score || 0).toFixed(4)}</div>` : ''}
      </div>
    </div>`;
}

// ------------------------------------------------------------------ people

async function viewPeople(root, params) {
  const initial = params.get('topic') || '';
  root.innerHTML = `
    <h1>People</h1>
    <p class="lede">Who has demonstrated knowledge of a topic, ranked by the facts
      that prove it — not by job title.</p>
    <div class="searchbar">
      <input id="pw" type="search" aria-label="Topic, system, or product"
        placeholder="A topic, system, or product…" autocomplete="off"
        value="${esc(initial)}" />
      <button class="primary" id="pgo">Find</button>
    </div>
    <div id="pout" aria-live="polite"><div class="empty"><b>Ask about a topic</b>Each
      person comes with the evidence that earned them the slot.</div></div>`;

  const run = async () => {
    const topic = $('pw').value.trim();
    if (!topic) return;
    history.replaceState(null, '', `#people?${qs({ topic })}`);
    const out = $('pout');
    out.innerHTML = '<div class="spin">Searching…</div>';
    let data;
    try { data = await post('/v1/who-knows', { topic, limit: 8 }); }
    catch (e) { return fail(out, e); }

    const people = data.people || data.experts || [];
    if (!people.length) {
      out.innerHTML = `<div class="empty"><b>Nobody has visibly worked on
        “${esc(topic)}”</b>No stored fact attributes this topic to a person yet.</div>`;
      return;
    }
    out.innerHTML = people.map((p) => `
      <section class="card" style="margin-bottom:10px">
        <div class="row">
          <b>${esc(p.name || p.person || p.entity)}</b>
          <span class="pill">${n(p.fact_count ?? (p.evidence || []).length)} facts</span>
        </div>
        ${(p.evidence || []).map((e) => `<div class="hit" data-id="${esc(e.id || '')}">
          <div class="hbody"><div class="hc">${esc(e.content || e)}</div></div>
        </div>`).join('')}
      </section>`).join('');
    out.querySelectorAll('[data-id]').forEach((d) => {
      if (!d.dataset.id) return;
      d.tabIndex = 0; d.setAttribute('role', 'button');
      activate(d, () => openFact(d.dataset.id, d));
    });
    announce(`${people.length} people found.`);
  };
  $('pgo').onclick = run;
  $('pw').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  if (initial) run();
}

// --------------------------------------------------------------------- ops

async function viewOps(root) {
  root.innerHTML = '<div class="spin">Loading…</div>';
  let o;
  try { o = await api('/v1/ops?days=14'); } catch (e) { return fail(root, e); }

  const qtable = (rows, cols) => rows.length
    ? `<table class="t"><tbody>${rows.map((r) => `<tr data-q="${esc(r.query)}"
        tabindex="0" role="button" aria-label="Search for ${esc(r.query)}">
        <td>${esc(r.query)}</td>${cols(r)}</tr>`).join('')}</tbody></table>`
    : '<p class="dim">Nothing yet.</p>';

  root.innerHTML = `
    <h1>Operations</h1>
    <p class="lede">Retrieval health over the last 14 days, from every recall this
      org has run.</p>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-svc">
      <h2 class="sec" id="h-svc">Service checks</h2>
      <p class="dim" style="margin:0 0 12px">The database and the API keys this
        deployment runs on — live calls, not config reads. Deliberately not in the
        setup wizard: nobody onboarding their workspace can fix these, and a red
        row they cannot act on just teaches them to ignore red rows.</p>
      <button id="svc-run" class="ghost">Run service checks</button>
      <div id="svc" style="margin-top:12px"></div>
    </section>

    <div class="tiles" style="margin-bottom:14px">
      ${tile(n(o.recalls), 'recalls', 'last 14 days')}
      ${tile(ms(o.p50_ms), 'median latency', `p95 ${ms(o.p95_ms)}`)}
      ${tile(o.avg_results, 'results per recall', 'average')}
      ${tile(`${(o.zero_rate * 100).toFixed(1)}%`, 'came back empty',
             `${n(o.zero_results)} recalls`)}
    </div>

    <section class="card" style="margin-bottom:12px" aria-labelledby="h-vol">
      <h2 class="sec" id="h-vol">Recalls per day</h2>
      ${spark(o.daily, o.days, 'recalls')}
    </section>

    <div class="split">
      <section class="card" aria-labelledby="h-empty">
        <h2 class="sec" id="h-empty">Questions memory could not answer</h2>
        <p class="dim" style="margin:-4px 0 10px">The highest-signal failure there
          is: somebody asked and got nothing. These are the sources to connect next.</p>
        ${qtable(o.empty, (r) => `<td class="tight num">${r.n}×</td>
          <td class="tight">${ago(r.last_at)}</td>`)}
      </section>
      <section class="card" aria-labelledby="h-top">
        <h2 class="sec" id="h-top">Most asked</h2>
        ${qtable(o.top, (r) => `<td class="tight num">${r.n}×</td>
          <td class="tight">${ago(r.last_at)}</td>`)}
      </section>
    </div>

    <section class="card" style="margin-top:12px" aria-labelledby="h-slow">
      <h2 class="sec" id="h-slow">Slowest recalls</h2>
      ${qtable(o.slowest, (r) => `<td class="tight num">${ms(r.latency_ms)}</td>
        <td class="tight num">${r.result_count} results</td>
        <td class="tight">${ago(r.created_at)}</td>`)}
    </section>

    <section class="card" style="margin-top:12px" aria-labelledby="h-maint">
      <h2 class="sec" id="h-maint">Maintenance</h2>
      <p class="dim" style="margin:-4px 0 10px">Hygiene jobs. Safe to run any time,
        and safe to run on a schedule.</p>
      <div class="row">
        <button data-run="/v1/maintain" data-confirm="Run maintenance? This retires near-duplicate facts and prunes orphaned graph nodes.">Run full maintenance</button>
        <button data-run="/v1/reconcile">Retry failed inputs</button>
        <button data-run="/v1/summaries">Refresh summaries</button>
        
      </div>
      <pre id="orun" class="raw" style="margin-top:11px; display:none" tabindex="0"></pre>
    </section>`;

  // A failed query is a question to investigate, so every row jumps into Search.
  root.querySelectorAll('[data-q]').forEach((tr) =>
    activate(tr, () => go(`search?q=${encodeURIComponent(tr.dataset.q)}`)));

  root.querySelectorAll('[data-run]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      const out = $('orun');
      b.disabled = true; out.style.display = 'block'; out.textContent = 'Running…';
      try { out.textContent = JSON.stringify(await post(b.dataset.run, {}), null, 2); }
      catch (e) { out.textContent = `Failed: ${e.message}`; }
      b.disabled = false;
      announce('Maintenance job finished.');
    });
  });

  // Server-scope preflight: the same live checks the wizard runs, shown to the
  // person who can actually do something about a bad key.
  $('svc-run').addEventListener('click', async () => {
    const btn = $('svc-run'); const box = $('svc');
    btn.disabled = true; box.innerHTML = '<div class="spin">Checking…</div>';
    try {
      const res = await api('/v1/preflight');
      const svc = (res.checks || []).filter((c) => c.scope !== 'org');
      const ok = svc.every((c) => c.ok || !c.required);
      box.innerHTML = `<div class="pfhead ${ok ? 'ok' : 'bad'}">
          ${ok ? 'Every service check passed.' : 'A service check failed.'}</div>
        ${checkRows(svc)}`;
      announce(ok ? 'Service checks passed' : 'A service check failed');
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; }
    finally { btn.disabled = false; }
  });
}

// ------------------------------------------------------------------- graph

/** The graph is a complete d3 application with its own layout, index and
 *  inspector. Re-implementing it inside the shell would fork 600 lines of
 *  working code, so it is embedded — `?embed=1` drops its own header so there
 *  is only one chrome on screen. */
function viewGraph(root) {
  root.classList.add('wide');
  root.innerHTML = '<iframe id="gframe" src="/graph?embed=1" title="Knowledge graph"></iframe>';
}

// -------------------------------------------------------------- settings

async function viewSettings(root) {
  root.innerHTML = '<div class="spin">Loading…</div>';
  let org, reg;
  try {
    [org, reg] = await Promise.all([
      api('/v1/org'),
      api('/v1/memory-types').catch(() => ({ sources: [] })),
    ]);
  } catch (e) { return fail(root, e); }

  const sources = (reg.sources || []);
  root.innerHTML = `
    <h1>Settings</h1>
    <p class="lede">This organization, what feeds it, and how to remove it.</p>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-org">
      <h2 class="sec" id="h-org">Organization</h2>
      <div class="kv">
        <span class="k">Name</span><span class="v mono" translate="no">${esc(org.name || '—')}</span>
        <span class="k">Inputs</span><span class="v num">${n(org.raw)}</span>
        <span class="k">Facts</span><span class="v num">${n(org.facts)}</span>
        <span class="k">Entities</span><span class="v num">${n(org.entities)}</span>
        <span class="k">API tokens</span><span class="v num">${n(org.tokens)}</span>
      </div>
      <p style="margin:12px 0 0"><a class="btnlink" href="./onboard.html">Re-run setup</a></p>
      <p class="dim" style="margin:12px 0 0">Membership is by email domain.
        Everyone signing in from your domain shares this memory; nobody outside
        it can reach a single row.</p>
    </section>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-src">
      <h2 class="sec" id="h-src">Connected sources</h2>
      ${sources.length
        ? `<div class="barlist">${sources.map((s) => `
            <div class="barrow" style="grid-template-columns:minmax(0,160px) 1fr auto">
              <span class="bl mono">${esc(s.source || s)}</span>
              <span></span>
              <span class="bn">${n(s.count || 0)}</span>
            </div>`).join('')}</div>`
        : `<div class="empty"><b>Nothing has arrived yet</b>Connectors write on a
           five-minute cycle. If this stays empty, check Operations for failed
           inputs.</div>`}
    </section>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-export">
      <h2 class="sec" id="h-export">Take your data</h2>
      <p class="dim" style="margin:-4px 0 12px">Everything, as portable JSON —
        the raw record, the facts, the graph, ids preserved.</p>
      
    </section>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-people">
      <h2 class="sec" id="h-people">People &amp; usage</h2>
      <p class="dim" style="margin:0 0 12px">Everyone who has shown up — signing
        in or calling through Claude — with whether their own mailbox feeds the
        memory, and how much they use it. Only tokens minted by a signed-in
        person carry that person; anonymous org tokens never appear here: this
        table says who showed up, it never guesses.
        Invite link: <b class="mono" id="invitelink" translate="no"></b> —
        <a href="/welcome">it sets up your own Claude too</a> (MCP connect +
        the memory hooks, personal token minted on the page).</p>
      <div id="people"><div class="spin">Loading…</div></div>
    </section>

    <section class="card danger" aria-labelledby="h-danger">
      <h2 class="sec" id="h-danger">Danger zone</h2>
      <div class="issue">
        <span class="sev error" aria-hidden="true"></span>
        <div class="itxt">
          <div class="it">Delete all memory in this organization</div>
          <div class="id2">Removes every input, fact, entity, relationship and
            summary — ${n(org.raw)} inputs and ${n(org.facts)} facts. Your
            account, API tokens and connectors survive, so sources will start
            refilling on the next poll. Anything typed in by hand, or captured
            from a coding session, is gone for good.</div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <label class="field" for="purgeconfirm" style="flex:1;min-width:220px">
          Type <b class="mono" translate="no">${esc(org.name || '')}</b> to confirm
          <input id="purgeconfirm" autocomplete="off" spellcheck="false"
            placeholder="${esc(org.name || '')}" />
        </label>
        <button id="purgego" class="destructive" disabled>Delete everything</button>
      </div>
      <pre id="purgeout" class="raw" style="margin-top:12px;display:none" tabindex="0"></pre>

      <div class="issue" style="margin-top:20px">
        <span class="sev error" aria-hidden="true"></span>
        <div class="itxt">
          <div class="it">Delete the organization itself</div>
          <div class="id2">Everything above, plus the organization and its API
            tokens — and each connected source is revoked <b>at the provider</b>
            (Google's revoke endpoint, Trello's token delete), so the access you
            granted is genuinely withdrawn rather than just forgotten here. You are signed out; signing
            in again creates it empty and starts setup from the top.</div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <label class="field" for="delconfirm" style="flex:1;min-width:220px">
          Type <b class="mono" translate="no">${esc(org.name || '')}</b> to confirm
          <input id="delconfirm" autocomplete="off" spellcheck="false"
            placeholder="${esc(org.name || '')}" />
        </label>
        <button id="delgo" class="destructive" disabled>Delete organization</button>
      </div>
      <p id="delout" class="dim" style="margin:12px 0 0" role="status"></p>
    </section>`;

  $('invitelink').textContent = `${location.origin}/welcome`;
  api('/v1/members').then((res) => {
    const rows = res.members || [];
    $('people').innerHTML = rows.length ? `
      <table class="t"><thead><tr><th>Member</th><th>Last seen</th>
        <th>Via</th><th>Own Gmail</th><th class="num">Recalls</th>
        <th class="num">Captures</th></tr></thead>
      <tbody>${rows.map((m) => `<tr>
        <td class="mono">${esc(m.email)}</td>
        <td title="${esc(exact(m.last_seen))}">${esc(ago(m.last_seen))}</td>
        <td>${esc(m.last_surface || '—')}</td>
        <td>${m.gmail_connected ? '<span class="pill ok">connected</span>' : '—'}</td>
        <td class="num">${n(m.recalls)}</td>
        <td class="num">${n(m.remembers)}</td>
      </tr>`).join('')}</tbody></table>`
      : '<p class="dim">Nobody has signed in yet. Send the invite link above.</p>';
  }).catch(() => { $('people').innerHTML = '<p class="dim">Could not load.</p>'; });

  const input = $('purgeconfirm');
  const go = $('purgego');
  // The button stays dead until the name matches exactly — the same string the
  // server will re-check, so the UI never promises what the API would refuse.
  input.addEventListener('input', () => {
    go.disabled = input.value.trim() !== (org.name || '');
  });
  go.addEventListener('click', async () => {
    if (!confirm(`Delete all ${n(org.raw)} inputs and ${n(org.facts)} facts? `
                 + 'This cannot be undone.')) return;
    go.disabled = true; go.textContent = 'Deleting…';
    const out = $('purgeout');
    out.style.display = 'block';
    try {
      const res = await post('/v1/purge', { confirm: input.value.trim() });
      out.textContent = JSON.stringify(res, null, 2);
      announce(`Deleted ${res.total} rows.`);
      go.textContent = 'Deleted';
      setTimeout(() => viewSettings(root), 1500);
    } catch (e) {
      out.textContent = `Failed: ${e.message}`;
      go.disabled = false; go.textContent = 'Delete everything';
    }
  });

  const dIn = $('delconfirm');
  const dGo = $('delgo');
  dIn.addEventListener('input', () => {
    dGo.disabled = dIn.value.trim() !== (org.name || '');
  });
  dGo.addEventListener('click', async () => {
    if (!confirm(`Delete ${org.name} entirely — all memory, its API tokens, and the `
                 + 'source authorizations at Google and Trello? You will be signed out. '
                 + 'This cannot be undone.')) return;
    dGo.disabled = true; $('delout').textContent = 'Deleting…';
    try {
      const res = await post('/v1/reset', { confirm: dIn.value.trim() });
      const failed = (res.revocations || [])
        .filter((r) => !r.revoked).map((r) => r.provider);
      $('delout').textContent = `Deleted ${n(res.total || 0)} rows. `
        + (failed.length
          ? `Revocation was NOT confirmed for: ${failed.join(', ')} — revoke those `
            + 'manually (myaccount.google.com/connections or trello.com). Signing out…'
          : 'Signing out…');
      // The session names an org that no longer exists; anything short of a full
      // reload would spend the next minute 401ing.
      setTimeout(() => { location.href = './index.html'; }, failed.length ? 6000 : 1500);
    } catch (e) {
      $('delout').textContent = `Failed: ${e.message}`;
      dGo.disabled = false;
    }
  });
}

const DOT = (ok, pending) =>
  `<span class="sdot ${ok ? 'ok' : pending ? 'warn' : 'bad'}" aria-hidden="true"></span>`;

function checkRows(checks) {
  /* An optional check that is merely unconfigured is NOT a failure, and painting
   * it red says it is. Amber reads as "you could do this"; red is reserved for
   * something that is actually broken and needs fixing. */
  return checks.map((c) => `
    <div class="chk ${c.ok ? 'ok' : c.required ? 'bad' : 'warn'}">
      <div class="chkhead">${DOT(c.ok, !c.ok && !c.required)}<b>${esc(c.name)}</b>
        <span class="dim">${esc(c.detail || '')}</span>
        ${c.required ? '' : '<span class="pill">optional</span>'}</div>
      ${c.ok ? '' : `<p class="chkfix">${esc(c.fix || '')}</p>`}
      ${c.ok || !(c.steps || []).length ? '' : `<ol class="chksteps">
        ${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`}
    </div>`).join('');
}

// ------------------------------------------------------------------ router

const VIEWS = {
  overview: { title: 'Overview', render: viewOverview },
  memories: { title: 'Memories', render: viewMemories },
  graph: { title: 'Graph', render: viewGraph },
  people: { title: 'People', render: viewPeople },
  search: { title: 'Search', render: viewSearch },
  ops: { title: 'Operations', render: viewOps },
  settings: { title: 'Settings', render: viewSettings },
};

const go = (hash) => { location.hash = hash; };

/* An org that has never completed setup lands on the wizard instead of an
 * Overview full of zeroes with no explanation. Deliberately a ONE-TIME redirect
 * held in memory, not a hard gate: once it has fired, every other tab stays
 * reachable, so a half-configured org can still look at what it does have. A
 * loop that kept forcing you back to setup would be a trap, not a guide. */
let setupRedirectDone = false;

async function maybeForceSetup() {
  /* "Skip for now" must actually skip. The guard above only lives inside one
   * page load, so the wizard's Skip link (a fresh /app load) used to bounce
   * straight back to /onboarding — a loop, which is exactly the trap this was
   * written not to be. The skip arrives as ?skip=1 and is remembered for the
   * browser session; the wizard still greets them on their next visit. */
  if (sessionStorage.getItem('ob_skipped') === '1') return false;
  if (new URLSearchParams(location.search).has('skip')) {
    sessionStorage.setItem('ob_skipped', '1');
    history.replaceState(null, '', location.pathname + location.hash);
    return false;
  }
  if (setupRedirectDone) return false;
  setupRedirectDone = true;
  if (location.hash && location.hash !== '#overview') return false;
  try {
    const ob = await api('/v1/onboarding');
    if (ob && !ob.completed_at) { location.href = './onboard.html'; return true; }
  } catch { /* never block the dashboard on this */ }
  return false;
}

async function route() {
  if (await maybeForceSetup()) return;   // the hash change re-enters route()
  const raw = (location.hash || '#overview').slice(1);
  const [name, query] = raw.split('?');
  const key = VIEWS[name] ? name : 'overview';
  const view = VIEWS[key];
  const params = new URLSearchParams(query || '');

  document.querySelectorAll('.navitem').forEach((a) => {
    if (a.dataset.tab === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('crumb').textContent = view.title;
  document.title = `${view.title} · OneBrain`;

  // Filter changes use replaceState, which does NOT fire hashchange, so
  // reaching here always means real navigation and always means a re-render.
  const root = $('view');
  root.className = 'view';
  root.innerHTML = '';
  try { await view.render(root, params); }
  catch (e) { fail(root, e); }
}

// -------------------------------------------------------- command palette

/* One keystroke to anywhere. Sections first (always available, zero latency),
 * then live memory hits — so ⌘K answers both "take me to Operations" and "what
 * do we know about Stripe". */
const palette = {
  items: [],
  at: 0,
  open() {
    $('pq').value = '';
    palette.render([]);
    openModal($('palette'), $('pq'));
  },
  close() { closeModal($('palette')); },
  render(hits) {
    const q = $('pq').value.trim().toLowerCase();
    const tabs = Object.entries(VIEWS)
      .filter(([k, v]) => !q || k.includes(q) || v.title.toLowerCase().includes(q))
      .map(([k, v]) => ({ label: v.title, kind: 'Go to', to: k }));
    palette.items = [...tabs, ...hits.map((h) => ({
      label: h.content, kind: h.source || 'memory', fact: h.id }))];
    palette.at = 0;
    const box = $('presults');
    box.innerHTML = palette.items.length
      ? palette.items.map((it, i) => `<div class="pitem" role="option" id="pi-${i}"
          aria-selected="${i === 0}" data-i="${i}">
          <span class="pl">${esc(it.label)}</span>
          <span class="pk">${esc(it.kind)}</span></div>`).join('')
      : '<div class="pitem" role="option" aria-selected="false"><span class="pl dim">No matches</span></div>';
    box.querySelectorAll('.pitem[data-i]').forEach((d) =>
      d.addEventListener('click', () => palette.choose(Number(d.dataset.i))));
    palette.mark();
  },
  mark() {
    const opts = [...$('presults').querySelectorAll('.pitem[data-i]')];
    opts.forEach((d, i) => d.setAttribute('aria-selected', String(i === palette.at)));
    const active = opts[palette.at];
    if (active) {
      $('pq').setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  },
  choose(i) {
    const it = palette.items[i];
    if (!it) return;
    palette.close();
    if (it.to) go(it.to); else if (it.fact) openFact(it.fact);
  },
};

function wirePalette() {
  let t;
  $('cmdk').onclick = palette.open;
  $('pq').oninput = () => {
    palette.render([]);
    clearTimeout(t);
    const q = $('pq').value.trim();
    if (q.length < 3) return;
    // Searching memory from the palette costs a real recall, so it waits until
    // the user has clearly stopped typing.
    t = setTimeout(async () => {
      try {
        const d = await post('/v1/recall', { query: q, limit: 5 });
        if (!$('palette').hidden && $('pq').value.trim() === q) palette.render(d.results || []);
      } catch (e) { /* section navigation still works */ }
    }, 350);
  };
  $('pq').onkeydown = (e) => {
    if (e.key === 'Escape') return palette.close();
    if (e.key === 'Enter') { e.preventDefault(); return palette.choose(palette.at); }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const max = palette.items.length - 1;
    palette.at = Math.max(0, Math.min(max, palette.at + (e.key === 'ArrowDown' ? 1 : -1)));
    palette.mark();
  };
  $('palette').addEventListener('keydown', (e) => trapTab($('palette'), e));
  $('palette').onclick = (e) => { if (e.target === $('palette')) palette.close(); };

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); palette.open(); }
    if (e.key !== 'Escape') return;
    if (!$('drawer').hidden) closeModal($('drawer'));
    else if (!$('palette').hidden) palette.close();
  });
}

// -------------------------------------------------------------------- boot

async function boot() {
  $('dclose').onclick = () => closeModal($('drawer'));
  $('drawer').onclick = (e) => { if (e.target === $('drawer')) closeModal($('drawer')); };
  $('drawer').addEventListener('keydown', (e) => trapTab($('drawer'), e));
  wirePalette();
  window.addEventListener('hashchange', route);

  try {
    const me = await api('/auth/me');
    if (me.authenticated) {
      $('orgline').textContent = me.org || '';
      $('orgline').title = me.email || '';
      $('account').innerHTML =
        `<a href="#" id="signout" title="${esc(me.email || '')}">Sign out</a>`;
      $('signout').onclick = (e) => { e.preventDefault(); window.OB.signout(); };
    } else if (me.login_enabled !== false) {
      location.href = './index.html';
      return;
    }
  } catch (e) { /* an unauthenticated view still renders its empty states */ }

  route();
}

boot();

import "./compat.js?v=10";
import { FN } from "./env.js?v=1";

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
  const [s, ob, conns, mem, members] = await Promise.all([
    api('/v1/stats'),
    // Never let the setup prompt take the whole page down with it.
    api('/v1/onboarding').catch(() => null),
    api('/v1/connections').catch(() => ({ connections: [] })),
    api('/v1/memories?limit=6').catch(() => ({ items: [] })),
    api('/v1/members').catch(() => ({ members: [] })),
  ]);

  /* An org whose setup is unfinished has a Home full of zeroes and no way to
   * know why. Say it once, at the top, with the way out. */
  const setupPrompt = (ob && !ob.completed_at) ? `
    <section class="card setupcard" style="margin-bottom:14px" aria-labelledby="h-setup">
      <h2 class="sec" id="h-setup">Finish setting up ${esc(ob.org || 'your organization')}</h2>
      <p style="margin:0 0 12px">Connect your sources and verify every key and
        connection with a live call. Until then this page mostly shows zeroes.</p>
      <a class="btnlink primary" href="./onboard.html">Open setup</a>
    </section>` : '';

  const week = (s.daily || []).slice(-7).reduce((a, d) => a + (d.n || 0), 0);
  const cs = conns.connections || [];
  const ok = cs.filter((c) => c.status === 'ok').length;
  const recent = mem.items || [];
  const clip = (t, len) => {
    const v = String(t || '');
    return esc(v.length > len ? v.slice(0, len) + '…' : v);
  };

  root.innerHTML = `
    <h1>Home</h1>
    <p class="lede">${n(s.facts_current)} current facts from ${n(s.raw)} inputs${
      s.last_ingest ? ` · last ingest ${ago(s.last_ingest)}` : ''}</p>

    ${setupPrompt}

    <div class="tiles" style="margin-bottom:14px">
      ${tile(n(s.facts_current), 'current facts',
             s.facts > s.facts_current ? `${n(s.facts - s.facts_current)} superseded`
                                       : 'nothing retired')}
      ${tile(n(week), 'added this week',
             s.unenriched ? `${n(s.unenriched)} still processing` : 'all processed')}
      ${tile(cs.length ? `${ok}/${cs.length}` : '0', 'sources verified',
             cs.length ? 'live-checked every sweep' : 'none connected yet')}
      ${tile(n((members.members || []).length), 'members', 'signed in from your domain')}
    </div>

    <div class="split">
      <section class="card" aria-labelledby="h-recent">
        <h2 class="sec" id="h-recent">Latest knowledge</h2>
        ${recent.length
          ? `<table class="t"><tbody>${recent.map((f) => `
              <tr data-goto="memories" tabindex="0" role="button"
                  aria-label="Open Knowledge">
                <td>${clip(f.content, 96)}</td>
                <td class="tight"><span class="pill">${esc(f.type || 'fact')}</span></td>
                <td class="tight">${ago(f.created_at)}</td>
              </tr>`).join('')}</tbody></table>`
          : '<p class="dim">Nothing yet — connect a source, or write through the MCP tools.</p>'}
      </section>
      <section class="card" aria-labelledby="h-src">
        <h2 class="sec" id="h-src">Where memory comes from</h2>
        <div id="srcbars"></div>
        <h2 class="sec" id="h-type" style="margin-top:18px">What kind of thing</h2>
        <div id="typebars"></div>
      </section>
    </div>

    <section class="card" style="margin-top:12px" aria-labelledby="h-daily">
      <h2 class="sec" id="h-daily">Facts added — last 30 days</h2>
      ${spark(s.daily, 30, 'facts')}
    </section>`;

  $('srcbars').innerHTML = barlist(
    s.by_source.map((r) => ({ key: r.source, label: r.source, value: r.n })),
    { clickable: true });
  $('typebars').innerHTML = barlist(
    s.by_type.map((r) => ({ key: r.type, label: r.type, value: r.n })),
    { clickable: true });

  // Every breakdown row is a filter into Knowledge — a count you cannot click
  // is a dead end.
  const drill = (container, key) => container.querySelectorAll('[data-bar]')
    .forEach((r) => activate(r, () => go(`memories?${key}=${encodeURIComponent(r.dataset.bar)}`)));
  drill($('srcbars'), 'source');
  drill($('typebars'), 'type');
  root.querySelectorAll('[data-goto]').forEach((tr) =>
    activate(tr, () => go(tr.dataset.goto)));
  announce('Home loaded.');
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
    <h1>Knowledge</h1>
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

// ---------------------------------------------------------------- insights

async function viewInsights(root) {
  root.innerHTML = `<div class="spin">Reading your memory\u2026 the first load
    of the day synthesizes fresh insights and can take up to a minute.</div>`;
  let d;
  try { d = await api('/v1/insights'); } catch (e) { return fail(root, e); }
  renderInsights(root, d);
}

function renderInsights(root, d) {
  const item = (h) => `
    <div class="issue">
      <span class="sev" aria-hidden="true"></span>
      <div class="itxt">
        <div class="it">${esc(h.title)}</div>
        <div class="id2">${esc(h.detail)}</div>
      </div>
    </div>`;
  const chips = (rows, key, field) => rows.length
    ? `<div class="barlist">${rows.map((r) => `
        <div class="barrow" data-bar="${esc(r[field])}" tabindex="0" role="button"
             style="grid-template-columns:minmax(0,220px) 1fr auto">
          <span class="bl">${esc(r[field])}</span><span></span>
          <span class="bn">${n(r.n)}</span>
        </div>`).join('')}</div>`
    : '<p class="dim">Nothing in the last 14 days.</p>';

  root.innerHTML = `
    <h1>Insights</h1>
    <p class="lede">Your memory, reading itself: what moved in the last 14 days,
      synthesized from every recorded fact — never invented.
      <span class="dim">Generated ${d.generated_at ? ago(d.generated_at) : 'now'}.</span></p>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-pulse">
      <div style="display:flex;align-items:baseline;gap:12px;justify-content:space-between">
        <h2 class="sec" id="h-pulse">The pulse</h2>
        <button class="ghost" id="ins-refresh">Regenerate</button>
      </div>
      <p style="margin:6px 0 0;max-width:70ch">${esc(d.summary || 'Not enough recorded yet — connect sources and check back.')}</p>
    </section>

    <div class="split">
      <section class="card" aria-labelledby="h-hl">
        <h2 class="sec" id="h-hl">What matters</h2>
        ${(d.highlights || []).length ? d.highlights.map(item).join('')
          : '<p class="dim">Nothing stands out yet.</p>'}
      </section>
      <section class="card" aria-labelledby="h-watch">
        <h2 class="sec" id="h-watch">Worth watching</h2>
        ${(d.watch || []).length ? d.watch.map(item).join('')
          : '<p class="dim">No open loops detected.</p>'}
      </section>
    </div>

    <div class="split" style="margin-top:12px">
      <section class="card" aria-labelledby="h-tt">
        <h2 class="sec" id="h-tt">Trending topics</h2>
        <div id="ins-topics">${chips(d.topics || [], 'topic', 'topic')}</div>
      </section>
      <section class="card" aria-labelledby="h-tp">
        <h2 class="sec" id="h-tp">Most active subjects</h2>
        <div id="ins-people">${chips(d.people || [], 'entity', 'entity')}</div>
      </section>
    </div>`;

  $('ins-refresh').addEventListener('click', async () => {
    const b = $('ins-refresh');
    b.disabled = true; b.textContent = 'Thinking\u2026';
    try { renderInsights(root, await post('/v1/insights', { refresh: true })); }
    catch (e) { b.textContent = String(e.message || e).slice(0, 40); }
  });
  $('ins-topics').querySelectorAll('[data-bar]').forEach((r) =>
    activate(r, () => go(`memories?q=${encodeURIComponent(r.dataset.bar)}`)));
  $('ins-people').querySelectorAll('[data-bar]').forEach((r) =>
    activate(r, () => go(`memories?q=${encodeURIComponent(r.dataset.bar)}`)));
}

// ------------------------------------------------------------------- graph

/** The graph is a complete d3 application with its own layout, index and
 *  inspector — embedded rather than forked; `?embed=1` drops its own header so
 *  there is only one chrome on screen. */
function viewGraph(root) {
  root.classList.add('wide');
  root.innerHTML = '<iframe id="gframe" src="./graph.html?embed=1" title="Knowledge graph"></iframe>';
}

// --------------------------------------------------------------- sources

const SOURCE_LABEL = {
  gmail: 'Gmail', google_meet: 'Google Meet',
  google_calendar: 'Google Calendar', trello: 'Trello',
};

async function viewSources(root) {
  root.innerHTML = '<div class="spin">Loading…</div>';
  let conns, types;
  try {
    [conns, types] = await Promise.all([api('/v1/connections'), api('/v1/memory-types')]);
  } catch (e) { return fail(root, e); }
  const counts = Object.fromEntries((types.sources || []).map((x) => [x.source, x.count]));
  const rows = conns.connections || [];
  const connected = new Set(rows.map((c) => c.provider));
  const others = (types.sources || []).filter((x) => !connected.has(x.source));

  root.innerHTML = `
    <h1>Sources</h1>
    <p class="lede">What feeds this memory. Every connection is verified with a
      real call on every sweep — trouble is written here, not buried in a log.</p>

    <section class="card" style="margin-bottom:14px" aria-labelledby="h-conn">
      <h2 class="sec" id="h-conn">Connections</h2>
      ${rows.length
        ? `<table class="t"><thead><tr><th>Source</th><th>State</th>
             <th>Last verified</th><th>Trouble</th><th class="num">Facts</th></tr></thead>
           <tbody>${rows.map((c) => `<tr>
             <td>${esc(SOURCE_LABEL[c.provider] || c.provider)}${c.member_email
                 ? ` <span class="dim mono">${esc(c.member_email)}</span>` : ''}</td>
             <td>${c.status === 'ok' ? '<span class="pill ok">verified</span>'
                 : `<span class="pill">${esc(c.status || 'pending')}</span>`}</td>
             <td>${c.last_ok_at ? esc(ago(c.last_ok_at)) : '—'}</td>
             <td>${c.last_error ? `<span class="dim">${esc(String(c.last_error).slice(0, 90))}</span>` : ''}</td>
             <td class="num">${n(counts[c.provider] || 0)}</td>
           </tr>`).join('')}</tbody></table>`
        : `<div class="empty"><b>Nothing is connected</b>Connect Gmail, Google Meet,
             Calendar or Trello and ingestion starts within a minute.</div>`}
      <p style="margin:12px 0 0"><a class="ghost" href="./onboard.html">Connect or
        repair a source</a></p>
    </section>

    ${others.length ? `
    <section class="card" aria-labelledby="h-oth">
      <h2 class="sec" id="h-oth">Written directly</h2>
      <p class="dim" style="margin:-4px 0 10px">Memory that arrives through the
        MCP tools and hooks rather than a polled connection.</p>
      <div class="barlist">${others.map((x) => `
        <div class="barrow" style="grid-template-columns:minmax(0,160px) 1fr auto">
          <span class="bl mono">${esc(x.source)}</span><span></span>
          <span class="bn">${n(x.count || 0)}</span>
        </div>`).join('')}</div>
    </section>` : ''}`;
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


    <section class="card" style="margin-bottom:14px" aria-labelledby="h-connect">
      <h2 class="sec" id="h-connect">Connect your tools</h2>
      <p class="dim" style="margin:-4px 0 14px">Two ways in: AI assistants speak
        MCP; hooks and scripts authenticate with a personal token.</p>

      <div class="it" style="font-weight:600">Claude and other MCP clients</div>
      <div class="id2" style="margin:2px 0 8px">Run this once, then sign in with
        Google on first use — recall and remember work mid-conversation from
        then on.</div>
      <pre class="raw mono" id="mcpsnip" tabindex="0"
        style="white-space:pre-wrap;word-break:break-all"></pre>
      <p style="margin:6px 0 20px">
        <button class="btnlink" id="mcpcopy">Copy command</button></p>

      <div class="it" style="font-weight:600">Personal token — hooks &amp; API</div>
      <div class="id2" style="margin:2px 0 8px">Authenticates the capture hook and
        the REST API as you. The token is shown once; minting again replaces the
        previous one everywhere it's used.</div>
      <p style="margin:0"><button class="btnlink" id="mintgo">Mint my token</button></p>
      <pre class="raw mono" id="mintout" tabindex="0"
        style="margin-top:10px;display:none;white-space:pre-wrap;word-break:break-all"></pre>
      <p style="margin:6px 0 0;display:none" id="mintcopyrow">
        <button class="btnlink" id="mintcopy">Copy token</button></p>
    </section>


    <section class="card" style="margin-bottom:14px" aria-labelledby="h-export">
      <h2 class="sec" id="h-export">Take your data</h2>
      <p class="dim" style="margin:-4px 0 12px">Everything, as portable JSON —
        the raw record, the facts, the graph, ids preserved. Export is being
        rebuilt on the new engine and returns shortly.</p>
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

  // Connect your tools: the MCP add command is plain text (public URL), the
  // personal token is fetched on demand and shown exactly once.
  const mcpCmd = `claude mcp add --transport http onebrain ${FN}/mcp`;
  $('mcpsnip').textContent = mcpCmd;
  $('mcpcopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(mcpCmd);
      $('mcpcopy').textContent = 'Copied';
      setTimeout(() => { $('mcpcopy').textContent = 'Copy command'; }, 1800);
    } catch { announce('Copy failed — select the command text instead.'); }
  });
  let mintedToken = '';
  $('mintgo').addEventListener('click', async () => {
    if (!confirm('Mint a personal token? Any previous token of yours stops '
                 + 'working the moment this one is created.')) return;
    const btn = $('mintgo');
    btn.disabled = true; btn.textContent = 'Minting…';
    const out = $('mintout');
    try {
      const res = await post('/v1/me/token');
      mintedToken = res.token;
      out.style.display = 'block';
      out.textContent =
        `# ~/.config/onebrain/config — for the capture hook\n` +
        `ONEBRAIN_URL=${FN}/api\n` +
        `ONEBRAIN_TOKEN=${res.token}\n\n` +
        `# shown once — minting again replaces it`;
      $('mintcopyrow').style.display = 'block';
      announce('Token minted — shown once, copy it now.');
      btn.textContent = 'Mint again';
    } catch (e) {
      out.style.display = 'block';
      out.textContent = `Failed: ${e.message || e}`;
      btn.textContent = 'Mint my token';
    } finally { btn.disabled = false; }
  });
  $('mintcopy').addEventListener('click', async () => {
    if (!mintedToken) return;
    try {
      await navigator.clipboard.writeText(mintedToken);
      $('mintcopy').textContent = 'Copied';
      setTimeout(() => { $('mintcopy').textContent = 'Copy token'; }, 1800);
    } catch { announce('Copy failed — select the token text instead.'); }
  });

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

// ------------------------------------------------------------------- usage

async function viewUsage(root) {
  root.innerHTML = '<div class="spin">Loading…</div>';
  let u;
  try { u = await api('/v1/usage'); } catch (e) { return fail(root, e); }
  // Sub-cent amounts get the decimals they need — a row reading $0.0000
  // under a non-zero total is a lie of precision.
  const usd = (x, d = 2) => {
    const v = Number(x || 0);
    return `$${v.toFixed(v && Math.abs(v) < 0.01 ? 6 : d)}`;
  };
  const mt = (t) => (t >= 1e6 ? `${(t / 1e6).toFixed(2)}M` : n(t));
  const REASON = { trial: 'Trial credit', allowance: 'Plan allowance',
    purchase: 'Purchase', promo: 'Promo', adjustment: 'Adjustment' };
  const breakdown = (rows, name, key) => rows.length
    ? `<table class="t"><tbody>${rows.map((r) => `<tr>
        <td>${esc(r[key])}</td>
        <td class="tight num">${mt(r.tokens)}</td>
        <td class="tight num">${usd(r.usd, 4)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="dim">No ${name} yet.</p>`;

  root.innerHTML = `
    <h1>Billing</h1>
    <p class="lede">What the platform engine has thought on your behalf — every
      call metered as it happened, priced per token. An org running on its own
      API keys spends there, not here.</p>

    <div class="tiles" style="margin-bottom:14px">
      ${tile(usd(u.balance_usd), 'balance', 'prepaid — rolls over')}
      ${tile(u.plan ? esc(u.plan.name) : '—', 'plan',
             u.plan ? `${usd(u.plan.usd_month, 0)}/mo · ${esc(u.plan.status)}`
                    : 'not chosen yet')}
      ${tile(mt(u.month_tokens), 'tokens this month', `${usd(u.month_spend_usd, 4)} spent`)}
      ${tile(n(u.events), 'metered calls', `last ${u.days} days`)}
    </div>

    <p style="margin:-4px 0 14px">
      <button class="ghost" id="bill-act">${
        u.plan && u.plan.status === 'active' ? 'Manage billing' : 'Activate billing'}</button>
      <span class="dim" id="bill-out" role="status" style="margin-left:10px"></span>
    </p>

    <section class="card" style="margin-bottom:12px" aria-labelledby="h-ud">
      <h2 class="sec" id="h-ud">Tokens per day</h2>
      ${spark(u.daily, u.days, 'tokens')}
    </section>

    <section class="card" aria-labelledby="h-uop">
      <h2 class="sec" id="h-uop">By operation</h2>
      <p class="dim" style="margin:-4px 0 10px">Where the thinking goes:
        enrichment turns raw inputs into facts; embeddings make them findable;
        recall answers questions.</p>
      ${breakdown(u.by_op, 'operations', 'operation')}
    </section>

    <section class="card" style="margin-top:12px;margin-bottom:12px" aria-labelledby="h-um">
      <h2 class="sec" id="h-um">By member</h2>
      <p class="dim" style="margin:-4px 0 10px">Who showed up and how much they
        use it. Only tokens minted by a signed-in person carry a name — this
        table never guesses.</p>
      <div id="umembers"><div class="spin">Loading…</div></div>
    </section>

    <section class="card" style="margin-top:12px" aria-labelledby="h-ul">
      <h2 class="sec" id="h-ul">Credits</h2>
      ${u.ledger.length
        ? `<table class="t"><tbody>${u.ledger.map((r) => `<tr>
            <td>${ago(r.at)}</td>
            <td>${esc(REASON[r.reason] || r.reason)}</td>
            <td class="tight num">${Number(r.delta_usd) >= 0 ? '+' : ''}${usd(r.delta_usd)}</td>
          </tr>`).join('')}</tbody></table>`
        : '<p class="dim">No credits yet — the trial lands on first setup.</p>'}
    </section>`;

  $('bill-act').addEventListener('click', async () => {
    const b = $('bill-act'); const out = $('bill-out');
    b.disabled = true; out.textContent = 'Opening Stripe…';
    try {
      const active = u.plan && u.plan.status === 'active';
      const res = await post(active ? '/v1/billing/portal' : '/v1/billing/checkout',
        { plan: u.plan?.plan_code || u.plan?.code || 'starter',
          return_base: location.origin + location.pathname.replace(/\/app\.html$/, '') });
      if (res.url) location.href = res.url;
      else out.textContent = 'No URL returned';
    } catch (e) {
      out.textContent = String(e.message || e).slice(0, 80);
      b.disabled = false;
    }
  });

  api('/v1/members').then((res) => {
    const rows = res.members || [];
    $('umembers').innerHTML = rows.length ? `
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
      : '<p class="dim">Nobody has signed in yet.</p>';
  }).catch(() => { $('umembers').innerHTML = '<p class="dim">Could not load.</p>'; });
}

// ------------------------------------------------------------------ router

const VIEWS = {
  overview: { title: 'Home', render: viewOverview },
  memories: { title: 'Knowledge', render: viewMemories },
  people: { title: 'People', render: viewPeople },
  insights: { title: 'Insights', render: viewInsights },
  search: { title: 'Search', render: viewSearch },
  graph: { title: 'Graph', render: viewGraph },
  sources: { title: 'Sources', render: viewSources },
  usage: { title: 'Billing', render: viewUsage },
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

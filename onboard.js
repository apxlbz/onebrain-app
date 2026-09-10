import "./compat.js?v=13";
import { FN } from "./env.js?v=1";

/* OneBrain onboarding.
 *
 * A four-step machine over the same /v1 endpoints the dashboard uses. No
 * framework, no build step, and nothing loaded from any external host: Google
 * consent is a plain navigation through Supabase's own /authorize endpoint, and
 * Trello consent happens on Trello's own page in a new tab.
 *
 * The rule this file follows everywhere: nothing claims success it has not
 * measured. Every state a source can be in comes from a real API response, and
 * "verified" is only ever printed after a live call returned.
 */

'use strict';

document.documentElement.classList.add('js');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const announce = (m) => { $('live').textContent = m; };

async function api(path, opts = {}) {
  return await window.OB.api(path, opts);
}
const post = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const SOURCES = [
  { id: 'gmail', label: 'Gmail', pck: 'google-mail',
    what: 'Recent mail, minus promotions and social.' },
  { id: 'google_meet', label: 'Google Meet', pck: 'google-drive',
    what: 'Gemini meeting notes and transcripts from Drive.' },
  { id: 'trello', label: 'Trello', pck: 'trello',
    what: 'Card comments and descriptions across open boards.' },
  { id: 'google_calendar', label: 'Google Calendar', pck: 'google-calendar',
    what: 'Events, attendees and dates.' },
];

/* Brand marks, inline.
 *
 * Inline rather than linked because this page loads nothing from an external
 * host — a CDN logo would be a third-party request on a screen where someone is
 * about to authorize their email. Drawn simply and in each brand's own colours:
 * these are recognisable marks for an integration list, NOT the official brand
 * assets, which every one of these companies distributes under its own brand
 * guidelines. Swap in the official SVGs before this is a public signup page.
 */
const ICON = {
  gmail: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#fff" d="M2 6.5h20v12H2z"/>
    <path fill="#EA4335" d="M2 6.5 12 14 22 6.5v-1A1.5 1.5 0 0 0 20.5 4h-17A1.5 1.5 0 0 0 2 5.5z"/>
    <path fill="#34A853" d="M2 18.5V8l4 3v7.5z"/>
    <path fill="#4285F4" d="M22 18.5V8l-4 3v7.5z"/>
    <path fill="#FBBC04" d="M6 11 12 15.5 18 11v7.5H6z"/></svg>`,
  google_meet: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#00832D" d="M14 8v3l4-2.6v7.2L14 13v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1z"/>
    <path fill="#1A73E8" d="M3 8a1 1 0 0 1 1-1h6v10H4a1 1 0 0 1-1-1z"/>
    <path fill="#FFBA00" d="M18 8.4 20.4 6.9A1 1 0 0 1 22 7.7v8.6a1 1 0 0 1-1.6.8L18 15.6z"/></svg>`,
  trello: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="20" height="20" x="2" y="2" rx="4" fill="#0079BF"/>
    <rect width="5.5" height="12" x="5" y="5" rx="1.4" fill="#fff"/>
    <rect width="5.5" height="7.5" x="13.5" y="5" rx="1.4" fill="#fff"/></svg>`,
  google_calendar: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="18" height="18" x="3" y="3" rx="2.5" fill="#fff" stroke="#DADCE0"/>
    <path fill="#1A73E8" d="M3 5.5A2.5 2.5 0 0 1 5.5 3H8v4H3z"/>
    <path fill="#EA4335" d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V7h-5z"/>
    <text x="12" y="16.6" text-anchor="middle" font-size="8.5"
          font-family="Inter, system-ui, sans-serif" fill="#1A73E8">31</text></svg>`,
};

let state = { step: 0, ob: null, conns: [] };

// ------------------------------------------------------------- step machine

const steps = [...document.querySelectorAll('.step')];

function paintRail() {
  document.querySelectorAll('#obrail li').forEach((li) => {
    const i = Number(li.dataset.step);
    li.toggleAttribute('data-on', i === state.step);
    li.toggleAttribute('data-done', i < state.step);
  });
}

/* Swaps panels with an out/in pair rather than a cross-fade: two headlines
 * visible at once, at this size, reads as a glitch. */
function show(next, { back = false } = {}) {
  const cur = steps[state.step];
  const to = steps[next];
  if (cur === to) return;
  const swap = () => {
    cur.hidden = true; cur.removeAttribute('data-anim');
    to.hidden = false;
    to.setAttribute('data-anim', 'in');
    state.step = next;
    paintRail();
    // Focus the new heading so a screen reader and the keyboard both land in
    // the step that just appeared, not back at the top of the document.
    const h = to.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' });
    announce(h ? h.textContent : '');
    onEnter(next, { back });
  };
  if (reduced.matches) return swap();
  cur.setAttribute('data-anim', 'out');
  setTimeout(swap, 160);
}

/* Step indices: 0 welcome, 1 organization, 2 sources, 3 plan, 4 verify, 5 done. */
const STEP = { welcome: 0, org: 1, sources: 2, plan: 3, verify: 4, done: 5 };

function onEnter(i) {
  if (i === STEP.sources) renderSources();
  if (i === STEP.plan) renderPlans();
  if (i === STEP.verify) { runChecks(); }
  if (i === STEP.done) renderDone();
}

// ------------------------------------------------------------------ step 1

async function saveOrg() {
  await post('/v1/onboarding', {
    display_name: $('ob-name').value,
    steps: { ...((state.ob && state.ob.steps) || {}),
             team: $('ob-team').value, goal: $('ob-goal').value.trim() },
  });
}

// ------------------------------------------------------------------ step 2

const STATE_LABEL = {
  ok: 'Verified', pending: 'Saved, not yet verified', error: 'Needs attention',
};

/* The integrations catalog.
 *
 * One grid, one vocabulary. The four built-in sources and the ~1,200 servers
 * synced from the public registry are presented the same way — a mark, a
 * name, one line on what gets remembered, and a state — because to the person
 * connecting them the transport is irrelevant. Pages of twelve, so the list is
 * browsable rather than a search box with nothing behind it; search and the
 * filters narrow the same list rather than opening a different one. */

const BATCH = 24;
const cat = { q: '', filter: 'all', seq: 0, natives: [], offset: 0, total: 0,
              done: false, loading: false,
              manual: !('IntersectionObserver' in window) };

/* Brand colour for the fallback tile, keyed by a token of the slug or title.
 * These are colours, not logos: a coloured square with an initial reads as
 * "a product" at a glance when no logo could be fetched. */
const BRAND = {
  github: '#24292f', gitlab: '#fc6d26', notion: '#1f1f1f', linear: '#5e6ad2',
  asana: '#f06a6a', atlassian: '#0052cc', jira: '#0052cc', confluence: '#0052cc',
  bitbucket: '#0052cc', hubspot: '#ff7a59', intercom: '#1f8ded', sentry: '#362d59',
  slack: '#4a154b', stripe: '#635bff', figma: '#a259ff', zendesk: '#03363d',
  salesforce: '#00a1e0', airtable: '#fcb400', supabase: '#3ecf8e', vercel: '#171717',
  cloudflare: '#f38020', postgres: '#336791', postgresql: '#336791', mongodb: '#00684a',
  shopify: '#5e8e3e', zapier: '#ff4f00', discord: '#5865f2', dropbox: '#0061ff',
  box: '#0061d5', monday: '#ff3d57', clickup: '#7b68ee', todoist: '#e44332',
  google: '#4285f4', microsoft: '#0078d4', aws: '#ff9900', azure: '#0078d4',
  datadog: '#632ca6', pagerduty: '#06ac38', twilio: '#f22f46', canva: '#00c4cc',
  miro: '#ffd02f', loom: '#625df5', calendly: '#006bff', paypal: '#003087',
  trello: '#0079bf', linkedin: '#0a66c2', spotify: '#1db954', anthropic: '#d97757',
  netlify: '#00c7b7', heroku: '#430098', railway: '#7b3fe4', snowflake: '#29b5e8',
  grafana: '#f46800', redis: '#dc382d', firebase: '#ffca28', okta: '#007dc1',
  auth0: '#eb5424', zoom: '#0b5cff',
};

const hue = (str) => {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};
function tileColor(slug, title) {
  const toks = `${slug} ${title}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of toks) if (BRAND[t]) return BRAND[t];
  return `hsl(${hue(slug)} 34% 46%)`;
}
const initial = (slug, title) => (String(title || slug).trim()[0] || '?').toUpperCase();
const monogram = (slug, title) =>
  `<span class="srcicon tile" style="--tile:${tileColor(slug, title)}" aria-hidden="true">${
    esc(initial(slug, title))}</span>`;

/* The registry names servers in reverse-DNS — "com.notion/notion",
 * "agency.goji/goji" — so the namespace IS the vendor's domain, reversed.
 * That domain's favicon is the real mark. GitHub-hosted namespaces
 * (io.github.<user>) say nothing about the vendor, so those fall back to
 * the server's own host with the usual mcp./api./app. prefixes removed. */
function brandDomain(slug, url) {
  const ns = String(slug || '').split('/')[0];
  if (ns.includes('.') && !ns.startsWith('io.github.')) {
    return ns.split('.').reverse().join('.').toLowerCase();
  }
  try {
    return new URL(url).hostname.replace(/^(mcp|api|app|www|server|remote)\./i, '')
      .toLowerCase();
  } catch { return ''; }
}
const logoUrl = (domain) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;

function catIcon(r) {
  const d = brandDomain(r.slug, r.url);
  return d
    ? `<span class="srcicon logo" data-logo="${esc(d)}" style="--tile:${tileColor(r.slug, r.title)}"
         data-initial="${esc(initial(r.slug, r.title))}" aria-hidden="true"></span>`
    : monogram(r.slug, r.title);
}

const catShort = (slug) => (String(slug).split('/').pop() || 'server')
  .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'server';

function nativeCard(s, c) {
  const on = !c ? '0' : c.status === 'ok' ? '1' : c.status === 'error' ? 'err' : 'p';
  const label = !c ? 'Not connected' : (STATE_LABEL[c.status] || 'Connected');
  return `<button class="srccard" data-src="${esc(s.id)}" data-pck="${esc(s.pck)}"
            data-on="${on}" aria-label="${esc(c ? `Reconnect ${s.label}` : `Connect ${s.label}`)}">
      <span class="srcname"><span class="srcicon" aria-hidden="true">${ICON[s.id] || ''}</span>${esc(s.label)}<span class="sd" aria-hidden="true"></span></span>
      <span class="srcwhat">${esc(s.what)}</span>
      <span class="srcstate">${esc(label)}</span>
    </button>`;
}

function catalogCard(r, c) {
  const on = !c ? '0' : c.status === 'ok' ? '1' : c.status === 'error' ? 'err' : 'p';
  const label = !c ? 'Not connected' : (STATE_LABEL[c.status] || 'Connected');
  const what = (r.description || '').replace(/\s+/g, ' ').trim();
  return `<button class="srccard" data-mslug="${esc(r.slug)}" data-on="${on}"
            aria-label="${esc(c ? `Reconnect ${r.title}` : `Connect ${r.title}`)}">
      <span class="srcname">${catIcon(r)}${esc(r.title)}<span class="sd" aria-hidden="true"></span></span>
      <span class="srcwhat" title="${esc(what)}">${esc(what || 'Remote source')}</span>
      <span class="srcstate">${esc(label)}</span>
    </button>`;
}

const skeletons = (n) => Array.from({ length: Math.max(0, n) }, () =>
  '<div class="srccard skel" aria-hidden="true"><span class="srcname"><span class="srcicon"></span><span class="sk sk-t"></span></span><span class="sk sk-w"></span><span class="sk sk-s"></span></div>').join('');

async function fetchCatalog(from, to) {
  let sel = window.OB.sb.from('mcp_catalog')
    .select('slug,title,description,url,auth,featured', { count: 'exact' });
  if (cat.q) {
    const safe = cat.q.replace(/[%,()]/g, ' ');
    sel = sel.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }
  if (cat.filter === 'featured') sel = sel.eq('featured', true);
  const { data, count, error } = await sel
    .order('featured', { ascending: false }).order('title').range(from, to);
  if (error) throw new Error(error.message || 'catalog unavailable');
  return { rows: data || [], count: count || 0 };
}

/* Logos load after the card is in the DOM, with the fallback listener
 * attached BEFORE src is set so a 404 can never slip past it: a missing
 * favicon turns into the coloured initial rather than a broken image. */
function loadLogos(root) {
  root.querySelectorAll('.srcicon.logo[data-logo]').forEach((box) => {
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    const fallback = () => {
      box.classList.remove('logo'); box.classList.add('tile');
      box.textContent = box.dataset.initial || '?';
    };
    img.addEventListener('error', fallback);
    // A placeholder answer for an unknown host is a few pixels wide.
    img.addEventListener('load', () => { if (img.naturalWidth < 8) fallback(); });
    img.src = logoUrl(box.dataset.logo);
    box.appendChild(img);
    box.removeAttribute('data-logo');
  });
}

function wireCards(root) {
  root.querySelectorAll('[data-src]').forEach((b) =>
    b.addEventListener('click', () => connect(b)));
  root.querySelectorAll('[data-mslug]').forEach((b) =>
    b.addEventListener('click', () => {
      b.querySelector('.srcstate').textContent = 'Checking\u2026';
      const provider = `mcp:${catShort(b.dataset.mslug)}`;
      if (state.conns.some((c) => c.provider === provider)) {
        // Already connected: fix what it reads, no second consent screen.
        mcpRepair(provider, b.querySelector('.srcname').textContent.trim(), b);
      } else {
        mcpStart({ slug: b.dataset.mslug, card: b });
      }
    }));
  loadLogos(root);
}

/* Append cards without re-rendering (and re-wiring) the ones already there. */
function appendCards(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  wireCards(tpl.content);
  $('srcgrid').appendChild(tpl.content);
}

function paintFoot(note) {
  const shown = $('srcgrid').querySelectorAll('.srccard:not(.skel)').length;
  const fmt = (n) => n.toLocaleString('en-US');
  $('cat-count').textContent = note ? note
    : !cat.total ? 'No matches'
    : cat.done ? `All ${fmt(cat.total)} shown`
    : `Showing ${fmt(shown)} of ${fmt(cat.total)} \u2014 keep scrolling`;
  $('cat-more').hidden = cat.done || cat.loading || !cat.manual;
  $('catfoot').hidden = !cat.total && !note;
}

/* One continuous list. Built-in sources come first (they have a verified
 * first-party path), then the catalog in featured-then-alphabetical order,
 * fetched in batches as the reader nears the bottom. Search and the filters
 * reset the list; a stale fetch (typing fast) is dropped by sequence number. */
async function renderSources() {
  const seq = ++cat.seq;
  const grid = $('srcgrid');
  const by = Object.fromEntries(state.conns.map((c) => [c.provider, c]));
  const q = cat.q.toLowerCase();
  let natives = SOURCES.filter((s) => !q
    || s.label.toLowerCase().includes(q) || s.what.toLowerCase().includes(q));
  if (cat.filter === 'connected') natives = natives.filter((s) => by[s.id]);
  cat.natives = natives; cat.offset = 0; cat.done = false; cat.loading = false;
  cat.total = natives.length;
  grid.innerHTML = natives.map((s) => nativeCard(s, by[s.id])).join('');
  wireCards(grid);

  if (cat.filter === 'connected') {
    /* Connected is a view over what this org actually has, not the catalog. */
    const mcp = state.conns.filter((c) => String(c.provider).startsWith('mcp:'))
      .filter((c) => !q || c.provider.toLowerCase().includes(q));
    appendCards(mcp.map((c) => catalogCard({ slug: c.provider.slice(4),
      title: c.provider.slice(4), url: '',
      description: 'Remote source, polled every sweep.' }, c)).join(''));
    cat.total = natives.length + mcp.length; cat.done = true;
    if (!cat.total) grid.innerHTML = '<p class="catempty">Nothing is connected yet. Pick anything from All to start.</p>';
    paintFoot();
    return;
  }
  await loadMore(seq);
}

async function loadMore(seq = cat.seq) {
  if (cat.done || cat.loading) return;
  cat.loading = true;
  const grid = $('srcgrid');
  const by = Object.fromEntries(state.conns.map((c) => [c.provider, c]));
  grid.insertAdjacentHTML('beforeend',
    skeletons(cat.offset ? 6 : Math.max(3, BATCH - cat.natives.length)));
  paintFoot();
  let note = '';
  try {
    const { rows, count } = await fetchCatalog(cat.offset, cat.offset + BATCH - 1);
    if (seq !== cat.seq) return;
    cat.total = cat.natives.length + count;
    cat.offset += rows.length;
    if (rows.length < BATCH || cat.offset >= count) cat.done = true;
    grid.querySelectorAll('.skel').forEach((el) => el.remove());
    appendCards(rows.map((r) => catalogCard(r, by[`mcp:${catShort(r.slug)}`])).join(''));
    if (!grid.querySelector('.srccard')) {
      grid.innerHTML = `<p class="catempty">Nothing matches &ldquo;${esc(cat.q)}&rdquo;. Try
        another name, or add it by server address below.</p>`;
    }
  } catch (e) {
    if (seq !== cat.seq) return;
    grid.querySelectorAll('.skel').forEach((el) => el.remove());
    note = `Catalog unavailable \u2014 ${String(e.message || e).slice(0, 60)}`;
    cat.done = true;
  } finally {
    if (seq === cat.seq) {
      cat.loading = false; paintFoot(note);
      /* The observer only reports CHANGES. If the end marker was already in
       * range while this batch loaded (a tall viewport, a short list), it
       * stays in range and the observer stays silent — so look once more. */
      if (!cat.done) requestAnimationFrame(() => { if (nearEnd()) loadMore(); });
    }
  }
}

const nearEnd = () => {
  const el = $('cat-sentinel');
  return !!el && !el.closest('[hidden]')
    && el.getBoundingClientRect().top < innerHeight + 480;
};

/* Connecting a Google source is a plain navigation through Supabase Auth's own
 * /authorize endpoint — the identical GoTrue flow the login page uses, with two
 * additions Google requires for a refresh token (access_type=offline,
 * prompt=consent) and the one read-only scope this source needs. No SDK, no
 * widget, no third-party script: the browser leaves, consents, and comes back
 * to this page with the grant in the URL fragment.
 *
 * Scopes are requested at CONNECT time, never at sign-in — folding
 * gmail.readonly into login would show every colleague a Gmail consent screen
 * just to open the dashboard.
 */
async function connectGoogle(btn) {
  const provider = btn.dataset.src;
  const st = btn.querySelector('.srcstate');
  st.textContent = 'Redirecting to Google…';
  try {
    const cfg = await api('/v1/connect/config');
    if (!cfg.google_ready) {
      st.textContent = 'Google connect is not configured on this server';
      return;
    }
    sessionStorage.setItem('ob_connect_provider', provider);
    const u = new URL(`${cfg.supabase_url}/auth/v1/authorize`);
    u.searchParams.set('provider', 'google');
    u.searchParams.set('redirect_to', `${location.origin}${location.pathname}`);
    u.searchParams.set('scopes', cfg.google_scopes[provider]);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    /* include_granted_scopes is deliberately ABSENT: with it, Google's Allow
     * click 500s ("Something went wrong") whenever the user already granted
     * another scope — reproduced 2026-08-31. Each source keeps its own
     * refresh token, so merged grants buy nothing anyway. */
    location.href = u.toString();
  } catch (e) {
    st.textContent = String(e.message || e).slice(0, 80);
  }
}

/* Trello, one hop: its /1/authorize page bounces the token straight back in
 * the URL fragment (return_url + callback_method=fragment) — the same return
 * shape as Google, so the wizard catches it and verifies with a live call.
 * No copy-paste. The org's (free) app key is the only one-time ask. */
function trelloAuthorize(cfg) {
  sessionStorage.setItem('ob_connect_provider', 'trello');
  const u = new URL(cfg.trello_authorize_url);
  u.searchParams.set('return_url', location.origin + location.pathname);
  u.searchParams.set('callback_method', 'fragment');
  location.href = u.toString();
}

async function connectTrello(btn) {
  const st = btn.querySelector('.srcstate');
  try {
    const cfg = await api('/v1/connect/config');
    state.cfg = cfg;
    if (cfg.trello_authorize_url) {
      st.textContent = 'Heading to Trello\u2026';
      trelloAuthorize(cfg);
      return;
    }
    const box = $('trello-attach');
    box.hidden = false;
    st.textContent = 'One-time setup \u2014 your organization\u2019s API key';
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth',
                         block: 'nearest' });
  } catch (e) {
    st.textContent = String(e.message || e).slice(0, 80);
  }
}

async function connect(btn) {
  if (btn.dataset.src === 'trello') return connectTrello(btn);
  return connectGoogle(btn);
}

// ---------------------------------------------------------------- step 3
// The plan is not optional: Continue stays disabled until a tier is chosen.
// Choosing writes the subscription immediately (no payment yet — Stripe
// activates it later), so a refresh or a return visit remembers it.

async function renderPlans() {
  const grid = $('plangrid'); const out = $('plan-out');
  try {
    const b = await api('/v1/billing');
    const chosen = b.subscription?.plan_code || '';
    grid.innerHTML = b.plans.map((pl) => `
      <button class="srccard" role="radio" data-plan="${esc(pl.code)}"
              aria-checked="${pl.code === chosen}" data-on="${pl.code === chosen ? '1' : '0'}">
        <span class="srcname">${esc(pl.name)}<span class="sd" aria-hidden="true"></span></span>
        <span class="srcwhat">$${Number(pl.usd_month)}/month &mdash; ${esc(pl.display_tokens)} included, rolls over</span>
        <span class="srcstate">${pl.code === chosen ? 'Selected' : 'Choose'}</span>
      </button>`).join('');
    out.textContent = `Balance: $${Number(b.balance_usd).toFixed(2)} — this month’s use: `
      + `${(b.month_tokens / 1e6).toFixed(2)}M tokens ($${Number(b.month_spend_usd).toFixed(4)})`;
    $('plan-next').disabled = !chosen;
    grid.querySelectorAll('[data-plan]').forEach((card) => {
      card.addEventListener('click', async () => {
        card.querySelector('.srcstate').textContent = 'Saving…';
        try {
          await post('/v1/billing/plan', { plan: card.dataset.plan });
          await renderPlans();
        } catch (e) {
          card.querySelector('.srcstate').textContent = String(e.message || e).slice(0, 60);
        }
      });
    });
  } catch (e) {
    out.textContent = String(e.message || e).slice(0, 120);
  }
}

/* Returning from Google: Supabase puts the grant in the URL fragment. The
 * fragment is scrubbed from the URL and history BEFORE any network call, so
 * tokens never survive in the address bar, a bookmark, or a shared screen. */
async function handleConnectReturn() {
  // The inline stash in onboard.html wins over location.hash: by module
  // time another consumer may already have scrubbed the URL.
  const rawHash = window.__ob_hash || location.hash;
  window.__ob_hash = '';
  const frag = new URLSearchParams(rawHash.slice(1));
  const prt = frag.get('provider_refresh_token');
  const trelloToken = frag.get('token');
  const hadTokens = frag.has('access_token') || frag.has('provider_token')
    || frag.has('token');
  const provider = sessionStorage.getItem('ob_connect_provider');
  if (!hadTokens || !provider) return false;
  history.replaceState(null, '', location.pathname);
  sessionStorage.removeItem('ob_connect_provider');
  state.step = STEP.sources;            // land back on the sources step
  steps.forEach((el, i) => { el.hidden = i !== STEP.sources; });
  paintRail();
  if (provider === 'trello') {
    try {
      const res = await post('/v1/connections/trello', { token: trelloToken || '' });
      announce(res.boards > 0
        ? `Trello connected as ${res.account || 'your account'} \u2014 `
          + `${res.boards} open board${res.boards === 1 ? '' : 's'} visible`
        : `Trello verified as ${res.account || 'your account'} \u2014 `
          + 'no open boards visible yet');
    } catch (e) {
      announce('Connecting Trello failed');
      try { await refresh(); } catch { /* render what we have */ }
      renderSources();
      const card = document.querySelector('[data-src="trello"] .srcstate');
      if (card) card.textContent = String(e.message || e).slice(0, 120);
      return true;
    }
    try { await refresh(); } catch { /* render what we have */ }
    renderSources();
    return true;
  }
  if (!prt) {
    announce('Google did not return offline access');
    try { await refresh(); } catch { /* render what we have */ }
    renderSources();
    const card = document.querySelector(`[data-src="${provider}"] .srcstate`);
    if (card) {
      card.textContent = 'Google returned no offline grant — press Connect and '
        + 'approve again';
    }
    return true;
  }
  try {
    await post('/v1/connections/google', {
      provider, provider_refresh_token: prt,
    });
    announce('Source connected and verified');
  } catch (e) {
    announce('Connecting failed');
    try { await refresh(); } catch { /* fall through to render */ }
    renderSources();
    const card = document.querySelector(`[data-src="${provider}"] .srcstate`);
    if (card) card.textContent = String(e.message || e).slice(0, 120);
    return true;
  }
  try { await refresh(); } catch { /* render what we have */ }
  renderSources();
  return true;
}

// ------------------------------------------------------------------ step 3

const ROW = (ok, name, detail, fix, pending, steps) => `
  <div class="vrow">
    ${pending ? '<span class="spinner" aria-hidden="true"></span>'
              : `<span class="sd" aria-hidden="true" style="margin-top:6px;background:${
                  ok ? 'var(--color-deep-verdant)' : 'var(--color-coral)'}"></span>`}
    <div>
      <b>${esc(name)}</b> <span class="vdetail">${esc(detail || '')}</span>
      ${!ok && fix ? `<p class="vfix">${esc(fix)}</p>` : ''}
      ${!ok && (steps || []).length ? `<ol class="vsteps">
        ${steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>` : ''}
    </div>
  </div>`;

/* Failed platform KEY rows get a paste field — for the operating org only.
 * The key is verified with a real provider call server-side before it is
 * stored (in Vault) and applied live, so no redeploy and no "saved but
 * broken" state. Other tenants keep the read-only hand-off view. */
const KEY_FIELDS = {
  'Anthropic API key': 'anthropic_api_key',
  'Voyage API key': 'voyage_api_key',
};

function keyForm(c) {
  const field = KEY_FIELDS[c.name];
  if (!field) return '';
  /* Keys are PER-ORG: every organization pastes its own and pays its own
   * bills, so there is no admin gate — you can only ever set yours. The ask is
   * ALWAYS present: a missing key asks plainly, a set one offers replacement
   * (self-serve rotation). Only a key entered HERE (provenance "org") counts
   * as set — the deployment's env keys are a bootstrap fallback, and a fresh
   * onboarding must not silently ride on them. Verify-before-store means a bad
   * paste can never displace a working key. */
  const replacing = c.ok && c.provenance === 'org';
  return `<div class="mrow keyform" data-field="${esc(field)}">
      <input class="fi" type="password"
             placeholder="${replacing ? 'paste a new key to replace the current one'
                                      : 'paste the key here'}"
             spellcheck="false" autocomplete="off"
             aria-label="${esc(c.name)}" />
      <button class="ghostpill" data-keysave>${replacing
        ? 'Verify &amp; replace' : 'Verify &amp; apply'}</button>
      <p class="fh" role="status"></p>
    </div>`;
}

function wireKeyForms() {
  document.querySelectorAll('.keyform').forEach((f) => {
    const btn = f.querySelector('[data-keysave]');
    const input = f.querySelector('input');
    const out = f.querySelector('[role="status"]');
    btn.addEventListener('click', async () => {
      const val = input.value.trim();
      if (!val) { out.textContent = 'Paste the key first.'; return; }
      btn.disabled = true; out.textContent = 'Verifying with the provider…';
      try {
        await post('/v1/org/keys', { [f.dataset.field]: val });
        input.value = '';
        out.textContent = 'Verified and applied — re-running the checks…';
        await runChecks();
      } catch (e) {
        out.textContent = String(e.message || e).slice(0, 180);
        btn.disabled = false;
      }
    });
  });
}

async function runChecks() {
  const box = $('vrows');
  $('vtitle').textContent = 'Checking…';
  box.innerHTML = ROW(true, 'Contacting your sources', '', '', true);
  try {
    const res = await api('/v1/preflight');
    /* Both audiences, clearly separated. Your sources first — the rows this org
     * can act on. Then the platform group: the keys and storage the deployment
     * runs on, live-verified here too, because during first setup the person
     * onboarding usually IS the person running the deployment. The label tells
     * everyone else who to hand a red row to, and each failure carries its own
     * numbered walkthrough. */
    const checks = res.checks || [];
    const mine = checks.filter((c) => c.scope === 'org' && c.name !== 'Sources');
    /* Platform = failing infrastructure only. The keys are the ORG's now — they
     * live in the group above with everything else this org sets up. Green
     * infra (sign-in, Vault, database) is noise here and stays in Operations;
     * a FAILING piece always surfaces, because "everything answered" over a
     * dead database would be a lie. */
    const platform = checks.filter((c) => c.scope !== 'org').filter((c) => !c.ok);
    /* A key row is only "done" when this ORG set its own key; the deployment's
     * env keys keep things RUNNING (fallback) but keep the ask OPEN. */
    const keyDone = (c) => KEY_FIELDS[c.name] === undefined
      ? c.ok : (c.ok && c.provenance === 'org');
    const okMine = mine.every((c) => keyDone(c) || !c.required);
    const okPlat = platform.length === 0;
    const onlyEnvKeys = !okMine
      && mine.every((c) => c.ok || !c.required);
    $('vtitle').textContent = !okPlat ? 'The platform needs attention'
      : !okMine ? (onlyEnvKeys ? 'Set your organization\u2019s keys'
                               : 'Some sources need attention')
      : mine.length ? 'Everything answered' : 'Nothing connected yet';
    box.innerHTML = (mine.length
        ? mine.map((c) => {
            const done = keyDone(c);
            const detail = done ? (KEY_FIELDS[c.name] !== undefined
                                     ? (c.detail || 'ok') : 'verified')
              : (c.ok ? 'not set for your organization — running on the '
                        + 'deployment\u2019s fallback key for now'
                      : c.detail);
            return ROW(done, c.name, detail, done ? '' : c.fix, false,
                       done ? [] : c.steps) + keyForm(c);
          }).join('')
        : ROW(true, 'Nothing connected',
              'Connect any source above whenever you want it ingested.', '', false))
      + (platform.length
        ? '<div class="vsub">Platform — what this deployment runs on. Fixed by '
          + 'whoever operates it, not per organization.</div>'
          + platform.map((c) => ROW(false, c.name, c.detail, c.fix, false,
                                    c.steps)).join('')
        : '');
    wireKeyForms();
    announce($('vtitle').textContent);
  } catch (e) {
    $('vtitle').textContent = 'Could not run the checks';
    box.innerHTML = ROW(false, 'Check failed', String(e.message || e).slice(0, 160),
      'Reload the page; if it persists the server may be down.');
  }
}

// ------------------------------------------------------------------ step 4

/* Done. Two things belong here and nothing else: the shortest honest path to
 * Claude on THIS machine, and one line about who else can get in.
 *
 * A web page cannot write ~/.claude/settings.json, so the machine setup is a
 * single pasted line — but it is ONE line, it needs no sign-in (the personal
 * token rides along, and the MCP endpoint accepts it as a bearer), and it
 * does everything: Claude Code tools, the auto-memory hooks, Claude Desktop.
 * Cursor and VS Code take a click. Invitations are not a wizard concern —
 * membership is by email domain, managed in Settings. */
const MCP_URL = `${FN}/mcp`;
const API_URL = `${FN}/api`;
let doneWired = false;
let doneToken = '';

function orgLabel() {
  const typed = ($('ob-name').value || '').trim();
  if (typed) return typed;
  const org = (state.ob && state.ob.org) || '';
  return org.startsWith('user:') ? 'Your memory' : (org || 'Your organization');
}

/* The site serves install.sh with this environment's API address already
 * inside (the sync fills it per target), so the line carries only the token. */
const installLine = (token) =>
  `curl -fsSL ${location.origin}/install.sh | bash -s -- ${token}`;

/* Every harness, filled in. With a token each client is authenticated at
 * once; without one (a return visit) the OAuth sign-in takes over. */
function paintHarnesses(token) {
  const tok = token || '<your personal token>';
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  $('h-code').textContent = installLine(tok);
  $('h-claude').textContent = MCP_URL;
  $('h-cursor').href = 'cursor://anysphere.cursor-deeplink/mcp/install?name=onebrain&config='
    + btoa(JSON.stringify({ url: MCP_URL, ...(headers ? { headers } : {}) }));
  $('h-vscode').href = 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify(
    { name: 'onebrain', type: 'http', url: MCP_URL, ...(headers ? { headers } : {}) }));
  $('h-windsurf').textContent = JSON.stringify({ onebrain: { serverUrl: MCP_URL,
    ...(headers ? { headers } : {}) } }, null, 2).replace(/^\{\n|\n\}$/g, '');
  $('h-gemini').textContent = `gemini mcp add --transport http onebrain ${MCP_URL}`
    + (token ? ` --header "Authorization: Bearer ${tok}"` : '');
  $('h-other').textContent = `${MCP_URL}\nAuthorization: Bearer ${tok}`;
}

function showLine(token, mintedAt) {
  doneToken = token || '';
  paintHarnesses(token);
  $('cc-out').textContent = token
    ? 'Your personal token is inside these. It is shown once — set up what you '
      + 'use now; leaving this page hides it.'
    : mintedAt
      ? `Your token was created ${new Date(mintedAt).toLocaleDateString()} and is not `
        + 'shown again. To set up another tool, create a new token — the old one stops working.'
      : 'Create a token to get these filled in.';
}

async function mintToken() {
  const res = await post('/v1/me/token');
  const steps = { ...((state.ob && state.ob.steps) || {}), token_minted_at: new Date().toISOString() };
  post('/v1/onboarding', { steps }).catch(() => {});
  if (state.ob) state.ob.steps = steps;
  return res.token;
}

async function renderDone() {
  const live = state.conns.filter((c) => c.status === 'ok').length;
  const name = orgLabel();
  $('donesum').textContent = live
    ? `${name} is connected to ${live} source${live === 1 ? '' : 's'}, and OneBrain `
      + 'starts collecting within the minute.'
    : `${name} is ready. Nothing is ingesting automatically yet — connect a source `
      + 'from Settings whenever you want it filled for you.';
  const org = (state.ob && state.ob.org) || '';
  $('done-team').textContent = org.startsWith('user:')
    ? 'This memory is keyed to your personal address, so it is yours alone. '
      + 'A work domain gets a shared one: everyone who signs in from it lands together.'
    : `Anyone with a Google account at ${org} who signs in at ${location.origin} `
      + 'lands in this memory — no invitation needed. Who is in, and who has '
      + 'connected what, lives in Settings.';

  if (!doneWired) { doneWired = true; wireDone(); }
  post('/v1/onboarding', { complete: true }).catch(() => {});

  /* First arrival: mint the token now, no button — the line must be ready
   * to copy. A return visit never re-mints on its own, because a new token
   * silently kills the one already installed on this person's machine. */
  const mintedAt = state.ob && state.ob.steps && state.ob.steps.token_minted_at;
  if (doneToken) { showLine(doneToken, mintedAt); return; }
  if (mintedAt) { showLine('', mintedAt); return; }
  $('cc-out').textContent = 'Creating your personal token\u2026';
  try { showLine(await mintToken()); }
  catch (e) {
    showLine('', null);
    $('cc-out').textContent = `Could not create your token: ${String(e.message || e).slice(0, 140)}`;
  }
}

function wireDone() {
  document.querySelectorAll('.harn [data-harn]').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.harn [data-harn]').forEach((x) =>
      x.setAttribute('aria-selected', String(x === t)));
    document.querySelectorAll('.harnpane').forEach((p) => { p.hidden = p.dataset.harn !== t.dataset.harn; });
  }));
  /* Claude Desktop registers the claude:// scheme and routes
   * claude://claude.ai/customize/connectors to its Connectors page; the https
   * twin does the same on claude.ai. Either press also puts the address on
   * the clipboard, so the only thing left in Claude is Add and paste. */
  document.querySelectorAll('[data-claude-open]').forEach((a) => a.addEventListener('click', () => {
    navigator.clipboard.writeText(MCP_URL).then(
      () => { $('h-claude-out').textContent = 'Address copied — in Claude, press “Add custom connector” and paste it.'; },
      () => { $('h-claude-out').textContent = 'Copy the address below, then paste it into “Add custom connector”.'; });
  }));
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = $(b.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      const was = b.textContent; b.textContent = 'Copied';
      setTimeout(() => { b.textContent = was; }, 1800);
    } catch { announce('Copy failed — select the text instead.'); }
  }));
  $('cc-mint').addEventListener('click', async () => {
    const btn = $('cc-mint');
    if (doneToken && !confirm('Create a new token? The one in the line above stops working.')) return;
    btn.disabled = true;
    try { showLine(await mintToken()); announce('New token created — shown once.'); }
    catch (e) { $('cc-out').textContent = `Could not create a token: ${String(e.message || e).slice(0, 140)}`; }
    finally { btn.disabled = false; }
  });
}

// ------------------------------------------------------------------- boot

async function refresh() {
  const [ob, conns, cfg] = await Promise.all([
    api('/v1/onboarding'),
    api('/v1/connections').catch(() => ({ connections: [] })),
    api('/v1/connect/config').catch(() => null),
  ]);
  state.ob = ob;
  state.conns = conns.connections || [];
  if (cfg) state.cfg = cfg;
  return ob;
}

/* Controls are wired BEFORE any await. Attaching them after the first fetch
 * meant the page painted a Continue button that silently did nothing until the
 * API came back — the click was simply dropped, which reads as a broken page. */
function wire() {
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    if (state.step === STEP.org) {
      b.disabled = true;
      try { await saveOrg(); } catch { /* naming is not worth blocking setup */ }
      b.disabled = false;
    }
    if (state.step === STEP.sources) { try { await refresh(); } catch { /* keep going */ } }
    if (state.step === STEP.plan && $('plan-next').disabled) return;
    show(Math.min(state.step + 1, steps.length - 1));
  }));
  document.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => show(Math.max(state.step - 1, 0), { back: true })));

  $('vrun').addEventListener('click', runChecks);

  if ($('tr-origin')) $('tr-origin').firstChild.textContent = location.origin + ' ';
  $('tr-origin')?.addEventListener('click', async () => {
    const b = $('tr-origin');
    try {
      await navigator.clipboard.writeText(location.origin);
      const was = b.innerHTML;
      b.textContent = 'Copied \u2713';
      setTimeout(() => { b.innerHTML = was; }, 1600);
    } catch { /* clipboard blocked: the text is still selectable */ }
  });

  $('tr-key-save').addEventListener('click', async () => {
    const out = $('tr-key-out'); const btn = $('tr-key-save');
    const key = $('tr-key').value.trim();
    if (!key) { out.textContent = 'Paste the API key first.'; return; }
    btn.disabled = true; out.textContent = 'Saving\u2026';
    try {
      await post('/v1/org/keys', { trello_api_key: key });
      $('tr-key').value = '';
      const cfg = await api('/v1/connect/config');
      state.cfg = cfg;
      out.textContent = 'Saved \u2014 heading to Trello to approve\u2026';
      trelloAuthorize(cfg);
    } catch (e) {
      out.textContent = `Failed: ${String(e.message || e).slice(0, 140)}`;
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------- remote (MCP) sources

const mcpShort = (s) => (String(s).split('/').pop() || 'server')
  .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'server';

/* Choosing what a remote source feeds us.
 *
 * A server lists everything it can do — create pages, upload files, get
 * users — and almost none of it is "hand me the content". The person
 * connecting should not have to know which of 27 tool names is the one
 * that reads. So: rank the reading tools (list, then search, then fetch;
 * ones that need no arguments first), try the best one for real, and only
 * fall back to asking when nothing answered. The server refuses any pick
 * that does not answer a live call, so "verified" here is measured. */

const WRITE_VERB = /(create|update|delete|remove|move|duplicate|upload|download|convert|archive|restore|write|post|send|add|set|edit|rename|patch|insert|put|trigger|run|execute|assign|invite|cancel|complete|submit|publish|import|export|sync)/i;
const NOT_CONTENT = /(user|users|team|teams|member|members|async|attachment|skill|file|folder|schema|meta|whoami|ping|health)/i;
const READ_RANK = [/list/i, /search/i, /query/i, /recent|latest|feed|timeline|history|changes/i, /fetch|get|read|retrieve|find|show/i];

function rankTools(tools) {
  const body = (t) => t.name.replace(/^[a-z0-9]+[-_.]/i, '');   // drop a vendor prefix
  const readable = tools.filter((t) => !WRITE_VERB.test(body(t)) && !NOT_CONTENT.test(body(t)));
  const pool = readable.length ? readable : tools;
  const score = (t) => {
    const i = READ_RANK.findIndex((r) => r.test(body(t)));
    return (i < 0 ? 9 : i) + ((t.required || []).length ? 0.5 : 0);
  };
  return { ranked: pool.slice().sort((x, y) => score(x) - score(y)), readable };
}

/* Arguments a reading tool insists on, filled with the widest net we can
 * cast: an empty query, a generous limit. Anything else is left for the
 * server to reject — which it does, out loud. */
function defaultArgs(t) {
  const args = {};
  for (const r of (t.required || [])) {
    if (/query|^q$|search|text|term|keyword|filter/i.test(r)) args[r] = '';
    else if (/limit|max|count|size|top|per_page/i.test(r)) args[r] = 50;
    else if (/page|offset|cursor|start/i.test(r)) args[r] = 0;
  }
  return args;
}

const nice = (name) => String(name).replace(/^[a-z0-9]+[-_.]/i, '').replace(/[-_.]+/g, ' ');

/* `save(tool, args)` is the write path for this connection (authless finish
 * or the tool endpoint); it resolves with {items} or throws with the
 * server's reason. Tries the ranked candidates in turn. */
async function mcpChoose({ label, tools, save, recipe, current }) {
  const box = $('mcp-toolpick');
  const title = $('mtp-title'); const sum = $('mtp-sum');
  const sel = $('mtp-select'); const out = $('mtp-out'); const adv = $('mtp-adv');
  box.hidden = false;
  title.textContent = `${label} is connected`;
  adv.open = false; out.textContent = '';
  if (!tools.length) {
    sum.textContent = `${label} lists nothing OneBrain can read, so nothing will be ingested from it.`;
    adv.hidden = true;
    return;
  }
  const { ranked, readable } = rankTools(tools);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  mtpSave = { save, byName };
  sel.innerHTML = (readable.length && readable.length < tools.length
    ? `<optgroup label="Reads content">${ranked.map((t) => `<option value="${esc(t.name)}">${esc(nice(t.name))}${t.description ? ` \u2014 ${esc(t.description.slice(0, 70))}` : ''}</option>`).join('')}</optgroup>`
      + `<optgroup label="Everything else the service offers">${tools.filter((t) => !readable.includes(t)).map((t) => `<option value="${esc(t.name)}">${esc(nice(t.name))}</option>`).join('')}</optgroup>`
    : ranked.map((t) => `<option value="${esc(t.name)}">${esc(nice(t.name))}${t.description ? ` \u2014 ${esc(t.description.slice(0, 70))}` : ''}</option>`).join(''));
  adv.hidden = false;
  box.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });

  const settle = (tool, items) => {
    sel.value = tool;
    sum.innerHTML = `OneBrain reads it through <b class="mono" translate="no">${esc(nice(tool))}</b>`
      + (items != null ? ` \u2014 ${items} item${items === 1 ? '' : 's'} on the first read.` : '.')
      + ' Facts reach the dashboard within a minute of each sweep.';
    announce(`${label} connected.`);
  };

  // Already reading (a recipe applied server-side): confirm, offer to change.
  if (current?.tool) { settle(current.tool, null); return; }

  const candidates = recipe?.tool ? [{ tool: recipe.tool, args: recipe.args || {} }] : [];
  for (const t of ranked.slice(0, 3)) {
    if (!candidates.some((c) => c.tool === t.name)) candidates.push({ tool: t.name, args: defaultArgs(t) });
  }
  const errors = [];
  for (const c of candidates) {
    sum.textContent = `Checking what it can hand back \u2014 trying ${nice(c.tool)}\u2026`;
    try {
      const r = await save(c.tool, c.args);
      settle(c.tool, r?.items);
      try { await refresh(); } catch { /* render what we have */ }
      renderSources();
      return;
    } catch (e) { errors.push(`${nice(c.tool)}: ${String(e.message || e).slice(0, 120)}`); }
  }
  // Nothing answered on its own — ask, with the reasons in view.
  sum.textContent = `${label} is connected, but none of its reading tools answered without help. Pick one below.`;
  adv.open = true;
  out.textContent = errors.join(' \u00b7 ');

}

/* The "Use this" button, wired once: whichever connection is currently in
 * the box is what it saves to. */
let mtpSave = null;
function wireToolBox() {
  $('mtp-save').addEventListener('click', async () => {
    if (!mtpSave) return;
    const sel = $('mtp-select'); const out = $('mtp-out'); const btn = $('mtp-save');
    const tool = sel.value; const t = mtpSave.byName[tool] || { name: tool, required: [] };
    btn.disabled = true; out.textContent = `Trying ${nice(tool)}\u2026`;
    try {
      const r = await mtpSave.save(tool, defaultArgs(t));
      out.textContent = `Now reading through ${nice(tool)}${r?.items != null ? ` \u2014 ${r.items} item${r.items === 1 ? '' : 's'} on the first read` : ''}.`;
      $('mtp-sum').innerHTML = `OneBrain reads it through <b class="mono" translate="no">${esc(nice(tool))}</b>. Facts reach the dashboard within a minute of each sweep.`;
      try { await refresh(); } catch { /* render what we have */ }
      renderSources();
    } catch (e) { out.textContent = `${nice(tool)}: ${String(e.message || e).slice(0, 160)}`; }
    btn.disabled = false;
  });
}

async function mcpStart({ slug, url, card }) {
  const out = $('mcp-out');
  /* The clicked card shows the outcome too — the status line lives below a
   * long list, and a card that says "Checking…" forever reads as stuck. */
  const st = card ? card.querySelector('.srcstate') : null;
  const say = (msg) => { if (st) st.textContent = msg; };
  $('mcp-toolpick').hidden = true;
  out.textContent = 'Checking the server…';
  const short = mcpShort(slug ||
    new URL(url).hostname.replace(/^mcp\./, '').split('.')[0]);
  try {
    const res = await post('/v1/connections/mcp/start', {
      slug: slug || '', url: url || '',
      return_to: `${location.origin}${location.pathname}?mcp=${encodeURIComponent(short)}`,
    });
    if (res.auth === 'oauth') {
      out.textContent = 'Handing you to the provider for consent…';
      say('Heading to the provider\u2026');
      location.href = res.authorize_url;
      return;
    }
    const label = res.server?.name || (card ? card.querySelector('.srcname').textContent.trim() : short);
    out.textContent = `${label} is reachable.`;
    say('Reachable \u2014 checking what it can hand back');
    await mcpChoose({
      label, tools: res.tools || [], recipe: res.recipe || null,
      save: async (tool, args) => {
        const r = await post('/v1/connections/mcp', {
          slug: short, url: res.url, tool, args,
          ...(res.recipe?.tool === tool && res.recipe?.since_arg ? { since_arg: res.recipe.since_arg } : {}),
        });
        out.textContent = `Connected ${r.connected}.`;
        return r;
      },
    });
  } catch (e) {
    out.textContent = `Failed: ${e.message || e}`;
    say(String(e.message || e).slice(0, 80));
    if (card) card.dataset.on = 'err';
  }
}

function wireCatalog() {
  let t;
  $('cat-q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = $('cat-q').value.trim();
      if (q === cat.q) return;
      cat.q = q;
      renderSources();
    }, 220);
  });
  $('cat-more').addEventListener('click', () => loadMore());
  if (!cat.manual) {
    // Fetch the next batch while the reader is still a couple of rows above
    // the end. The observer catches most cases; the scroll listener catches
    // the rest (the observer reports changes, and a marker that stays inside
    // its margin while a batch loads never changes).
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); },
                             { rootMargin: '480px 0px' }).observe($('cat-sentinel'));
    let tick = false;
    addEventListener('scroll', () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => { tick = false; if (nearEnd()) loadMore(); });
    }, { passive: true });
  }
  // Scoped to the catalog: the Done step reuses the pill style for its tabs.
  document.querySelectorAll('#catalog .catfilter').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.filter === cat.filter) return;
    cat.filter = b.dataset.filter;
    document.querySelectorAll('#catalog .catfilter').forEach((x) =>
      x.setAttribute('aria-pressed', String(x === b)));
    renderSources();
  }));
  $('mcp-url-go').addEventListener('click', () => {
    const u = $('mcp-url').value.trim();
    if (u.startsWith('https://')) mcpStart({ url: u });
    else $('mcp-out').textContent = 'Paste an https:// server address.';
  });
}

async function handleMcpReturn() {
  // The OAuth callback bounces here with ?mcp=<short-slug>; the connection
  // already exists — what's left is choosing the ingestion tool.
  // The dashboard's "Fix now" link arrives with ?repair=mcp:<short-slug>.
  const params = new URLSearchParams(location.search);
  const short = params.get('mcp');
  const repair = params.get('repair');
  if (!short && !repair) return false;
  history.replaceState(null, '', location.pathname);
  state.step = STEP.sources;
  steps.forEach((el, i) => { el.hidden = i !== STEP.sources; });
  paintRail();
  const provider = repair && repair.startsWith('mcp:') ? repair : `mcp:${mcpShort(short || repair)}`;
  const label = provider.slice(4).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  /* Not awaited: the live tool check can take seconds, and the step — with
   * its Continue — must be on screen and usable while it runs. */
  mcpRepair(provider, label, null);
  return true;
}

/* An existing remote connection: (re)choose what it reads, verified live.
 * Used on the OAuth return leg and when a connected card is clicked. */
async function mcpRepair(provider, label, card) {
  const out = $('mcp-out');
  const st = card ? card.querySelector('.srcstate') : null;
  out.textContent = `${label} connected \u2014 checking what it can hand back\u2026`;
  try {
    const res = await post('/v1/connections/mcp/tools', { provider });
    out.textContent = '';
    if (st) st.textContent = 'Choosing what to read\u2026';
    await mcpChoose({
      label, tools: res.tools || [],
      /* A card was clicked because something is wrong: ignore the stored
       * pick and choose again, verified. */
      current: card ? null : (res.current || null),
      save: (tool, args) => post('/v1/connections/mcp/tool', { provider, tool, args }),
    });
  } catch (e) {
    out.textContent = `${label}: ${e.message || e}`;
    if (st) st.textContent = String(e.message || e).slice(0, 80);
  }
}

async function boot() {
  wire();
  paintRail();
  wireCatalog();
  wireToolBox();
  /* Reveal before any network round-trip. Everything marked .reveal starts
   * invisible for its entrance, and on a return from a provider the first
   * request can take seconds — a step with no visible Continue reads as
   * broken, not as loading. */
  document.querySelectorAll('.reveal, [data-words]').forEach((el) => el.classList.add('in'));
  const returned = (await handleConnectReturn()) || (await handleMcpReturn());
  let ob;
  try { ob = await refresh(); } catch { return; }   // 401 already redirected
  $('ob-domain').textContent = ob.org || '';
  $('wel-domain').textContent = ob.org || 'your domain';
  if (ob.display_name) $('ob-name').value = ob.display_name;
  /* The welcome is for the first visit. Someone who already named the
   * organization has read it; a return visit lands on the first real step. */
  if (ob.display_name && !returned && state.step === STEP.welcome) {
    state.step = STEP.org;
    steps.forEach((el, i) => { el.hidden = i !== STEP.org; });
    paintRail();
  }
  $('ob-name').placeholder = ob.org || 'Acme Inc.';
  if (ob.steps) {
    if (ob.steps.team) $('ob-team').value = ob.steps.team;
    if (ob.steps.goal) $('ob-goal').value = ob.steps.goal;
  }
  if (returned) renderSources();

  // Already finished? Say so rather than walking them through it again.
  if (ob.completed_at) $('exit').textContent = 'Back to dashboard';
}

boot();
